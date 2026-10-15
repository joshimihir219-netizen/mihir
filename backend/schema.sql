CREATE TABLE users (
    user_id INTEGER PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trading_strategies (
    strategy_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name VARCHAR(120) NOT NULL,
    parameters TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE TABLE market_data (
    data_id INTEGER PRIMARY KEY,
    symbol VARCHAR(40) NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    open DECIMAL(18,4),
    high DECIMAL(18,4),
    low DECIMAL(18,4),
    close DECIMAL(18,4),
    volume BIGINT
);

CREATE TABLE technical_indicators (
    indicator_id INTEGER PRIMARY KEY,
    data_id INTEGER NOT NULL,
    type VARCHAR(40) NOT NULL,
    value DECIMAL(18,6),
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(data_id) REFERENCES market_data(data_id)
);

CREATE TABLE trading_signals (
    signal_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    strategy_id INTEGER,
    data_id INTEGER,
    signal_type VARCHAR(10) NOT NULL,
    confidence DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(user_id),
    FOREIGN KEY(strategy_id) REFERENCES trading_strategies(strategy_id),
    FOREIGN KEY(data_id) REFERENCES market_data(data_id)
);

CREATE TABLE backtests (
    backtest_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    strategy_id INTEGER,
    start_date DATE,
    end_date DATE,
    pnl DECIMAL(18,2),
    win_rate DECIMAL(6,2),
    max_drawdown DECIMAL(6,2),
    FOREIGN KEY(user_id) REFERENCES users(user_id),
    FOREIGN KEY(strategy_id) REFERENCES trading_strategies(strategy_id)
);

CREATE TABLE risk_rules (
    risk_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    stop_loss DECIMAL(6,2),
    max_drawdown DECIMAL(6,2),
    alert_enabled BOOLEAN DEFAULT TRUE,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE TABLE reports (
    report_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    backtest_id INTEGER,
    report_type VARCHAR(60),
    file_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(user_id),
    FOREIGN KEY(backtest_id) REFERENCES backtests(backtest_id)
);
