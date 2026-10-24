import time
from fastapi import HTTPException
import numpy as np
import pandas as pd

try:
    import yfinance as yf
except ImportError:
    yf = None

SYMBOL_MAP = {
    "NIFTY 50": "^NSEI",
    "BANK NIFTY": "^NSEBANK",
    "SENSEX": "^BSESN",
    "RELIANCE": "RELIANCE.NS",
    "TCS": "TCS.NS",
    "INFOSYS": "INFY.NS",
    "HDFC BANK": "HDFCBANK.NS",
    "ICICI BANK": "ICICIBANK.NS",
    "SBIN": "SBIN.NS",
    "ITC": "ITC.NS",
    "BHARTI AIRTEL": "BHARTIARTL.NS",
    "BTC/USDT": "BTC-USD",
    "ETH/USDT": "ETH-USD",
}

_cache = {}
CACHE_SECONDS = 15
TIMEFRAME_HISTORY = {
    "1m": "7d",
    "2m": "60d",
    "5m": "60d",
    "15m": "60d",
    "30m": "60d",
    "60m": "60d",
    "90m": "60d",
    "1h": "60d",
    "1d": "5y",
    "5d": "5y",
    "1wk": "10y",
    "1mo": "10y",
    "3mo": "10y",
}
TIMEFRAME_FREQUENCY = {
    "1m": "min",
    "2m": "2min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "60m": "h",
    "90m": "90min",
    "1h": "h",
    "1d": "D",
    "5d": "5D",
    "1wk": "W",
    "1mo": "MS",
    "3mo": "QS",
}
TIMEFRAME_MAX_DURATION_DAYS = {
    "1m": 7,
    "2m": 60,
    "5m": 60,
    "15m": 60,
    "30m": 60,
    "60m": 60,
    "90m": 60,
    "1h": 60,
    "1d": 1825,
    "5d": 1825,
    "1wk": 3650,
    "1mo": 3650,
    "3mo": 3650,
}


def _duration_offset(duration, unit):
    if unit == "months":
        return pd.DateOffset(months=duration)
    if unit == "years":
        return pd.DateOffset(years=duration)
    return pd.Timedelta(days=duration)


def _max_duration(interval, unit):
    if unit not in {"days", "months", "years"}:
        raise ValueError(f"Unsupported duration unit: {unit}")
    divisor = {"days": 1, "months": 30, "years": 365}[unit]
    return TIMEFRAME_MAX_DURATION_DAYS[interval] // divisor


def _add_indicators(df):
    df = df.copy()
    df["sma20"] = df["close"].rolling(20).mean()
    delta = df["close"].diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    df["rsi"] = (100 - 100 / (1 + rs)).mask((loss == 0) & (gain > 0), 100).fillna(50)
    ema12 = df["close"].ewm(span=12, adjust=False).mean()
    ema26 = df["close"].ewm(span=26, adjust=False).mean()
    df["macd"] = ema12 - ema26
    df["signal_line"] = df["macd"].ewm(span=9, adjust=False).mean()
    return df


def completed_candles(df, interval, now=None):
    now = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    times = pd.to_datetime(df.time, utc=True)
    offsets = {"1mo": pd.DateOffset(months=1), "3mo": pd.DateOffset(months=3)}
    offset = offsets.get(interval)
    if offset is None:
        frequency = {"1wk": "7D"}.get(interval, TIMEFRAME_FREQUENCY[interval])
        offset = pd.Timedelta("1" + frequency if frequency.isalpha() else frequency)
    return df.loc[times + offset <= now].reset_index(drop=True)


def data_metadata(df, interval, closed=False):
    last = pd.to_datetime(df.time.iloc[-1], utc=True)
    now = pd.Timestamp.now(tz="UTC")
    # Intraday freshness is deliberately strict: closed markets cannot issue new entries.
    tolerance = pd.Timedelta(minutes=2) + pd.Timedelta(
        {"1m": "1min", "2m": "2min", "5m": "5min", "15m": "15min", "30m": "30min",
         "60m": "1h", "90m": "90min", "1h": "1h", "1d": "1D", "5d": "5D",
         "1wk": "7D", "1mo": "31D", "3mo": "93D"}[interval])
    if closed:
        tolerance = tolerance * 2 - pd.Timedelta(minutes=2)
    stale = now - last > tolerance
    return {"data_source": df.attrs.get("data_source", "Yahoo Finance (may be delayed)"),
            "data_as_of": last.isoformat(), "fetched_at": df.attrs.get("fetched_at"),
            "stale": bool(stale), "live": bool(df.attrs.get("broker", False) and not stale),
            "status": "stale_or_market_closed" if stale else "broker_candles" if df.attrs.get("broker") else "provider_may_be_delayed"}


def market_frame(symbol="NIFTY 50", periods=80, live=True, interval="5m", duration=None, duration_unit="days"):
    if symbol not in SYMBOL_MAP:
        raise HTTPException(status_code=422, detail="Unsupported market symbol.")
    if interval not in TIMEFRAME_HISTORY:
        raise ValueError(f"Unsupported market timeframe: {interval}")
    if not live:
        raise HTTPException(status_code=422, detail="Synthetic market data is disabled.")
    if duration is not None and not 1 <= duration <= _max_duration(interval, duration_unit):
        raise ValueError("Requested duration exceeds provider history.")
    key = (symbol, periods, interval, duration, duration_unit)
    now = time.time()
    if key in _cache and now - _cache[key][0] < CACHE_SECONDS:
        df = _cache[key][1].copy()
        return df, data_metadata(df, interval)["live"]
    # Prefer the configured broker for supported Indian market intervals. Never mask a broker failure.
    from angel_options import broker_market_frame, broker_configured, BROKER_INTERVALS
    if broker_configured() and not symbol.endswith("/USDT") and interval in BROKER_INTERVALS:
        df = broker_market_frame(symbol, interval, periods, duration, duration_unit)
        df.attrs.update(data_source="Angel One SmartAPI", broker=True)
    else:
        if yf is None:
            raise HTTPException(status_code=503, detail="Yahoo Finance dependency is unavailable.")
        try:
            data = yf.Ticker(SYMBOL_MAP[symbol]).history(period=TIMEFRAME_HISTORY[interval], interval=interval, auto_adjust=False)
            if data is None or data.empty:
                raise ValueError("Empty history")
            data = data.reset_index()
            time_col = "Datetime" if "Datetime" in data.columns else "Date"
            df = pd.DataFrame({"time": pd.to_datetime(data[time_col], utc=True),
                               **{column.lower(): pd.to_numeric(data[column], errors="coerce")
                                  for column in ("Open", "High", "Low", "Close", "Volume")}})
        except Exception as error:
            raise HTTPException(status_code=502, detail=f"Market history unavailable for {symbol}; no synthetic data substituted.") from error
        df.attrs.update(data_source="Yahoo Finance (may be delayed)", broker=False)
    df = df.dropna(subset=["time", "open", "high", "low", "close", "volume"])
    df = df.loc[np.isfinite(df[["open", "high", "low", "close", "volume"]]).all(axis=1)]
    df = df.loc[(df.close > 0) & (df.open > 0) & (df.low > 0) &
                (df.high >= df[["open", "close", "low"]].max(axis=1)) &
                (df.low <= df[["open", "close"]].min(axis=1)) & (df.volume >= 0)]
    df = df.sort_values("time").drop_duplicates("time").reset_index(drop=True)
    if duration is not None:
        cutoff = pd.Timestamp.now(tz="UTC") - _duration_offset(duration, duration_unit)
        df = df.loc[pd.to_datetime(df.time, utc=True) >= cutoff]
    else:
        df = df.tail(periods)
    if df.empty:
        raise HTTPException(status_code=502, detail="No valid market candles available.")
    df = _add_indicators(df.reset_index(drop=True))
    df.attrs["fetched_at"] = pd.Timestamp.now(tz="UTC").isoformat()
    _cache[key] = (now, df.copy())
    return df, data_metadata(df, interval)["live"]
