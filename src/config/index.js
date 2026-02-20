// Config/Credentials Module
// Loads settings from .env file and environment variables

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf-8');
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

export function loadConfig(envPath) {
  const dotenvPath = envPath || resolve(process.cwd(), '.env');
  const fileVars = parseEnvFile(dotenvPath);

  // Env vars override .env file
  const get = (key, fallback) => process.env[key] || fileVars[key] || fallback;
  const getBool = (key, fallback) => {
    const v = get(key);
    if (v === undefined) return fallback;
    return v === 'true' || v === '1';
  };
  const getNum = (key, fallback) => {
    const v = get(key);
    if (v === undefined) return fallback;
    const n = Number(v);
    return Number.isNaN(n) ? fallback : n;
  };

  return {
    // Alpaca
    alpaca: {
      keyId: get('ALPACA_KEY_ID', ''),
      secretKey: get('ALPACA_SECRET_KEY', ''),
      paper: getBool('ALPACA_PAPER', true),
    },

    // Binance
    binance: {
      apiKey: get('BINANCE_API_KEY', ''),
      secretKey: get('BINANCE_SECRET_KEY', ''),
      testnet: getBool('BINANCE_TESTNET', true),
    },

    // Reddit (for sentiment)
    reddit: {
      clientId: get('REDDIT_CLIENT_ID', ''),
      clientSecret: get('REDDIT_CLIENT_SECRET', ''),
      userAgent: get('REDDIT_USER_AGENT', 'tradingbot/1.0'),
    },

    // Trading params
    trading: {
      symbols: get('TRADING_SYMBOLS', 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()),
      initialBalance: getNum('INITIAL_BALANCE', 100000),
      maxPositionPct: getNum('MAX_POSITION_PCT', 0.10),
      yoloThreshold: getNum('YOLO_THRESHOLD', 0.85),
      lookback: getNum('LOOKBACK_PERIOD', 30),
    },

    // Dashboard
    dashboard: {
      port: getNum('DASHBOARD_PORT', 3000),
      host: get('DASHBOARD_HOST', '0.0.0.0'),
    },

    // General
    logLevel: get('LOG_LEVEL', 'info'),
    mode: get('BOT_MODE', 'paper'), // 'live', 'paper', 'backtest'
  };
}

export function validateConfig(config) {
  const errors = [];

  if (config.mode === 'live') {
    if (!config.alpaca.keyId && !config.binance.apiKey) {
      errors.push('Live mode requires at least one exchange API key (ALPACA_KEY_ID or BINANCE_API_KEY)');
    }
  }

  if (config.trading.symbols.length === 0) {
    errors.push('At least one trading symbol required (TRADING_SYMBOLS)');
  }

  if (config.trading.maxPositionPct <= 0 || config.trading.maxPositionPct > 1) {
    errors.push('MAX_POSITION_PCT must be between 0 and 1');
  }

  return { valid: errors.length === 0, errors };
}
