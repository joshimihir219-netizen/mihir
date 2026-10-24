# AI Trading Dashboard

For questions or help with the dashboard, contact [fultonskipz44@gmail.com](mailto:fultonskipz44@gmail.com).

## Live market-data mode
The dashboard polls every 15 seconds. With Angel One credentials, Indian indices and NSE equities use broker candles at supported intervals (1m, 5m, 15m, 30m, 60m/1h, 1d). The selected market also requests a broker FULL quote and checks its exchange timestamp. Other intervals and cryptocurrencies use Yahoo Finance and are explicitly labeled as potentially delayed. Polling is not a tick streaming feed.

Supported symbols:
- NIFTY 50 (`^NSEI`)
- BANK NIFTY (`^NSEBANK`)
- SENSEX (`^BSESN`)
- RELIANCE, TCS, INFOSYS, HDFC BANK, ICICI BANK, SBIN, ITC, BHARTI AIRTEL (Yahoo Finance NSE symbols)
- BTC/USDT (`BTC-USD`)
- ETH/USDT (`ETH-USD`)

**Data integrity:** Unavailable history returns an error; generated prices are never substituted. Yahoo data is never labeled real time. Provider, candle time, fetch time and freshness are exposed by the API, and the UI shows the source and candle time. Stale data cannot generate a new entry. An unavailable broker quote is labeled separately from historical candle availability. Broker credentials and exchange entitlements are required for live Indian data.

The dashboard chart supports line, area, candlestick, and OHLC views; 1-minute through monthly intervals; 1D-to-1Y range shortcuts; linear, logarithmic, and percentage price scales; volume, SMA (20), EMA (20), and Bollinger overlays; horizontal and trend-line drawings; watchlist selection; and price-crossing alerts. Replay steps through the loaded candles, and chart data can be exported as CSV. Save stores chart settings in the browser. Quotes and candles are sourced through Yahoo Finance and may be delayed or unavailable. For exchange-authoritative real-time quotes, connect an authorized broker or exchange market-data feed.

Options trading uses Angel One SmartAPI for live index candles, listed option contracts, exchange expiries, and option LTP quotes. Signals use the nearest listed expiry and closest-to-spot strike, map BUY to CE and SELL to PE (STBT uses the opposite right and sells), and calculate target/stop scenarios from the live premium (25%/20% for buys; 20%/25% for sells). Configure backend credentials before using the live signals by editing `backend/.env`:

```dotenv
ANGELONE_API_KEY=your-api-key
ANGELONE_CLIENT_CODE=your-client-code
ANGELONE_PASSWORD=your-password-or-pin
ANGELONE_TOTP_SECRET=your-totp-secret
```

The backend loads this file automatically on startup. It is excluded from version control; keep credentials out of frontend code and never commit or share them. Restart the backend after editing it. Docker Compose also reads this file. Without credentials or if Angel One is unavailable, the live signal panel shows the provider error and does not substitute demo values. The separate options-chain display and paper-order form remain theoretical simulators and are not used for live signal prices. Signal direction uses the selected strategy on completed five minute broker candles. FULL quotes must include an exchange timestamp no older than 120 seconds. The contract and entry/target/stop snapshot stay fixed within that completed candle in the current backend process, while current premium is refreshed separately. These snapshots are not durable trade records: multiple workers or a restart can observe different first premiums. Target/stop crossings are observations, not fills. Overnight trade types exclude contracts expiring today. Signal direction is a rule based estimate, and percentage target/stop prices are scenarios, not guaranteed fills or investment advice. Paper-order confirmations are stored in the browser only; no broker order execution is connected.

Backtesting supports Yahoo Finance intervals from 1 minute through 3 months (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, and 3mo), plus a duration amount selectable in days, months, or years. Yahoo limits how far intraday intervals reach into history: 1-minute uses up to 7 days and other intraday intervals use up to 60 days. Daily intervals support up to 5 years, and weekly/monthly intervals up to 10 years. Duration units that exceed a timeframe's available history are disabled. These limits are request limits, not a promise of history coverage. Actual availability depends on the instrument and provider; unavailable history produces an error. Broker requests are bounded by interval (30 days for 1m, 60 days for other intraday, 90 days for hourly, 2000 days for daily). The API and report include requested start, available history start and actual tested start/end, so shorter provider coverage is visible.

## Strategies, signals and backtests

Five executable templates are available. No template is presented as proven profitable in 2026; validate your instrument, timeframe, costs and out of sample results.

| Template | BUY rule | SELL / long exit rule |
| --- | --- | --- |
| EMA Trend | Fast EMA above slow EMA; RSI 50–70 | Fast EMA below slow EMA; RSI 30–50 |
| RSI Reversal | RSI crosses above configured oversold level | RSI crosses below configured overbought level |
| Breakout Momentum | Close above previous channel high with volume confirmation | Close below previous channel low with volume confirmation |
| VWAP Trend | Close above session VWAP approximation and fast EMA above slow | Close below session VWAP approximation and fast EMA below slow |
| Mean Reversion | Close crosses back above lower Bollinger band | Close crosses back below upper Bollinger band |

VWAP uses candle typical price times volume, grouped by Asia/Kolkata calendar date; it is an approximation for intraday analysis. Daily and longer VWAP requests are rejected. Index feeds often have zero volume, so VWAP and volume breakouts return HOLD instead of inventing volume. EMA defaults: 12/26. RSI period: 14, thresholds: 30/70. Channel and Bollinger defaults: 20 candles, bands: two population standard deviations. Breakout volume compares against the previous channel's mean volume. Warmup requires the largest of slow EMA, lookback and 15 candles. HOLD means no new directional condition; a historical long remains open until SELL, stop, or test end.

Custom strategies are saved in this browser as a name, one of these templates and executable parameters. They appear in both selectors and can drive signals, options direction and backtests. Arbitrary uploaded code and custom rule languages are not supported. Risk labels are descriptive only; actual allocation, stop and estimated costs are set in Backtesting.

Signals use the last completed candle and include a stable identifier and candle timestamp. Unfinished candles are excluded. There is no calibrated confidence probability. A strategy can change at the next completed candle. Indicators use the same causal rule engine as backtesting. Chart indicators can include the currently forming candle; the signal panel explicitly identifies its completed candle.

Backtests simulate **long underlying units**, not option premiums, short sales or actual portfolio returns. SELL exits the long; it does not open a short. Index units are hypothetical because the cash index cannot be directly purchased. Decisions use closed candles, execute at the next open, use whole units within the specified cash allocation and deduct fees/slippage per side (defaults: 10/5 bps). Stops are checked against candle lows, with adverse gaps filled at the open plus slippage. Final open positions are liquidated with costs and counted. All equity points and trades are returned. Report CSVs contain the actual result snapshot, inputs, source, assumptions, full trade ledger and equity timestamps; changing form fields does not relabel a completed result. These reports are simulations, not broker statements or tax reports.

API compatibility: GET `/api/signal/{symbol}` defaults to EMA Trend; POST accepts a `StrategyConfig` JSON object. POST `/api/backtest` accepts the same optional body and query parameters `strategy`, `position_size` (cash allocation), `stop_loss`, `fee_bps`, `slippage_bps`. Old `AI Momentum` and `Swing Breakout` strategy names resolve to EMA Trend and Breakout Momentum. POST `/api/options/signal/{underlying}` accepts the config with the same authentication as GET. `/api/strategies` lists defaults. Invalid configs and unsupported symbols return 422; missing provider data returns 502/503. Synthetic fallback and fabricated confidence values have been removed.

### Tests

From `backend`, with requirements and `httpx` installed:

```bash
python -m unittest discover -s tests -v
```

From `frontend`:

```bash
npm ci
npm run build
```

## Run
### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

### Frontend
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```

## Accounts
Create an account from the login screen before signing in. Locally, usernames and hashed passwords are stored in the backend SQLite database at `backend/trademind-auth.sqlite3` by default. Set `TRADEMIND_AUTH_DB` to choose a different SQLite path. Existing browser-only sessions are not server accounts, so those users need to sign up once.

For persistent accounts on Vercel, create a PostgreSQL database in Neon and add its pooled connection string as the `DATABASE_URL` environment variable in the Vercel project's **Settings → Environment Variables**. Keep the connection string private, enable it for Production (and Preview if needed), then redeploy so the backend can create its tables in Neon. The backend also recognizes `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`. Until a database URL is configured, account signup and login are disabled on Vercel instead of writing accounts to unreliable temporary storage; `/api/health` reports `database: "not_configured"`. Use `/api/health` after redeployment to confirm it reports `database: "postgresql"` and `persistent_storage: true`. The backend creates the account tables automatically; any accounts previously created on temporary storage are not migrated, so users must sign up again.

## Telegram signal alerts
After signing in, open the profile settings and enter a Telegram bot token and chat ID, then use **Test Telegram connection** to confirm delivery. Create the bot with Telegram's BotFather and send it `/start` from the target chat before testing; a bot cannot start a private chat on its own. Signal alerts are sent by the backend through the Telegram Bot API when the selected signal changes. Keep the dashboard open and signed in to receive automatic alerts. Telegram settings are stored in this browser, so only save a bot token on a device you trust.

## Trading safety
The included `/api/orders/paper` endpoint is **paper trading only**. No real orders are sent to a broker.

For real-money order execution, the project must be connected to a broker API such as Zerodha Kite Connect, Upstox, Angel One SmartAPI, or another broker supported by the user's account. Broker choice, API credentials, authentication flow, order types, and exchange permissions must be configured explicitly before enabling live execution.
