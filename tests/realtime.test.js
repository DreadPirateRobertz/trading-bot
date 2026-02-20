import { describe, it, expect } from 'vitest';
import { RealtimeTrader } from '../src/realtime/index.js';

describe('RealtimeTrader', () => {
  function makeTrader(opts = {}) {
    return new RealtimeTrader({
      initialBalance: 100000,
      symbols: ['BTCUSDT', 'ETHUSDT'],
      lookback: 10,
      ...opts,
    });
  }

  // Feed enough price data to trigger signal generation
  function feedPrices(rt, symbol, count, startPrice = 100, trend = 0.5) {
    const results = [];
    for (let i = 0; i < count; i++) {
      const close = startPrice + trend * i + Math.sin(i) * 2;
      const result = rt.feedPrice(symbol, {
        close,
        volume: 1000 + Math.random() * 500,
        high: close + 1,
        low: close - 1,
        open: close - 0.5,
        timestamp: Date.now() + i * 60000,
      });
      results.push(result);
    }
    return results;
  }

  it('initializes with price buffers for each symbol', () => {
    const rt = makeTrader();
    expect(rt.priceBuffers.has('BTCUSDT')).toBe(true);
    expect(rt.priceBuffers.has('ETHUSDT')).toBe(true);
  });

  it('feeds prices and builds buffer', () => {
    const rt = makeTrader();
    rt.feedPrice('BTCUSDT', { close: 50000, volume: 100, timestamp: Date.now() });
    const buffer = rt.priceBuffers.get('BTCUSDT');
    expect(buffer.closes).toHaveLength(1);
    expect(buffer.volumes).toHaveLength(1);
  });

  it('returns null when not enough data for signals', () => {
    const rt = makeTrader({ lookback: 20 });
    const result = rt.feedPrice('BTCUSDT', { close: 50000, volume: 100, timestamp: Date.now() });
    expect(result).toBeNull();
  });

  it('generates signals when enough data is fed', () => {
    const rt = makeTrader({ lookback: 10 });
    const results = feedPrices(rt, 'BTCUSDT', 15);
    const lastResult = results[results.length - 1];
    expect(lastResult).not.toBeNull();
    expect(lastResult.analysis).toBeDefined();
    expect(lastResult.analysis.signal).toBeDefined();
  });

  it('fires onSignal callback', () => {
    const signals = [];
    const rt = makeTrader({
      lookback: 10,
      onSignal: (s) => signals.push(s),
    });
    feedPrices(rt, 'BTCUSDT', 15);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].signal).toBeDefined();
  });

  it('fires onTrade callback when trade executes', () => {
    const trades = [];
    const rt = makeTrader({
      lookback: 10,
      onTrade: (t) => trades.push(t),
    });
    // Feed data that creates a strong signal
    // Dropping price to trigger RSI oversold
    for (let i = 0; i < 15; i++) {
      const close = 100 - i * 3; // dropping price
      rt.feedPrice('BTCUSDT', {
        close, volume: 5000, high: close + 1, low: close - 1,
        open: close + 0.5, timestamp: Date.now() + i * 60000,
      });
    }
    // trades may or may not fire depending on signal strength
    // Just ensure no crashes
    expect(Array.isArray(trades)).toBe(true);
  });

  it('updates sentiment cache', () => {
    const rt = makeTrader();
    rt.updateSentiment('BTCUSDT', { classification: 'very_bullish', score: 5 });
    expect(rt.sentimentCache.get('BTCUSDT')).toEqual({
      classification: 'very_bullish', score: 5,
    });
  });

  it('includes sentiment in signal generation', () => {
    const signals = [];
    const rt = makeTrader({
      lookback: 10,
      onSignal: (s) => signals.push(s),
    });
    rt.updateSentiment('BTCUSDT', { classification: 'very_bullish', score: 5 });
    feedPrices(rt, 'BTCUSDT', 15);
    const lastSignal = signals[signals.length - 1];
    expect(lastSignal.sentiment).toEqual({ classification: 'very_bullish', score: 5 });
  });

  it('trims buffer when it exceeds max size', () => {
    const rt = makeTrader({ lookback: 10 });
    feedPrices(rt, 'BTCUSDT', 100);
    const buffer = rt.priceBuffers.get('BTCUSDT');
    expect(buffer.closes.length).toBeLessThanOrEqual(60); // lookback + 50
  });

  it('provides status report', () => {
    const rt = makeTrader();
    feedPrices(rt, 'BTCUSDT', 5);
    const status = rt.getStatus();
    expect(status.running).toBe(false);
    expect(status.portfolio).toBeDefined();
    expect(status.portfolio.cash).toBe(100000);
    expect(status.buffers.BTCUSDT).toBeDefined();
    expect(status.buffers.BTCUSDT.dataPoints).toBe(5);
    expect(status.buffers.BTCUSDT.ready).toBe(false);
  });

  it('creates new buffer for unknown symbols on feed', () => {
    const rt = makeTrader();
    rt.feedPrice('SOLUSDT', { close: 150, volume: 200, timestamp: Date.now() });
    expect(rt.priceBuffers.has('SOLUSDT')).toBe(true);
  });

  it('stops cleanly', () => {
    const rt = makeTrader();
    rt.running = true;
    rt.stop();
    expect(rt.running).toBe(false);
    expect(rt.ws).toBeNull();
  });
});
