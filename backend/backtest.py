import numpy as np

def run_backtest(df, initial_capital=100000):
    capital = float(initial_capital)
    equity = []
    position = 0.0
    wins = 0
    trades = 0
    entry_price = 0.0

    for i in range(len(df)):
        price = float(df.close.iloc[i])
        sma = float(df.sma20.iloc[i])
        if np.isfinite(sma) and price > sma and position == 0:
            position = capital / price
            capital = 0
            entry_price = price
        elif np.isfinite(sma) and price < sma and position > 0:
            capital = position * price
            position = 0
            trades += 1
            wins += int(price > entry_price)
        equity.append(capital + position * price)

    if not equity:
        equity = [float(initial_capital)]
    final_value = equity[-1]
    pnl = final_value - initial_capital
    returns = np.diff(equity) / np.maximum(equity[:-1], 1)
    peak = np.maximum.accumulate(equity)
    drawdown = (np.array(equity) - peak) / peak * 100
    max_drawdown = abs(float(drawdown.min())) if len(drawdown) else 0

    return {
        "initial_capital": initial_capital,
        "final_value": round(float(final_value), 2),
        "pnl": round(float(pnl), 2),
        "return_pct": round(float(pnl / initial_capital * 100), 2),
        "trades": trades,
        "win_rate": round(float(wins / max(trades, 1) * 100), 2),
        "max_drawdown": round(max_drawdown, 2),
        "equity_curve": [round(float(x), 2) for x in equity[-60:]]
    }
