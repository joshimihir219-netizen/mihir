# AI Trading Dashboard

For questions or help with the dashboard, contact [fultonskipz44@gmail.com](mailto:fultonskipz44@gmail.com).

## Live market-data mode
The dashboard now attempts to load current market data through Yahoo Finance using `yfinance` from the FastAPI backend. It refreshes automatically every 15 seconds.

Supported symbols:
- NIFTY 50 (`^NSEI`)
- BANK NIFTY (`^NSEBANK`)
- SENSEX (`^BSESN`)
- RELIANCE, TCS, INFOSYS, HDFC BANK, ICICI BANK, SBIN, ITC, BHARTI AIRTEL (Yahoo Finance NSE symbols)
- BTC/USDT (`BTC-USD`)
- ETH/USDT (`ETH-USD`)

**Important:** Yahoo Finance data availability and exchange delays depend on the instrument/exchange. The app visibly falls back to demo data if the provider is unavailable. This is not a guaranteed tick-by-tick feed.

The dashboard chart supports line, area, candlestick, and OHLC views; 1-minute through monthly intervals; 1D-to-1Y range shortcuts; linear, logarithmic, and percentage price scales; volume, SMA (20), EMA (20), and Bollinger overlays; horizontal and trend-line drawings; watchlist selection; and price-crossing alerts. Replay steps through the loaded candles, and chart data can be exported as CSV. Save stores chart settings in the browser. Quotes and candles are sourced through Yahoo Finance and may be delayed or unavailable. For exchange-authoritative real-time quotes, connect an authorized broker or exchange market-data feed.

Options trading uses Angel One SmartAPI for live index candles, listed option contracts, exchange expiries, and option LTP quotes. Signals use the nearest listed expiry and closest-to-spot strike, map BUY to CE and SELL to PE (STBT uses the opposite right and sells), and calculate target/stop scenarios from the live premium (25%/20% for buys; 20%/25% for sells). Configure backend credentials before using the live signals by editing `backend/.env`:

```dotenv
ANGELONE_API_KEY=your-api-key
ANGELONE_CLIENT_CODE=your-client-code
ANGELONE_PASSWORD=your-password-or-pin
ANGELONE_TOTP_SECRET=your-totp-secret
```

The backend loads this file automatically on startup. It is excluded from version control; keep credentials out of frontend code and never commit or share them. Restart the backend after editing it. Docker Compose also reads this file. Without credentials or if Angel One is unavailable, the live signal panel shows the provider error and does not substitute demo values. The separate options-chain display and paper-order form remain theoretical simulators and are not used for live signal prices. Signal direction is a rule-based estimate, and target/stop prices are scenarios—not guaranteed fills or investment advice. Paper-order confirmations are stored in the browser only; no broker order execution is connected.

Backtesting supports Yahoo Finance intervals from 1 minute through 3 months (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, and 3mo), plus a duration amount selectable in days, months, or years. Yahoo limits how far intraday intervals reach into history: 1-minute uses up to 7 days and other intraday intervals use up to 60 days. Daily intervals support up to 5 years, and weekly/monthly intervals up to 10 years. Duration units that exceed a timeframe's available history are disabled. Actual availability depends on the instrument and Yahoo Finance; unavailable history uses generated demo data.

## Run
### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
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
