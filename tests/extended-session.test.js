import { describe, it, expect } from 'vitest';
import { RealtimeTrader } from '../src/realtime/index.js';
import { LiveTrader } from '../src/live/index.js';

function makeConfig(overrides = {}) {
  return {
    alpaca: { keyId: '', secretKey: '', paper: true },
    binance: { apiKey: '', secretKey: '', testnet: true },
    reddit: { clientId: '', clientSecret: '', userAgent: 'test' },
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

// Simulate realistic price movement with trends and mean reversion
function generateRealisticPrices(count, startPrice, volatility = 0.02) {
  const prices = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const drift = (Math.random() - 0.5) * 2 * volatility * price;
    const meanReversion = (startPrice - price) * 0.01;
    price = Math.max(price + drift + meanReversion, 1);
    prices.push({
      close: price,
      open: price + (Math.random() - 0.5) * volatility * price,
      high: price * (1 + Math.random() * volatility),
      low: price * (1 - Math.random() * volatility),
      volume: 1000 + Math.random() * 5000,
    });
  }
  return prices;
}

describe('Extended paper trading sessions', () => {
  describe('long-running RealtimeTrader stability', () => {
    it('processes 10,000 ticks without crash or data loss', () => {
      const signals = [];
      const trades = [];
      const errors = [];
      const rt = new RealtimeTrader({
        initialBalance: 100000,
        symbols: ['BTCUSDT'],
        lookback: 10,
        onSignal: (s) => signals.push(s),
        onTrade: (t) => trades.push(t),
        onError: (e) => errors.push(e),
      });

      const prices = generateRealisticPrices(10000, 50000, 0.01);
      for (let i = 0; i < prices.length; i++) {
        rt.feedPrice('BTCUSDT', {
          ...prices[i],
          timestamp: Date.now() + i * 60000,
        });
      }

      expect(errors).toHaveLength(0);
      // Signal generated when buffer.length >= lookback, so from tick #lookback onward
      expect(signals.length).toBe(10000 - 10 + 1);
      // Portfolio should be self-consistent
      const status = rt.getStatus();
      expect(status.portfolio.cash).toBeGreaterThanOrEqual(0);
      expect(status.portfolio.portfolioValue).toBeGreaterThan(0);
    });

    it('buffer trimming prevents unbounded memory growth', () => {
      const rt = new RealtimeTrader({
        initialBalance: 100000,
        symbols: ['BTCUSDT'],
        lookback: 30,
      });

      // Feed 5000 ticks
      for (let i = 0; i < 5000; i++) {
        rt.feedPrice('BTCUSDT', {
          close: 50000 + Math.sin(i / 10) * 1000,
          volume: 1000,
          timestamp: Date.now() + i * 60000,
        });
      }

      const buffer = rt.priceBuffers.get('BTCUSDT');
      const maxBuffer = 30 + 50; // lookback + 50
      expect(buffer.closes.length).toBeLessThanOrEqual(maxBuffer);
      expect(buffer.volumes.length).toBeLessThanOrEqual(maxBuffer);
      expect(buffer.candles.length).toBeLessThanOrEqual(maxBuffer);
    });

    it('multi-symbol trading maintains independent buffers', () => {
      const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOTUSDT'];
      const rt = new RealtimeTrader({
        initialBalance: 500000,
        symbols,
        lookback: 10,
      });

      // Feed different price patterns to each symbol
      for (let tick = 0; tick < 1000; tick++) {
        for (let s = 0; s < symbols.length; s++) {
          const basePrice = (s + 1) * 10000;
          rt.feedPrice(symbols[s], {
            close: basePrice + Math.sin(tick / (10 + s)) * 500,
            volume: 1000 + Math.random() * 2000,
            timestamp: Date.now() + tick * 60000,
          });
        }
      }

      // Each symbol should have its own trimmed buffer
      for (const sym of symbols) {
        const buffer = rt.priceBuffers.get(sym);
        expect(buffer.closes.length).toBeLessThanOrEqual(60);
        expect(buffer.closes.length).toBeGreaterThan(0);
      }

      // Portfolio should reflect positions correctly
      const status = rt.getStatus();
      expect(status.portfolio.cash).toBeGreaterThanOrEqual(0);
    });
  });

  describe('portfolio accounting consistency', () => {
    it('cash + position value = portfolioValue after many trades', () => {
      const rt = new RealtimeTrader({
        initialBalance: 100000,
        symbols: ['BTCUSDT'],
        lookback: 10,
      });

      // Feed oscillating prices to force BUY/SELL cycles
      for (let cycle = 0; cycle < 50; cycle++) {
        // Downtrend: should trigger BUY
        for (let i = 0; i < 15; i++) {
          rt.feedPrice('BTCUSDT', {
            close: 50000 - i * 200 - cycle,
            volume: 5000,
            timestamp: Date.now() + (cycle * 30 + i) * 60000,
          });
        }
        // Uptrend: should trigger SELL
        for (let i = 0; i < 15; i++) {
          rt.feedPrice('BTCUSDT', {
            close: 47000 + i * 200 + cycle,
            volume: 5000,
            timestamp: Date.now() + (cycle * 30 + 15 + i) * 60000,
          });
        }
      }

      // Verify internal consistency
      const trader = rt.trader;
      let posValue = 0;
      for (const [, pos] of trader.positions) {
        posValue += pos.qty * pos.avgPrice;
      }
      expect(trader.cash + posValue).toBeCloseTo(trader.portfolioValue, 2);
      expect(trader.cash).toBeGreaterThanOrEqual(0);
    });

    it('trade history count matches actual trades executed', () => {
      const tradeCallbacks = [];
      const rt = new RealtimeTrader({
        initialBalance: 100000,
        symbols: ['BTCUSDT'],
        lookback: 10,
        onTrade: (t) => tradeCallbacks.push(t),
      });

      for (let i = 0; i < 500; i++) {
        rt.feedPrice('BTCUSDT', {
          close: 50000 + Math.sin(i / 5) * 3000,
          volume: 3000 + Math.random() * 2000,
          timestamp: Date.now() + i * 60000,
        });
      }

      // Every onTrade callback should match a trade in history
      expect(rt.trader.tradeHistory.length).toBe(tradeCallbacks.length);
    });

    it('no negative cash after extended session', () => {
      const rt = new RealtimeTrader({
        initialBalance: 50000,
        symbols: ['BTCUSDT', 'ETHUSDT'],
        lookback: 10,
      });

      const prices = generateRealisticPrices(2000, 50000, 0.03);
      const ethPrices = generateRealisticPrices(2000, 3000, 0.04);

      for (let i = 0; i < 2000; i++) {
        rt.feedPrice('BTCUSDT', {
          ...prices[i],
          timestamp: Date.now() + i * 60000,
        });
        rt.feedPrice('ETHUSDT', {
          ...ethPrices[i],
          timestamp: Date.now() + i * 60000,
        });
      }

      expect(rt.trader.cash).toBeGreaterThanOrEqual(0);
    });
  });

  describe('LiveTrader signal/trade log management', () => {
    it('signal log trims to 500 when exceeding 1000', async () => {
      const config = makeConfig();
      const trader = new LiveTrader({ config });
      await trader.start(null);

      // The start() wraps onSignal to auto-trim at 1000
      // Feed enough data to generate >1000 signals
      for (let i = 0; i < 1050; i++) {
        trader.realtimeTrader.feedPrice('BTCUSDT', {
          close: 50000 + Math.sin(i / 5) * 1000,
          volume: 1000,
          timestamp: Date.now() + i * 60000,
        });
      }

      // Signal log should have been trimmed
      expect(trader.signalLog.length).toBeLessThanOrEqual(1050);
      // After trimming triggers (at >1000), it slices to last 500
      // But more signals get added after the trim
      expect(trader.signalLog.length).toBeLessThanOrEqual(600);

      trader.stop();
    });

    it('trade log grows without bound tracking all trades', async () => {
      const config = makeConfig();
      const trader = new LiveTrader({ config });
      await trader.start(null);

      // Feed strong oscillations to maximize trades
      for (let cycle = 0; cycle < 100; cycle++) {
        for (let i = 0; i < 15; i++) {
          trader.realtimeTrader.feedPrice('BTCUSDT', {
            close: 50000 - i * 500,
            volume: 8000,
            timestamp: Date.now() + (cycle * 30 + i) * 60000,
          });
        }
        for (let i = 0; i < 15; i++) {
          trader.realtimeTrader.feedPrice('BTCUSDT', {
            close: 43000 + i * 500,
            volume: 8000,
            timestamp: Date.now() + (cycle * 30 + 15 + i) * 60000,
          });
        }
      }

      // All trades should be logged
      expect(trader.tradeLog.length).toBe(trader.realtimeTrader.trader.tradeHistory.length);

      trader.stop();
    });

    it('error log captures WebSocket errors without affecting trading', async () => {
      const config = makeConfig();
      const trader = new LiveTrader({ config });
      await trader.start(null);

      let wsInstance;
      trader.connectBinanceWS(function (url) {
        wsInstance = new MockWebSocket(url);
        return wsInstance;
      });

      // Interleave errors with valid data
      for (let i = 0; i < 100; i++) {
        if (i % 10 === 0) {
          wsInstance.emit('message', 'invalid json ' + i);
        }
        wsInstance.emit('message', JSON.stringify({
          e: 'kline', s: 'BTCUSDT',
          k: {
            o: String(50000 + i), h: String(50100 + i),
            l: String(49900 + i), c: String(50000 + i * 5),
            v: '10', T: Date.now() + i * 60000, x: true,
          },
        }));
      }

      // Errors logged but trading continued
      expect(trader.errorLog.length).toBe(10);
      const buffer = trader.realtimeTrader.priceBuffers.get('BTCUSDT');
      // Buffer is trimmed to lookback(10) + 50 = 60 max
      expect(buffer.closes.length).toBe(60);

      trader.stop();
    });
  });

  describe('WebSocket reconnection resilience', () => {
    it('survives WebSocket close and data continues from new feed', async () => {
      const config = makeConfig();
      const statuses = [];
      const trader = new LiveTrader({
        config,
        onStatus: (s) => statuses.push(s),
      });
      await trader.start(null);

      // First WS connection
      let ws1;
      trader.connectBinanceWS(function (url) {
        ws1 = new MockWebSocket(url);
        return ws1;
      });

      // Feed some data
      for (let i = 0; i < 20; i++) {
        ws1.emit('message', JSON.stringify({
          e: 'kline', s: 'BTCUSDT',
          k: {
            o: '50000', h: '50100', l: '49900',
            c: String(50000 + i * 10), v: '5',
            T: Date.now() + i * 60000, x: true,
          },
        }));
      }

      // Simulate WS close
      ws1.emit('close');
      expect(statuses.some(s => s.event === 'ws_closed')).toBe(true);

      // The trader should still work with direct feed
      const buffer = trader.realtimeTrader.priceBuffers.get('BTCUSDT');
      const countBefore = buffer.closes.length;

      // Feed directly (simulating a new connection)
      trader.realtimeTrader.feedPrice('BTCUSDT', {
        close: 51000, volume: 1000, timestamp: Date.now() + 100 * 60000,
      });
      expect(buffer.closes.length).toBe(countBefore + 1);

      trader.stop();
    });

    it('handles rapid connect/disconnect cycles', async () => {
      const config = makeConfig();
      const trader = new LiveTrader({ config });
      await trader.start(null);

      // 10 rapid connect/disconnect cycles
      for (let cycle = 0; cycle < 10; cycle++) {
        let ws;
        trader.connectBinanceWS(function (url) {
          ws = new MockWebSocket(url);
          return ws;
        });
        // Feed a few ticks
        for (let i = 0; i < 3; i++) {
          ws.emit('message', JSON.stringify({
            e: 'kline', s: 'BTCUSDT',
            k: {
              o: '50000', h: '50100', l: '49900',
              c: String(50000 + cycle * 100 + i * 10), v: '5',
              T: Date.now() + (cycle * 10 + i) * 60000, x: true,
            },
          }));
        }
        ws.emit('close');
      }

      // Should have accumulated data from all cycles
      const buffer = trader.realtimeTrader.priceBuffers.get('BTCUSDT');
      expect(buffer.closes.length).toBe(30); // 10 cycles * 3 ticks

      // wsConnections accumulates (no cleanup on close)
      expect(trader.wsConnections.length).toBe(10);

      trader.stop();
      // After stop, all connections closed
      expect(trader.wsConnections).toHaveLength(0);
    });
  });

  describe('data consistency under stress', () => {
    it('getFullStatus is consistent with internal state', async () => {
      const config = makeConfig();
      const trader = new LiveTrader({ config });
      await trader.start(null);

      // Generate significant trading activity
      for (let i = 0; i < 500; i++) {
        trader.realtimeTrader.feedPrice('BTCUSDT', {
          close: 50000 + Math.sin(i / 5) * 3000,
          volume: 5000,
          timestamp: Date.now() + i * 60000,
        });
        trader.realtimeTrader.feedPrice('ETHUSDT', {
          close: 3000 + Math.sin(i / 7) * 200,
          volume: 3000,
          timestamp: Date.now() + i * 60000,
        });
      }

      const fullStatus = trader.getFullStatus();

      // Running state
      expect(fullStatus.running).toBe(true);

      // Portfolio matches trader state
      const traderSummary = trader.realtimeTrader.trader.getSummary();
      expect(fullStatus.portfolio.cash).toBe(traderSummary.cash);
      expect(fullStatus.portfolio.tradeCount).toBe(traderSummary.tradeCount);

      // Buffers match actual buffers
      for (const sym of ['BTCUSDT', 'ETHUSDT']) {
        const actualBuffer = trader.realtimeTrader.priceBuffers.get(sym);
        expect(fullStatus.buffers[sym].dataPoints).toBe(actualBuffer.closes.length);
      }

      // Log caps
      expect(fullStatus.recentSignals.length).toBeLessThanOrEqual(20);
      expect(fullStatus.recentTrades.length).toBeLessThanOrEqual(50);
      expect(fullStatus.recentErrors.length).toBeLessThanOrEqual(20);

      trader.stop();
    });

    it('executeTrade does not double-buy same symbol', () => {
      const trades = [];
      const rt = new RealtimeTrader({
        initialBalance: 100000,
        symbols: ['BTCUSDT'],
        lookback: 10,
        onTrade: (t) => trades.push(t),
      });

      // Feed strongly declining prices → BUY signal
      for (let i = 0; i < 20; i++) {
        rt.feedPrice('BTCUSDT', {
          close: 60000 - i * 500,
          volume: 10000,
          timestamp: Date.now() + i * 60000,
        });
      }

      // Count BUY trades — should be at most 1 (no double-buy)
      const buys = trades.filter(t => t.action === 'BUY');
      expect(buys.length).toBeLessThanOrEqual(1);

      // If we got a buy, further BUY signals should be ignored
      if (buys.length === 1) {
        const posBefore = rt.trader.getPosition('BTCUSDT');
        // Feed more declining data
        for (let i = 20; i < 40; i++) {
          rt.feedPrice('BTCUSDT', {
            close: 50000 - i * 200,
            volume: 10000,
            timestamp: Date.now() + i * 60000,
          });
        }
        const posAfter = rt.trader.getPosition('BTCUSDT');
        // Position should not have changed (no additional buys)
        if (posAfter) {
          expect(posAfter.qty).toBe(posBefore.qty);
        }
      }
    });

    it('executeTrade does not sell when no position exists', () => {
      const trades = [];
      const rt = new RealtimeTrader({
        initialBalance: 100000,
        symbols: ['BTCUSDT'],
        lookback: 10,
        onTrade: (t) => trades.push(t),
      });

      // Feed strongly rising prices → SELL signal, but no position to sell
      for (let i = 0; i < 20; i++) {
        rt.feedPrice('BTCUSDT', {
          close: 40000 + i * 500,
          volume: 10000,
          timestamp: Date.now() + i * 60000,
        });
      }

      // Should have no sells since no position was opened
      const sells = trades.filter(t => t.action === 'SELL');
      expect(sells).toHaveLength(0);
    });
  });

  describe('24/7 reliability simulation', () => {
    it('simulates 24 hours of minute-by-minute data (1440 ticks)', async () => {
      const config = makeConfig({
        trading: {
          symbols: ['BTCUSDT', 'ETHUSDT'],
          initialBalance: 100000,
          maxPositionPct: 0.10,
          yoloThreshold: 0.85,
          lookback: 30,
        },
      });
      const signals = [];
      const trades = [];
      const errors = [];

      const trader = new LiveTrader({
        config,
        onSignal: (s) => signals.push(s),
        onTrade: (t) => trades.push(t),
        onError: (e) => errors.push(e),
      });
      await trader.start(null);

      const btcPrices = generateRealisticPrices(1440, 50000, 0.005);
      const ethPrices = generateRealisticPrices(1440, 3000, 0.008);

      for (let i = 0; i < 1440; i++) {
        trader.realtimeTrader.feedPrice('BTCUSDT', {
          ...btcPrices[i],
          timestamp: Date.now() + i * 60000,
        });
        trader.realtimeTrader.feedPrice('ETHUSDT', {
          ...ethPrices[i],
          timestamp: Date.now() + i * 60000,
        });
      }

      // No errors
      expect(errors).toHaveLength(0);

      // Signals generated for both symbols (from tick #lookback onward)
      expect(signals.length).toBe((1440 - 30 + 1) * 2);

      // Portfolio still valid
      const status = trader.getFullStatus();
      expect(status.portfolio.cash).toBeGreaterThanOrEqual(0);
      expect(status.portfolio.portfolioValue).toBeGreaterThan(0);

      // Buffers are bounded
      for (const sym of ['BTCUSDT', 'ETHUSDT']) {
        expect(status.buffers[sym].dataPoints).toBeLessThanOrEqual(80);
        expect(status.buffers[sym].ready).toBe(true);
      }

      trader.stop();
      expect(trader.running).toBe(false);
    });

    it('simulates 7 days of data (10,080 ticks) across 5 symbols', () => {
      const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOTUSDT'];
      const rt = new RealtimeTrader({
        initialBalance: 500000,
        symbols,
        lookback: 20,
      });

      const basePrices = [50000, 3000, 100, 0.5, 7];
      const priceData = basePrices.map(p => generateRealisticPrices(10080, p, 0.01));

      for (let i = 0; i < 10080; i++) {
        for (let s = 0; s < symbols.length; s++) {
          rt.feedPrice(symbols[s], {
            ...priceData[s][i],
            timestamp: Date.now() + i * 60000,
          });
        }
      }

      // Verify no memory leak - all buffers bounded
      for (const sym of symbols) {
        const buffer = rt.priceBuffers.get(sym);
        expect(buffer.closes.length).toBeLessThanOrEqual(70);
      }

      // Portfolio is consistent
      expect(rt.trader.cash).toBeGreaterThanOrEqual(0);
      const summary = rt.trader.getSummary();
      expect(summary.portfolioValue).toBeGreaterThan(0);
    });
  });

  describe('edge cases in extended sessions', () => {
    it('handles price going to near-zero during session', () => {
      const rt = new RealtimeTrader({
        initialBalance: 100000,
        symbols: ['SHIBUSDT'],
        lookback: 10,
      });

      // Price crashes from 0.001 to 0.000001
      for (let i = 0; i < 100; i++) {
        rt.feedPrice('SHIBUSDT', {
          close: Math.max(0.001 * Math.pow(0.95, i), 0.0000001),
          volume: 1000000,
          timestamp: Date.now() + i * 60000,
        });
      }

      expect(rt.trader.cash).toBeGreaterThanOrEqual(0);
    });

    it('handles extreme volatility (50% swings)', () => {
      const rt = new RealtimeTrader({
        initialBalance: 100000,
        symbols: ['BTCUSDT'],
        lookback: 10,
      });

      for (let i = 0; i < 200; i++) {
        // Wild swings between 25000 and 75000
        const price = 50000 + Math.sin(i / 3) * 25000;
        rt.feedPrice('BTCUSDT', {
          close: price,
          volume: 10000,
          high: price * 1.05,
          low: price * 0.95,
          timestamp: Date.now() + i * 60000,
        });
      }

      // Should not crash and portfolio should remain valid
      expect(rt.trader.cash).toBeGreaterThanOrEqual(0);
      const status = rt.getStatus();
      expect(status.portfolio.portfolioValue).toBeGreaterThan(0);
    });

    it('handles identical consecutive prices (flat market)', () => {
      const rt = new RealtimeTrader({
        initialBalance: 100000,
        symbols: ['BTCUSDT'],
        lookback: 10,
      });

      // 500 ticks at the same price
      for (let i = 0; i < 500; i++) {
        rt.feedPrice('BTCUSDT', {
          close: 50000,
          volume: 1000,
          timestamp: Date.now() + i * 60000,
        });
      }

      // Should all be HOLD signals, no trades
      expect(rt.trader.tradeHistory).toHaveLength(0);
      expect(rt.trader.cash).toBe(100000);
    });

    it('handles sentiment updates during extended session', () => {
      const signals = [];
      const rt = new RealtimeTrader({
        initialBalance: 100000,
        symbols: ['BTCUSDT'],
        lookback: 10,
        onSignal: (s) => signals.push(s),
      });

      // Phase 1: neutral sentiment
      for (let i = 0; i < 50; i++) {
        rt.feedPrice('BTCUSDT', {
          close: 50000 + Math.sin(i / 5) * 500,
          volume: 1000,
          timestamp: Date.now() + i * 60000,
        });
      }

      // Phase 2: bullish sentiment
      rt.updateSentiment('BTCUSDT', { classification: 'very_bullish', score: 5 });
      for (let i = 50; i < 100; i++) {
        rt.feedPrice('BTCUSDT', {
          close: 50000 + Math.sin(i / 5) * 500,
          volume: 1000,
          timestamp: Date.now() + i * 60000,
        });
      }

      // Phase 3: bearish sentiment
      rt.updateSentiment('BTCUSDT', { classification: 'very_bearish', score: -5 });
      for (let i = 100; i < 150; i++) {
        rt.feedPrice('BTCUSDT', {
          close: 50000 + Math.sin(i / 5) * 500,
          volume: 1000,
          timestamp: Date.now() + i * 60000,
        });
      }

      // Signals generated from tick #lookback onward: 150 - 10 + 1 = 141
      expect(signals.length).toBe(141);
      // Sentiment should appear in signals from phase 2 onward
      // Phase 1: ticks 10-49 = 40 signals, Phase 2: ticks 50-99 = 50 signals
      const phase2Signals = signals.slice(41, 91);
      expect(phase2Signals.every(s => s.sentiment?.classification === 'very_bullish')).toBe(true);
      const phase3Signals = signals.slice(91);
      expect(phase3Signals.every(s => s.sentiment?.classification === 'very_bearish')).toBe(true);
    });
  });
});
