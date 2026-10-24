import json
import math
from threading import RLock
import os
from datetime import datetime
from urllib.error import URLError
from urllib.request import urlopen

import pandas as pd
import pyotp
from dotenv import load_dotenv
from fastapi import HTTPException
from SmartApi import SmartConnect

from market_data import completed_candles, data_metadata
from ml_engine import generate_signal
from strategies import resolve_strategy

INSTRUMENT_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=False)
INDEX_NAMES = {
    "NIFTY 50": "NIFTY",
    "BANK NIFTY": "BANKNIFTY",
    "SENSEX": "SENSEX",
}
BROKER_INTERVALS = {"1m": "ONE_MINUTE", "5m": "FIVE_MINUTE", "15m": "FIFTEEN_MINUTE", "30m": "THIRTY_MINUTE", "1h": "ONE_HOUR", "60m": "ONE_HOUR", "1d": "ONE_DAY"}
_option_signals = {}
_option_lock = RLock()
INSTRUMENT_CACHE_SECONDS = 3600
SESSION_CACHE_SECONDS = 20 * 60
_session = None
_session_created_at = None
_instruments = None
_instruments_loaded_at = None


def _smartapi_client():
    global _session, _session_created_at
    api_key = os.environ.get("ANGELONE_API_KEY", "").strip()
    client_code = os.environ.get("ANGELONE_CLIENT_CODE", "").strip()
    password = os.environ.get("ANGELONE_PASSWORD", "").strip()
    totp_secret = os.environ.get("ANGELONE_TOTP_SECRET", "").strip()
    if not all((api_key, client_code, password, totp_secret)):
        raise HTTPException(
            status_code=503,
            detail=(
                "Angel One SmartAPI is not configured. Set ANGELONE_API_KEY, "
                "ANGELONE_CLIENT_CODE, ANGELONE_PASSWORD, and ANGELONE_TOTP_SECRET "
                "in the backend environment."
            ),
        )

    if _session is not None and _session_created_at and (
        datetime.now() - _session_created_at
    ).total_seconds() < SESSION_CACHE_SECONDS:
        return _session

    try:
        client = SmartConnect(api_key=api_key)
        response = client.generateSession(client_code, password, pyotp.TOTP(totp_secret).now())
    except Exception as error:
        raise HTTPException(status_code=502, detail="Angel One login failed. Check the backend API credentials and TOTP configuration.") from error

    if not isinstance(response, dict) or not response.get("status"):
        detail = response.get("message", "Angel One rejected the login.") if isinstance(response, dict) else "Angel One returned an invalid login response."
        raise HTTPException(status_code=502, detail=detail)
    _session = client
    _session_created_at = datetime.now()
    return client


def _instrument_master():
    global _instruments, _instruments_loaded_at
    now = datetime.now()
    if (
        _instruments is not None
        and _instruments_loaded_at is not None
        and (now - _instruments_loaded_at).total_seconds() < INSTRUMENT_CACHE_SECONDS
    ):
        return _instruments
    try:
        with urlopen(INSTRUMENT_MASTER_URL, timeout=15) as response:
            records = json.loads(response.read().decode("utf-8"))
    except (OSError, URLError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=502, detail="Could not load Angel One's current instrument master.") from error
    if not isinstance(records, list):
        raise HTTPException(status_code=502, detail="Angel One returned an invalid instrument master.")
    _instruments = records
    _instruments_loaded_at = now
    return records


def _api_data(response, operation):
    if not isinstance(response, dict) or not response.get("status"):
        detail = response.get("message", f"Angel One {operation} request failed.") if isinstance(response, dict) else f"Angel One returned an invalid {operation} response."
        raise HTTPException(status_code=502, detail=detail)
    data = response.get("data")
    if data is None:
        raise HTTPException(status_code=502, detail=f"Angel One returned no {operation} data.")
    return data


def _quote_ltp(client, exchange, token):
    try:
        response = client.getMarketData("FULL", {exchange: [str(token)]})
    except Exception as error:
        raise HTTPException(status_code=502, detail="Broker quote request failed.") from error
    data = _api_data(response, "quote")
    fetched = data.get("fetched") if isinstance(data, dict) else None
    if not isinstance(fetched, list) or not fetched:
        raise HTTPException(status_code=502, detail="Angel One did not return a quote for the selected instrument.")
    try:
        ltp = float(fetched[0]["ltp"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Angel One returned an invalid last-traded price.") from error
    if not math.isfinite(ltp) or ltp <= 0:
        raise HTTPException(status_code=502, detail="Angel One returned a non-positive last-traded price.")
    quote_time = fetched[0].get("exchFeedTime") or fetched[0].get("exchTradeTime")
    try:
        stamp = pd.to_datetime(quote_time, format="%d-%b-%Y %H:%M:%S", errors="raise")
        if pd.isna(stamp):
            raise ValueError("Missing timestamp")
        if stamp.tzinfo is None:
            stamp = stamp.tz_localize("Asia/Kolkata")
        age = (pd.Timestamp.now(tz="UTC") - stamp.tz_convert("UTC")).total_seconds()
        if not -30 <= age <= 120:
            raise ValueError("Stale quote")
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Broker quote is stale or lacks an exchange timestamp; no new option entry.") from error
    return ltp


def _expiry_date(value):
    try:
        return datetime.strptime(value.upper(), "%d%b%Y").date()
    except (AttributeError, ValueError):
        return None


def broker_configured():
    return bool(os.environ.get("ANGELONE_API_KEY", "").strip())


def broker_instrument(symbol):
    from market_data import SYMBOL_MAP
    records = _instrument_master()
    if symbol in INDEX_NAMES:
        instrument = next((item for item in records
                           if str(item.get("name", "")).upper() == INDEX_NAMES[symbol]
                           and str(item.get("instrumenttype", "")).upper() == "AMXIDX"), None)
    else:
        ticker = SYMBOL_MAP[symbol].removesuffix(".NS") + "-EQ"
        instrument = next((item for item in records if item.get("exch_seg") == "NSE" and item.get("symbol") == ticker), None)
    if instrument is None:
        raise HTTPException(status_code=502, detail=f"Broker token unavailable for {symbol}.")
    return instrument


def broker_quote(symbol):
    instrument = broker_instrument(symbol)
    return _quote_ltp(_smartapi_client(), instrument["exch_seg"], instrument["token"])


def broker_market_frame(symbol, interval, periods=500, duration=None, duration_unit="days"):
    client = _smartapi_client()
    index = broker_instrument(symbol)
    now = pd.Timestamp.now(tz="Asia/Kolkata")
    days = 30 if interval == "1m" else 90 if interval in {"1h", "60m"} else 60 if interval != "1d" else 2000
    try:
        response = client.getCandleData({"exchange": index["exch_seg"], "symboltoken": str(index["token"]),
                       "interval": BROKER_INTERVALS[interval], "fromdate": (now - pd.Timedelta(days=days)).strftime("%Y-%m-%d %H:%M"),
                       "todate": now.strftime("%Y-%m-%d %H:%M")})
    except Exception as error:
        raise HTTPException(status_code=502, detail="Broker candle request failed.") from error
    rows = _api_data(response, "historical candle")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=502, detail="Broker returned no candles.")
    frame = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"])
    frame["time"] = pd.to_datetime(frame.time, utc=True, errors="coerce")
    for column in ("open", "high", "low", "close", "volume"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.tail(periods)


def get_live_option_signal(underlying, trade_type, config=None):
    with _option_lock:
        return _live_option_signal(underlying, trade_type, config)


def _live_option_signal(underlying, trade_type, config=None):
    config = resolve_strategy(config=config)
    if underlying not in INDEX_NAMES:
        raise HTTPException(status_code=422, detail="Live options are available only for NIFTY 50, BANK NIFTY, and SENSEX.")
    if trade_type not in {"INTRADAY", "BTST", "STBT"}:
        raise HTTPException(status_code=422, detail="Trade type must be INTRADAY, BTST, or STBT.")

    client = _smartapi_client()
    records = _instrument_master()
    index_name = INDEX_NAMES[underlying]
    index = next(
        (
            item for item in records
            if str(item.get("name", "")).upper() == index_name
            and str(item.get("instrumenttype", "")).upper() == "AMXIDX"
        ),
        None,
    )
    if index is None:
        raise HTTPException(status_code=502, detail=f"Angel One's instrument master has no live index token for {underlying}.")

    spot_exchange = str(index.get("exch_seg", "")).upper()
    spot_token = str(index.get("token", ""))
    spot = _quote_ltp(client, spot_exchange, spot_token)

    now = pd.Timestamp.now(tz="Asia/Kolkata")
    from market_data import market_frame
    frame, _ = market_frame(underlying, 500, interval="5m")
    if frame.attrs.get("data_source") != "Angel One SmartAPI" or data_metadata(frame, "5m")["stale"]:
        raise HTTPException(status_code=502, detail="Fresh broker candles are required for an option entry.")
    frame = completed_candles(frame, "5m")
    if frame.empty or data_metadata(frame, "5m", closed=True)["stale"]:
        raise HTTPException(status_code=502, detail="No fresh completed broker candles.")
    result = generate_signal(frame, config=config)
    signal_key = (underlying, trade_type, config.model_dump_json(), result["signal_time"])
    if signal_key in _option_signals:
        cached = _option_signals[signal_key]
        current = _quote_ltp(client, cached["exchange"], cached["token"]) if cached.get("contract") else None
        status = cached.get("setup_status", "observed")
        if current is not None and status == "observed":
            selling = cached["action"] == "SELL"
            if (selling and current >= cached["stop_loss_premium"]) or (not selling and current <= cached["stop_loss_premium"]):
                status = "stop_scenario_crossed"
            elif (selling and current <= cached["target_premium"]) or (not selling and current >= cached["target_premium"]):
                status = "target_scenario_crossed"
        cached["setup_status"] = status
        return {**cached, "current_premium": current, "updated_at": now.isoformat()}
    direction = result["signal"]
    trade_date = now.date()
    base_response = {
        "underlying": underlying,
        "signal": direction,
        "confidence": None,
        "strategy": config.name,
        "signal_id": "|".join(signal_key),
        "signal_time": result["signal_time"],
        "reason": result["reason"],
        "trade_type": trade_type,
        "spot": spot,
        "signal_date": trade_date.isoformat(),
        "updated_at": now.isoformat(),
        "data_source": "Angel One SmartAPI",
        "paper_only": True,
        "note": "Rule-based directional estimate using Angel One index candles; option levels are live quotes with model percentage exits, not guaranteed fills or investment advice.",
    }
    if direction not in {"BUY", "SELL"}:
        return {**base_response, "contract": None, "expiry": None, "action": None, "entry_premium": None, "target_premium": None, "stop_loss_premium": None}

    option_type = (
        "PE" if direction == "BUY" else "CE"
    ) if trade_type == "STBT" else (
        "CE" if direction == "BUY" else "PE"
    )
    side = "SELL" if trade_type == "STBT" else "BUY"
    option_exchange = "BFO" if underlying == "SENSEX" else "NFO"
    today = now.date()
    contracts = []
    for item in records:
        if (
            str(item.get("name", "")).upper() != index_name
            or str(item.get("exch_seg", "")).upper() != option_exchange
            or str(item.get("instrumenttype", "")).upper() != "OPTIDX"
            or not str(item.get("symbol", "")).upper().endswith(option_type)
        ):
            continue
        expiry = _expiry_date(item.get("expiry"))
        try:
            strike = float(item.get("strike", 0)) / 100
        except (TypeError, ValueError):
            continue
        if expiry and expiry >= today and (trade_type == "INTRADAY" or expiry > today) and strike > 0:
            contracts.append((expiry, strike, item))
    if not contracts:
        raise HTTPException(status_code=502, detail=f"No listed {option_type} contracts are available for {underlying}.")

    nearest_expiry = min(expiry for expiry, _, _ in contracts)
    _, strike, contract = min(
        (
            (expiry, strike, item)
            for expiry, strike, item in contracts
            if expiry == nearest_expiry
        ),
        key=lambda choice: abs(choice[1] - spot),
    )
    entry = _quote_ltp(client, option_exchange, contract.get("token"))
    target = entry * (0.8 if side == "SELL" else 1.25)
    stop = entry * (1.25 if side == "SELL" else 0.8)
    response = {
        **base_response,
        "contract": str(contract.get("symbol", "")),
        "exchange": option_exchange,
        "token": str(contract.get("token", "")),
        "strike": strike,
        "option_type": option_type,
        "expiry": nearest_expiry.isoformat(),
        "action": side,
        "entry_premium": round(entry, 2),
        "setup_status": "observed",
        "current_premium": round(entry, 2),
        "target_premium": round(target, 2),
        "stop_loss_premium": round(stop, 2),
    }

    if len(_option_signals) > 500:
        _option_signals.clear()
    _option_signals[signal_key] = response
    return response
