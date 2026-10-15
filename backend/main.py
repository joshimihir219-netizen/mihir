from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import psycopg
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from ml_engine import generate_signal
from backtest import run_backtest
from market_data import TIMEFRAME_HISTORY, market_frame, _duration_offset, _max_duration
from angel_options import get_live_option_signal

app = FastAPI(title="AI Trading Dashboard API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

SYMBOLS = [
    "NIFTY 50", "BANK NIFTY", "SENSEX",
    "RELIANCE", "TCS", "INFOSYS", "HDFC BANK", "ICICI BANK", "SBIN", "ITC", "BHARTI AIRTEL",
    "BTC/USDT", "ETH/USDT",
]
DEFAULT_AUTH_DB = Path(__file__).with_name("trademind-auth.sqlite3")
AUTH_DB = Path(os.environ.get("TRADEMIND_AUTH_DB", DEFAULT_AUTH_DB))
DATABASE_URL = (
    os.environ.get("DATABASE_URL")
    or os.environ.get("POSTGRES_URL")
    or os.environ.get("POSTGRES_URL_NON_POOLING")
)
PASSWORD_ITERATIONS = 310_000
SESSION_LIFETIME = timedelta(days=30)


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)


class TelegramMessage(BaseModel):
    bot_token: str = Field(min_length=1, max_length=128)
    chat_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=4096)


@contextmanager
def _auth_connection():
    if DATABASE_URL:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=5) as connection:
            yield connection
        return
    if os.environ.get("VERCEL"):
        raise HTTPException(
            status_code=503,
            detail="Persistent account storage is not configured. Set DATABASE_URL in the Vercel project environment.",
        )

    AUTH_DB.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(AUTH_DB)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _execute(connection, query, parameters=()):
    if DATABASE_URL:
        query = query.replace("?", "%s")
    return connection.execute(query, parameters)


def _initialize_auth_db():
    if os.environ.get("VERCEL") and not DATABASE_URL:
        return
    with _auth_connection() as connection:
        if DATABASE_URL:
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS users (
                    id BIGSERIAL PRIMARY KEY,
                    username TEXT NOT NULL,
                    password_salt BYTEA NOT NULL,
                    password_hash BYTEA NOT NULL,
                    created_at TEXT NOT NULL
                )
                """,
            )
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL
                )
                """,
            )
        else:
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    password_salt BLOB NOT NULL,
                    password_hash BLOB NOT NULL,
                    created_at TEXT NOT NULL
                )
                """,
            )
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL
                )
                """,
            )
        _execute(
            connection,
            "CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username))",
        )


_initialize_auth_db()


def _hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)


def _new_session(connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = (datetime.now(timezone.utc) + SESSION_LIFETIME).isoformat()
    _execute(
        connection,
        "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (token_hash, user_id, expires_at),
    )
    return token


def _session_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")
    return authorization[7:].strip()


@app.post("/api/auth/signup", status_code=201)
def signup(credentials: Credentials):
    username = credentials.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username is required.")
    salt = secrets.token_bytes(16)
    password_hash = _hash_password(credentials.password, salt)
    try:
        with _auth_connection() as connection:
            if DATABASE_URL:
                cursor = _execute(
                    connection,
                    "INSERT INTO users (username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?) RETURNING id",
                    (username, salt, password_hash, datetime.now(timezone.utc).isoformat()),
                )
                user_id = int(cursor.fetchone()["id"])
            else:
                cursor = _execute(
                    connection,
                    "INSERT INTO users (username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (username, salt, password_hash, datetime.now(timezone.utc).isoformat()),
                )
                user_id = int(cursor.lastrowid)
            token = _new_session(connection, user_id)
    except (sqlite3.IntegrityError, psycopg.IntegrityError) as error:
        raise HTTPException(status_code=409, detail="An account with that username already exists. Log in instead.") from error
    return {"access_token": token, "token_type": "bearer", "username": username}


@app.post("/api/auth/login")
def login(credentials: Credentials):
    with _auth_connection() as connection:
        user = _execute(
            connection,
            "SELECT id, username, password_salt, password_hash FROM users WHERE LOWER(username) = LOWER(?)",
            (credentials.username.strip(),),
        ).fetchone()
        if user is None or not hmac.compare_digest(
            _hash_password(credentials.password, user["password_salt"]),
            user["password_hash"],
        ):
            raise HTTPException(status_code=401, detail="Account not found or password incorrect. Sign up if you don't have an account.")
        token = _new_session(connection, int(user["id"]))
    return {"access_token": token, "token_type": "bearer", "username": user["username"]}


@app.get("/api/auth/me")
def current_user(authorization: str | None = Header(default=None)):
    token = _session_token(authorization)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    with _auth_connection() as connection:
        user = _execute(
            connection,
            """
            SELECT users.username, auth_sessions.expires_at
            FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
            WHERE auth_sessions.token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
        if user is None or user["expires_at"] <= now:
            _execute(connection, "DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
            raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    return {"username": user["username"]}


@app.post("/api/auth/logout", status_code=204)
def logout(authorization: str | None = Header(default=None)):
    token = _session_token(authorization)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with _auth_connection() as connection:
        _execute(connection, "DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
    return None


@app.post("/api/telegram/send")
def send_telegram_message(
    telegram_message: TelegramMessage,
    authorization: str | None = Header(default=None),
):
    current_user(authorization)
    bot_token = telegram_message.bot_token.strip()
    chat_id = telegram_message.chat_id.strip()
    message = telegram_message.message.strip()
    if not re.fullmatch(r"\d+:[A-Za-z0-9_-]+", bot_token):
        raise HTTPException(status_code=422, detail="Telegram bot token format is invalid.")
    if not chat_id or not message:
        raise HTTPException(status_code=422, detail="Telegram chat ID and message are required.")

    payload = json.dumps({"chat_id": chat_id, "text": message}).encode("utf-8")
    request = Request(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            result = json.loads(error.read().decode("utf-8"))
            detail = result.get("description", "Telegram rejected the message.")
        except (UnicodeDecodeError, json.JSONDecodeError):
            detail = "Telegram rejected the message. Check the bot token and chat ID."
        raise HTTPException(status_code=502, detail=detail) from error
    except (URLError, OSError) as error:
        raise HTTPException(status_code=502, detail="Could not connect to Telegram. Check the server's internet connection.") from error
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=502, detail="Telegram returned an invalid response.") from error

    if not isinstance(result, dict) or not result.get("ok"):
        if not isinstance(result, dict):
            raise HTTPException(status_code=502, detail="Telegram returned an invalid response.")
        raise HTTPException(status_code=502, detail=result.get("description", "Telegram could not deliver the message."))
    message_result = result.get("result")
    message_id = message_result.get("message_id") if isinstance(message_result, dict) else None
    return {"ok": True, "message_id": message_id}


@app.get("/")
def root():
    return {"name": "AI Trading Dashboard API", "status": "online", "market_data": "live when provider is available"}


@app.get("/api/health")
def health():
    if os.environ.get("VERCEL") and not DATABASE_URL:
        return {
            "status": "ok",
            "service": "backend",
            "database": "not_configured",
            "persistent_storage": False,
        }
    database_status = "postgresql" if DATABASE_URL else "sqlite"
    try:
        with _auth_connection() as connection:
            _execute(connection, "SELECT 1")
    except psycopg.Error as error:
        if not DATABASE_URL:
            raise
        raise HTTPException(
            status_code=503,
            detail="The configured PostgreSQL database is unavailable.",
        ) from error
    return {
        "status": "ok",
        "service": "backend",
        "database": database_status,
        "persistent_storage": bool(DATABASE_URL) or not os.environ.get("VERCEL"),
    }


@app.get("/api/markets")
def markets():
    result = []
    for symbol in SYMBOLS:
        df, live = market_frame(symbol, 80, live=True)
        price = float(df.close.iloc[-1])
        prev = float(df.close.iloc[-2]) if len(df) > 1 else price
        result.append({"symbol": symbol, "price": round(price, 4), "change": round((price / prev - 1) * 100, 2), "live": live})
    return result

@app.get("/api/market/{symbol:path}")
def market(
    symbol: str,
    interval: str = Query("5m", pattern="^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$"),
):
    df, live = market_frame(symbol, 500, live=True, interval=interval)
    price = float(df.close.iloc[-1])
    prev = float(df.close.iloc[-2]) if len(df) > 1 else price
    return {
        "symbol": symbol,
        "timeframe": interval,
        "price": price,
        "change": (price / prev - 1) * 100,
        "live": live,
        "updated_at": pd.Timestamp(df.time.iloc[-1]).isoformat(),
        "series": [{"time": pd.Timestamp(x).strftime("%d %b %H:%M"), "timestamp": pd.Timestamp(x).isoformat(), "open": float(o), "high": float(h), "low": float(l), "close": float(c), "volume": float(v), "sma20": float(sma) if pd.notna(sma) else None} for x,o,h,l,c,v,sma in zip(df.time,df.open,df.high,df.low,df.close,df.volume,df.sma20)],
        "indicators": {"rsi": round(float(df.rsi.iloc[-1]), 2), "macd": round(float(df.macd.iloc[-1]), 4), "sma20": round(float(df.sma20.iloc[-1]), 2)},
    }

@app.get("/api/signal/{symbol:path}")
def signal(symbol: str):
    df, live = market_frame(symbol, 80, live=True)
    result = generate_signal(df)
    return {"symbol": symbol, "live": live, **result}

@app.get("/api/options/signal/{underlying}")
def options_signal(
    underlying: str,
    trade_type: str = Query("INTRADAY", pattern="^(INTRADAY|BTST|STBT)$"),
    authorization: str | None = Header(default=None),
):
    current_user(authorization)
    return get_live_option_signal(underlying.upper(), trade_type)

@app.post("/api/backtest")
def backtest(
    symbol: str = Query("NIFTY 50"),
    initial_capital: float = Query(100000, gt=0),
    timeframe: str = Query("1d", pattern="^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$"),
    duration: int = Query(30, ge=1, le=3650),
    duration_unit: str = Query("days", pattern="^(days|months|years)$"),
):
    max_duration = _max_duration(timeframe, duration_unit)
    if duration > max_duration:
        raise HTTPException(
            status_code=422,
            detail=f"Duration cannot exceed {max_duration} {duration_unit} for {timeframe} timeframe.",
        )
    df, live = market_frame(symbol, 6000, live=True, interval=timeframe)
    cutoff = pd.Timestamp.now(tz="UTC") - _duration_offset(duration, duration_unit)
    timestamps = pd.to_datetime(df["time"], utc=True)
    df = df.loc[timestamps >= cutoff].reset_index(drop=True)
    if df.empty:
        raise HTTPException(status_code=502, detail="No market data is available for the selected backtest period.")
    return {
        **run_backtest(df, initial_capital),
        "timeframe": timeframe,
        "duration": duration,
        "duration_unit": duration_unit,
        "history_period": TIMEFRAME_HISTORY[timeframe],
        "data_source": "live provider" if live else "demo fallback",
    }

@app.get("/api/risk")
def risk():
    return {"stop_loss": 2.0, "max_drawdown": 8.0, "daily_loss_limit": 5000, "alert_enabled": True}

@app.post("/api/orders/paper")
def paper_order(
    symbol: str,
    side: str,
    quantity: float,
    price: float,
    option_type: str | None = None,
    strike: float | None = None,
    expiry: str | None = None,
):
    symbol = symbol.strip()
    side = side.upper()
    if not symbol or len(symbol) > 40:
        raise HTTPException(status_code=422, detail="Symbol must contain 1 to 40 characters.")
    if side not in {"BUY", "SELL"}:
        raise HTTPException(status_code=422, detail="Side must be BUY or SELL.")
    if not math.isfinite(quantity) or not 0 < quantity <= 1_000_000:
        raise HTTPException(status_code=422, detail="Quantity must be greater than 0 and at most 1,000,000.")
    if not math.isfinite(price) or price <= 0:
        raise HTTPException(status_code=422, detail="Price must be a positive finite number.")
    option_fields = (option_type, strike, expiry)
    if any(value is not None for value in option_fields) and not all(value is not None for value in option_fields):
        raise HTTPException(status_code=422, detail="Option type, strike, and expiry must be provided together.")
    if option_type is not None:
        option_type = option_type.upper()
        if option_type not in {"CALL", "PUT"}:
            raise HTTPException(status_code=422, detail="Option type must be CALL or PUT.")
        if strike is None or not math.isfinite(strike) or strike <= 0:
            raise HTTPException(status_code=422, detail="Strike must be a positive finite number.")
        if expiry is None or len(expiry) != 10:
            raise HTTPException(status_code=422, detail="Expiry must use YYYY-MM-DD format.")
    if expiry is not None:
        try:
            parsed_expiry = datetime.strptime(expiry, "%Y-%m-%d")
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Expiry must use YYYY-MM-DD format.") from error
        if parsed_expiry.strftime("%Y-%m-%d") != expiry:
            raise HTTPException(status_code=422, detail="Expiry must use YYYY-MM-DD format.")
    return {
        "mode": "PAPER",
        "status": "accepted",
        "symbol": symbol,
        "side": side,
        "quantity": quantity,
        "price": price,
        "option_type": option_type,
        "strike": strike,
        "expiry": expiry,
        "message": "Paper order only. No real money was used.",
    }
