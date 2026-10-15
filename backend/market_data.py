import time
from datetime import datetime
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


def _demo_frame(symbol="NIFTY 50", periods=80, interval="5m", duration=None, duration_unit="days"):
    bases = {
        "NIFTY 50": 25842.35,
        "BANK NIFTY": 58320.10,
        "SENSEX": 84500.0,
        "RELIANCE": 1450.0,
        "TCS": 3200.0,
        "INFOSYS": 1500.0,
        "HDFC BANK": 950.0,
        "ICICI BANK": 1400.0,
        "SBIN": 800.0,
        "ITC": 400.0,
        "BHARTI AIRTEL": 1900.0,
        "BTC/USDT": 112640.20,
        "ETH/USDT": 4182.75,
    }
    base = bases.get(symbol, bases["NIFTY 50"])
    rng = np.random.default_rng(abs(hash(symbol)) % (2**32))
    frequency = TIMEFRAME_FREQUENCY[interval]
    if duration is None:
        dates = pd.date_range(end=datetime.now(), periods=periods, freq=frequency)
    else:
        end = datetime.now()
        start = end - _duration_offset(duration, duration_unit)
        dates = pd.date_range(start=start, end=end, freq=frequency)
        periods = len(dates)
    returns = rng.normal(0.0004, 0.008, periods)
    close = base * np.cumprod(1 + returns)
    df = pd.DataFrame({"time": dates, "close": close})
    df["open"] = df["close"].shift(1).fillna(df["close"] * 0.998)
    df["high"] = df[["open", "close"]].max(axis=1) * (1 + rng.uniform(0, .003, periods))
    df["low"] = df[["open", "close"]].min(axis=1) * (1 - rng.uniform(0, .003, periods))
    df["volume"] = rng.integers(50000, 400000, periods)
    return df


def _add_indicators(df):
    df = df.copy()
    df["sma20"] = df["close"].rolling(20).mean()
    delta = df["close"].diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    df["rsi"] = (100 - 100 / (1 + rs)).fillna(50)
    ema12 = df["close"].ewm(span=12, adjust=False).mean()
    ema26 = df["close"].ewm(span=26, adjust=False).mean()
    df["macd"] = ema12 - ema26
    df["signal_line"] = df["macd"].ewm(span=9, adjust=False).mean()
    return df


def market_frame(symbol="NIFTY 50", periods=80, live=True, interval="5m", duration=None, duration_unit="days"):
    if interval not in TIMEFRAME_HISTORY:
        raise ValueError(f"Unsupported market timeframe: {interval}")
    if duration is not None and not 1 <= duration <= _max_duration(interval, duration_unit):
        raise ValueError(f"Duration must be between 1 and {_max_duration(interval, duration_unit)} {duration_unit} for {interval}.")
    key = (symbol, periods, interval, duration, duration_unit)
    now = time.time()
    if live and key in _cache and now - _cache[key][0] < CACHE_SECONDS:
        return _cache[key][1].copy(), True

    df = None
    if live and yf is not None and symbol in SYMBOL_MAP:
        try:
            ticker = yf.Ticker(SYMBOL_MAP[symbol])
            data = ticker.history(period=TIMEFRAME_HISTORY[interval], interval=interval, auto_adjust=False)
            if data is not None and not data.empty:
                data = data.reset_index()
                time_col = "Datetime" if "Datetime" in data.columns else "Date"
                df = pd.DataFrame({
                    "time": pd.to_datetime(data[time_col]),
                    "open": data["Open"].astype(float),
                    "high": data["High"].astype(float),
                    "low": data["Low"].astype(float),
                    "close": data["Close"].astype(float),
                    "volume": data["Volume"].astype(float),
                }).dropna(subset=["close"])
                if duration is None:
                    df = df.tail(periods)
        except Exception:
            df = None

    if df is not None and not df.empty and duration is not None:
        cutoff = pd.Timestamp.now(tz="UTC") - _duration_offset(duration, duration_unit)
        timestamps = pd.to_datetime(df["time"], utc=True)
        df = df.loc[timestamps >= cutoff].reset_index(drop=True)

    is_live = df is not None and not df.empty
    if not is_live:
        df = _demo_frame(symbol, periods, interval, duration, duration_unit)

    df = _add_indicators(df)
    _cache[key] = (now, df.copy())
    return df, is_live
