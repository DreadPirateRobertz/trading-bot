import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from '../src/config/index.js';
import { LiveTrader } from '../src/live/index.js';
import { createDashboard } from '../src/dashboard/index.js';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock WebSocket
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

// Mock Express
function createMockExpress() {
  const routes = {};
  const app = {
    use: () => {},
    get: (path, handler) => { routes[path] = handler; },
    listen: () => ({ close: () => {} }),
  };
  const fn = () => app;
  fn.json = () => () => {};
  return { fn, routes };
}

function mockRes() {
  const res = {
    _json: null, _headers: {}, _html: null,
    json(d) { res._json = d; return res; },
    setHeader(k, v) { res._headers[k] = v; return res; },
    send(d) { res._html = d; return res; },
  };
  return res;
}

describe('E2E Integration', () => {
  let tmpDir;
  let envFile;
  let trader;

  afterEach(() => {
    if (trader) trader.stop();
    try { unlinkSync(envFile); } catch { /* ignore */ }
  });

  it('full pipeline: config → live trader → WebSocket feed → signal → dashboard', async () => {
    // 1. Create config
    tmpDir = mkdtempSync(join(tmpdir(), 'tb-e2e-'));
    envFile = join(tmpDir, '.env');
    writeFileSync(envFile, [
      'TRADING_SYMBOLS=BTCUSDT,ETHUSDT',
      'INITIAL_BALANCE=50000',
      'DASHBOARD_PORT=0',
      'BOT_MODE=paper',
      'LOOKBACK_PERIOD=10',
    ].join('\n'));

    const config = loadConfig(envFile);
    expect(config.trading.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(config.trading.initialBalance).toBe(50000);

    // 2. Create LiveTrader with callbacks
    const signals = [];
    const trades = [];
    const statuses = [];

    trader = new LiveTrader({
      config,
      onSignal: (s) => signals.push(s),
      onTrade: (t) => trades.push(t),
      onStatus: (s) => statuses.push(s),
    });

    // 3. Start (no real WebSocket)
    await trader.start(null);
    expect(trader.running).toBe(true);
    expect(statuses.some(s => s.event === 'seeding')).toBe(true);
    expect(statuses.some(s => s.event === 'started')).toBe(true);

    // 4. Connect mock Binance WebSocket
    let wsInstance;
    trader.connectBinanceWS(function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    });

    // 5. Feed price data through WebSocket to trigger signals
    for (let i = 0; i < 20; i++) {
      const price = 50000 - i * 200; // Downtrend to trigger RSI oversold → BUY
      wsInstance.emit('message', JSON.stringify({
        e: 'kline', s: 'BTCUSDT',
        k: {
          o: String(price + 50), h: String(price + 100),
          l: String(price - 100), c: String(price),
          v: '15.0', T: Date.now() + i * 60000, x: true,
        },
      }));
    }

    // 6. Verify signals were generated
    expect(signals.length).toBeGreaterThan(0);
    const lastSignal = signals[signals.length - 1];
    expect(lastSignal.symbol).toBe('BTCUSDT');
    expect(lastSignal.signal).toBeDefined();
    expect(['BUY', 'SELL', 'HOLD']).toContain(lastSignal.signal.action);

    // 7. Check dashboard API returns correct data
    const { fn: expressFn, routes } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    dashboard.createApp(expressFn);

    // Status endpoint
    const statusRes = mockRes();
    routes['/api/status']({}, statusRes);
    expect(statusRes._json.running).toBe(true);
    expect(statusRes._json.recentSignals.length).toBeGreaterThan(0);
    expect(statusRes._json.connections).toBeGreaterThan(0);

    // Portfolio endpoint
    const portfolioRes = mockRes();
    routes['/api/portfolio']({}, portfolioRes);
    expect(portfolioRes._json.cash).toBeDefined();

    // Health endpoint
    const healthRes = mockRes();
    routes['/api/health']({}, healthRes);
    expect(healthRes._json.healthy).toBe(true);

    // HTML endpoint
    const htmlRes = mockRes();
    routes['/']({}, htmlRes);
    expect(htmlRes._html).toContain('Trading Bot Dashboard');

    // 8. Clean shutdown
    trader.stop();
    expect(trader.running).toBe(false);
    expect(wsInstance.closed).toBe(true);
  });

  it('multi-symbol pipeline with sentiment', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tb-e2e2-'));
    envFile = join(tmpDir, '.env');
    writeFileSync(envFile, 'TRADING_SYMBOLS=BTCUSDT\nINITIAL_BALANCE=100000\nBOT_MODE=paper\nLOOKBACK_PERIOD=10');

    const config = loadConfig(envFile);
    const signals = [];
    const trades = [];

    trader = new LiveTrader({
      config,
      onSignal: (s) => signals.push(s),
      onTrade: (t) => trades.push(t),
    });

    await trader.start(null);

    // Inject sentiment
    trader.realtimeTrader.updateSentiment('BTCUSDT', {
      classification: 'very_bullish',
      score: 5,
    });

    // Feed strong downtrend → should get BUY signal with bullish sentiment boost
    for (let i = 0; i < 20; i++) {
      const price = 60000 - i * 500;
      trader.realtimeTrader.feedPrice('BTCUSDT', {
        close: price, volume: 10000 + i * 500,
        high: price + 200, low: price - 200,
        open: price + 100, timestamp: Date.now() + i * 60000,
      });
    }

    // Should have signals
    expect(signals.length).toBeGreaterThan(0);

    // Check that sentiment was included
    const withSentiment = signals.find(s => s.sentiment !== null);
    expect(withSentiment).toBeDefined();
    expect(withSentiment.sentiment.classification).toBe('very_bullish');

    // Portfolio should still be trackable
    const status = trader.getFullStatus();
    expect(status.portfolio).toBeDefined();

    trader.stop();
  });

  it('handles WebSocket errors gracefully in full pipeline', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tb-e2e3-'));
    envFile = join(tmpDir, '.env');
    writeFileSync(envFile, 'TRADING_SYMBOLS=BTCUSDT\nBOT_MODE=paper');

    const config = loadConfig(envFile);
    trader = new LiveTrader({ config });

    await trader.start(null);

    let wsInstance;
    trader.connectBinanceWS(function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    });

    // Send malformed data
    wsInstance.emit('message', 'garbage');
    wsInstance.emit('message', '{"e":"unknown"}');

    // Should log errors but not crash
    expect(trader.errorLog.length).toBe(1); // Only garbage triggers parse error
    expect(trader.running).toBe(true);

    // Feed valid data after errors - system should still work
    for (let i = 0; i < 15; i++) {
      wsInstance.emit('message', JSON.stringify({
        e: 'kline', s: 'BTCUSDT',
        k: { o: '50000', h: '50100', l: '49900', c: String(50000 + i * 10), v: '5', T: Date.now() + i * 60000, x: true },
      }));
    }

    const buffer = trader.realtimeTrader.priceBuffers.get('BTCUSDT');
    expect(buffer.closes.length).toBe(15);

    trader.stop();
  });
});
