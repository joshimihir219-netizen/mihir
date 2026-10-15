import React, {useEffect, useMemo, useRef, useState} from "react";
import "./signal-details.css";
import {Line} from "react-chartjs-2";
import {Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler} from "chart.js";
import {LayoutDashboard, Activity, FlaskConical, ShieldCheck, FileText, Settings, Bell, Search, Menu, TrendingUp, TrendingDown, LogIn} from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const API = "/api";
const TIMEFRAME_MAX_DURATION_DAYS = {
  "1m": 7, "2m": 60, "5m": 60, "15m": 60, "30m": 60,
  "60m": 60, "90m": 60, "1h": 60, "1d": 1825, "5d": 1825,
  "1wk": 3650, "1mo": 3650, "3mo": 3650
};
function maxDurationForUnit(timeframe, unit){
  const divisor = unit === "years" ? 365 : unit === "months" ? 30 : 1;
  return Math.floor(TIMEFRAME_MAX_DURATION_DAYS[timeframe] / divisor);
}
const nav = [
  ["Dashboard", LayoutDashboard], ["Signals", Activity], ["Options Trading", TrendingUp], ["Backtesting", FlaskConical],
  ["Risk Management", ShieldCheck], ["Reports", FileText], ["Strategies", Settings]
];
const defaultStrategies = [
  {name: "AI Momentum", risk: "Medium", status: "ACTIVE", description: "Combines SMA, RSI and MACD conditions for signal generation."},
  {name: "RSI Reversal", risk: "Medium", status: "READY", description: "Uses RSI oversold/overbought zones for reversal entries."},
  {name: "Breakout Momentum", risk: "High", status: "READY", description: "Focuses on strong index breakouts with confirmation volume and trend follow-through."},
  {name: "VWAP Trend", risk: "Medium", status: "READY", description: "Tracks trend direction using VWAP and short-term moving-average alignment."},
  {name: "Mean Reversion", risk: "Low", status: "READY", description: "Captures oversold bounce opportunities near key support zones."},
  {name: "Swing Breakout", risk: "High", status: "READY", description: "Trades clean breakouts in directional sessions with risk-managed exits."}
];

function toCurrency(value){
  if(typeof value === "number" && Number.isFinite(value)) return `₹${value.toLocaleString("en-IN", {maximumFractionDigits: 2})}`;
  return "—";
}

function formatPercent(value){
  const clean = Number(value ?? 0);
  return `${clean >= 0 ? "+" : ""}${clean.toFixed(2)}%`;
}

function normalCdf(value){
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const density = 0.3989422804 * Math.exp(-0.5 * absolute * absolute);
  const probability = 1 - density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return value >= 0 ? probability : 1 - probability;
}

function estimateOptionPremium(spot, strike, daysToExpiry, optionType, volatility = 0.2){
  if (!spot || !strike || daysToExpiry <= 0) return 0;
  const time = daysToExpiry / 365;
  const rootTime = Math.sqrt(time);
  const d1 = (Math.log(spot / strike) + 0.5 * volatility * volatility * time) / (volatility * rootTime);
  const d2 = d1 - volatility * rootTime;
  const premium = optionType === "CALL"
    ? spot * normalCdf(d1) - strike * normalCdf(d2)
    : strike * normalCdf(-d2) - spot * normalCdf(-d1);
  return Math.max(0.05, Number(premium.toFixed(2)));
}

function nextOptionsExpiry(daysFromToday){
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTradeDate(date = new Date()){
  return date.toLocaleDateString("en-IN", {day: "numeric", month: "short", year: "numeric"});
}

function createOptionsSignalMetadata(key){
  const generatedAt = new Date();
  const dateParts = [
    generatedAt.getFullYear(),
    String(generatedAt.getMonth() + 1).padStart(2, "0"),
    String(generatedAt.getDate()).padStart(2, "0")
  ];
  const timeParts = [
    String(generatedAt.getHours()).padStart(2, "0"),
    String(generatedAt.getMinutes()).padStart(2, "0"),
    String(generatedAt.getSeconds()).padStart(2, "0"),
    String(generatedAt.getMilliseconds()).padStart(3, "0")
  ];
  return {
    key,
    date: formatTradeDate(generatedAt),
    tradeNumber: `OPT-${dateParts.join("")}-${timeParts.join("")}`
  };
}

function getSignalPlan(symbol, market, signal){
  const price = Number(market?.price || 0);
  const direction = (signal?.signal || "HOLD").toUpperCase();
  const entryFactor = direction === "BUY" ? 0.998 : direction === "SELL" ? 1.002 : 1;
  const exitFactor = direction === "BUY" ? 1.022 : direction === "SELL" ? 0.978 : 1.01;
  const stopLossFactor = direction === "BUY" ? 0.985 : direction === "SELL" ? 1.015 : 0.992;

  return {
    entry: price ? Number((price * entryFactor).toFixed(2)) : "—",
    exit: price ? Number((price * exitFactor).toFixed(2)) : "—",
    stopLoss: price ? Number((price * stopLossFactor).toFixed(2)) : "—",
    symbol: symbol || "Market",
    bias: direction === "BUY" ? "Bullish" : direction === "SELL" ? "Bearish" : "Neutral"
  };
}

function formatMarketPrice(symbol, value){
  if (!Number.isFinite(value)) return "—";
  const isCrypto = ["BTC/USDT", "ETH/USDT"].includes(symbol);
  return `${isCrypto ? "$" : "₹"}${value.toLocaleString(isCrypto ? "en-US" : "en-IN", {maximumFractionDigits: 2})}`;
}

function formatSignalMove(entryPrice, currentPrice){
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(currentPrice)) return "unavailable";
  const points = currentPrice - entryPrice;
  const percent = points / entryPrice * 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(2)} (${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%)`;
}

function App(){
  const [page, setPage] = useState("Dashboard");
  const [symbol, setSymbol] = useState("NIFTY 50");
  const [chartInterval, setChartInterval] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").chartInterval || "1d"; } catch { return "1d"; }
  });
  const [markets, setMarkets] = useState([]);
  const [market, setMarket] = useState(null);
  const [signal, setSignal] = useState(null);
  const [backtest, setBacktest] = useState(null);
  const [backtestForm, setBacktestForm] = useState({
    symbol: "NIFTY 50",
    strategy: "AI Momentum",
    timeframe: "1d",
    durationValue: "30",
    durationUnit: "days",
    initialCapital: "100000",
    positionSize: "1000",
    stopLoss: "1.5"
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    try { return Boolean(JSON.parse(localStorage.getItem("trademind-auth-session") || "null")?.accessToken); } catch { return false; }
  });
  const [authChecking, setAuthChecking] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const width = Number(localStorage.getItem("trademind-sidebar-width"));
      return Number.isFinite(width) && width >= 200 && width <= 420 ? width : 245;
    } catch { return 245; }
  });
  const [profile, setProfile] = useState(() => {
    try {
      const savedProfile = JSON.parse(localStorage.getItem("trademind-profile") || "null");
      const savedUser = JSON.parse(localStorage.getItem("trademind-user") || "null");
      return savedProfile || {name: savedUser?.username || "TradeMind User", email: "", phone: "", location: ""};
    } catch { return {name: "TradeMind User", email: "", phone: "", location: ""}; }
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [developerCardOpen, setDeveloperCardOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [notificationsReadAt, setNotificationsReadAt] = useState(() => {
    try { return Number(localStorage.getItem("trademind-notifications-read-at") || 0); } catch { return 0; }
  });
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-read-notification-ids") || "[]");
      return new Set(Array.isArray(saved) ? saved : []);
    } catch { return new Set(); }
  });
  const [authMode, setAuthMode] = useState("login");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [telegramConfig, setTelegramConfig] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-telegram") || "{}");
      return { botToken: saved.botToken || "", chatId: saved.chatId || "" };
    } catch { return { botToken: "", chatId: "" }; }
  });
  const [logs, setLogs] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-log") || "[]");
      if (Array.isArray(saved) && saved.length) {
        const migrated = saved.map((entry) => (
          (entry.type === "notification" || entry.type === "signal") && !entry.optionSignal
            ? {...entry, type: "info"}
            : entry
        ));
        localStorage.setItem("trademind-log", JSON.stringify(migrated));
        return migrated;
      }
      return [{time: new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}), message: "System ready", type: "info"}];
    } catch { return [{time: new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}), message: "System ready", type: "info"}]; }
  });
  const [riskRules, setRiskRules] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-risk-rules") || "null");
      return saved || {stopLoss: "2.0", maxDrawdown: "8.0", dailyLoss: "5000", capitalBox: "250000"};
    } catch {
      return {stopLoss: "2.0", maxDrawdown: "8.0", dailyLoss: "5000", capitalBox: "250000"};
    }
  });
  const [strategies, setStrategies] = useState(defaultStrategies);
  const lastSignalTelegramKeyRef = useRef("");
  const pendingSignalTelegramKeyRef = useRef("");
  const notifiedMarketSignalsRef = useRef(null);
  const loggedTradeAlertsRef = useRef(null);
  if (loggedTradeAlertsRef.current === null) {
    try {
      const savedKeys = JSON.parse(localStorage.getItem("trademind-trade-alert-notifications") || "[]");
      loggedTradeAlertsRef.current = new Set(Array.isArray(savedKeys) ? savedKeys : []);
    } catch {
      loggedTradeAlertsRef.current = new Set();
    }
  }
  if (notifiedMarketSignalsRef.current === null) {
    try {
      const savedKeys = JSON.parse(localStorage.getItem("trademind-market-signal-notifications") || "[]");
      notifiedMarketSignalsRef.current = new Set(Array.isArray(savedKeys) ? savedKeys : []);
    } catch {
      notifiedMarketSignalsRef.current = new Set();
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function validateSession(){
      try {
        const savedSession = JSON.parse(localStorage.getItem("trademind-auth-session") || "null");
        if (!savedSession?.accessToken) {
          if (!cancelled) setIsLoggedIn(false);
          return;
        }
        const response = await fetch(API + "/auth/me", {
          headers: {Authorization: `Bearer ${savedSession.accessToken}`}
        });
        if (!response.ok) throw new Error("Session expired.");
        const account = await response.json();
        if (cancelled) return;
        localStorage.setItem("trademind-user", JSON.stringify({username: account.username}));
        setProfile((current) => ({
          ...current,
          name: current.name === "TradeMind User" ? account.username : current.name
        }));
        setIsLoggedIn(true);
      } catch {
        try {
          localStorage.removeItem("trademind-auth-session");
          localStorage.removeItem("trademind-session");
        } catch {}
        if (!cancelled) setIsLoggedIn(false);
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    }
    validateSession();
    return () => { cancelled = true; };
  }, []);

  const addLog = (message, type = "info", optionSignal = null) => {
    setLogs((current) => {
      const createdAt = Date.now();
      const next = [{id: `${createdAt}-${Math.random()}`, createdAt, time: new Date(createdAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}), message, type, ...(optionSignal ? {optionSignal} : {})}, ...current].slice(0, 30);
      try { localStorage.setItem("trademind-log", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    try { localStorage.setItem("trademind-sidebar-width", String(sidebarWidth)); } catch {}
  }, [sidebarWidth]);

  useEffect(() => {
    try { localStorage.setItem("trademind-profile", JSON.stringify(profile)); } catch {}
  }, [profile]);

  useEffect(() => {
    try { localStorage.setItem("trademind-telegram", JSON.stringify(telegramConfig)); } catch {}
  }, [telegramConfig]);

  function beginSidebarResize(event){
    event.preventDefault();
    const move = (moveEvent) => setSidebarWidth(Math.max(200, Math.min(420, moveEvent.clientX)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, {once: true});
  }

  function markNotificationsRead(){
    const readAt = Date.now();
    setNotificationsReadAt(readAt);
    try { localStorage.setItem("trademind-notifications-read-at", String(readAt)); } catch {}
  }

  function openNotification(entry){
    const id = entry.id || `${entry.time}-${entry.message}`;
    setReadNotificationIds((current) => {
      const next = new Set(current);
      next.add(id);
      try { localStorage.setItem("trademind-read-notification-ids", JSON.stringify([...next])); } catch {}
      return next;
    });
    setSelectedNotification(entry);
    setNotificationsOpen(false);
  }

  function saveProfile(event, updatedProfile = profile, updatedTelegram = telegramConfig){
    event.preventDefault();
    const savedProfile = {
      name: String(updatedProfile.name || "").trim() || "TradeMind User",
      email: String(updatedProfile.email || "").trim(),
      phone: String(updatedProfile.phone || "").trim(),
      location: String(updatedProfile.location || "").trim()
    };
    const cleanedTelegram = {
      botToken: String(updatedTelegram.botToken || "").trim(),
      chatId: String(updatedTelegram.chatId || "").trim()
    };
    setProfile(savedProfile);
    setTelegramConfig(cleanedTelegram);
    try { localStorage.setItem("trademind-profile", JSON.stringify(savedProfile)); } catch {}
    setProfileOpen(false);
    addLog(cleanedTelegram.botToken && cleanedTelegram.chatId ? "Profile and Telegram alerts saved on this device." : "Profile information saved on this device.", cleanedTelegram.botToken && cleanedTelegram.chatId ? "success" : "info");
  }

  const notifyTelegram = async (message, settings = telegramConfig) => {
    try {
      const botToken = String(settings.botToken || "").trim();
      const chatId = String(settings.chatId || "").trim();
      addLog(message, "info");
      if (!botToken || !chatId) {
        const error = "Add a Telegram bot token and chat ID in your profile settings.";
        addLog(`Telegram delivery failed: ${error}`, "warning");
        return {ok: false, error};
      }
      const savedSession = JSON.parse(localStorage.getItem("trademind-auth-session") || "null");
      if (!savedSession?.accessToken) {
        const error = "Telegram delivery requires an active TradeMind login.";
        addLog(error, "warning");
        return {ok: false, error};
      }
      const response = await fetch(API + "/telegram/send", {
        method: "POST",
        headers: {"Content-Type": "application/json", Authorization: `Bearer ${savedSession.accessToken}`},
        body: JSON.stringify({bot_token: botToken, chat_id: chatId, message})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Telegram rejected the message.");
      addLog("Telegram alert delivered.", "success");
      return {ok: true, error: ""};
    } catch (error) {
      const detail = error.message || "Could not reach the Telegram service.";
      addLog(`Telegram delivery failed: ${detail}`, "warning");
      return {ok: false, error: detail};
    }
  };

  useEffect(() => {
    const loadMarkets = () => fetch(API + "/markets").then((r) => r.json()).then(setMarkets).catch(() => {});
    loadMarkets();
    const timer = setInterval(loadMarkets, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(API + "/market/" + encodeURIComponent(symbol) + "?interval=" + chartInterval).then((r) => r.json()),
      fetch(API + "/signal/" + encodeURIComponent(symbol)).then((r) => r.json())
    ])
      .then(([m, s]) => { setMarket(m); setSignal(s); })
      .catch(() => {});
  }, [symbol, chartInterval]);

  useEffect(() => {
    const timer = setInterval(() => {
      fetch(API + "/market/" + encodeURIComponent(symbol) + "?interval=" + chartInterval).then((r) => r.json()).then(setMarket).catch(() => {});
      fetch(API + "/signal/" + encodeURIComponent(symbol)).then((r) => r.json()).then(setSignal).catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [symbol, chartInterval]);

  useEffect(() => {
    try { localStorage.setItem("trademind-risk-rules", JSON.stringify(riskRules)); } catch {}
  }, [riskRules]);

  useEffect(() => {
    if (!isLoggedIn || !market || !signal) return;
    const direction = String(signal.signal || "").toUpperCase();
    if (!["BUY", "SELL", "HOLD"].includes(direction)) return;

    const plan = getSignalPlan(symbol, market, signal);
    const now = new Date();
    const tradeDate = formatTradeDate(now);
    const localDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const currentPrice = Number(market.price);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;

    const notificationKey = `${symbol}:${localDateKey}:${direction}`;
    const notificationMessage = `${symbol}: ${direction} signal on ${tradeDate}. Entry ${plan.entry}, Exit ${plan.exit}, Stop Loss ${plan.stopLoss}. Confidence ${signal.confidence || 0}%.`;
    const isNewMarketSignalNotification = !notifiedMarketSignalsRef.current.has(notificationKey);
    if (isNewMarketSignalNotification) {
      notifiedMarketSignalsRef.current.add(notificationKey);
      try {
        localStorage.setItem(
          "trademind-market-signal-notifications",
          JSON.stringify([...notifiedMarketSignalsRef.current].slice(-100))
        );
      } catch {}
    }

    let signalStates = {};
    let activeTrade = null;
    const tradeStorageKey = `trademind-market-trade:${symbol}`;
    try {
      signalStates = JSON.parse(localStorage.getItem("trademind-market-signal-directions") || "{}");
      if (!signalStates || typeof signalStates !== "object" || Array.isArray(signalStates)) signalStates = {};
      activeTrade = JSON.parse(localStorage.getItem(tradeStorageKey) || "null");
    } catch {}

    const directionChanged = signalStates[symbol] !== direction;
    let telegramMessage = "";
    let telegramKey = "";
    const signalStatusKey = `${symbol}:${telegramConfig.chatId}:${telegramConfig.botToken.slice(-4)}:${localDateKey}:${direction}`;
    let deliveredSignalStates = {};
    try {
      deliveredSignalStates = JSON.parse(localStorage.getItem("trademind-telegram-signal-state") || "{}");
      if (!deliveredSignalStates || typeof deliveredSignalStates !== "object" || Array.isArray(deliveredSignalStates)) {
        deliveredSignalStates = {};
      }
    } catch {}

    if (activeTrade?.openedAt && new Date(activeTrade.openedAt).toLocaleDateString("en-CA") !== localDateKey) {
      activeTrade = null;
      try { localStorage.removeItem(tradeStorageKey); } catch {}
    }

    if (directionChanged) {
      signalStates[symbol] = direction;
      try {
        localStorage.setItem("trademind-market-signal-directions", JSON.stringify(signalStates));
      } catch {}

      if (direction === "BUY" && !activeTrade) {
        activeTrade = {
          entryPrice: currentPrice,
          openedAt: now.toISOString(),
          targetPrice: currentPrice * 1.022,
          stopPrice: currentPrice * 0.985,
          lastProfitMilestone: 0
        };
        try { localStorage.setItem(tradeStorageKey, JSON.stringify(activeTrade)); } catch {}
      }

      if (direction === "BUY") {
        telegramMessage = `${symbol} · BUY signal · ${tradeDate}\nSignal entry: ${formatMarketPrice(symbol, currentPrice)}\nTarget scenario: ${formatMarketPrice(symbol, activeTrade?.targetPrice || currentPrice * 1.022)}\nStop-loss scenario: ${formatMarketPrice(symbol, activeTrade?.stopPrice || currentPrice * 0.985)}\nConfidence: ${signal.confidence || 0}%\nInformational signal only. No order is placed and prices are not guaranteed.`;
      } else if (direction === "HOLD") {
        telegramMessage = activeTrade
          ? `${symbol} · HOLD existing BUY · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry (${formatMarketPrice(symbol, activeTrade.entryPrice)}): ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nTarget: ${formatMarketPrice(symbol, activeTrade.targetPrice)} · Stop: ${formatMarketPrice(symbol, activeTrade.stopPrice)}\nIndicative signal move only; actual P&L depends on your entry, quantity, and costs.`
          : `${symbol} · HOLD / WAIT · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nNo active BUY signal is being tracked. Wait for a directional signal; no order was placed.`;
      } else {
        telegramMessage = activeTrade
          ? `${symbol} · SELL / EXIT BUY signal · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry (${formatMarketPrice(symbol, activeTrade.entryPrice)}): ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nIndicative exit signal only; no order was placed.`
          : `${symbol} · SELL signal · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nBearish signal: consider exiting an existing long or avoiding a new long. No order was placed.`;
        if (activeTrade) {
          activeTrade = null;
          try { localStorage.removeItem(tradeStorageKey); } catch {}
        }
      }
      telegramKey = signalStatusKey;
    }

    if (activeTrade && ["BUY", "HOLD"].includes(direction)) {
      const movePercent = (currentPrice / activeTrade.entryPrice - 1) * 100;
      if (currentPrice >= activeTrade.targetPrice) {
        telegramMessage = `${symbol} · TARGET REACHED · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry: ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nTarget scenario: ${formatMarketPrice(symbol, activeTrade.targetPrice)}\nConsider reviewing or closing your position. This alert does not place an order.`;
        telegramKey = `${symbol}:TARGET:${activeTrade.openedAt}`;
        activeTrade = null;
        try { localStorage.removeItem(tradeStorageKey); } catch {}
      } else if (currentPrice <= activeTrade.stopPrice) {
        telegramMessage = `${symbol} · STOP-LOSS LEVEL REACHED · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry: ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nStop scenario: ${formatMarketPrice(symbol, activeTrade.stopPrice)}\nReview your risk and position. This alert does not place an order.`;
        telegramKey = `${symbol}:STOP:${activeTrade.openedAt}`;
        activeTrade = null;
        try { localStorage.removeItem(tradeStorageKey); } catch {}
      } else if (movePercent >= 1 && Math.floor(movePercent) > activeTrade.lastProfitMilestone) {
        activeTrade.lastProfitMilestone = Math.floor(movePercent);
        telegramMessage = `${symbol} · HOLD · SIGNAL MOVE IS POSITIVE · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry: ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nTarget: ${formatMarketPrice(symbol, activeTrade.targetPrice)} · Stop: ${formatMarketPrice(symbol, activeTrade.stopPrice)}\nIndicative signal move only, not actual account P&L.`;
        telegramKey = `${symbol}:GAIN:${activeTrade.openedAt}:${activeTrade.lastProfitMilestone}`;
        try { localStorage.setItem(tradeStorageKey, JSON.stringify(activeTrade)); } catch {}
      }
    }

    if (
      !telegramMessage &&
      telegramConfig.botToken &&
      telegramConfig.chatId &&
      deliveredSignalStates[symbol] !== signalStatusKey
    ) {
      telegramMessage = direction === "BUY"
        ? `${symbol} · BUY signal is active · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nTracked signal entry: ${formatMarketPrice(symbol, activeTrade?.entryPrice || currentPrice)}\nTarget: ${formatMarketPrice(symbol, activeTrade?.targetPrice || currentPrice * 1.022)} · Stop: ${formatMarketPrice(symbol, activeTrade?.stopPrice || currentPrice * 0.985)}\nInformational signal only; no order is placed.`
        : direction === "HOLD"
          ? activeTrade
            ? `${symbol} · HOLD existing BUY · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry: ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nTarget: ${formatMarketPrice(symbol, activeTrade.targetPrice)} · Stop: ${formatMarketPrice(symbol, activeTrade.stopPrice)}\nIndicative move only; it is not actual account P&L.`
            : `${symbol} · HOLD / WAIT · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nNo active BUY signal is being tracked. No order was placed.`
          : `${symbol} · SELL signal · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nBearish signal: consider exiting an existing long or avoiding a new long. No order was placed.`;
      telegramKey = signalStatusKey;
    }

    if (telegramMessage && telegramKey && !loggedTradeAlertsRef.current.has(telegramKey)) {
      loggedTradeAlertsRef.current.add(telegramKey);
      try {
        localStorage.setItem(
          "trademind-trade-alert-notifications",
          JSON.stringify([...loggedTradeAlertsRef.current].slice(-100))
        );
      } catch {}
      addLog(telegramMessage, "signal");
    }
    if (isNewMarketSignalNotification && !telegramMessage) {
      addLog(notificationMessage, "signal");
    }

    if (telegramMessage && telegramConfig.botToken && telegramConfig.chatId) {
      if (
        lastSignalTelegramKeyRef.current !== telegramKey &&
        pendingSignalTelegramKeyRef.current !== telegramKey
      ) {
        pendingSignalTelegramKeyRef.current = telegramKey;
        notifyTelegram(telegramMessage).then((delivery) => {
          if (delivery.ok) {
            lastSignalTelegramKeyRef.current = telegramKey;
            if (telegramKey === signalStatusKey) {
              deliveredSignalStates[symbol] = signalStatusKey;
              try {
                localStorage.setItem("trademind-telegram-signal-state", JSON.stringify(deliveredSignalStates));
              } catch {}
            }
          }
          if (pendingSignalTelegramKeyRef.current === telegramKey) pendingSignalTelegramKeyRef.current = "";
        });
      }
    }
  }, [isLoggedIn, symbol, market, signal, telegramConfig.botToken, telegramConfig.chatId]);

  async function runBacktest(customForm = backtestForm){
    const timeframe = customForm.timeframe || "1d";
    const durationUnit = customForm.durationUnit || "days";
    const maxDuration = maxDurationForUnit(timeframe, durationUnit);
    const duration = Math.min(maxDuration, Math.max(1, Number(customForm.durationValue) || 1));
    const form = {...customForm, durationValue: String(duration), durationUnit};
    const params = new URLSearchParams({
      symbol: form.symbol,
      initial_capital: String(form.initialCapital || 100000),
      timeframe,
      duration: String(duration),
      duration_unit: durationUnit
    });
    const r = await fetch(API + "/backtest?" + params.toString(), {method: "POST"});
    const result = await r.json();
    const merged = {...result, ...form, equity_curve: result.equity_curve || []};
    setBacktest(merged);
    setPage("Backtesting");
    addLog(`Backtest executed for ${form.symbol} using ${form.strategy} strategy on ${timeframe} timeframe over ${duration} ${durationUnit}.`, "info");
  }

  async function handleLogin(event){
    event.preventDefault();
    const username = loginForm.username.trim();
    const password = loginForm.password;
    if (username.length < 3 || !password || password.length < 8) {
      setLoginError("Enter a username with at least 3 characters and a password with at least 8 characters.");
      return;
    }
    if (authMode === "signup" && password !== confirmPassword) {
      setLoginError("Passwords do not match. Please confirm your account password.");
      return;
    }
    setLoginError("");
    try {
      const response = await fetch(API + (authMode === "signup" ? "/auth/signup" : "/auth/login"), {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username, password})
      });
      const result = await response.json();
      if (!response.ok) {
        setLoginError(result.detail || "Could not authenticate. Please try again.");
        return;
      }
      localStorage.setItem("trademind-auth-session", JSON.stringify({accessToken: result.access_token}));
      localStorage.setItem("trademind-user", JSON.stringify({username: result.username}));
      localStorage.removeItem("trademind-session");
      setProfile((current) => ({
        ...current,
        name: current.name === "TradeMind User" || current.name === loginForm.username ? result.username : current.name
      }));
      setIsLoggedIn(true);
      addLog(`${authMode === "signup" ? "Signed up and logged in" : "Logged in"} as ${result.username}.`, "success");
      if (telegramConfig.botToken && telegramConfig.chatId) {
        notifyTelegram(`TradeMind ${authMode === "signup" ? "signup" : "login"} successful for ${result.username}. Alerts are now enabled.`);
      }
    } catch {
      setLoginError("Unable to reach the account service. Check that the backend is running, then try again.");
    }
  }

  async function handleLogout(){
    try {
      const savedSession = JSON.parse(localStorage.getItem("trademind-auth-session") || "null");
      if (savedSession?.accessToken) {
        const response = await fetch(API + "/auth/logout", {
          method: "POST",
          headers: {Authorization: `Bearer ${savedSession.accessToken}`}
        });
        if (!response.ok) addLog("Could not revoke the session on the server; local sign-out completed.", "warning");
      }
    } catch {
      addLog("Could not revoke the session on the server; local sign-out completed.", "warning");
    }
    try {
      localStorage.removeItem("trademind-session");
      localStorage.removeItem("trademind-auth-session");
    } catch {}
    setIsLoggedIn(false);
    setPage("Dashboard");
    addLog("Logged out from TradeMind.", "warning");
  }

  function handleSearch(event){
    if (event.key !== "Enter") return;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;
    const marketMatch = markets.find((item) => item.symbol.toLowerCase().includes(query));
    const pageMatch = nav.find(([name]) => name.toLowerCase().includes(query));
    if (marketMatch) {
      setSymbol(marketMatch.symbol);
      setPage("Dashboard");
    } else if (pageMatch) {
      setPage(pageMatch[0]);
    } else if (strategies.some((item) => item.name.toLowerCase().includes(query))) {
      setPage("Strategies");
    } else {
      alert(`No market, section, or strategy found for "${searchQuery.trim()}".`);
    }
    setSearchQuery("");
  }

  function saveRiskRules(event){
    event.preventDefault();
    localStorage.setItem("trademind-risk-rules", JSON.stringify(riskRules));
    addLog("Risk rules saved.", "success");
  }

  function addStrategy(name){
    if (!name?.trim() || strategies.some((item) => item.name.toLowerCase() === name.trim().toLowerCase())) return false;
    setStrategies((current) => [...current, {name: name.trim(), risk: "Medium", status: "READY", description: "Custom strategy configuration."}]);
    return true;
  }

  function configureStrategy(name, risk){
    const normalizedRisk = risk.trim().toLowerCase();
    if (!["low", "medium", "high"].includes(normalizedRisk)) return false;
    setStrategies((current) => current.map((item) => item.name === name ? {...item, risk: normalizedRisk[0].toUpperCase() + normalizedRisk.slice(1)} : item));
    return true;
  }

  function exportReport(title, scope, period){
    const rows = [["Report", "Scope", "Period", "Generated"], [title, scope, period, new Date().toLocaleDateString()]];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    const message = `${title} exported as ${link.download}.`;
    setExportMessage(message);
    addLog(message, "success");
    notifyTelegram(`Report exported: ${title} (${scope}, ${period}).`);
  }

  const notificationItems = logs.filter((entry) => entry.type === "signal");
  const notificationId = (entry) => entry.id || `${entry.time}-${entry.message}`;
  const unreadNotificationCount = notificationItems.filter((entry) =>
    Number(entry.createdAt || 0) > notificationsReadAt && !readNotificationIds.has(notificationId(entry))
  ).length;

  if (authChecking) {
    return <div className="loginShell"><div className="loginCard"><p role="status">Checking your account session…</p></div></div>;
  }

  if (!isLoggedIn) {
    return (
      <div className="loginShell">
        <div className="loginCard">
          <div className="brand"><div className="brandIcon">AI</div><div><b>TradeMind</b><small>AI Trading Lab</small></div></div>
          <div className="authToggle">
            <button type="button" className={authMode === "login" ? "toggle active" : "toggle"} onClick={() => setAuthMode("login")}>Log in</button>
            <button type="button" className={authMode === "signup" ? "toggle active" : "toggle"} onClick={() => setAuthMode("signup")}>Sign up</button>
          </div>
          <h1>{authMode === "login" ? "Log in" : "Create account"}</h1>
          <p>{authMode === "login" ? "Access the live trading dashboard and risk controls." : "Open a new market-ready trading workspace."}</p>
          <form onSubmit={handleLogin} className="loginForm">
            <label>Username<input autoComplete="username" minLength={3} maxLength={50} required value={loginForm.username} onChange={(event) => setLoginForm((current) => ({...current, username: event.target.value}))} placeholder="Choose a username" /></label>
            <label>Password<input type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={8} maxLength={128} required value={loginForm.password} onChange={(event) => setLoginForm((current) => ({...current, password: event.target.value}))} placeholder="At least 8 characters" /></label>
            {authMode === "signup" && <label>Confirm Password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm password" /></label>}
            {loginError && <div className="loginError" role="alert">{loginError}</div>}
            <button className="primary full" type="submit"><LogIn size={16} /> {authMode === "login" ? "Log in" : "Sign up"}</button>
          </form>
          <div className="demoCreds">{authMode === "login" ? "Only registered accounts can log in. New here? Sign up to create an account." : "Create a unique account with a username and password of at least 8 characters."}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app" style={{"--sidebar-width": `${sidebarWidth}px`}}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brandIcon">AI</div>
          <div><b>TradeMind</b><small>AI Trading Lab</small></div>
        </div>
        <button className="profileCard" type="button" onClick={() => setProfileOpen(true)} aria-label="View and edit profile">
          <span className="profileCardAvatar">{(profile.name || "U").trim().charAt(0).toUpperCase()}</span>
          <span className="profileCardText">
            <strong>{profile.name || "TradeMind User"}</strong>
            <small>{profile.email || "Add personal information"}</small>
          </span>
          <span className="profileEditHint">Edit</span>
        </button>
        <div className="sectionLabel">WORKSPACE</div>
        {nav.map(([name, Icon]) => <button key={name} className={page === name ? "nav active" : "nav"} onClick={() => setPage(name)}><Icon size={18} />{name}</button>)}
        <div className="sidebarBottom">
          <div className="riskMini"><span>●</span> System online<small>Market data connected</small></div>
          <div className="supportContact">
            <span>Need help?</span>
            <a href="mailto:fultonskipz44@gmail.com">fultonskipz44@gmail.com</a>
          </div>
        </div>
        <button
          className="sidebarResizeHandle"
          type="button"
          aria-label="Resize navigation panel"
          aria-valuemin={200}
          aria-valuemax={420}
          aria-valuenow={sidebarWidth}
          onPointerDown={beginSidebarResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setSidebarWidth((width) => Math.max(200, width - 10));
            if (event.key === "ArrowRight") setSidebarWidth((width) => Math.min(420, width + 10));
          }}
        />
      </aside>
      <main>
        <header>
          <button className="mobileMenu" aria-label="Toggle navigation" onClick={() => document.querySelector(".sidebar")?.classList.toggle("open")}><Menu /></button>
          <div className="search"><Search size={17} /><input aria-label="Search symbols, strategies, or sections" placeholder="Search symbol, strategy..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={handleSearch} /></div>
          <div className="topActions">
            <div className="notificationWrap">
              <button
                className="iconButton notificationButton"
                aria-label={`Notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ""}`}
                aria-expanded={notificationsOpen}
                aria-haspopup="dialog"
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <Bell />
                {unreadNotificationCount > 0 && <span className="notificationCount">{unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}</span>}
              </button>
              {notificationsOpen && (
                <div className="notificationPanel" role="dialog" aria-label="Trading signals">
                  <div className="notificationPanelHead">
                    <div><strong>Trading Signals</strong><small>{unreadNotificationCount ? `${unreadNotificationCount} unread` : "You're all caught up"}</small></div>
                    <div className="notificationPanelActions">
                      <button className="linkButton" type="button" onClick={markNotificationsRead} disabled={!unreadNotificationCount}>Mark read</button>
                      <button className="popoverClose" type="button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}>Close</button>
                    </div>
                  </div>
                  <div className="notificationList">
                    {notificationItems.length ? notificationItems.slice(0, 8).map((entry) => (
                      <button
                        className={`notificationItem ${Number(entry.createdAt || 0) > notificationsReadAt && !readNotificationIds.has(notificationId(entry)) ? "unread" : ""}`}
                        key={notificationId(entry)}
                        type="button"
                        aria-label={`Open notification: ${entry.message}`}
                        onClick={() => openNotification(entry)}
                      >
                        <span className={`notificationDot ${entry.type || "info"}`} />
                        <div className="notificationItemContent">
                          {entry.optionSignal ? <OptionSignalNotification details={entry.optionSignal} /> : <p>{entry.message}</p>}
                          <time>{entry.time || "Earlier"}</time>
                        </div>
                      </button>
                    )) : <p className="notificationEmpty">No trading signals yet. New signal alerts will appear here.</p>}
                  </div>
                </div>
              )}
            </div>
            <button className="logoutButton" onClick={handleLogout}>Logout</button>
            <div className="developerProfile">
              <button
                className="avatar"
                type="button"
                aria-label="Show developer name"
                aria-expanded={developerCardOpen}
                onClick={() => setDeveloperCardOpen((open) => !open)}
              >
                MJ
              </button>
              {developerCardOpen && (
                <div className="developerPopover" role="status">
                  <div className="developerPopoverHead">
                    <small>Developer</small>
                    <button className="popoverClose" type="button" aria-label="Close developer information" onClick={() => setDeveloperCardOpen(false)}>Close</button>
                  </div>
                  <strong>Mihir Joshi</strong>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="content">
          {page === "Dashboard" && <Dashboard markets={markets} symbol={symbol} setSymbol={setSymbol} market={market} signal={signal} chartInterval={chartInterval} setChartInterval={setChartInterval} runBacktest={() => runBacktest(backtestForm)} onViewAll={() => setPage("Signals")} notifyTelegram={notifyTelegram} addLog={addLog} />}
          {page === "Signals" && <Signals symbol={symbol} setSymbol={setSymbol} signal={signal} markets={markets} market={market} notifyTelegram={notifyTelegram} addLog={addLog} />}
          {page === "Options Trading" && <OptionsTrading symbol={symbol} setSymbol={setSymbol} signal={signal} markets={markets} market={market} addLog={addLog} />}
          {page === "Backtesting" && <Backtesting backtest={backtest} runBacktest={() => runBacktest(backtestForm)} symbol={symbol} backtestForm={backtestForm} setBacktestForm={setBacktestForm} notifyTelegram={notifyTelegram} addLog={addLog} />}
          {page === "Risk Management" && <Risk riskRules={riskRules} setRiskRules={setRiskRules} saveRiskRules={saveRiskRules} addLog={addLog} />}
          {page === "Reports" && <Reports exportReport={exportReport} exportMessage={exportMessage} notifyTelegram={notifyTelegram} />}
          {page === "Strategies" && <Strategies strategies={strategies} addStrategy={addStrategy} configureStrategy={configureStrategy} addLog={addLog} />}
        </div>
      </main>
      {profileOpen && <ProfileDialog profile={profile} telegramConfig={telegramConfig} onSave={saveProfile} onTestTelegram={(settings) => notifyTelegram("TradeMind Telegram connection test successful.", settings)} onClose={() => setProfileOpen(false)} />}
      {selectedNotification && (
        <div className="profileDialogBackdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedNotification(null);
        }}>
          <section className="profileDialog notificationDetailDialog" role="dialog" aria-modal="true" aria-labelledby="notification-detail-title">
            <div className="panelHead">
              <div>
                <p className="eyebrow">TRADING SIGNAL</p>
                <h2 id="notification-detail-title">Signal details</h2>
              </div>
              <button className="popoverClose" type="button" aria-label="Close notification details" onClick={() => setSelectedNotification(null)}>Close</button>
            </div>
            {selectedNotification.optionSignal
              ? <OptionSignalNotification details={selectedNotification.optionSignal} expanded />
              : <p className="notificationDetailMessage">{selectedNotification.message}</p>}
            <div className="notificationDetailMeta">
              <span className={`notificationDot ${selectedNotification.type || "info"}`} />
              <span>{selectedNotification.type || "info"}</span>
              <time>{selectedNotification.time || "Earlier"}</time>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MarketPriceChart({market, chartType, indicators, showVolume, priceScale, drawings, drawingTool, onChartClick}){
  const svgRef = useRef(null);
  const series = market?.series || [];
  const stats = useMemo(() => {
    const closes = series.map((candle) => Number(candle.close));
    const sma = closes.map((_, index) => {
      if (index < 19) return null;
      return closes.slice(index - 19, index + 1).reduce((sum, value) => sum + value, 0) / 20;
    });
    const ema = [];
    const alpha = 2 / 21;
    closes.forEach((value, index) => {
      ema.push(index ? value * alpha + ema[index - 1] * (1 - alpha) : value);
    });
    const deviation = closes.map((_, index) => {
      if (index < 19) return null;
      const window = closes.slice(index - 19, index + 1);
      const mean = sma[index];
      return Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 20);
    });
    return {
      sma,
      ema,
      upperBand: sma.map((value, index) => value === null ? null : value + 2 * deviation[index]),
      lowerBand: sma.map((value, index) => value === null ? null : value - 2 * deviation[index])
    };
  }, [series]);
  const plotBottom = showVolume ? 250 : 340;
  const xAt = (index) => 30 + (index / Math.max(series.length - 1, 1)) * 840;
  const indicatorValues = [
    ...(indicators.sma ? stats.sma : []),
    ...(indicators.ema ? stats.ema : []),
    ...(indicators.bollinger ? [...stats.upperBand, ...stats.lowerBand] : [])
  ].filter((value) => value !== null && Number.isFinite(value));
  const prices = [
    ...series.flatMap((candle) => [Number(candle.low), Number(candle.high)]),
    ...indicatorValues
  ].filter(Number.isFinite);
  const basePrice = Number(series[0]?.close || 1);
  const transformPrice = (price) => {
    const value = Number(price);
    if (priceScale === "log") return Math.log(Math.max(value, Number.MIN_VALUE));
    if (priceScale === "percent") return ((value - basePrice) / basePrice) * 100;
    return value;
  };
  const scaledPrices = prices.map(transformPrice);
  const rawMin = scaledPrices.length ? Math.min(...scaledPrices) : 0;
  const rawMax = scaledPrices.length ? Math.max(...scaledPrices) : 1;
  const padding = (rawMax - rawMin) * 0.06 || 1;
  const minimum = rawMin - padding;
  const maximum = rawMax + padding;
  const range = maximum - minimum || 1;
  const yAt = (price) => 18 + ((maximum - transformPrice(price)) / range) * (plotBottom - 26);
  const priceAtY = (y) => {
    const scaledValue = maximum - ((y - 18) / (plotBottom - 26)) * range;
    if (priceScale === "log") return Math.exp(scaledValue);
    if (priceScale === "percent") return basePrice * (1 + scaledValue / 100);
    return scaledValue;
  };
  const formatScale = (scaledValue) => {
    if (priceScale === "percent") return `${scaledValue.toFixed(1)}%`;
    const value = priceScale === "log" ? Math.exp(scaledValue) : scaledValue;
    return value.toLocaleString(undefined, {maximumFractionDigits: 2});
  };
  const lineFor = (values) => values.map((value, index) => value === null || !Number.isFinite(value) ? null : `${xAt(index)},${yAt(value)}`).filter(Boolean).join(" ");
  const maxVolume = Math.max(1, ...series.map((candle) => Number(candle.volume) || 0));
  const bodyWidth = Math.max(2, Math.min(12, 840 / Math.max(series.length, 1) * 0.62));

  function handleDrawingClick(event){
    if (!svgRef.current || drawingTool === "cursor") return;
    const bounds = svgRef.current.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 900;
    const y = ((event.clientY - bounds.top) / bounds.height) * 360;
    onChartClick({x, y, price: priceAtY(y)});
  }

  return (
    <svg
      ref={svgRef}
      className={`priceChartSvg ${drawingTool === "cursor" ? "" : "drawingActive"}`}
      viewBox="0 0 900 360"
      role="img"
      aria-label={`${chartType} chart for ${market?.symbol || "market"}`}
      preserveAspectRatio="none"
      onClick={handleDrawingClick}
    >
      {[0, 1, 2, 3, 4].map((line) => {
        const y = 18 + (line / 4) * (plotBottom - 26);
        const scaledValue = maximum - (line / 4) * range;
        return (
          <g key={line}>
            <line x1="22" x2="878" y1={y} y2={y} className="priceChartGridLine" />
            <text x="890" y={y + 4} textAnchor="end" className="priceChartScaleLabel">{formatScale(scaledValue)}</text>
          </g>
        );
      })}
      {chartType === "candlestick" || chartType === "ohlc" ? series.map((candle, index) => {
        const x = xAt(index);
        const openY = yAt(candle.open);
        const closeY = yAt(candle.close);
        const highY = yAt(candle.high);
        const lowY = yAt(candle.low);
        const rising = Number(candle.close) >= Number(candle.open);
        return (
          <g key={`${candle.time}-${index}`} className={rising ? "priceChartUp" : "priceChartDown"}>
            <title>{`${candle.time}: O ${candle.open}, H ${candle.high}, L ${candle.low}, C ${candle.close}`}</title>
            <line x1={x} x2={x} y1={highY} y2={lowY} className="priceChartWick" />
            {chartType === "candlestick" ? (
              <rect x={x - bodyWidth / 2} y={Math.min(openY, closeY)} width={bodyWidth} height={Math.max(Math.abs(closeY - openY), 1)} className="priceChartCandleBody" />
            ) : (
              <>
                <line x1={x - bodyWidth / 2} x2={x} y1={openY} y2={openY} className="priceChartWick" />
                <line x1={x} x2={x + bodyWidth / 2} y1={closeY} y2={closeY} className="priceChartWick" />
              </>
            )}
          </g>
        );
      }) : (
        <>
          {chartType === "area" && series.length > 1 && <polygon points={`${xAt(0)},${plotBottom} ${lineFor(series.map((candle) => Number(candle.close)))} ${xAt(series.length - 1)},${plotBottom}`} className="priceChartArea" />}
          <polyline points={lineFor(series.map((candle) => Number(candle.close)))} className="priceChartCloseLine" />
        </>
      )}
      {indicators.bollinger && <polyline points={lineFor(stats.upperBand)} className="priceChartBollinger" />}
      {indicators.bollinger && <polyline points={lineFor(stats.lowerBand)} className="priceChartBollinger" />}
      {indicators.sma && <polyline points={lineFor(stats.sma)} className="priceChartSma" />}
      {indicators.ema && <polyline points={lineFor(stats.ema)} className="priceChartEma" />}
      {drawings.map((drawing) => (
        <line key={drawing.id} x1={drawing.x1} y1={drawing.y1} x2={drawing.x2} y2={drawing.y2} className="priceChartDrawing" />
      ))}
      {showVolume && series.map((candle, index) => {
        const volume = Number(candle.volume) || 0;
        const height = (volume / maxVolume) * 62;
        return <rect key={`volume-${candle.time}-${index}`} x={xAt(index) - bodyWidth / 2} y={348 - height} width={bodyWidth} height={height} className={Number(candle.close) >= Number(candle.open) ? "priceChartVolumeUp" : "priceChartVolumeDown"}><title>{`${candle.time}: volume ${volume.toLocaleString()}`}</title></rect>;
      })}
    </svg>
  );
}

function Dashboard({markets, symbol, setSymbol, market, signal, chartInterval, setChartInterval, runBacktest, onViewAll, notifyTelegram, addLog}){
  const [showSignalDetails, setShowSignalDetails] = useState(false);
  const [chartType, setChartType] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").chartType || "candlestick"; } catch { return "candlestick"; }
  });
  const [priceScale, setPriceScale] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").priceScale || "linear"; } catch { return "linear"; }
  });
  const [indicators, setIndicators] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").indicators || {sma: true, ema: false, bollinger: false}; } catch { return {sma: true, ema: false, bollinger: false}; }
  });
  const [showVolume, setShowVolume] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").showVolume !== false; } catch { return true; }
  });
  const [drawingTool, setDrawingTool] = useState("cursor");
  const [drawings, setDrawings] = useState([]);
  const [pendingTrendPoint, setPendingTrendPoint] = useState(null);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [alertPrice, setAlertPrice] = useState("");
  const [alertCondition, setAlertCondition] = useState("above");
  const [priceAlerts, setPriceAlerts] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-price-alerts") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
  const [replayIndex, setReplayIndex] = useState(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const chartPanelRef = useRef(null);
  const alertedPriceIdsRef = useRef(new Set());
  const previousMarketPriceRef = useRef(null);
  const marketMap = useMemo(() => Object.fromEntries((markets || []).map((item) => [item.symbol, item])), [markets]);
  const breadth = useMemo(() => {
    const indiaSymbols = ["NIFTY 50", "BANK NIFTY", "SENSEX", "RELIANCE", "TCS", "INFOSYS", "HDFC BANK", "ICICI BANK", "SBIN", "ITC", "BHARTI AIRTEL"];
    const available = indiaSymbols.map((name) => marketMap[name]).filter(Boolean);
    const advancing = available.filter((item) => Number(item.change) > 0).length;
    const declining = available.filter((item) => Number(item.change) < 0).length;
    const unchanged = available.filter((item) => Number(item.change) === 0).length;
    return {advancing, declining, unchanged, total: available.length};
  }, [marketMap]);
  const marketStats = [
    {title: "Sensex", value: marketMap["SENSEX"] ? `₹${marketMap["SENSEX"].price.toLocaleString("en-IN", {maximumFractionDigits: 2})}` : "—", delta: marketMap["SENSEX"] ? formatPercent(marketMap["SENSEX"].change) : "—", icon: "S"},
    {title: "Nifty 50", value: marketMap["NIFTY 50"] ? `₹${marketMap["NIFTY 50"].price.toLocaleString("en-IN", {maximumFractionDigits: 2})}` : "—", delta: marketMap["NIFTY 50"] ? formatPercent(marketMap["NIFTY 50"].change) : "—", icon: "N"},
    {title: "Bank Nifty", value: marketMap["BANK NIFTY"] ? `₹${marketMap["BANK NIFTY"].price.toLocaleString("en-IN", {maximumFractionDigits: 2})}` : "—", delta: marketMap["BANK NIFTY"] ? formatPercent(marketMap["BANK NIFTY"].change) : "—", icon: "B"}
  ];
  const signalPlan = getSignalPlan(symbol, market, signal);
  const intervalChoices = [["1m", "1m"], ["2m", "2m"], ["5m", "5m"], ["15m", "15m"], ["30m", "30m"], ["60m", "60m"], ["90m", "90m"], ["1h", "1h"], ["1D", "1d"], ["5D", "5d"], ["1W", "1wk"], ["1M", "1mo"], ["3M", "3mo"]];
  const allChartSeries = market?.series || [];
  const chartRangeOptions = [["1D", 1], ["5D", 5], ["1M", 30], ["3M", 90], ["6M", 180], ["1Y", 365], ["All", null]];
  const [chartRange, setChartRange] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").chartRange || "All"; } catch { return "All"; }
  });
  const rangeDays = chartRangeOptions.find(([label]) => label === chartRange)?.[1];
  const rangedSeries = rangeDays
    ? allChartSeries.filter((candle) => {
      const timestamp = new Date(candle.timestamp || candle.time).getTime();
      return Number.isFinite(timestamp) && timestamp >= Date.now() - rangeDays * 86400000;
    })
    : allChartSeries;
  const chartSeries = rangedSeries.length || !allChartSeries.length
    ? rangedSeries
    : allChartSeries.slice(-1);
  const visibleChartSeries = chartSeries.length ? chartSeries : allChartSeries.slice(-1);
  const visibleMarket = market ? {
    ...market,
    series: replayIndex === null ? chartSeries : visibleChartSeries.slice(0, replayIndex + 1),
    price: replayIndex === null ? market.price : visibleChartSeries[replayIndex]?.close || market.price
  } : null;
  const lastClose = Number(market?.price || 0);

  useEffect(() => {
    try { localStorage.setItem("trademind-price-alerts", JSON.stringify(priceAlerts)); } catch {}
  }, [priceAlerts]);

  useEffect(() => {
    if (!lastClose) return;
    const previous = previousMarketPriceRef.current;
    previousMarketPriceRef.current = {symbol, price: lastClose};
    if (!previous || previous.symbol !== symbol) return;
    const triggeredIds = new Set();
    for (const alert of priceAlerts) {
      if (alert.triggered || alert.symbol !== symbol || alertedPriceIdsRef.current.has(alert.id)) continue;
      const triggered = alert.condition === "above"
        ? previous.price < alert.price && lastClose >= alert.price
        : previous.price > alert.price && lastClose <= alert.price;
      if (!triggered) continue;
      alertedPriceIdsRef.current.add(alert.id);
      triggeredIds.add(alert.id);
      const message = `${symbol} price alert: ${lastClose.toLocaleString()} crossed ${alert.condition} ${alert.price.toLocaleString()}.`;
      addLog(message, "info");
      notifyTelegram(message);
    }
    if (triggeredIds.size) {
      setPriceAlerts((current) => current.map((alert) => triggeredIds.has(alert.id) ? {...alert, triggered: true} : alert));
    }
  }, [lastClose, symbol, priceAlerts, addLog, notifyTelegram]);

  useEffect(() => {
    if (!replayPlaying) return undefined;
    const timer = window.setInterval(() => {
      setReplayIndex((current) => {
        const next = (current ?? 0) + 1;
        if (next >= visibleChartSeries.length) {
          setReplayPlaying(false);
          return visibleChartSeries.length - 1;
        }
        return next;
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [replayPlaying, visibleChartSeries.length]);

  useEffect(() => {
    const syncFullscreenState = () => setIsChartFullscreen(document.fullscreenElement === chartPanelRef.current);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  function handleChartDrawing(point){
    if (drawingTool === "horizontal") {
      setDrawings((current) => [...current, {id: `${Date.now()}-${Math.random()}`, x1: 22, x2: 878, y1: point.y, y2: point.y}]);
    } else if (drawingTool === "trendline") {
      if (!pendingTrendPoint) setPendingTrendPoint(point);
      else {
        setDrawings((current) => [...current, {id: `${Date.now()}-${Math.random()}`, x1: pendingTrendPoint.x, y1: pendingTrendPoint.y, x2: point.x, y2: point.y}]);
        setPendingTrendPoint(null);
        setDrawingTool("cursor");
      }
    }
  }

  function createPriceAlert(event){
    event.preventDefault();
    const price = Number(alertPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    const alert = {id: `${Date.now()}-${Math.random()}`, symbol, price, condition: alertCondition, triggered: false};
    setPriceAlerts((current) => [alert, ...current]);
    addLog(`Price alert set for ${symbol} ${alertCondition} ${price.toLocaleString()}.`, "info");
    setAlertPrice("");
    setShowAlertForm(false);
  }

  function saveChartLayout(){
    try {
      localStorage.setItem("trademind-chart-settings", JSON.stringify({chartType, priceScale, indicators, showVolume, chartInterval, chartRange}));
      addLog("Chart layout saved on this device.", "success");
    } catch {
      addLog("Chart layout could not be saved in this browser.", "warning");
    }
  }

  function resetChartLayout(){
    setChartType("candlestick");
    setPriceScale("linear");
    setIndicators({sma: true, ema: false, bollinger: false});
    setShowVolume(true);
    setChartInterval("1d");
    setChartRange("All");
    try { localStorage.removeItem("trademind-chart-settings"); } catch {}
    setDrawingTool("cursor");
    setPendingTrendPoint(null);
    setDrawings([]);
  }

  function downloadChartData(){
    const rows = [["Time", "Open", "High", "Low", "Close", "Volume"], ...chartSeries.map((item) => [item.time, item.open, item.high, item.low, item.close, item.volume])];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${chartInterval}-chart.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function toggleChartFullscreen(){
    try {
      if (document.fullscreenElement === chartPanelRef.current) await document.exitFullscreen();
      else if (chartPanelRef.current?.requestFullscreen) await chartPanelRef.current.requestFullscreen();
    } catch {
      addLog("Fullscreen is unavailable in this browser.", "warning");
    }
  }

  return (
    <>
      <div className="pageHead">
        <div><p className="eyebrow">OVERVIEW</p><h1>Trading Dashboard</h1><p>AI-powered market intelligence and strategy monitoring.</p></div>
        <button className="primary" onClick={() => { runBacktest(); notifyTelegram(`Backtest launched for ${symbol}.`); }}>Run Backtest</button>
      </div>
      <div className="marketStrip">{(markets || []).map((m) => <button type="button" className={"marketPill " + (m.symbol === symbol ? "selected" : "")} onClick={() => setSymbol(m.symbol)} key={m.symbol}><span>{m.symbol}</span><b>{m.price.toLocaleString()}</b><em className={m.change >= 0 ? "up" : "down"}>{m.change >= 0 ? "+" : ""}{m.change}%</em></button>)}</div>
      <div className="grid4">
        {marketStats.map((item) => <Stat key={item.title} title={item.title} value={item.value} delta={item.delta} icon={item.icon} />)}
        <MarketBreadth breadth={breadth} />
      </div>
      <div className="mainGrid">
        <div className="panel chartPanel" ref={chartPanelRef}>
          <div className="panelHead">
            <div><h3>{symbol} · {chartInterval} <span className="liveDot">{market?.live ? "LIVE" : "DEMO"}</span></h3><span className="bigPrice">{Number(visibleMarket?.price || 0).toLocaleString(undefined, {maximumFractionDigits: 2}) || "—"}</span></div>
            <div className="marketChartControls">
              <label><span>Chart</span><select aria-label="Chart style" value={chartType} onChange={(event) => setChartType(event.target.value)}><option value="line">Line</option><option value="area">Area</option><option value="candlestick">Candlestick</option><option value="ohlc">OHLC bars</option></select></label>
              <label><span>Scale</span><select aria-label="Price scale" value={priceScale} onChange={(event) => setPriceScale(event.target.value)}><option value="linear">Linear</option><option value="log">Logarithmic</option><option value="percent">Percentage</option></select></label>
              <select aria-label="Chart market symbol" value={symbol} onChange={(event) => { setSymbol(event.target.value); setReplayIndex(null); setReplayPlaying(false); }}>{(markets || []).map((m) => <option key={m.symbol}>{m.symbol}</option>)}</select>
            </div>
          </div>
          <div className="chartIntervalBar" aria-label="Chart timeframe">
            {intervalChoices.map(([label, interval]) => <button key={interval} type="button" className={chartInterval === interval ? "chartToolButton active" : "chartToolButton"} aria-pressed={chartInterval === interval} onClick={() => { setChartInterval(interval); setReplayIndex(null); setReplayPlaying(false); }}>{label}</button>)}
            <span className="chartToolbarDivider" />
            <button type="button" className="chartToolButton" onClick={() => { setShowWatchlist((shown) => !shown); setShowAlertForm(false); }} aria-expanded={showWatchlist}>Watchlist</button>
            <button type="button" className="chartToolButton" onClick={() => { setShowAlertForm((shown) => !shown); setShowWatchlist(false); }} aria-expanded={showAlertForm}>＋ Alert</button>
            <button type="button" className="chartToolButton" onClick={() => {
              if (replayIndex === null) setReplayIndex(Math.max(0, Math.min(9, visibleChartSeries.length - 1)));
              else setReplayPlaying((playing) => !playing);
            }} disabled={visibleChartSeries.length < 2}>{replayIndex === null ? "◀ Replay" : replayPlaying ? "Ⅱ Pause" : "▶ Replay"}</button>
            {replayIndex !== null && <>
              <button type="button" className="chartToolButton" aria-label="Previous replay candle" onClick={() => { setReplayPlaying(false); setReplayIndex((index) => Math.max(0, (index ?? 0) - 1)); }}>◀</button>
              <button type="button" className="chartToolButton" aria-label="Next replay candle" onClick={() => { setReplayPlaying(false); setReplayIndex((index) => Math.min(visibleChartSeries.length - 1, (index ?? 0) + 1)); }}>▶</button>
              <button type="button" className="chartToolButton" onClick={() => { setReplayPlaying(false); setReplayIndex(null); }}>Exit replay</button>
            </>}
            <button type="button" className="chartToolButton" onClick={saveChartLayout}>Save</button>
            <button type="button" className="chartToolButton" onClick={resetChartLayout}>Reset</button>
            <button type="button" className="chartToolButton" onClick={downloadChartData}>Export</button>
            <button type="button" className="chartToolButton" aria-label={isChartFullscreen ? "Minimize chart" : "Maximize chart"} onClick={toggleChartFullscreen}>{isChartFullscreen ? "↙ Minimize" : "⛶ Maximize"}</button>
          </div>
          <div className="chartIndicatorBar" aria-label="Chart indicators and drawing tools">
            {[["sma", "SMA 20"], ["ema", "EMA 20"], ["bollinger", "Bollinger"]].map(([key, label]) => <button key={key} type="button" className={indicators[key] ? "chartToolButton active" : "chartToolButton"} aria-pressed={indicators[key]} onClick={() => setIndicators((current) => ({...current, [key]: !current[key]}))}>{label}</button>)}
            <button type="button" className={showVolume ? "chartToolButton active" : "chartToolButton"} aria-pressed={showVolume} onClick={() => setShowVolume((shown) => !shown)}>Volume</button>
            <span className="chartToolbarDivider" />
            <label>Draw<select aria-label="Drawing tool" value={drawingTool} onChange={(event) => { setDrawingTool(event.target.value); setPendingTrendPoint(null); }}><option value="cursor">Cursor</option><option value="horizontal">Horizontal line</option><option value="trendline">Trend line (two clicks)</option></select></label>
            <button type="button" className="chartToolButton" disabled={!drawings.length} onClick={() => setDrawings((current) => current.slice(0, -1))}>Undo drawing</button>
            <button type="button" className="chartToolButton" disabled={!drawings.length} onClick={() => setDrawings([])}>Clear drawings</button>
          </div>
          {showWatchlist && <div className="chartPopover chartWatchlist" role="region" aria-label="Market watchlist">
            <div className="chartPopoverHead"><strong>Watchlist</strong><button type="button" aria-label="Close watchlist" onClick={() => setShowWatchlist(false)}>×</button></div>
            {(markets || []).map((item) => <button key={item.symbol} type="button" className={item.symbol === symbol ? "chartWatchItem active" : "chartWatchItem"} onClick={() => { setSymbol(item.symbol); setReplayIndex(null); setReplayPlaying(false); setShowWatchlist(false); }}><span>{item.symbol}</span><b>{Number(item.price).toLocaleString()}</b><em className={item.change >= 0 ? "up" : "down"}>{formatPercent(item.change)}</em></button>)}
          </div>}
          {showAlertForm && <form className="chartPopover chartAlertForm" onSubmit={createPriceAlert}>
            <div className="chartPopoverHead"><strong>Price alert · {symbol}</strong><button type="button" aria-label="Close alert form" onClick={() => setShowAlertForm(false)}>×</button></div>
            <label>Trigger<select aria-label="Alert direction" value={alertCondition} onChange={(event) => setAlertCondition(event.target.value)}><option value="above">Price crosses above</option><option value="below">Price crosses below</option></select></label>
            <label>Price<input aria-label="Alert price" required min="0.01" step="any" type="number" value={alertPrice} onChange={(event) => setAlertPrice(event.target.value)} placeholder={lastClose ? String(lastClose) : "Enter price"} /></label>
            <button className="primary" type="submit">Create alert</button>
            {priceAlerts.filter((alert) => alert.symbol === symbol).map((alert) => <div className="chartAlertRow" key={alert.id}><span>{alert.condition} {alert.price.toLocaleString()} {alert.triggered ? "· Triggered" : "· Active"}</span><button type="button" aria-label={`Remove alert at ${alert.price}`} onClick={() => setPriceAlerts((current) => current.filter((item) => item.id !== alert.id))}>×</button></div>)}
          </form>}
          <div className="chart chartLive"><MarketPriceChart market={visibleMarket} chartType={chartType} indicators={indicators} showVolume={showVolume} priceScale={priceScale} drawings={drawings} drawingTool={drawingTool} onChartClick={handleChartDrawing} /></div>
          <div className="chartRangeBar" aria-label="Visible chart range">
            {chartRangeOptions.map(([label]) => <button key={label} type="button" className={chartRange === label ? "chartToolButton active" : "chartToolButton"} aria-pressed={chartRange === label} onClick={() => { setChartRange(label); setReplayIndex(null); setReplayPlaying(false); }}>{label}</button>)}
            <span className="chartRangeStatus">{replayIndex === null ? `${chartSeries.length} candles` : `Replay · ${replayIndex + 1}/${visibleChartSeries.length}`}{market?.updated_at ? ` · Updated ${new Date(market.updated_at).toLocaleTimeString()}` : ""}</span>
          </div>
        </div>
        <div className="panel signalPanel">
          <div className="panelHead"><h3>AI Signal</h3><span className="badge">MODEL v1.0</span></div>
          <div className={"signal " + (signal?.signal || "HOLD").toLowerCase()}>{signal?.signal || "WAIT"}<small>{signal?.confidence || 0}% confidence</small></div>
          <div className="meter"><span style={{width: `${signal?.confidence || 0}%`}} /></div>
          <div className="indicatorRows">
            <Row name="RSI" value={signal?.rsi ?? "—"} status={signal?.rsi > 70 ? "Overbought" : "Neutral"} />
            <Row name="MACD" value={signal?.macd ?? "—"} status="Trend" />
            <Row name="Strategy" value="AI Momentum" status="Active" />
          </div>
          <button className="outline" type="button" onClick={() => setShowSignalDetails(true)}>View Signal Details</button>
        </div>
      </div>
      {showSignalDetails && (
        <div className="signalDialogBackdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowSignalDetails(false);
        }}>
          <section className="signalDialog" role="dialog" aria-modal="true" aria-labelledby="signal-details-title">
            <div className="panelHead">
              <div>
                <p className="eyebrow">CURRENT MARKET SETUP</p>
                <h2 id="signal-details-title">{symbol} Signal Details</h2>
              </div>
              <button className="outline" type="button" aria-label="Close signal details" onClick={() => setShowSignalDetails(false)}>Close</button>
            </div>
            <div className="signalDetailGrid">
              <Row name="Signal" value={signal?.signal || "WAIT"} status={`${signal?.confidence || 0}% confidence`} />
              <Row name="Bias" value={signalPlan.bias} status={market?.live ? "Live data" : "Demo data"} />
              <Row name="Market price" value={toCurrency(market?.price)} status={market?.updated_at ? new Date(market.updated_at).toLocaleString() : "Awaiting data"} />
              <Row name="Entry" value={toCurrency(signalPlan.entry)} status="Indicative" />
              <Row name="Target exit" value={toCurrency(signalPlan.exit)} status="Indicative" />
              <Row name="Stop loss" value={toCurrency(signalPlan.stopLoss)} status="Indicative" />
              <Row name="RSI (14)" value={signal?.rsi ?? "—"} status={signal?.rsi > 70 ? "Overbought" : signal?.rsi < 30 ? "Oversold" : "Neutral"} />
              <Row name="MACD" value={signal?.macd ?? "—"} status="Trend indicator" />
            </div>
            <p className="signalDisclaimer">Signal levels are indicative estimates for analysis only, not exchange-verified option prices or investment advice.</p>
            <div className="signalDialogActions">
              <button className="outline" type="button" onClick={() => setShowSignalDetails(false)}>Done</button>
              <button className="primary" type="button" onClick={() => {
                const message = `${symbol}: ${signal?.signal || "WAIT"} signal with ${signal?.confidence || 0}% confidence. Entry ${signalPlan.entry}, Exit ${signalPlan.exit}, Stop Loss ${signalPlan.stopLoss}.`;
                addLog(message, "info");
                notifyTelegram(message);
              }}>Send details to Telegram</button>
            </div>
          </section>
        </div>
      )}
      <div className="bottomGrid">
        <div className="panel">
          <div className="panelHead"><h3>Technical Indicators</h3><span>Live</span></div>
          <div className="indicatorCards">
            <Indicator title="RSI (14)" value={signal?.rsi ?? "—"} sub="Neutral zone" />
            <Indicator title="MACD" value={signal?.macd ?? "—"} sub="Momentum" />
            <Indicator title="SMA (20)" value={market?.indicators?.sma20?.toLocaleString() ?? "—"} sub="Trend support" />
            <Indicator title="Latest volume" value={market?.series?.length ? Number(market.series.at(-1)?.volume || 0).toLocaleString() : "—"} sub="Provider volume" />
          </div>
        </div>
        <div className="panel activity">
          <div className="panelHead"><h3>Recent Signals</h3><button className="linkButton" onClick={onViewAll}>View all</button></div>
          <div className="signalLine"><i className="buy">BUY</i><b>NIFTY 50</b><span>09:42 AM</span><strong>₹25,842</strong></div>
          <div className="signalLine"><i className="sell">SELL</i><b>BTC/USDT</b><span>09:18 AM</span><strong>$112,640</strong></div>
          <div className="signalLine"><i className="hold">HOLD</i><b>BANK NIFTY</b><span>08:57 AM</span><strong>₹58,320</strong></div>
        </div>
      </div>
    </>
  );
}

function ProfileDialog({profile, telegramConfig, onSave, onTestTelegram, onClose}){
  const [draft, setDraft] = useState(profile);
  const [draftTelegram, setDraftTelegram] = useState(telegramConfig);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramTestStatus, setTelegramTestStatus] = useState("");

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  useEffect(() => {
    setDraftTelegram(telegramConfig);
  }, [telegramConfig]);

  async function testTelegram(){
    setTestingTelegram(true);
    setTelegramTestStatus("");
    try {
      const delivery = await onTestTelegram(draftTelegram);
      setTelegramTestStatus(delivery.ok
        ? "Test message delivered. Check your Telegram chat."
        : `Test failed: ${delivery.error}`);
    } finally {
      setTestingTelegram(false);
    }
  }

  return (
    <div className="profileDialogBackdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="profileDialog" onSubmit={(event) => onSave(event, draft, draftTelegram)} role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
        <div className="panelHead">
          <div>
            <p className="eyebrow">ACCOUNT</p>
            <h2 id="profile-dialog-title">Personal profile</h2>
          </div>
          <button className="outline" type="button" onClick={onClose}>Close</button>
        </div>
        <p className="profilePrivacyNote">Profile and Telegram alert settings are stored in this browser on this device.</p>
        <label>Full name<input autoComplete="name" value={draft.name || ""} onChange={(event) => setDraft((current) => ({...current, name: event.target.value}))} maxLength={80} /></label>
        <label>Email address<input type="email" autoComplete="email" value={draft.email || ""} onChange={(event) => setDraft((current) => ({...current, email: event.target.value}))} maxLength={120} /></label>
        <label>Phone number<input type="tel" autoComplete="tel" value={draft.phone || ""} onChange={(event) => setDraft((current) => ({...current, phone: event.target.value}))} maxLength={40} /></label>
        <label>Location<input autoComplete="address-level2" value={draft.location || ""} onChange={(event) => setDraft((current) => ({...current, location: event.target.value}))} maxLength={80} /></label>
        <label>Telegram bot token<input value={draftTelegram.botToken || ""} onChange={(event) => setDraftTelegram((current) => ({...current, botToken: event.target.value}))} placeholder="123456:ABCDEF" /></label>
        <label>Telegram chat ID<input value={draftTelegram.chatId || ""} onChange={(event) => setDraftTelegram((current) => ({...current, chatId: event.target.value}))} placeholder="-1001234567890" /></label>
        <p className="profilePrivacyNote">Use a Telegram bot token and your chat ID to receive signal notifications automatically.</p>
        <details className="telegramIdSuggestion">
          <summary>Suggestion: How do I find my bot token and chat ID?</summary>
          <p>Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> and copy its API token; the bot ID is the number before the colon. To find your chat ID, send a message to your bot, then check <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> for <code>message.chat.id</code>.</p>
        </details>
        <div className="telegramTestActions">
          <button className="outline" type="button" onClick={testTelegram} disabled={testingTelegram}>
            {testingTelegram ? "Sending test…" : "Test Telegram connection"}
          </button>
          {telegramTestStatus && <span role="status" aria-live="polite">{telegramTestStatus}</span>}
        </div>
        <div className="profileDialogActions">
          <button className="outline" type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit">Save profile & alerts</button>
        </div>
      </form>
    </div>
  );
}

function Stat({title, value, delta, icon}){
  return <div className="stat"><div className="statIcon">{icon}</div><div><span>{title}</span><h2>{value}</h2><em>{delta} <small>vs last period</small></em></div></div>;
}

function MarketBreadth({breadth}){
  const advancingShare = breadth.total ? (breadth.advancing / breadth.total) * 100 : 0;
  const decliningShare = breadth.total ? (breadth.declining / breadth.total) * 100 : 0;

  return (
    <div className="stat breadthStat" aria-label={`Market breadth: ${breadth.advancing} advancing, ${breadth.declining} declining, ${breadth.unchanged} unchanged`}>
      <div className="statIcon">M</div>
      <div className="breadthContent">
        <span>India Market Breadth</span>
        {breadth.total ? (
          <>
            <h2>{breadth.advancing} <small>up</small> / {breadth.declining} <small>down</small></h2>
            <div className="breadthMeter" role="img" aria-label={`${advancingShare.toFixed(0)}% advancing, ${decliningShare.toFixed(0)}% declining`}>
              <span className="breadthAdvance" style={{width: `${advancingShare}%`}} />
              <span className="breadthDecline" style={{width: `${decliningShare}%`}} />
            </div>
            <em>{breadth.unchanged} unchanged · {breadth.total} tracked</em>
          </>
        ) : (
          <>
            <h2>—</h2>
            <em>Waiting for market data</em>
          </>
        )}
      </div>
    </div>
  );
}

function Row({name, value, status}){
  return <div className="row"><span>{name}</span><b>{value}</b><em>{status}</em></div>;
}

function Indicator({title, value, sub}){
  return <div className="indicator"><span>{title}</span><b>{value}</b><small>{sub}</small></div>;
}

function OptionSignalNotification({details, expanded = false}){
  const tradeType = {INTRADAY: "Intraday", BTST: "BTST", STBT: "STBT"}[details.tradeType] || details.tradeType;
  const signalDate = details.signalDate
    ? formatTradeDate(new Date(`${details.signalDate}T12:00:00`))
    : "—";

  return (
    <div className={`optionNotificationCard${expanded ? " expanded" : ""}`}>
      <div className="optionNotificationHeading">
        <strong>Index Options by TradeMind</strong>
        <span>Setup · Paper only</span>
      </div>
      <div className="optionNotificationContract">
        <b>{details.contract}</b>
        <span>{details.underlying} · {tradeType} · {details.action} {details.optionType}</span>
        <time>{signalDate} · Expiry {details.expiry}</time>
      </div>
      <div className="optionNotificationPrices">
        <div><span>Entry</span><b>{toCurrency(details.entry)}</b></div>
        <div><span>Target</span><b>{toCurrency(details.target)}</b></div>
        <div><span>SL</span><b>{toCurrency(details.stopLoss)}</b></div>
      </div>
      <small>Signal setup only. No order was placed or exited.</small>
    </div>
  );
}

function Signals({symbol, setSymbol, signal, markets, market, notifyTelegram, addLog}){
  const plan = getSignalPlan(symbol, market, signal);
  return (
    <>
      <div className="pageHead">
        <div><p className="eyebrow">AI ENGINE</p><h1>Trading Signals</h1><p>Generated from technical indicators and strategy rules.</p></div>
        <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{(markets || []).map((m) => <option key={m.symbol}>{m.symbol}</option>)}</select>
      </div>
      <div className="signalHero">
        <div>
          <span className="eyebrow">CURRENT SIGNAL</span>
          <div className={"heroSignal " + (signal?.signal || "HOLD").toLowerCase()}>{signal?.signal || "WAIT"}</div>
          <p>Confidence score: <b>{signal?.confidence || 0}%</b></p>
        </div>
        <div className="featureList">
          <Row name="Signal date" value={formatTradeDate()} status="Trade date" />
          <Row name="RSI (14)" value={signal?.rsi ?? "—"} status="Calculated" />
          <Row name="MACD" value={signal?.macd ?? "—"} status="Calculated" />
          <Row name="Entry" value={plan.entry} status={plan.bias} />
          <Row name="Exit" value={plan.exit} status="Target" />
          <Row name="Stop Loss" value={plan.stopLoss} status="Risk" />
          <Row name="Engine" value="ML + Rules" status="Online" />
        </div>
      </div>
      <div className="panel signalLogPanel">
        <div className="panelHead"><h3>Signal alert</h3><button className="outline" onClick={() => {
          const message = `${symbol}: ${signal?.signal || "WAIT"} signal on ${formatTradeDate()}. Entry ${plan.entry}, Exit ${plan.exit}, SL ${plan.stopLoss}.`;
          addLog(message, "info");
          notifyTelegram(message);
        }}>Send to Telegram</button></div>
      </div>
    </>
  );
}

function OptionsTrading({symbol, setSymbol, signal, markets, market, addLog}){
  const underlyings = ["NIFTY 50", "BANK NIFTY", "SENSEX"];
  const [expiry, setExpiry] = useState(() => nextOptionsExpiry(7));
  const [optionType, setOptionType] = useState("CALL");
  const [strike, setStrike] = useState(null);
  const [tradeType, setTradeType] = useState("INTRADAY");
  const [liveOptionSignal, setLiveOptionSignal] = useState(null);
  const [liveOptionError, setLiveOptionError] = useState("");
  const [liveOptionLoading, setLiveOptionLoading] = useState(true);
  const notifiedOptionSignalsRef = useRef(null);
  if (notifiedOptionSignalsRef.current === null) {
    try {
      const savedKeys = JSON.parse(localStorage.getItem("trademind-option-signal-notifications") || "[]");
      notifiedOptionSignalsRef.current = new Set(Array.isArray(savedKeys) ? savedKeys : []);
    } catch {
      notifiedOptionSignalsRef.current = new Set();
    }
  }
  const [side, setSide] = useState("BUY");
  const [quantity, setQuantity] = useState("1");
  const [orderError, setOrderError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [paperOrders, setPaperOrders] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-paper-options") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
  const underlying = underlyings.includes(symbol) ? symbol : "NIFTY 50";
  const selectedMarket = symbol === underlying ? market : (markets || []).find((item) => item.symbol === underlying);
  const spot = Number(selectedMarket?.price || 0);
  const strikeStep = underlying === "NIFTY 50" ? 50 : 100;
  const atmStrike = spot ? Math.round(spot / strikeStep) * strikeStep : strikeStep;
  const strikes = Array.from({length: 11}, (_, index) => atmStrike + (index - 5) * strikeStep);
  const selectedStrike = strikes.includes(Number(strike)) ? Number(strike) : atmStrike;
  const expiryDate = new Date(`${expiry}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysToExpiry = Math.max(1, Math.ceil((expiryDate.getTime() - today.getTime()) / 86400000));
  const selectedPremium = estimateOptionPremium(spot, selectedStrike, daysToExpiry, optionType);
  const signalKey = [underlying, tradeType, liveOptionSignal?.signal, liveOptionSignal?.contract].join("|");
  const [signalMetadata, setSignalMetadata] = useState(() => createOptionsSignalMetadata(signalKey));

  useEffect(() => {
    let cancelled = false;
    async function loadLiveSignal(){
      setLiveOptionLoading(true);
      setLiveOptionError("");
      try {
        const savedSession = JSON.parse(localStorage.getItem("trademind-auth-session") || "null");
        if (!savedSession?.accessToken) throw new Error("Sign in to request a live Angel One options signal.");
        const params = new URLSearchParams({trade_type: tradeType});
        const response = await fetch(`${API}/options/signal/${encodeURIComponent(underlying)}?${params}`, {
          headers: {Authorization: `Bearer ${savedSession.accessToken}`}
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Unable to load a live options signal.");
        if (!cancelled) setLiveOptionSignal(result);
      } catch (error) {
        if (!cancelled) setLiveOptionError(error.message || "Unable to load a live options signal.");
      } finally {
        if (!cancelled) setLiveOptionLoading(false);
      }
    }
    loadLiveSignal();
    const timer = setInterval(loadLiveSignal, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [underlying, tradeType]);

  useEffect(() => {
    if (symbol !== underlying) setSymbol(underlying);
  }, [symbol, underlying, setSymbol]);

  useEffect(() => {
    setSignalMetadata((current) => current.key === signalKey ? current : createOptionsSignalMetadata(signalKey));
  }, [signalKey]);

  useEffect(() => {
    if (
      !liveOptionSignal?.contract ||
      !["BUY", "SELL"].includes(liveOptionSignal.signal) ||
      !Number.isFinite(Number(liveOptionSignal.entry_premium)) ||
      !Number.isFinite(Number(liveOptionSignal.target_premium)) ||
      !Number.isFinite(Number(liveOptionSignal.stop_loss_premium))
    ) return;

    const details = {
      underlying: liveOptionSignal.underlying,
      signal: liveOptionSignal.signal,
      contract: liveOptionSignal.contract,
      expiry: liveOptionSignal.expiry,
      tradeType: liveOptionSignal.trade_type,
      optionType: liveOptionSignal.option_type,
      action: liveOptionSignal.action,
      signalDate: liveOptionSignal.signal_date,
      entry: Number(liveOptionSignal.entry_premium),
      target: Number(liveOptionSignal.target_premium),
      stopLoss: Number(liveOptionSignal.stop_loss_premium)
    };
    const notificationKey = [
      details.underlying,
      details.signalDate,
      details.tradeType,
      details.contract,
      details.action
    ].join("|");
    if (notifiedOptionSignalsRef.current.has(notificationKey)) return;

    notifiedOptionSignalsRef.current.add(notificationKey);
    try {
      localStorage.setItem(
        "trademind-option-signal-notifications",
        JSON.stringify([...notifiedOptionSignalsRef.current].slice(-100))
      );
    } catch {}
    const message = `${details.contract} · ${details.tradeType} · ${details.signalDate} · Expiry ${details.expiry} · Entry ${toCurrency(details.entry)} · Target ${toCurrency(details.target)} · SL ${toCurrency(details.stopLoss)}`;
    addLog(message, "signal", details);
  }, [liveOptionSignal, addLog]);

  useEffect(() => {
    try { localStorage.setItem("trademind-paper-options", JSON.stringify(paperOrders.slice(0, 10))); } catch {}
  }, [paperOrders]);

  async function submitPaperOrder(event){
    event.preventDefault();
    setOrderError("");
    const units = Number(quantity);
    if (!Number.isInteger(units) || units < 1 || !selectedPremium) {
      setOrderError("Enter a positive whole-number quantity and wait for a valid underlying price.");
      return;
    }
    setSubmitting(true);
    try {
      const params = new URLSearchParams({
        symbol: underlying,
        side,
        quantity: String(units),
        price: selectedPremium.toFixed(2),
        option_type: optionType,
        strike: String(selectedStrike),
        expiry
      });
      const response = await fetch(`${API}/orders/paper?${params}`, {method: "POST"});
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Paper order was rejected.");
      const order = {...result, id: `${Date.now()}-${selectedStrike}`, created_at: new Date().toLocaleString()};
      setPaperOrders((current) => [order, ...current].slice(0, 10));
      addLog(`${side} ${units} ${underlying} ${selectedStrike} ${optionType} paper option accepted at ${toCurrency(selectedPremium)}.`, "info");
    } catch (error) {
      setOrderError(error.message || "Unable to submit the paper order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="pageHead">
        <div><p className="eyebrow">LIVE SIGNAL · PAPER ORDERS</p><h1>Options Trading</h1><p>Live Angel One listed contracts and premiums; the paper-order simulator remains separate.</p></div>
        <span className="optionDemoBadge">SIGNALS FROM ANGEL ONE · NO LIVE EXECUTION</span>
      </div>
      <div className="optionWorkspace">
        <section className="panel optionChainPanel">
          <div className="panelHead"><div><h3>Indicative options chain</h3><p className="optionSubheading">Separate simulator only; these estimates are not used in the live signal.</p></div></div>
          <div className="optionControls">
            <label>Underlying
              <select value={underlying} onChange={(event) => { setSymbol(event.target.value); setStrike(null); }}>
                {underlyings.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>Simulated expiry
              <select value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                {[7, 14, 30].map((days) => {
                  const date = nextOptionsExpiry(days);
                  return <option key={days} value={date}>{date} · {days}-day scenario</option>;
                })}
              </select>
            </label>
            <label>Option right
              <select value={optionType} onChange={(event) => setOptionType(event.target.value)}>
                <option value="CALL">Call</option><option value="PUT">Put</option>
              </select>
            </label>
          </div>
          <div className="optionUnderlyingStats">
            <span>Underlying spot <b>{toCurrency(spot)}</b></span>
            <span>Strike step <b>{toCurrency(strikeStep)}</b></span>
            <span>Pricing basis <b>20% assumed volatility</b></span>
          </div>
          <div className="optionChainScroll">
            <table className="optionChainTable">
              <thead><tr><th>Call premium</th><th>Call</th><th>Strike</th><th>Put</th><th>Put premium</th></tr></thead>
              <tbody>
                {strikes.map((rowStrike) => {
                  const call = estimateOptionPremium(spot, rowStrike, daysToExpiry, "CALL");
                  const put = estimateOptionPremium(spot, rowStrike, daysToExpiry, "PUT");
                  const active = selectedStrike === rowStrike;
                  return (
                    <tr className={active ? "selectedStrike" : ""} key={rowStrike}>
                      <td>{toCurrency(call)}</td>
                      <td><button type="button" className={`optionSelectButton ${optionType === "CALL" && active ? "active" : ""}`} onClick={() => { setStrike(rowStrike); setOptionType("CALL"); }}>Select</button></td>
                      <th scope="row">{rowStrike.toLocaleString("en-IN")}{rowStrike === atmStrike && <small> ATM</small>}</th>
                      <td><button type="button" className={`optionSelectButton ${optionType === "PUT" && active ? "active" : ""}`} onClick={() => { setStrike(rowStrike); setOptionType("PUT"); }}>Select</button></td>
                      <td>{toCurrency(put)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="panel optionTradePanel">
          <div className="panelHead"><div><h3>Paper trade</h3><p className="optionSubheading">No broker connection or real order placement.</p></div></div>
          <div className="optionContractSummary">
            <span>{underlying} · {selectedStrike} · {optionType}</span>
            <strong>{toCurrency(selectedPremium)}</strong>
            <small>Simulated premium · {expiry}</small>
          </div>
          <form className="optionTradeForm" onSubmit={submitPaperOrder}>
            <label>Action
              <select value={side} onChange={(event) => setSide(event.target.value)}>
                <option value="BUY">Buy</option><option value="SELL">Sell</option>
              </select>
            </label>
            <label>Quantity (units)
              <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
            </label>
            <button className="primary" type="submit" disabled={submitting || !spot}>{submitting ? "Submitting…" : "Submit paper order"}</button>
          </form>
          {orderError && <p className="optionError" role="alert">{orderError}</p>}
          <div className="optionSignal">
            <p className="eyebrow">LIVE OPTIONS SIGNAL · {liveOptionSignal?.signal || "WAIT"} · {tradeType}</p>
            <div className="optionSignalMeta">
              <span>Signal date <b>{liveOptionSignal?.signal_date || signalMetadata.date}</b></span>
              <span>Trade No. <b>{signalMetadata.tradeNumber}</b></span>
              {liveOptionSignal?.confidence !== undefined && <span>Confidence <b>{liveOptionSignal.confidence}%</b></span>}
            </div>
            <div className="optionSignalControls">
              <label>Trade type
                <select value={tradeType} onChange={(event) => setTradeType(event.target.value)}>
                  <option value="INTRADAY">Intraday</option>
                  <option value="BTST">BTST · Buy today, sell tomorrow</option>
                  <option value="STBT">STBT · Sell today, buy tomorrow</option>
                </select>
              </label>
            </div>
            {liveOptionError ? (
              <p className="optionError" role="alert">{liveOptionError}</p>
            ) : liveOptionLoading && !liveOptionSignal ? (
              <p>Connecting to Angel One SmartAPI for live contract and quote data…</p>
            ) : liveOptionSignal?.contract ? (
              <dl className="optionSignalDetails">
                <div><dt>Signal</dt><dd>{liveOptionSignal.signal} · {liveOptionSignal.underlying}</dd></div>
                <div><dt>Exact option contract</dt><dd>{liveOptionSignal.contract}</dd></div>
                <div><dt>Expiry</dt><dd>{liveOptionSignal.expiry}</dd></div>
                <div><dt>Trade type / action</dt><dd>{liveOptionSignal.trade_type} · {liveOptionSignal.action} {liveOptionSignal.option_type}</dd></div>
                <div><dt>Live entry premium</dt><dd>{toCurrency(liveOptionSignal.entry_premium)}</dd></div>
                <div><dt>Target premium</dt><dd>{toCurrency(liveOptionSignal.target_premium)}</dd></div>
                <div><dt>Stop-loss premium</dt><dd>{toCurrency(liveOptionSignal.stop_loss_premium)}</dd></div>
                <div><dt>Underlying spot</dt><dd>{toCurrency(liveOptionSignal.spot)}</dd></div>
              </dl>
            ) : liveOptionSignal ? (
              <p>No directional options setup right now. Current {liveOptionSignal.underlying} signal: {liveOptionSignal.signal} ({liveOptionSignal.confidence}% confidence).</p>
            ) : <p>Waiting for a live signal.</p>}
            <small>{liveOptionSignal?.note || "Signal, expiry, and option premium require configured Angel One SmartAPI credentials. Target/stop levels are percentage scenarios, not guaranteed fills or investment advice."}</small>
          </div>
        </aside>
      </div>
      <section className="panel optionOrdersPanel">
        <div className="panelHead"><h3>Recent paper-order confirmations</h3><small>Saved in this browser only</small></div>
        {paperOrders.length ? (
          <div className="optionOrdersList">
            {paperOrders.map((order) => (
              <div className="optionOrderRow" key={order.id}>
                <b>{order.side} {order.quantity} {order.symbol} {order.strike} {order.option_type}</b>
                <span>{toCurrency(Number(order.price))} · {order.expiry}</span>
                <small>{order.created_at} · {order.status}</small>
              </div>
            ))}
          </div>
        ) : <p className="optionSubheading">No paper orders submitted yet.</p>}
      </section>
    </>
  );
}

function Backtesting({backtest, runBacktest, symbol, backtestForm, setBacktestForm, notifyTelegram, addLog}){
  const chartData = useMemo(() => {
    const labels = (backtest?.equity_curve || []).map((_, index) => `T${index + 1}`);
    const values = backtest?.equity_curve || [];
    return {
      labels,
      datasets: [{label: "Equity", data: values, borderColor: "#62d5ff", backgroundColor: "rgba(98,213,255,.15)", fill: true, tension: 0.2, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2, spanGaps: true}]
    };
  }, [backtest]);

  return (
    <>
      <div className="pageHead"><div><p className="eyebrow">STRATEGY LAB</p><h1>Backtesting</h1><p>Evaluate historical strategy performance.</p></div><button className="primary" onClick={() => { runBacktest(); notifyTelegram(`Backtest started for ${backtestForm.symbol} using ${backtestForm.strategy}.`); }}>Run {symbol} Test</button></div>
      <div className="panel backtestFormPanel">
        <div className="formGrid">
          <label>Market symbol<select value={backtestForm.symbol} onChange={(event) => setBacktestForm((current) => ({...current, symbol: event.target.value}))}><option>NIFTY 50</option><option>BANK NIFTY</option><option>SENSEX</option><option>RELIANCE</option><option>TCS</option><option>INFOSYS</option><option>HDFC BANK</option><option>ICICI BANK</option><option>SBIN</option><option>ITC</option><option>BHARTI AIRTEL</option><option>BTC/USDT</option><option>ETH/USDT</option></select></label>
          <label>Strategy<select value={backtestForm.strategy} onChange={(event) => setBacktestForm((current) => ({...current, strategy: event.target.value}))}><option>AI Momentum</option><option>RSI Reversal</option><option>Breakout Momentum</option><option>VWAP Trend</option><option>Mean Reversion</option><option>Swing Breakout</option></select></label>
          <label>Timeframe<select value={backtestForm.timeframe} onChange={(event) => setBacktestForm((current) => {
            const timeframe = event.target.value;
            const durationUnit = maxDurationForUnit(timeframe, current.durationUnit) ? current.durationUnit : "days";
            const maxDuration = maxDurationForUnit(timeframe, durationUnit);
            return {...current, timeframe, durationUnit, durationValue: String(Math.min(Number(current.durationValue) || 1, maxDuration))};
          })}>
            <option value="1m">1 minute</option><option value="2m">2 minutes</option><option value="5m">5 minutes</option><option value="15m">15 minutes</option><option value="30m">30 minutes</option><option value="60m">60 minutes</option><option value="90m">90 minutes</option><option value="1h">1 hour</option><option value="1d">1 day</option><option value="5d">5 days</option><option value="1wk">1 week</option><option value="1mo">1 month</option><option value="3mo">3 months</option>
          </select></label>
          <label>Duration<div className="durationInputGroup"><input aria-label="Duration amount" type="number" min="1" max={maxDurationForUnit(backtestForm.timeframe, backtestForm.durationUnit)} step="1" required value={backtestForm.durationValue} onChange={(event) => setBacktestForm((current) => ({...current, durationValue: event.target.value}))} /><select aria-label="Duration unit" value={backtestForm.durationUnit} onChange={(event) => setBacktestForm((current) => ({...current, durationUnit: event.target.value, durationValue: "1"}))}><option value="days">Days</option><option value="months" disabled={!maxDurationForUnit(backtestForm.timeframe, "months")}>Months</option><option value="years" disabled={!maxDurationForUnit(backtestForm.timeframe, "years")}>Years</option></select></div></label>
          <label>Initial capital<input type="number" value={backtestForm.initialCapital} onChange={(event) => setBacktestForm((current) => ({...current, initialCapital: event.target.value}))} /></label>
          <label>Position size<input type="number" value={backtestForm.positionSize} onChange={(event) => setBacktestForm((current) => ({...current, positionSize: event.target.value}))} /></label>
          <label>Stop loss %<input type="number" min="0" step="0.1" value={backtestForm.stopLoss} onChange={(event) => setBacktestForm((current) => ({...current, stopLoss: event.target.value}))} /></label>
        </div>
      </div>
      {backtest ? (
        <>
          <div className="grid4">
            <Stat title="Final Value" value={toCurrency(backtest.final_value)} delta={formatPercent(backtest.return_pct)} icon="₹" />
            <Stat title="P&L" value={toCurrency(backtest.pnl)} delta="Test result" icon="↗" />
            <Stat title="Win Rate" value={`${backtest.win_rate || 0}%`} delta={`${backtest.trades || 0} trades`} icon="W" />
            <Stat title="Max Drawdown" value={`${backtest.max_drawdown || 0}%`} delta="Risk metric" icon="↓" />
          </div>
          <div className="panel chartPanel"><div className="panelHead"><h3>{backtestForm.symbol} performance</h3><span>{backtestForm.strategy} · {backtestForm.durationValue} {backtestForm.durationUnit} · {chartData.datasets[0].data.length} equity points</span></div><div className="chart"><Line data={chartData} options={{responsive: true, maintainAspectRatio: false, interaction: {mode: "index", intersect: false}, plugins: {legend: {display: false}, tooltip: {enabled: true}}, scales: {x: {grid: {display: false}, ticks: {color: "#8190a5", autoSkip: true, maxTicksLimit: 8}}, y: {beginAtZero: false, grid: {color: "rgba(255,255,255,.05)"}, ticks: {color: "#8190a5", callback: (value) => toCurrency(Number(value))}}}}} /></div></div>
        </>
      ) : <div className="empty panel">Run a backtest to calculate P&L, win rate and maximum drawdown.</div>}
    </>
  );
}

function Risk({riskRules, setRiskRules, saveRiskRules, addLog}){
  const [saved, setSaved] = useState(false);
  const updateRule = (field, value) => { setRiskRules((current) => ({...current, [field]: value})); setSaved(false); };
  const capitalAmount = Number(riskRules.capitalBox || 0);
  const dailyLoss = Number(riskRules.dailyLoss || 0);
  const capitalUsage = capitalAmount ? ((dailyLoss / capitalAmount) * 100).toFixed(1) : "0.0";

  return (
    <>
      <div className="pageHead"><div><p className="eyebrow">PROTECTION</p><h1>Risk Management</h1><p>Configure limits and monitor portfolio risk.</p></div></div>
      <div className="riskGrid">
        <form className="panel" onSubmit={(event) => { saveRiskRules(event); setSaved(true); addLog("Risk rules saved.", "success"); }}>
          <h3>Risk Rules</h3>
          <label>Stop Loss %<input type="number" min="0" step="0.1" value={riskRules.stopLoss} onChange={(event) => updateRule("stopLoss", event.target.value)} /></label>
          <label>Maximum Drawdown %<input type="number" min="0" step="0.1" value={riskRules.maxDrawdown} onChange={(event) => updateRule("maxDrawdown", event.target.value)} /></label>
          <label>Capital Box<input type="number" min="0" step="1000" value={riskRules.capitalBox} onChange={(event) => updateRule("capitalBox", event.target.value)} /></label>
          <label>Daily Loss Limit<input type="number" min="0" step="100" value={riskRules.dailyLoss} onChange={(event) => updateRule("dailyLoss", event.target.value)} /></label>
          <button className="primary" type="submit">Save Risk Rules</button>
          {saved && <span role="status">Saved on this device.</span>}
        </form>
        <div className="panel">
          <h3>Risk Status</h3>
          <div className="safe">✓ Portfolio within configured risk limits</div>
          <Row name="Capital box" value={`₹${Number(riskRules.capitalBox || 0).toLocaleString()}`} status="Allocated" />
          <Row name="Stop loss" value={`${riskRules.stopLoss}%`} status="Active" />
          <Row name="Max drawdown" value={`${riskRules.maxDrawdown}%`} status="Active" />
          <Row name="Daily loss limit" value={`₹${Number(riskRules.dailyLoss).toLocaleString()}`} status="Active" />
          <Row name="Capital usage" value={`${capitalUsage}%`} status="Current" />
          <Row name="Alerts" value="ON" status="Enabled" />
        </div>
      </div>
    </>
  );
}

function Reports({exportReport, exportMessage, notifyTelegram}){
  return (
    <>
      <div className="pageHead"><div><p className="eyebrow">ANALYTICS</p><h1>Reports</h1><p>Backtesting and strategy performance reports.</p></div></div>
      <div className="panel table">
        <div className="signalLine"><b>Weekly Strategy Report</b><span>AI Momentum</span><span>Generated today</span><button className="outline" onClick={() => { exportReport("Weekly Strategy Report", "AI Momentum", "This week"); notifyTelegram("Weekly strategy report exported from TradeMind."); }}>Export</button></div>
        <div className="signalLine"><b>Monthly P&L Report</b><span>Portfolio</span><span>Sep 2026</span><button className="outline" onClick={() => { exportReport("Monthly P&L Report", "Portfolio", "Sep 2026"); notifyTelegram("Monthly P&L report exported from TradeMind."); }}>Export</button></div>
        {exportMessage && <p role="status">{exportMessage}</p>}
      </div>
    </>
  );
}

function Strategies({strategies, addStrategy, configureStrategy, addLog}){
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState("");
  const [editing, setEditing] = useState(null);
  const [editRisk, setEditRisk] = useState("Medium");

  function submitNewStrategy(event){
    event.preventDefault();
    if (!addStrategy(newName)) { setNewError("Enter a unique strategy name."); return; }
    addLog(`Created new strategy: ${newName.trim()}.`, "success");
    setNewName(""); setNewError(""); setShowNew(false);
  }

  function openConfiguration(strategy){
    setEditing(strategy.name);
    setEditRisk(strategy.risk);
  }

  function saveConfiguration(event, strategyName){
    event.preventDefault();
    if (configureStrategy(strategyName, editRisk)) {
      addLog(`Updated ${strategyName} to ${editRisk} risk.`, "success");
      setEditing(null);
    }
  }

  return (
    <>
      <div className="pageHead"><div><p className="eyebrow">CONFIGURATION</p><h1>Trading Strategies</h1><p>Create and manage rule-based strategies.</p></div><button className="primary" onClick={() => { setShowNew(true); setNewError(""); }}>+ New Strategy</button></div>
      {showNew && <form className="panel" onSubmit={submitNewStrategy}><label>Strategy name<input autoFocus maxLength="40" value={newName} onChange={(event) => { setNewName(event.target.value); setNewError(""); }} required /></label>{newError && <span role="alert">{newError}</span>}<button className="primary" type="submit">Create Strategy</button><button className="outline" type="button" onClick={() => setShowNew(false)}>Cancel</button></form>}
      <div className="strategyGrid">{strategies.map((strategy) => <div className="panel strategy" key={strategy.name}><span className={`badge ${strategy.status === "READY" ? "muted" : ""}`}>{strategy.status}</span><h3>{strategy.name}</h3><p>{strategy.description}</p><Row name="Risk" value={strategy.risk} status={strategy.status === "ACTIVE" ? "Configured" : "Ready"} /><button className="outline" onClick={() => editing === strategy.name ? setEditing(null) : openConfiguration(strategy)}>{editing === strategy.name ? "Close configuration" : "Configure"}</button>{editing === strategy.name && <form onSubmit={(event) => saveConfiguration(event, strategy.name)}><label>Risk level<select value={editRisk} onChange={(event) => setEditRisk(event.target.value)}><option>Low</option><option>Medium</option><option>High</option></select></label><button className="primary" type="submit">Save configuration</button></form>}</div>)}</div>
    </>
  );
}

export default App;
