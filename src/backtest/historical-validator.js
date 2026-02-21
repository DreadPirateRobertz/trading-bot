// Historical Backtest Validator
// Fetches real OHLCV data from Binance public API and runs walk-forward evaluation.
// No API keys needed — uses public klines endpoint.

import { WalkForwardEvaluator } from '../ml/walk-forward-evaluator.js';

// API endpoints: try Binance.US first (US-accessible), then global
const BINANCE_ENDPOINTS = [
  'https://api.binance.us/api/v3',
  'https://api.binance.com/api/v3',
];

// Fetch historical klines from Binance public API
// Tries Binance.US first, then global Binance as fallback.
// symbol: e.g. 'BTCUSDT', interval: '1d', '4h', '1h', etc.
export async function fetchBinanceKlines(symbol, {
  interval = '1d',
  limit = 1000,
  startTime,
  endTime,
} = {}) {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(Math.min(limit, 1000)),
  });
  if (startTime) params.set('startTime', String(startTime));
  if (endTime) params.set('endTime', String(endTime));

  let lastError;
  for (const base of BINANCE_ENDPOINTS) {
    try {
      const url = `${base}/klines?${params}`;
      const res = await fetch(url);
      if (res.status === 451) continue; // geo-restricted, try next
      if (!res.ok) {
        lastError = new Error(`Binance klines error: ${res.status}`);
        continue;
      }
      const data = await res.json();
      return data.map(k => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: k[6],
      }));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('All Binance endpoints failed');
}

// Fetch extended history by paginating through the API
export async function fetchExtendedHistory(symbol, {
  interval = '1d',
  totalCandles = 2000,
  endTime,
} = {}) {
  const allCandles = [];
  let currentEndTime = endTime || Date.now();
  const batchSize = 1000;

  while (allCandles.length < totalCandles) {
    const remaining = totalCandles - allCandles.length;
    const batch = await fetchBinanceKlines(symbol, {
      interval,
      limit: Math.min(remaining, batchSize),
      endTime: currentEndTime,
    });

    if (batch.length === 0) break;

    // Prepend (older data first)
    allCandles.unshift(...batch);
    // Move window back
    currentEndTime = batch[0].openTime - 1;

    // Rate limit: 100ms between requests
    await new Promise(r => setTimeout(r, 100));
  }

  // Deduplicate by openTime
  const seen = new Set();
  return allCandles.filter(c => {
    if (seen.has(c.openTime)) return false;
    seen.add(c.openTime);
    return true;
  });
}

// Run walk-forward validation on real historical data
export async function validateOnHistoricalData({
  symbol = 'BTCUSDT',
  interval = '1d',
  totalCandles = 1000,
  evaluatorConfig = {},
} = {}) {
  const candles = await fetchExtendedHistory(symbol, { interval, totalCandles });

  if (candles.length < 300) {
    return { error: `Insufficient data: got ${candles.length} candles, need >= 300` };
  }

  const evaluator = new WalkForwardEvaluator({
    epochs: 50,
    retrainInterval: 60,
    minTrainSamples: 80,
    slippageBps: 10,     // realistic for crypto
    commissionBps: 10,
    ...evaluatorConfig,
  });

  const result = evaluator.evaluate(candles);

  if (result.error) return result;

  return {
    symbol,
    interval,
    candleCount: candles.length,
    dateRange: {
      start: new Date(candles[0].openTime).toISOString().slice(0, 10),
      end: new Date(candles[candles.length - 1].openTime).toISOString().slice(0, 10),
    },
    priceRange: {
      start: candles[0].close,
      end: candles[candles.length - 1].close,
      buyAndHoldReturn: round((candles[candles.length - 1].close - candles[0].close) / candles[0].close * 100),
    },
    results: {
      mlEnsemble: summarize(result.mlEnsemble),
      rulesOnlyEnsemble: summarize(result.rulesOnlyEnsemble),
      bbConservative: summarize(result.bbConservative),
      momentum7d: summarize(result.momentum7d),
    },
    comparison: result.comparison,
    hmm: result.hmm,
  };
}

// Validate on pre-loaded candle data (no network needed)
export function validateWithCandles(candles, {
  symbol = 'UNKNOWN',
  evaluatorConfig = {},
} = {}) {
  if (candles.length < 300) {
    return { error: `Insufficient data: got ${candles.length} candles, need >= 300` };
  }

  const evaluator = new WalkForwardEvaluator({
    epochs: 50, retrainInterval: 60, minTrainSamples: 80,
    slippageBps: 10, commissionBps: 10,
    ...evaluatorConfig,
  });

  const result = evaluator.evaluate(candles);
  if (result.error) return result;

  return {
    symbol,
    candleCount: candles.length,
    dateRange: {
      start: new Date(candles[0].openTime).toISOString().slice(0, 10),
      end: new Date(candles[candles.length - 1].openTime).toISOString().slice(0, 10),
    },
    priceRange: {
      start: candles[0].close,
      end: candles[candles.length - 1].close,
      buyAndHoldReturn: round((candles[candles.length - 1].close - candles[0].close) / candles[0].close * 100),
    },
    results: {
      mlEnsemble: summarize(result.mlEnsemble),
      rulesOnlyEnsemble: summarize(result.rulesOnlyEnsemble),
      bbConservative: summarize(result.bbConservative),
      momentum7d: summarize(result.momentum7d),
    },
    comparison: result.comparison,
    hmm: result.hmm,
  };
}

function summarize(r) {
  return {
    sharpe: r.sharpeRatio,
    sortino: r.sortinoRatio,
    calmar: r.calmarRatio,
    totalReturn: r.totalReturn,
    maxDrawdown: r.maxDrawdown,
    totalTrades: r.totalTrades,
    winRate: r.winRate,
    profitFactor: r.profitFactor,
    executionCosts: r.executionCosts,
  };
}

function round(n) { return Math.round(n * 100) / 100; }
