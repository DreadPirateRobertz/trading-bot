// Historical OHLCV data fetcher
// Fetches daily candles from Binance (public API, no auth needed for klines)

const BINANCE_API = 'https://api.binance.com/api';
const MS_PER_DAY = 86400000;

// Map user-friendly symbol names to Binance pairs
const SYMBOL_MAP = {
  'BTC/USD': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT',
  BTCUSDT: 'BTCUSDT',
  ETHUSDT: 'ETHUSDT',
};

export class HistoricalFetcher {
  constructor({ baseUrl = BINANCE_API, fetchFn = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl;
    this.fetch = fetchFn;
  }

  async fetchDailyCandles(symbol, { days = 365, endTime } = {}) {
    const binanceSymbol = SYMBOL_MAP[symbol] || symbol;
    const end = endTime || Date.now();
    const start = end - days * MS_PER_DAY;

    // Binance allows max 1000 klines per request; 365 fits in one call
    const params = new URLSearchParams({
      symbol: binanceSymbol,
      interval: '1d',
      startTime: String(start),
      endTime: String(end),
      limit: String(Math.min(days, 1000)),
    });

    const res = await this.fetch(`${this.baseUrl}/v3/klines?${params}`);
    if (!res.ok) {
      throw new Error(`Binance klines error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return data.map(k => ({
      symbol,
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  async fetchMultipleSymbols(symbols, options = {}) {
    const results = {};
    for (const symbol of symbols) {
      results[symbol] = await this.fetchDailyCandles(symbol, options);
    }
    return results;
  }
}
