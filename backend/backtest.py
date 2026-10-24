"""Long-only underlying simulation: closed-bar decision, next-open execution."""
import math
import numpy as np
from strategies import resolve_strategy, strategy_frame


def run_backtest(df, initial_capital=100000, strategy="EMA Trend", config=None,
                 position_size=1000, stop_loss=1.5, fee_bps=10, slippage_bps=5, start_time=None):
    values = (initial_capital, position_size, stop_loss, fee_bps, slippage_bps)
    if not all(math.isfinite(float(value)) for value in values) or initial_capital <= 0 or position_size <= 0 or not 0 < stop_loss < 100 or not 0 <= fee_bps <= 100 or not 0 <= slippage_bps <= 100:
        raise ValueError("Invalid capital, allocation, stop loss, or trading costs.")
    config = resolve_strategy(strategy, config)
    frame = strategy_frame(df.reset_index(drop=True), config)
    cash, units, entry, entry_cost, stop = float(initial_capital), 0, 0, 0, 0
    equity, times, ledger = [], [], []
    fee, slip = fee_bps / 10000, slippage_bps / 10000
    entry_time = None

    def exit_trade(price, row, reason):
        nonlocal cash, units
        fill = price * (1 - slip)
        proceeds = units * fill
        exit_fee = proceeds * fee
        pnl = proceeds - exit_fee - entry_cost
        cash += proceeds - exit_fee
        ledger.append({"entry_time": entry_time, "exit_time": str(row.time), "side": "LONG",
                       "quantity": units, "entry_price": entry, "exit_price": fill,
                       "fees": entry_cost - units * entry + exit_fee,
                       "pnl": pnl, "reason": reason})
        units = 0

    for i in range(1, len(frame)):
        row, previous = frame.iloc[i], frame.iloc[i - 1]
        if start_time is not None and row.time < start_time:
            continue
        if units and previous.direction == "SELL":
            exit_trade(float(row.open), row, "strategy_exit")
        elif not units and previous.direction == "BUY":
            entry = float(row.open) * (1 + slip)
            allocation = min(cash, float(position_size))
            # Whole underlying units; no leverage or synthetic index option returns.
            units = math.floor(allocation / (entry * (1 + fee)))
            if units:
                entry_cost = units * entry * (1 + fee)
                cash -= entry_cost
                stop = entry * (1 - stop_loss / 100)
                entry_time = str(row.time)
        if units and row.low <= stop:
            exit_trade(min(float(row.open), stop), row, "stop_loss")
        if units and i == len(frame) - 1:
            exit_trade(float(row.close), row, "end_of_test")
        equity.append(cash + units * float(row.close))
        times.append(str(row.time))
    if not equity:
        raise ValueError("Insufficient completed history for this test.")
    curve = np.array([initial_capital, *equity])
    peaks = np.maximum.accumulate(curve)
    pnl = equity[-1] - initial_capital
    wins = sum(trade["pnl"] > 0 for trade in ledger)
    return {"initial_capital": initial_capital, "final_value": round(equity[-1], 2),
            "pnl": round(pnl, 2), "return_pct": round(pnl / initial_capital * 100, 2),
            "trades": len(ledger), "win_rate": round(wins / len(ledger) * 100, 2) if ledger else 0,
            "max_drawdown": round(float(((peaks - curve) / peaks * 100).max()), 2),
            "equity_curve": [round(value, 2) for value in equity], "equity_times": times,
            "trade_ledger": ledger, "strategy": config.name, "strategy_config": config.model_dump(),
            "position_size": position_size, "stop_loss": stop_loss, "fee_bps": fee_bps,
            "slippage_bps": slippage_bps, "actual_start": times[0], "actual_end": times[-1],
            "instrument_type": "underlying_long_only",
            "assumptions": "Next candle open; whole units; no leverage; stop gaps filled at open with slippage; final position liquidated. Index results are hypothetical underlying units, not option P&L. Costs are estimates, not a broker tax ledger."}
