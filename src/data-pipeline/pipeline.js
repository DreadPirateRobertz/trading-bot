// OHLCV data pipeline orchestrator
// Idempotent: re-runs fetch only missing data, recomputes features

import { CandleStore } from './storage.js';
import { HistoricalFetcher } from './fetcher.js';
import { computeAllFeatures } from './features.js';

const DEFAULT_SYMBOLS = ['BTC/USD', 'ETH/USD'];
const DEFAULT_DAYS = 365;

export class DataPipeline {
  constructor({ dbPath = ':memory:', fetchFn, symbols = DEFAULT_SYMBOLS, days = DEFAULT_DAYS } = {}) {
    this.store = new CandleStore(dbPath);
    this.fetcher = new HistoricalFetcher({ fetchFn });
    this.symbols = symbols;
    this.days = days;
  }

  async run({ sentimentScores = {} } = {}) {
    const report = { fetched: {}, computed: {}, errors: [] };

    for (const symbol of this.symbols) {
      try {
        // Step 1: Fetch candles (idempotent — upsert handles duplicates)
        const candles = await this.fetcher.fetchDailyCandles(symbol, { days: this.days });
        this.store.insertCandles(candles);
        report.fetched[symbol] = candles.length;

        // Step 2: Load all candles for feature computation (need full history for rolling calcs)
        const allCandles = this.store.getCandles(symbol);

        // Step 3: Compute features
        const features = computeAllFeatures(allCandles, {
          sentimentScores: sentimentScores[symbol] || [],
        });
        this.store.updateFeatures(features);
        report.computed[symbol] = features.length;
      } catch (err) {
        report.errors.push({ symbol, error: err.message });
      }
    }

    return report;
  }

  getCandles(symbol, options) {
    return this.store.getCandles(symbol, options);
  }

  getSymbols() {
    return this.store.getSymbols();
  }

  getRowCount(symbol) {
    return this.store.getRowCount(symbol);
  }

  close() {
    this.store.close();
  }
}
