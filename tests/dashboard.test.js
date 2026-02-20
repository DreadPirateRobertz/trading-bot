import { describe, it, expect, beforeEach } from 'vitest';
import { createDashboard } from '../src/dashboard/index.js';
import { LiveTrader } from '../src/live/index.js';

function makeConfig() {
  return {
    alpaca: { keyId: '', secretKey: '', paper: true },
    binance: { apiKey: '', secretKey: '', testnet: true },
    reddit: { clientId: '', clientSecret: '', userAgent: 'test' },
    trading: {
      symbols: ['BTCUSDT'],
      initialBalance: 100000,
      maxPositionPct: 0.10,
      yoloThreshold: 0.85,
      lookback: 10,
    },
    dashboard: { port: 0, host: '127.0.0.1' },
    logLevel: 'info',
    mode: 'paper',
  };
}

// Minimal Express mock
function createMockExpress() {
  const routes = {};
  const app = {
    use: () => {},
    get: (path, handler) => { routes[path] = handler; },
    listen: (port, host) => {
      return { close: () => {}, address: () => ({ port: 0 }) };
    },
  };
  const expressFn = () => app;
  expressFn.json = () => (_req, _res, next) => next && next();
  return { expressFn, routes, app };
}

function mockRes() {
  const res = {
    _json: null,
    _headers: {},
    _html: null,
    json(data) { res._json = data; return res; },
    setHeader(k, v) { res._headers[k] = v; return res; },
    send(data) { res._html = data; return res; },
  };
  return res;
}

describe('Dashboard', () => {
  let trader;
  let config;

  beforeEach(() => {
    config = makeConfig();
    trader = new LiveTrader({ config });
  });

  it('creates dashboard with REST endpoints', () => {
    const { expressFn, routes } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    dashboard.createApp(expressFn);

    expect(routes['/api/status']).toBeDefined();
    expect(routes['/api/portfolio']).toBeDefined();
    expect(routes['/api/positions']).toBeDefined();
    expect(routes['/api/trades']).toBeDefined();
    expect(routes['/api/signals']).toBeDefined();
    expect(routes['/api/errors']).toBeDefined();
    expect(routes['/api/health']).toBeDefined();
    expect(routes['/']).toBeDefined();
  });

  it('GET /api/status returns full status', () => {
    const { expressFn, routes } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    dashboard.createApp(expressFn);

    const res = mockRes();
    routes['/api/status']({}, res);
    expect(res._json).toBeDefined();
    expect(res._json.running).toBe(false);
    expect(res._json.recentSignals).toEqual([]);
  });

  it('GET /api/portfolio returns portfolio info', () => {
    const { expressFn, routes } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    dashboard.createApp(expressFn);

    const res = mockRes();
    routes['/api/portfolio']({}, res);
    expect(res._json).toBeDefined();
    expect(res._json.cash).toBe(100000);
  });

  it('GET /api/positions returns empty positions', () => {
    const { expressFn, routes } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    dashboard.createApp(expressFn);

    const res = mockRes();
    routes['/api/positions']({}, res);
    expect(res._json).toBeDefined();
  });

  it('GET /api/trades returns trade log with limit', () => {
    const { expressFn, routes } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    dashboard.createApp(expressFn);

    // Add some fake trades
    trader.tradeLog = [
      { action: 'BUY', symbol: 'BTC', qty: 1, price: 50000 },
      { action: 'SELL', symbol: 'BTC', qty: 1, price: 51000 },
    ];

    const res = mockRes();
    routes['/api/trades']({ query: { limit: '1' } }, res);
    expect(res._json).toHaveLength(1);
  });

  it('GET /api/signals returns signal log', () => {
    const { expressFn, routes } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    dashboard.createApp(expressFn);

    trader.signalLog = [{ symbol: 'BTC', signal: { action: 'BUY' } }];

    const res = mockRes();
    routes['/api/signals']({ query: {} }, res);
    expect(res._json).toHaveLength(1);
  });

  it('GET /api/errors returns error log', () => {
    const { expressFn, routes } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    dashboard.createApp(expressFn);

    trader.errorLog = [{ source: 'test', error: 'boom' }];

    const res = mockRes();
    routes['/api/errors']({}, res);
    expect(res._json).toHaveLength(1);
  });

  it('GET /api/health returns health check', () => {
    const { expressFn, routes } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    dashboard.createApp(expressFn);

    const res = mockRes();
    routes['/api/health']({}, res);
    expect(res._json.healthy).toBe(false);
    expect(res._json.errorCount).toBe(0);
  });

  it('GET / returns HTML dashboard', () => {
    const { expressFn, routes } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    dashboard.createApp(expressFn);

    const res = mockRes();
    routes['/']({}, res);
    expect(res._headers['Content-Type']).toBe('text/html');
    expect(res._html).toContain('Trading Bot Dashboard');
    expect(res._html).toContain('/api/status');
  });

  it('starts and stops server', () => {
    const { expressFn } = createMockExpress();
    const dashboard = createDashboard(trader, config);
    const server = dashboard.startServer(expressFn);
    expect(server).toBeDefined();
    // Should not throw
    dashboard.stopServer();
  });
});
