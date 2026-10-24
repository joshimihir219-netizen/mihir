"""Deterministic, causal rules shared by streaming analysis and historical tests."""
import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal

STRATEGIES = {
    "EMA Trend": "EMA fast/slow alignment with RSI momentum confirmation.",
    "RSI Reversal": "RSI crosses back above oversold or below overbought.",
    "Breakout Momentum": "Close breaks the previous channel with volume confirmation.",
    "VWAP Trend": "Session VWAP and EMA alignment; requires traded volume.",
    "Mean Reversion": "Close returns inside Bollinger bands after an excursion.",
}
ALIASES = {"AI Momentum": "EMA Trend", "Swing Breakout": "Breakout Momentum"}


class StrategyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(default="EMA Trend", min_length=1, max_length=40)
    template: Literal["EMA Trend", "RSI Reversal", "Breakout Momentum", "VWAP Trend", "Mean Reversion"] = "EMA Trend"
    fast: int = Field(default=12, ge=2, le=100)
    slow: int = Field(default=26, ge=3, le=200)
    lookback: int = Field(default=20, ge=5, le=100)
    oversold: float = Field(default=30, ge=5, le=45)
    overbought: float = Field(default=70, ge=55, le=95)
    volume_multiplier: float = Field(default=1, ge=0.1, le=5)

    @model_validator(mode="after")
    def ordered_windows(self):
        if self.fast >= self.slow:
            raise ValueError("Fast EMA must be shorter than slow EMA.")
        if not self.name.strip():
            raise ValueError("Strategy name cannot be blank.")
        return self


def resolve_strategy(name="EMA Trend", config=None):
    if config is not None:
        return config if isinstance(config, StrategyConfig) else StrategyConfig.model_validate(config)
    template = ALIASES.get(name, name)
    if template not in STRATEGIES:
        raise ValueError("Unknown strategy. Supply a valid strategy configuration.")
    return StrategyConfig(name=name, template=template)


def strategy_frame(df, config):
    """Each row uses only information available at that row's close."""
    frame = df.copy()
    close = frame.close
    fast = close.ewm(span=config.fast, adjust=False).mean()
    slow = close.ewm(span=config.slow, adjust=False).mean()
    delta = close.diff()
    gains = delta.clip(lower=0).rolling(14).mean()
    losses = (-delta.clip(upper=0)).rolling(14).mean()
    rsi = 100 - 100 / (1 + gains / losses.replace(0, np.nan))
    rsi = rsi.mask((losses == 0) & (gains > 0), 100).mask((losses == 0) & (gains == 0), 50)
    mean = close.rolling(config.lookback).mean()
    deviation = close.rolling(config.lookback).std(ddof=0)
    upper, lower = mean + 2 * deviation, mean - 2 * deviation
    volume = frame.volume.clip(lower=0)
    if config.template == "EMA Trend":
        buy, sell = (fast > slow) & (rsi.between(50, 70)), (fast < slow) & (rsi.between(30, 50))
    elif config.template == "RSI Reversal":
        buy = (rsi > config.oversold) & (rsi.shift() <= config.oversold)
        sell = (rsi < config.overbought) & (rsi.shift() >= config.overbought)
    elif config.template == "Breakout Momentum":
        confirmation = volume >= volume.rolling(config.lookback).mean().shift() * config.volume_multiplier
        buy = (close > frame.high.rolling(config.lookback).max().shift()) & confirmation & (volume > 0)
        sell = (close < frame.low.rolling(config.lookback).min().shift()) & confirmation & (volume > 0)
    elif config.template == "VWAP Trend":
        sessions = pd.to_datetime(frame.time, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
        typical = (frame.high + frame.low + close) / 3
        vwap = (typical * volume).groupby(sessions).cumsum() / volume.groupby(sessions).cumsum().replace(0, np.nan)
        buy, sell = (close > vwap) & (fast > slow) & (volume > 0), (close < vwap) & (fast < slow) & (volume > 0)
    else:
        buy = (close > lower) & (close.shift() <= lower.shift())
        sell = (close < upper) & (close.shift() >= upper.shift())
    warmup = max(config.slow, config.lookback, 15)
    ready = pd.Series(np.arange(len(frame)) >= warmup - 1, index=frame.index)
    frame["direction"] = np.select([buy & ready, sell & ready], ["BUY", "SELL"], default="HOLD")
    frame["ready"] = ready
    frame["rsi"] = rsi
    return frame
