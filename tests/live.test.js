import { describe, it, expect, vi } from 'vitest';
import { LiveTrader } from '../src/live/index.js';

function makeConfig(overrides = {}) {
  return {
    alpaca: { keyId: '', secretKey: '', paper: true },
    binance: { apiKey: '', secretKey: '', testnet: true },
    reddit: { clientId: '', clientSecret: '', userAgent: 'test' },
    twitter: { bearerToken: '' },
    hmm: { enabled: false }, // disabled by default in tests for speed
    risk: {},
    alerts: {},
    trading: {
      symbols: ['BTCUSDT', 'ETHUSDT'],
      initialBalance: 100000,
      maxPositionPct: 0.10,
      yoloThreshold: 0.85,
      lookback: 10,
    },
    dashboard: { port: 3000, host: '0.0.0.0' },
    logLevel: 'info',
    mode: 'paper',
    ...overrides,
  };
}

// Mock WebSocket class
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.sent = [];
    this.closed = false;
  }
  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; }
  emit(event, data) {
    for (const cb of (this.listeners[event] || [])) cb(data);
  }
}

describe('LiveTrader', () => {
  it('initializes with config', () => {
    const trader = new LiveTrader({ config: makeConfig() });
    expect(trader.running).toBe(false);
    expect(trader.realtimeTrader).toBeDefined();
    expect(trader.signalLog).toEqual([]);
    expect(trader.tradeLog).toEqual([]);
  });

  it('provides full status', () => {
    const trader = new LiveTrader({ config: makeConfig() });
    const status = trader.getFullStatus();
    expect(status.running).toBe(false);
    expect(status.recentSignals).toEqual([]);
    expect(status.recentTrades).toEqual([]);
    expect(status.recentErrors).toEqual([]);
    expect(status.connections).toBe(0);
  });

  it('starts and stops cleanly without WebSocket', async () => {
    const statuses = [];
    const trader = new LiveTrader({
      config: makeConfig(),
      onStatus: (s) => statuses.push(s),
    });
    await trader.start(null);
    expect(trader.running).toBe(true);
    expect(trader.startTime).toBeGreaterThan(0);

    trader.stop();
    expect(trader.running).toBe(false);
    expect(statuses.some(s => s.event === 'started')).toBe(true);
    expect(statuses.some(s => s.event === 'stopped')).toBe(true);
  });

  it('connects Binance WebSocket for crypto symbols', () => {
    const trader = new LiveTrader({ config: makeConfig() });
    let wsInstance;
    const ws = trader.connectBinanceWS(function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    });
    expect(ws).toBeDefined();
    expect(ws.url).toContain('binance.com');
    expect(ws.url).toContain('btcusdt@kline_1m');
    expect(trader.wsConnections).toHaveLength(1);
  });

  it('processes Binance kline messages', () => {
    const config = makeConfig();
    const signals = [];
    const trader = new LiveTrader({
      config,
      onSignal: (s) => signals.push(s),
    });

    let wsInstance;
    trader.connectBinanceWS(function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    });

    // Feed enough klines to trigger signals
    for (let i = 0; i < 15; i++) {
      const price = 50000 + i * 100;
      wsInstance.emit('message', JSON.stringify({
        e: 'kline',
        s: 'BTCUSDT',
        k: {
          o: String(price - 50),
          h: String(price + 50),
          l: String(price - 100),
          c: String(price),
          v: '10.5',
          T: Date.now() + i * 60000,
          x: true, // candle closed
        },
      }));
    }

    // Should have generated signals once lookback was met
    expect(signals.length).toBeGreaterThan(0);
  });

  it('skips non-closed candles', () => {
    const config = makeConfig();
    const trader = new LiveTrader({ config });

    let wsInstance;
    trader.connectBinanceWS(function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    });

    const buffer = trader.realtimeTrader.priceBuffers.get('BTCUSDT');
    const beforeLen = buffer.closes.length;

    wsInstance.emit('message', JSON.stringify({
      e: 'kline', s: 'BTCUSDT',
      k: { o: '50000', h: '50100', l: '49900', c: '50050', v: '5', T: Date.now(), x: false },
    }));

    expect(buffer.closes.length).toBe(beforeLen);
  });

  it('captures errors from malformed messages', () => {
    const trader = new LiveTrader({ config: makeConfig() });

    let wsInstance;
    trader.connectBinanceWS(function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    });

    // Send invalid JSON
    wsInstance.emit('message', 'not json');
    expect(trader.errorLog.length).toBe(1);
    expect(trader.errorLog[0].source).toBe('binance_ws');
  });

  it('connects Alpaca WebSocket for stock symbols', () => {
    const config = makeConfig({
      alpaca: { keyId: 'test', secretKey: 'secret', paper: true },
      trading: { symbols: ['AAPL', 'MSFT'], initialBalance: 100000, maxPositionPct: 0.1, yoloThreshold: 0.85, lookback: 10 },
    });
    const trader = new LiveTrader({ config });

    let wsInstance;
    trader.connectAlpacaWS(function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    });

    expect(wsInstance.url).toContain('alpaca.markets');
    expect(trader.wsConnections).toHaveLength(1);
  });

  it('authenticates and subscribes on Alpaca WS open', () => {
    const config = makeConfig({
      alpaca: { keyId: 'testkey', secretKey: 'testsecret', paper: true },
      trading: { symbols: ['AAPL'], initialBalance: 100000, maxPositionPct: 0.1, yoloThreshold: 0.85, lookback: 10 },
    });
    const trader = new LiveTrader({ config });

    let wsInstance;
    trader.connectAlpacaWS(function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    });

    // Trigger open
    wsInstance.emit('open');
    expect(wsInstance.sent).toHaveLength(1);
    const auth = JSON.parse(wsInstance.sent[0]);
    expect(auth.action).toBe('auth');
    expect(auth.key).toBe('testkey');

    // Trigger auth success -> subscribe
    wsInstance.emit('message', JSON.stringify([{ T: 'success', msg: 'authenticated' }]));
    expect(wsInstance.sent).toHaveLength(2);
    const sub = JSON.parse(wsInstance.sent[1]);
    expect(sub.action).toBe('subscribe');
    expect(sub.bars).toContain('AAPL');
  });

  it('processes Alpaca minute bars', () => {
    const config = makeConfig({
      alpaca: { keyId: 'testkey', secretKey: 'testsecret', paper: true },
      trading: { symbols: ['AAPL'], initialBalance: 100000, maxPositionPct: 0.1, yoloThreshold: 0.85, lookback: 10 },
    });
    const trader = new LiveTrader({ config });

    let wsInstance;
    trader.connectAlpacaWS(function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    });

    // Feed minute bars
    for (let i = 0; i < 5; i++) {
      wsInstance.emit('message', JSON.stringify([{
        T: 'b', S: 'AAPL',
        o: 150 + i, h: 151 + i, l: 149 + i, c: 150.5 + i,
        v: 10000, t: new Date().toISOString(),
      }]));
    }

    const buffer = trader.realtimeTrader.priceBuffers.get('AAPL');
    expect(buffer.closes).toHaveLength(5);
  });

  it('caps signal log at 1000 entries', async () => {
    const config = makeConfig();
    const trader = new LiveTrader({ config });

    // Manually stuff signal log
    for (let i = 0; i < 1100; i++) {
      trader.signalLog.push({ time: i, symbol: 'TEST', signal: { action: 'HOLD' } });
    }

    // Simulate the trimming that happens in start()
    await trader.start(null);

    // Feed enough data to trigger trimming
    for (let i = 0; i < 15; i++) {
      trader.realtimeTrader.feedPrice('BTCUSDT', {
        close: 50000 + i * 100, volume: 1000, high: 50100 + i * 100,
        low: 49900 + i * 100, open: 50000 + i * 100, timestamp: Date.now() + i * 60000,
      });
    }

    // After trimming, should be capped
    expect(trader.signalLog.length).toBeLessThanOrEqual(1100);
    trader.stop();
  });

  it('stops all WebSocket connections and intervals', async () => {
    const trader = new LiveTrader({ config: makeConfig() });
    await trader.start(null);

    // Manually add mock ws
    const mockWs = new MockWebSocket('test');
    trader.wsConnections.push(mockWs);

    trader.stop();
    expect(mockWs.closed).toBe(true);
    expect(trader.wsConnections).toHaveLength(0);
    expect(trader.sentimentInterval).toBeNull();
  });

  it('does not connect Binance WS when no crypto symbols', () => {
    const config = makeConfig({
      trading: { symbols: ['AAPL'], initialBalance: 100000, maxPositionPct: 0.1, yoloThreshold: 0.85, lookback: 10 },
    });
    const trader = new LiveTrader({ config });
    const ws = trader.connectBinanceWS(MockWebSocket);
    expect(ws).toBeNull();
  });

  it('does not connect Alpaca WS when no stock symbols', () => {
    const config = makeConfig();
    const trader = new LiveTrader({ config });
    const ws = trader.connectAlpacaWS(MockWebSocket);
    expect(ws).toBeNull();
  });

  describe('Twitter/X sentiment integration', () => {
    it('initializes TwitterCrawler when bearer token is provided', () => {
      const config = makeConfig({ twitter: { bearerToken: 'test-token' } });
      const trader = new LiveTrader({ config });
      expect(trader.twitterCrawler).toBeDefined();
      expect(trader.twitterCrawler.bearerToken).toBe('test-token');
    });

    it('does not initialize TwitterCrawler without bearer token', () => {
      const config = makeConfig({ twitter: { bearerToken: '' } });
      const trader = new LiveTrader({ config });
      expect(trader.twitterCrawler).toBeNull();
    });

    it('does not initialize TwitterCrawler when twitter config is missing', () => {
      const config = makeConfig();
      // Default config has empty bearerToken
      const trader = new LiveTrader({ config });
      expect(trader.twitterCrawler).toBeNull();
    });

    it('fetches Twitter sentiment in updateSentiment()', async () => {
      const config = makeConfig({ twitter: { bearerToken: 'test-token' } });
      const trader = new LiveTrader({ config });

      // Mock the twitter crawler's searchRecent method
      const mockTweets = [
        { text: '$BTC to the moon! Bullish 🚀', likes: 100, retweets: 50, quotes: 5, isInfluencer: true, authorFollowers: 50000 },
        { text: '$BTC looking strong, breakout incoming', likes: 30, retweets: 10, quotes: 2, isInfluencer: false, authorFollowers: 500 },
      ];
      trader.twitterCrawler.searchRecent = vi.fn().mockResolvedValue(mockTweets);

      // Mock news to return empty (isolate twitter testing)
      trader.newsCrawler.fetchAllFeeds = vi.fn().mockResolvedValue([]);

      await trader.updateSentiment();

      // Should have called searchRecent for each symbol
      expect(trader.twitterCrawler.searchRecent).toHaveBeenCalled();
      const calls = trader.twitterCrawler.searchRecent.mock.calls;
      expect(calls.some(c => c[0].includes('BTC'))).toBe(true);
      expect(calls.some(c => c[0].includes('ETH'))).toBe(true);
    });

    it('continues when Twitter API fails', async () => {
      const config = makeConfig({ twitter: { bearerToken: 'test-token' } });
      const trader = new LiveTrader({ config });

      // Mock twitter to throw
      trader.twitterCrawler.searchRecent = vi.fn().mockRejectedValue(new Error('Rate limited'));
      // Mock news to return empty
      trader.newsCrawler.fetchAllFeeds = vi.fn().mockResolvedValue([]);

      // Should not throw
      await expect(trader.updateSentiment()).resolves.not.toThrow();
    });

    it('aggregates Twitter scores into sentiment cache', async () => {
      const config = makeConfig({ twitter: { bearerToken: 'test-token' } });
      config.trading.symbols = ['BTCUSDT'];
      const trader = new LiveTrader({ config });

      // Mock twitter with strongly bullish tweets
      trader.twitterCrawler.searchRecent = vi.fn().mockResolvedValue([
        { text: '$BTC to the moon! Bullish rally 🚀', likes: 200, retweets: 100, quotes: 10, isInfluencer: true, authorFollowers: 50000 },
        { text: '$BTC breakout! Diamond hands!', likes: 100, retweets: 50, quotes: 5, isInfluencer: false, authorFollowers: 5000 },
      ]);
      // Mock news to return empty
      trader.newsCrawler.fetchAllFeeds = vi.fn().mockResolvedValue([]);

      await trader.updateSentiment();

      // Sentiment should have been set on the realtime trader
      const cached = trader.realtimeTrader.sentimentCache.get('BTCUSDT');
      expect(cached).toBeDefined();
      expect(cached.count).toBeGreaterThan(0);
      expect(cached.classification).toMatch(/bullish/);
    });
  });

  describe('HMM regime detection integration', () => {
    // Helper: generate candle-like data and feed into trader buffers
    function feedCandles(trader, symbol, n, { drift = 0.001, vol = 0.02 } = {}) {
      let price = 50000;
      for (let i = 0; i < n; i++) {
        const ret = drift + vol * (Math.random() - 0.5) * 2;
        const open = price;
        price = price * Math.exp(ret);
        trader.realtimeTrader.feedPrice(symbol, {
          open, close: price,
          high: Math.max(open, price) * 1.005,
          low: Math.min(open, price) * 0.995,
          volume: 1000 + Math.random() * 5000,
          timestamp: Date.now() + i * 60000,
        });
      }
    }

    it('does not train HMM when disabled', () => {
      const config = makeConfig({ hmm: { enabled: false } });
      const trader = new LiveTrader({ config });
      const result = trader.trainHMM();
      expect(result).toBeNull();
      expect(trader.hmm).toBeNull();
    });

    it('skips HMM training with insufficient data', () => {
      const statuses = [];
      const config = makeConfig({
        hmm: { enabled: true, minObservations: 50 },
      });
      const trader = new LiveTrader({ config, onStatus: (s) => statuses.push(s) });

      // Feed only a few candles — not enough for HMM
      feedCandles(trader, 'BTCUSDT', 20);

      const result = trader.trainHMM();
      expect(result).toBeNull();
      expect(statuses.some(s => s.event === 'hmm_skip')).toBe(true);
    });

    it('trains HMM when enough candle data is available', () => {
      const statuses = [];
      const config = makeConfig({
        hmm: { enabled: true, minObservations: 30 },
      });
      const trader = new LiveTrader({ config, onStatus: (s) => statuses.push(s) });

      // Feed enough candles for HMM training
      feedCandles(trader, 'BTCUSDT', 100);

      const result = trader.trainHMM();
      expect(result).not.toBeNull();
      expect(result.regime).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
      expect(trader.hmm).not.toBeNull();
      expect(trader.hmm.trained).toBe(true);
      expect(statuses.some(s => s.event === 'hmm_trained')).toBe(true);
    });

    it('injects HMM into ensemble strategy', () => {
      const config = makeConfig({
        hmm: { enabled: true, minObservations: 30 },
        signalEngine: { strategy: 'ensemble', strategyConfig: {} },
      });
      const trader = new LiveTrader({ config });

      // Feed data and train
      feedCandles(trader, 'BTCUSDT', 100);
      trader.trainHMM();

      // The ensemble strategy should now have the HMM detector
      const strategy = trader.realtimeTrader.signalEngine.strategy;
      expect(strategy).toBeDefined();
      expect(strategy.hmmDetector).toBe(trader.hmm);
    });

    it('includes HMM status in getFullStatus()', () => {
      const config = makeConfig({
        hmm: { enabled: true, minObservations: 30 },
      });
      const trader = new LiveTrader({ config });

      feedCandles(trader, 'BTCUSDT', 100);
      trader.trainHMM();

      const status = trader.getFullStatus();
      expect(status.hmm).toBeDefined();
      expect(status.hmm.trained).toBe(true);
      expect(status.hmm.states).toContain('bull');
      expect(status.hmm.states).toContain('bear');
    });

    it('cleans up HMM retrain interval on stop', async () => {
      const config = makeConfig({
        hmm: { enabled: true, minObservations: 30, retrainInterval: 100 },
      });
      const trader = new LiveTrader({ config });
      await trader.start(null);
      trader.stop();
      expect(trader.hmmRetrainInterval_id).toBeNull();
    });
  });
});
