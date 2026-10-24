"""Rule based signals; no fitted model or probability claims."""
from strategies import resolve_strategy, strategy_frame


def generate_signal(df, strategy="EMA Trend", config=None):
    config = resolve_strategy(strategy, config)
    frame = strategy_frame(df, config)
    if frame.empty:
        raise ValueError("No completed candles are available.")
    latest = frame.iloc[-1]
    direction = latest.direction
    ready = bool(latest.ready)
    volume_missing = config.template in {"VWAP Trend", "Breakout Momentum"} and latest.volume <= 0
    return {
        "signal": direction,
        "confidence": None,
        "strategy": config.name,
        "strategy_config": config.model_dump(),
        "rsi": round(float(latest.rsi), 2) if ready else None,
        "macd": round(float(latest.get("macd", 0)), 4),
        "model": "Deterministic technical rules",
        "reason": "Volume unavailable for this strategy." if volume_missing else (
            "Insufficient warmup candles." if not ready else f"{config.template}: {direction} on completed candle."),
        "signal_time": latest.time.isoformat() if hasattr(latest.time, "isoformat") else str(latest.time),
        "reference_price": float(latest.close),
        "note": "Rule conditions are not a win probability. Entry is possible only after this candle closes.",
    }
