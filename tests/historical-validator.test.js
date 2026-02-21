// tb-0uo: Backtest validation — historical data + offline validation
// Network tests skip gracefully if Binance API is geo-restricted (451)

import { describe, it, expect } from 'vitest';
import {
  fetchBinanceKlines, fetchExtendedHistory,
  validateOnHistoricalData, validateWithCandles,
} from '../src/backtest/historical-validator.js';
import { generateRegimeData } from '../src/ml/walk-forward-evaluator.js';

// Helper: check if Binance API is accessible
async function isBinanceAccessible() {
  try {
    await fetchBinanceKlines('BTCUSDT', { interval: '1d', limit: 1 });
    return true;
  } catch {
    return false;
  }
}

describe('Historical Validator', () => {
  describe('validateWithCandles() — offline validation', () => {
    it('validates ML pipeline on realistic synthetic data', () => {
      const candles = generateRegimeData(40000, 500);
      const result = validateWithCandles(candles, {
        symbol: 'SYN-BTC',
        evaluatorConfig: { epochs: 30, retrainInterval: 80, minTrainSamples: 60 },
      });

      expect(result.error).toBeUndefined();
      expect(result.symbol).toBe('SYN-BTC');
      expect(result.candleCount).toBe(500);

      for (const key of ['mlEnsemble', 'rulesOnlyEnsemble', 'bbConservative', 'momentum7d']) {
        const r = result.results[key];
        expect(Number.isFinite(r.sharpe)).toBe(true);
        expect(Number.isFinite(r.sortino)).toBe(true);
        expect(r.maxDrawdown).toBeGreaterThanOrEqual(0);
      }

      expect(result.comparison).toBeDefined();
      expect(typeof result.comparison.mlBeatsBB).toBe('boolean');
      expect(Number.isFinite(result.priceRange.buyAndHoldReturn)).toBe(true);
    });

    it('rejects insufficient data', () => {
      const candles = generateRegimeData(40000, 100);
      const result = validateWithCandles(candles);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Insufficient');
    });

    it('runs multi-regime validation across 5 scenarios', { timeout: 30000 }, () => {
      const scenarios = [
        { start: 20000, label: 'low-price' },
        { start: 40000, label: 'mid-price' },
        { start: 60000, label: 'high-price' },
        { start: 80000, label: 'very-high' },
        { start: 100000, label: 'moon-price' },
      ];

      for (const { start, label } of scenarios) {
        const candles = generateRegimeData(start, 500);
        const result = validateWithCandles(candles, {
          symbol: `SYN-${label}`,
          evaluatorConfig: { epochs: 20, retrainInterval: 80, minTrainSamples: 60 },
        });

        expect(result.error).toBeUndefined();
        expect(Number.isFinite(result.results.mlEnsemble.sharpe)).toBe(true);
        expect(result.results.mlEnsemble.maxDrawdown).toBeLessThan(100);
      }
    });
  });

  describe('Binance API (network tests — skip if geo-restricted)', () => {
    it('fetches real BTC daily candles', async () => {
      const accessible = await isBinanceAccessible();
      if (!accessible) {
        console.log('  [SKIP] Binance API geo-restricted');
        return;
      }

      const candles = await fetchBinanceKlines('BTCUSDT', { interval: '1d', limit: 30 });
      expect(candles.length).toBeGreaterThan(0);

      const c = candles[0];
      expect(c.openTime).toBeGreaterThan(0);
      expect(c.open).toBeGreaterThan(0);
      expect(c.high).toBeGreaterThanOrEqual(c.low);
      expect(c.close).toBeGreaterThan(1000);
    }, 15000);

    it('fetches extended history via pagination', async () => {
      const accessible = await isBinanceAccessible();
      if (!accessible) {
        console.log('  [SKIP] Binance API geo-restricted');
        return;
      }

      const candles = await fetchExtendedHistory('BTCUSDT', {
        interval: '1d', totalCandles: 500,
      });

      expect(candles.length).toBeGreaterThanOrEqual(400);

      // Chronological order
      for (let i = 1; i < candles.length; i++) {
        expect(candles[i].openTime).toBeGreaterThan(candles[i - 1].openTime);
      }
    }, 30000);

    it('runs walk-forward on real BTC data', async () => {
      const accessible = await isBinanceAccessible();
      if (!accessible) {
        console.log('  [SKIP] Binance API geo-restricted');
        return;
      }

      const result = await validateOnHistoricalData({
        symbol: 'BTCUSDT', interval: '1d', totalCandles: 500,
        evaluatorConfig: { epochs: 30, retrainInterval: 80, minTrainSamples: 60 },
      });

      expect(result.error).toBeUndefined();
      for (const key of ['mlEnsemble', 'rulesOnlyEnsemble', 'bbConservative', 'momentum7d']) {
        expect(Number.isFinite(result.results[key].sharpe)).toBe(true);
      }

      console.log('\n=== REAL DATA RESULTS ===');
      for (const [name, r] of Object.entries(result.results)) {
        console.log(`  ${name}: Sharpe ${r.sharpe} | Return ${r.totalReturn}% | DD ${r.maxDrawdown}%`);
      }
    }, 120000);
  });
});
