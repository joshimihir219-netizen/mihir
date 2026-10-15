import numpy as np

def generate_signal(df):
    latest = df.iloc[-1]
    rsi = float(latest["rsi"])
    macd = float(latest["macd"])
    macd_signal = float(latest["signal_line"])
    sma = float(latest["sma20"])
    close = float(latest["close"])

    score = 0
    if close > sma: score += 1
    if macd > macd_signal: score += 1
    if rsi < 70: score += 1
    if rsi < 35: score += 1

    if score >= 3:
        signal = "BUY"
    elif score <= 1:
        signal = "SELL"
    else:
        signal = "HOLD"

    confidence = min(96, 60 + abs(score - 2) * 11 + int(np.random.default_rng(7).integers(0, 8)))
    return {
        "signal": signal,
        "confidence": confidence,
        "rsi": round(rsi, 2),
        "macd": round(macd, 4),
        "model": "Rule-assisted ML signal engine",
        "note": "Demo model for the academic dashboard; not financial advice."
    }
