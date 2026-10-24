"""Synthetic fixtures test mechanics only; they are never provider fallbacks."""
import math
import unittest
from unittest.mock import patch, Mock
import numpy as np
import pandas as pd
from fastapi import HTTPException
from fastapi.testclient import TestClient

from strategies import STRATEGIES, StrategyConfig, resolve_strategy, strategy_frame
from ml_engine import generate_signal
from backtest import run_backtest
from market_data import _add_indicators, completed_candles, data_metadata, market_frame, _cache
import angel_options
from main import app


def candles(count=120):
    close = 100 + np.sin(np.arange(count) / 3) * 8 + np.arange(count) * .05
    return _add_indicators(pd.DataFrame({"time": pd.date_range(end=pd.Timestamp.now(tz="UTC").floor("5min"), periods=count, freq="5min"),
                                       "open": close, "high": close + 1, "low": close - 1,
                                       "close": close, "volume": np.full(count, 1000)}))


class StrategyTests(unittest.TestCase):
    def test_exactly_five_executable_templates(self):
        self.assertEqual(len(STRATEGIES), 5)
        for name in STRATEGIES:
            config = resolve_strategy(name)
            df = candles()
            result = generate_signal(df, config=config)
            self.assertIsNone(result["confidence"])
            self.assertEqual(result, generate_signal(df, config=config))
            self.assertEqual(result["signal"], strategy_frame(df, config).direction.iloc[-1])

    def test_future_candles_do_not_change_prior_decisions(self):
        df = candles()
        for name in STRATEGIES:
            config = resolve_strategy(name)
            before = strategy_frame(df.iloc[:80], config)
            changed = df.copy()
            changed.loc[80:, "close"] *= 2
            after = strategy_frame(changed, config)
            self.assertEqual(before.direction.tolist(), after.direction.iloc[:80].tolist())

    def test_rsi_is_100_for_rising_prices(self):
        df = candles()
        df["close"] = np.arange(len(df)) + 100
        self.assertEqual(strategy_frame(df, resolve_strategy()).rsi.iloc[-1], 100)
        self.assertEqual(_add_indicators(df).rsi.iloc[-1], 100)

    def test_parameters_are_validated_and_executed(self):
        with self.assertRaises(ValueError):
            StrategyConfig(fast=30, slow=10)
        with self.assertRaises(ValueError):
            resolve_strategy("nonexistent")
        df = candles()
        one = strategy_frame(df, StrategyConfig(template="EMA Trend", fast=2, slow=4)).direction
        two = strategy_frame(df, StrategyConfig(template="EMA Trend", fast=12, slow=60)).direction
        self.assertFalse(one.equals(two))

    def test_known_reversal_and_breakout_patterns(self):
        df = candles()
        df[["open", "close"]] = 100.0
        df["high"], df["low"] = 101.0, 99.0
        df.loc[len(df)-1, ["close", "high", "volume"]] = [110, 111, 2000]
        self.assertEqual(generate_signal(df, strategy="Breakout Momentum")["signal"], "BUY")
        self.assertEqual(generate_signal(df, strategy="VWAP Trend")["signal"], "BUY")
        df.loc[len(df)-2, "close"] = 60
        df.loc[len(df)-1, "close"] = 80
        self.assertEqual(generate_signal(df, strategy="RSI Reversal")["signal"], "BUY")
        df.loc[len(df)-1, "close"] = 100
        self.assertEqual(generate_signal(df, strategy="Mean Reversion")["signal"], "BUY")

    def test_zero_index_volume_does_not_invent_vwap_or_breakouts(self):
        df = candles()
        df["volume"] = 0
        for name in ("VWAP Trend", "Breakout Momentum"):
            self.assertEqual(generate_signal(df, strategy=name)["signal"], "HOLD")
            self.assertIn("Volume unavailable", generate_signal(df, strategy=name)["reason"])


class BacktestTests(unittest.TestCase):
    def fixture(self):
        df = candles(4)
        df["open"], df["close"], df["low"] = [100, 110, 120, 130], [100, 115, 125, 130], [99, 109, 119, 129]
        df["direction"] = ["BUY", "HOLD", "SELL", "HOLD"]
        df["ready"] = True
        return df

    def test_next_open_execution_exact_ledger_and_pnl(self):
        df = self.fixture()
        with patch("backtest.strategy_frame", return_value=df):
            result = run_backtest(df, initial_capital=1000, position_size=500, stop_loss=50, fee_bps=0, slippage_bps=0)
        self.assertEqual(result["trades"], 1)
        self.assertEqual(result["trade_ledger"][0]["entry_price"], 110)
        self.assertEqual(result["trade_ledger"][0]["exit_price"], 130)
        self.assertEqual(result["trade_ledger"][0]["quantity"], 4)
        self.assertEqual(result["pnl"], 80)
        self.assertEqual(result["final_value"], 1080)
        self.assertAlmostEqual(sum(t["pnl"] for t in result["trade_ledger"]), result["pnl"])
        self.assertEqual(len(result["equity_curve"]), len(result["equity_times"]))

    def test_gap_stop_and_costs(self):
        df = self.fixture()
        df.loc[2, ["open", "low"]] = [90, 85]
        with patch("backtest.strategy_frame", return_value=df):
            result = run_backtest(df, initial_capital=1000, position_size=500, stop_loss=10, fee_bps=10, slippage_bps=5)
        trade = result["trade_ledger"][0]
        self.assertEqual(trade["reason"], "stop_loss")
        self.assertAlmostEqual(trade["exit_price"], 90 * .9995)
        self.assertGreater(trade["fees"], 0)
        self.assertLess(result["pnl"], -80)

    def test_terminal_trade_is_closed_and_counted(self):
        df = self.fixture()
        df["direction"] = ["BUY", "HOLD", "HOLD", "HOLD"]
        with patch("backtest.strategy_frame", return_value=df):
            result = run_backtest(df, position_size=1000, stop_loss=50)
        self.assertEqual(result["trades"], 1)
        self.assertEqual(result["trade_ledger"][0]["reason"], "end_of_test")

    def test_selected_rules_change_results_and_costs_reduce_equity(self):
        df = candles(200)
        a = run_backtest(df, strategy="EMA Trend", position_size=10000)
        b = run_backtest(df, strategy="Mean Reversion", position_size=10000)
        self.assertNotEqual(a["trade_ledger"], b["trade_ledger"])
        free = run_backtest(df, strategy="EMA Trend", position_size=10000, fee_bps=0, slippage_bps=0)
        self.assertLessEqual(a["final_value"], free["final_value"])

    def test_invalid_inputs_rejected(self):
        for args in ({"initial_capital": float("inf")}, {"position_size": 0}, {"stop_loss": 0}, {"fee_bps": -1}):
            with self.assertRaises(ValueError):
                run_backtest(candles(), **args)


class DataTests(unittest.TestCase):
    def tearDown(self):
        _cache.clear()

    def test_incomplete_bar_cannot_change_signal(self):
        df = candles()
        now = df.time.iloc[-1] + pd.Timedelta(minutes=1)
        before = completed_candles(df, "5m", now)
        df.loc[len(df)-1, "close"] *= 3
        after = completed_candles(df, "5m", now)
        self.assertEqual(len(before), len(df)-1)
        self.assertEqual(generate_signal(before), generate_signal(after))
        # Supported month offsets also filter safely.
        self.assertEqual(len(completed_candles(df, "1mo", now)), 0)

    def test_yahoo_failure_never_generates_prices_or_cache(self):
        with patch("angel_options.broker_configured", return_value=False), patch("market_data.yf") as yf:
            yf.Ticker.return_value.history.return_value = pd.DataFrame()
            for _ in range(2):
                with self.assertRaises(HTTPException) as error:
                    market_frame("NIFTY 50")
                self.assertEqual(error.exception.status_code, 502)
        self.assertFalse(_cache)

    def test_delayed_and_stale_are_not_live(self):
        df = candles()
        self.assertFalse(data_metadata(df, "5m")["live"])
        df.attrs["broker"] = True
        self.assertTrue(data_metadata(df, "5m")["live"])
        df["time"] -= pd.Timedelta(days=3)
        self.assertTrue(data_metadata(df, "5m")["stale"])
        self.assertFalse(data_metadata(df, "5m")["live"])

    def test_stale_options_quotes_are_rejected(self):
        client = Mock()
        for quote_time in (None, "01-Jan-2020 12:00:00"):
            client.getMarketData.return_value = {"status": True, "data": {"fetched": [{"ltp": 100, "exchFeedTime": quote_time}]}}
            with self.assertRaises(HTTPException):
                angel_options._quote_ltp(client, "NFO", "1")
        fresh = pd.Timestamp.now(tz="Asia/Kolkata").strftime("%d-%b-%Y %H:%M:%S")
        client.getMarketData.return_value = {"status": True, "data": {"fetched": [{"ltp": 100, "exchFeedTime": fresh}]}}
        self.assertEqual(angel_options._quote_ltp(client, "NFO", "1"), 100)


class OptionsTests(unittest.TestCase):
    def tearDown(self):
        angel_options._option_signals.clear()

    def test_contract_and_levels_stay_fixed_within_candle(self):
        now = pd.Timestamp.now(tz="Asia/Kolkata")
        today = now.strftime("%d%b%Y").upper()
        records = [{"name": "NIFTY", "instrumenttype": "AMXIDX", "token": "index", "exch_seg": "NSE"},
                   {"name": "NIFTY", "instrumenttype": "OPTIDX", "exch_seg": "NFO", "token": "call",
                    "symbol": "NIFTY-CE", "expiry": today, "strike": "1000000"}]
        df = candles()
        df.attrs.update(data_source="Angel One SmartAPI", broker=True)
        result = {"signal": "BUY", "signal_time": str(df.time.iloc[-2]), "reason": "fixture"}
        with patch("angel_options._smartapi_client", return_value=Mock()), patch("angel_options._instrument_master", return_value=records), \
             patch("angel_options._quote_ltp", side_effect=[10000, 100, 10200, 110]), \
             patch("market_data.market_frame", return_value=(df, True)), patch("angel_options.generate_signal", return_value=result):
            first = angel_options.get_live_option_signal("NIFTY 50", "INTRADAY")
            second = angel_options.get_live_option_signal("NIFTY 50", "INTRADAY")
        for key in ("contract", "strike", "entry_premium", "target_premium", "stop_loss_premium", "signal_id"):
            self.assertEqual(first[key], second[key])
        self.assertEqual(first["action"], "BUY")
        self.assertEqual(first["option_type"], "CE")
        self.assertEqual(second["current_premium"], 110)

    def test_overnight_excludes_today_expiry_and_bearish_buys_put(self):
        now = pd.Timestamp.now(tz="Asia/Kolkata")
        today = now.strftime("%d%b%Y").upper()
        tomorrow = (now + pd.Timedelta(days=1)).strftime("%d%b%Y").upper()
        records = [{"name": "NIFTY", "instrumenttype": "AMXIDX", "token": "index", "exch_seg": "NSE"}]
        for expiry, token in ((today, "today"), (tomorrow, "tomorrow")):
            records.append({"name": "NIFTY", "instrumenttype": "OPTIDX", "exch_seg": "NFO", "token": token,
                            "symbol": token + "PE", "expiry": expiry, "strike": "1000000"})
        df = candles()
        df.attrs.update(data_source="Angel One SmartAPI", broker=True)
        result = {"signal": "SELL", "signal_time": str(df.time.iloc[-2]), "reason": "fixture"}
        with patch("angel_options._smartapi_client", return_value=Mock()), patch("angel_options._instrument_master", return_value=records), \
             patch("angel_options._quote_ltp", side_effect=[10000, 100]), \
             patch("market_data.market_frame", return_value=(df, True)), patch("angel_options.generate_signal", return_value=result):
            signal = angel_options.get_live_option_signal("NIFTY 50", "BTST")
        self.assertEqual(signal["token"], "tomorrow")
        self.assertEqual(signal["action"], "BUY")
        self.assertEqual(signal["option_type"], "PE")


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_bad_configuration_and_symbol(self):
        self.assertEqual(self.client.get("/api/signal/NIFTY%2050?interval=invalid").status_code, 422)
        self.assertEqual(self.client.post("/api/backtest?strategy=unknown").status_code, 422)
        self.assertEqual(self.client.post("/api/backtest?stop_loss=0").status_code, 422)
        self.assertEqual(self.client.post("/api/backtest?strategy=VWAP%20Trend&timeframe=1d").status_code, 422)
        self.assertEqual(self.client.get("/api/market/UNKNOWN").status_code, 422)
        self.assertEqual(self.client.post("/api/signal/NIFTY%2050", json={"fast": 50, "slow": 20}).status_code, 422)

    def test_signal_custom_configuration_and_stale_gate(self):
        df = candles()
        df["time"] -= pd.Timedelta(days=3)
        with patch("main.market_frame", return_value=(df, False)):
            response = self.client.post("/api/signal/NIFTY%2050?interval=5m", json={"name": "My RSI", "template": "RSI Reversal", "oversold": 40})
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["signal"], "HOLD")
        self.assertTrue(result["stale"])
        self.assertEqual(result["strategy_config"]["oversold"], 40)
        self.assertEqual(result["strategy"], "My RSI")

    def test_backtest_response_records_actual_inputs(self):
        df = candles(200)
        df.attrs["data_source"] = "fixture-provider"
        with patch("main.market_frame", return_value=(df, False)):
            response = self.client.post("/api/backtest?symbol=NIFTY%2050&timeframe=5m&duration=1&position_size=10000&fee_bps=12&stop_loss=2", json={"name": "My bands", "template": "Mean Reversion"})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["strategy"], "My bands")
        self.assertEqual(result["fee_bps"], 12)
        self.assertEqual(result["position_size"], 10000)
        self.assertEqual(result["stop_loss"], 2)
        self.assertEqual(result["data_source"], "fixture-provider")
        self.assertEqual(result["instrument_type"], "underlying_long_only")

    def test_market_list_retains_unavailable_symbols(self):
        with patch("main.market_frame", side_effect=HTTPException(status_code=502, detail="offline")):
            response = self.client.get("/api/markets")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 13)
        self.assertTrue(all(row["price"] is None for row in response.json()))


if __name__ == "__main__":
    unittest.main()
