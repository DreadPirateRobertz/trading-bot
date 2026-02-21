import { describe, it, expect, beforeEach } from 'vitest';
import { createServer } from '../src/mcp/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Helper: generate OHLCV candles
function makeCandles(n, basePrice = 100, volatility = 0.02) {
  const candles = [];
  let price = basePrice;
  for (let i = 0; i < n; i++) {
    const change = (Math.sin(i * 0.3) + ((i * 17 + 7) % 100 - 50) / 2500) * volatility * price;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.abs(((i * 13) % 50) / 5000));
    const low = Math.min(open, close) * (1 - Math.abs(((i * 11) % 50) / 5000));
    const volume = 1000 + ((i * 31) % 500);
    candles.push({ open, high, low, close, volume });
    price = close;
  }
  return candles;
}

// Helper: extract closes from candles
function extractCloses(candles) {
  return candles.map(c => c.close);
}

// Helper: generate returns
function makeReturns(n, mean = 0, stdDev = 0.02) {
  return Array.from({ length: n }, (_, i) =>
    mean + ((Math.sin(i * 0.7) * 2 + ((i * 17 + 3) % 100 - 50) / 1500) * stdDev),
  );
}

// Helper: create connected client+server pair
async function createTestPair(options = {}) {
  const server = createServer(options);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { server, client };
}

describe('MCP Server', () => {
  describe('createServer', () => {
    it('creates a server instance', () => {
      const server = createServer();
      expect(server).toBeDefined();
    });

    it('accepts custom config', () => {
      const server = createServer({
        positionSizerConfig: { maxPositionPct: 0.05 },
        signalEngineConfig: { rsiPeriod: 21 },
      });
      expect(server).toBeDefined();
    });
  });

  describe('tool listing', () => {
    it('lists all registered tools', async () => {
      const { client } = await createTestPair();
      const result = await client.listTools();
      const names = result.tools.map(t => t.name);
      expect(names).toContain('get_market_regime');
      expect(names).toContain('get_trade_signals');
      expect(names).toContain('compute_position_size');
      expect(names).toContain('analyze_risk');
      expect(names).toContain('run_backtest');
      expect(names).toContain('get_ensemble_signal');
      expect(names).toContain('compute_risk_parity');
      expect(names).toContain('compute_portfolio_kelly');
      expect(names).toContain('run_pairs_backtest');
      expect(names).toContain('run_walk_forward');
      expect(names).toContain('analyze_multi_timeframe');
      expect(names.length).toBe(11);
    });

    it('each tool has a description', async () => {
      const { client } = await createTestPair();
      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });
  });

  describe('get_market_regime', () => {
    it('detects market regime from candle data', async () => {
      const { client } = await createTestPair();
      const candles = makeCandles(60);
      const result = await client.callTool({ name: 'get_market_regime', arguments: { candles } });
      const data = JSON.parse(result.content[0].text);
      expect(data.regime).toBeDefined();
      expect(['bull', 'bear', 'range_bound', 'high_vol']).toContain(data.regime);
      expect(data.confidence).toBeGreaterThan(0);
      expect(data.probabilities).toBeDefined();
      expect(data.recentDistribution).toBeDefined();
      expect(data.candleCount).toBe(60);
    });

    it('includes regime probability distribution', async () => {
      const { client } = await createTestPair();
      const candles = makeCandles(50);
      const result = await client.callTool({ name: 'get_market_regime', arguments: { candles } });
      const data = JSON.parse(result.content[0].text);
      // Probabilities should sum to approximately 1
      const probSum = Object.values(data.probabilities).reduce((a, b) => a + b, 0);
      expect(probSum).toBeCloseTo(1.0, 1);
    });
  });

  describe('get_trade_signals', () => {
    it('generates BUY/SELL/HOLD signal', async () => {
      const { client } = await createTestPair();
      const closes = extractCloses(makeCandles(50));
      const result = await client.callTool({
        name: 'get_trade_signals',
        arguments: { symbol: 'BTC', closes },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.symbol).toBe('BTC');
      expect(data.price).toBeDefined();
      expect(data.signal).toBeDefined();
      expect(data.signal.action).toBeDefined();
      expect(['BUY', 'SELL', 'HOLD']).toContain(data.signal.action);
      expect(data.signal.confidence).toBeGreaterThanOrEqual(0);
      expect(data.signal.confidence).toBeLessThanOrEqual(1);
    });

    it('includes technical indicators', async () => {
      const { client } = await createTestPair();
      const closes = extractCloses(makeCandles(50));
      const result = await client.callTool({
        name: 'get_trade_signals',
        arguments: { symbol: 'ETH', closes },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.indicators).toBeDefined();
    });

    it('accepts sentiment data', async () => {
      const { client } = await createTestPair();
      const closes = extractCloses(makeCandles(50));
      const result = await client.callTool({
        name: 'get_trade_signals',
        arguments: {
          symbol: 'SOL',
          closes,
          sentiment: { score: 0.8, magnitude: 0.6 },
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.signal).toBeDefined();
    });
  });

  describe('compute_position_size', () => {
    it('computes Kelly-based position size', async () => {
      const { client } = await createTestPair();
      const result = await client.callTool({
        name: 'compute_position_size',
        arguments: {
          portfolioValue: 100000,
          price: 100,
          confidence: 0.7,
          strategyName: 'momentum',
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.quantity).toBeGreaterThan(0);
      expect(data.value).toBeGreaterThan(0);
      expect(data.method).toContain('kelly');
      expect(data.positionPct).toBeDefined();
    });

    it('applies regime adjustment', async () => {
      const { client } = await createTestPair();
      const bull = await client.callTool({
        name: 'compute_position_size',
        arguments: {
          portfolioValue: 100000,
          price: 100,
          confidence: 0.7,
          winRate: 0.6,
          avgWinReturn: 0.05,
          avgLossReturn: 0.03,
          regime: 'bull_low_vol',
        },
      });
      const bear = await client.callTool({
        name: 'compute_position_size',
        arguments: {
          portfolioValue: 100000,
          price: 100,
          confidence: 0.7,
          winRate: 0.6,
          avgWinReturn: 0.05,
          avgLossReturn: 0.03,
          regime: 'bear_high_vol',
        },
      });
      const bullData = JSON.parse(bull.content[0].text);
      const bearData = JSON.parse(bear.content[0].text);
      expect(bullData.quantity).toBeGreaterThan(bearData.quantity);
    });

    it('returns skip for tiny positions', async () => {
      const { client } = await createTestPair();
      const result = await client.callTool({
        name: 'compute_position_size',
        arguments: {
          portfolioValue: 100,
          price: 50000,
          confidence: 0.1,
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.quantity).toBe(0);
      expect(data.method).toBe('skip');
    });
  });

  describe('analyze_risk', () => {
    it('calculates VaR and CVaR', async () => {
      const { client } = await createTestPair();
      const returns = makeReturns(200);
      const result = await client.callTool({
        name: 'analyze_risk',
        arguments: { returns },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.confidenceLevel).toBe(0.95);
      expect(data.sampleSize).toBe(200);
      expect(data.parametricVaR).toBeDefined();
      expect(data.historicalVaR).toBeDefined();
      expect(data.cvar).toBeDefined();
      expect(data.cvar).toBeGreaterThanOrEqual(0);
    });

    it('includes optimal-f with trade history', async () => {
      const { client } = await createTestPair();
      const returns = makeReturns(100);
      const trades = [
        ...Array.from({ length: 12 }, () => ({ pnlPct: 0.05 })),
        ...Array.from({ length: 8 }, () => ({ pnlPct: -0.03 })),
      ];
      const result = await client.callTool({
        name: 'analyze_risk',
        arguments: { returns, trades },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.optimalF).toBeDefined();
      expect(data.optimalF.optimalF).toBeGreaterThan(0);
      expect(data.kellyCI).toBeDefined();
      expect(data.exponentialKelly).toBeDefined();
    });

    it('supports custom confidence level', async () => {
      const { client } = await createTestPair();
      const returns = makeReturns(200);
      const result99 = await client.callTool({
        name: 'analyze_risk',
        arguments: { returns, confidenceLevel: 0.99 },
      });
      const result95 = await client.callTool({
        name: 'analyze_risk',
        arguments: { returns, confidenceLevel: 0.95 },
      });
      const data99 = JSON.parse(result99.content[0].text);
      const data95 = JSON.parse(result95.content[0].text);
      expect(data99.parametricVaR).toBeGreaterThan(data95.parametricVaR);
    });
  });

  describe('run_backtest', () => {
    it('runs backtest and returns metrics', async () => {
      const { client } = await createTestPair();
      const candles = makeCandles(100);
      const result = await client.callTool({
        name: 'run_backtest',
        arguments: { symbol: 'BTC', candles },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.symbol).toBe('BTC');
      expect(data.candleCount).toBe(100);
      expect(data.initialBalance).toBe(100000);
      expect(data.totalReturn).toBeDefined();
      expect(data.sharpeRatio).toBeDefined();
      expect(data.maxDrawdown).toBeDefined();
      expect(typeof data.totalTrades).toBe('number');
    });

    it('accepts custom initial balance', async () => {
      const { client } = await createTestPair();
      const candles = makeCandles(60);
      const result = await client.callTool({
        name: 'run_backtest',
        arguments: { symbol: 'ETH', candles, initialBalance: 50000 },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.initialBalance).toBe(50000);
    });
  });

  describe('get_ensemble_signal', () => {
    it('generates ensemble signal from closes', async () => {
      const { client } = await createTestPair();
      const closes = extractCloses(makeCandles(50));
      const result = await client.callTool({
        name: 'get_ensemble_signal',
        arguments: { closes },
      });
      const data = JSON.parse(result.content[0].text);
      expect(['BUY', 'SELL', 'HOLD']).toContain(data.action);
      expect(data.confidence).toBeGreaterThanOrEqual(0);
      expect(data.regime).toBeDefined();
      expect(data.weights).toBeDefined();
      expect(data.components).toBeDefined();
      expect(data.reasons).toBeDefined();
    });

    it('supports HMM regime detection with candles', async () => {
      const { client } = await createTestPair();
      const candles = makeCandles(60);
      const closes = extractCloses(candles);
      const result = await client.callTool({
        name: 'get_ensemble_signal',
        arguments: { closes, candles, useHMM: true },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.hmmActive).toBe(true);
      expect(data.regime).toBeDefined();
    });

    it('works without HMM (default)', async () => {
      const { client } = await createTestPair();
      const closes = extractCloses(makeCandles(50));
      const result = await client.callTool({
        name: 'get_ensemble_signal',
        arguments: { closes, useHMM: false },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.hmmActive).toBe(false);
    });

    it('accepts custom strategy weights', async () => {
      const { client } = await createTestPair();
      const closes = extractCloses(makeCandles(50));
      const result = await client.callTool({
        name: 'get_ensemble_signal',
        arguments: {
          closes,
          weights: { momentum: 0.8, meanReversion: 0.2 },
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.action).toBeDefined();
    });
  });

  describe('compute_risk_parity', () => {
    it('computes inverse-vol weights', async () => {
      const { client } = await createTestPair();
      const result = await client.callTool({
        name: 'compute_risk_parity',
        arguments: {
          strategyVols: { momentum: 0.30, mean_reversion: 0.15, pairs: 0.20 },
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.weights).toBeDefined();
      expect(data.weights.mean_reversion).toBeGreaterThan(data.weights.momentum);
      const sum = Object.values(data.weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    });

    it('handles single strategy', async () => {
      const { client } = await createTestPair();
      const result = await client.callTool({
        name: 'compute_risk_parity',
        arguments: { strategyVols: { solo: 0.25 } },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.weights.solo).toBeCloseTo(1.0, 2);
    });
  });

  describe('compute_portfolio_kelly', () => {
    it('adjusts correlated positions downward', async () => {
      const { client } = await createTestPair();
      // Correlated returns
      const base = Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.1) * 0.03);
      const noise = Array.from({ length: 50 }, (_, i) => ((i * 7) % 50 - 25) / 5000);
      const returnsA = base.map((v, i) => v + noise[i]);
      const returnsB = base.map((v, i) => v - noise[i] * 0.5);

      const result = await client.callTool({
        name: 'compute_portfolio_kelly',
        arguments: {
          positions: [
            { name: 'BTC', kellyPct: 0.10, returns: returnsA },
            { name: 'ETH', kellyPct: 0.10, returns: returnsB },
          ],
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.adjustedPositions.BTC).toBeLessThanOrEqual(0.10);
      expect(data.adjustedPositions.ETH).toBeLessThanOrEqual(0.10);
      expect(data.diversificationBenefit).toBeGreaterThan(0);
    });

    it('returns single position unchanged', async () => {
      const { client } = await createTestPair();
      const returns = Array.from({ length: 20 }, (_, i) => Math.sin(i) * 0.02);
      const result = await client.callTool({
        name: 'compute_portfolio_kelly',
        arguments: {
          positions: [{ name: 'SOL', kellyPct: 0.15, returns }],
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.adjustedPositions.SOL).toBe(0.15);
    });
  });

  describe('run_pairs_backtest', () => {
    // Generate cointegrated pair for testing
    function makeCointegPair(n) {
      const closesA = [];
      const closesB = [];
      let pA = 100;
      let spread = 0;
      for (let i = 0; i < n; i++) {
        pA += 0.001 * pA + (Math.sin(i * 0.3) * 0.3);
        spread = spread * 0.9 + (((i * 17 + 3) % 100 - 50) / 250);
        closesB.push(Math.max((pA - spread) / 1.5, 1));
        closesA.push(pA);
      }
      return { closesA, closesB };
    }

    it('runs pairs backtest and returns metrics', async () => {
      const { client } = await createTestPair();
      const { closesA, closesB } = makeCointegPair(150);
      const result = await client.callTool({
        name: 'run_pairs_backtest',
        arguments: { closesA, closesB, symbolA: 'BTC', symbolB: 'ETH' },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.symbolA).toBe('BTC');
      expect(data.symbolB).toBe('ETH');
      expect(data.dataPoints).toBe(150);
      expect(data.initialBalance).toBe(100000);
      expect(typeof data.totalPnl).toBe('number');
      expect(typeof data.sharpeRatio).toBe('number');
      expect(typeof data.maxDrawdown).toBe('number');
      expect(typeof data.totalTrades).toBe('number');
    });

    it('returns error for insufficient data', async () => {
      const { client } = await createTestPair();
      const result = await client.callTool({
        name: 'run_pairs_backtest',
        arguments: {
          closesA: Array.from({ length: 60 }, (_, i) => 100 + i),
          closesB: Array.from({ length: 60 }, (_, i) => 50 + i),
          lookback: 100,
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toBeDefined();
    });

    it('accepts custom strategy parameters', async () => {
      const { client } = await createTestPair();
      const { closesA, closesB } = makeCointegPair(150);
      const result = await client.callTool({
        name: 'run_pairs_backtest',
        arguments: {
          closesA,
          closesB,
          entryZScore: 1.5,
          exitZScore: 0.3,
          initialBalance: 50000,
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.initialBalance).toBe(50000);
      expect(data.error).toBeUndefined();
    });
  });

  describe('run_walk_forward', () => {
    it('runs walk-forward evaluation and returns strategy comparison', async () => {
      const { client } = await createTestPair();
      const candles = makeCandles(300, 40000, 0.015);
      const result = await client.callTool({
        name: 'run_walk_forward',
        arguments: { candles },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.comparison).toBeDefined();
      expect(typeof data.comparison.mlEnsembleSharpe).toBe('number');
      expect(typeof data.comparison.bbConservativeSharpe).toBe('number');
      expect(typeof data.comparison.mlBeatsBB).toBe('boolean');
      expect(data.mlEnsemble).toBeDefined();
      expect(data.mlEnsemble.name).toBe('ML-Ensemble');
      expect(typeof data.mlEnsemble.totalReturn).toBe('number');
      expect(typeof data.mlEnsemble.sharpeRatio).toBe('number');
      expect(data.bbConservative).toBeDefined();
      expect(data.momentum7d).toBeDefined();
      expect(data.candleCount).toBe(300);
    }, 15000);

    it('rejects insufficient candle data', async () => {
      const { client } = await createTestPair();
      const candles = makeCandles(50);
      const result = await client.callTool({
        name: 'run_walk_forward',
        arguments: { candles },
      });
      expect(result.isError).toBe(true);
    });

    it('accepts custom execution cost parameters', async () => {
      const { client } = await createTestPair();
      const candles = makeCandles(300, 40000, 0.015);
      const result = await client.callTool({
        name: 'run_walk_forward',
        arguments: { candles, slippageBps: 10, commissionBps: 20 },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.mlEnsemble.executionCosts).toBeGreaterThanOrEqual(0);
    }, 15000);
  });

  describe('analyze_multi_timeframe', () => {
    // Generate 1-minute candles with openTime
    function makeCandles1m(n, basePrice = 100) {
      const candles = [];
      let price = basePrice;
      const startTime = Date.now() - n * 60000;
      for (let i = 0; i < n; i++) {
        const change = (Math.sin(i * 0.1) * 0.3 + ((i * 13 + 7) % 100 - 50) / 2500) * 0.005 * price;
        const open = price;
        const close = price + change;
        candles.push({
          openTime: startTime + i * 60000,
          open,
          high: Math.max(open, close) * 1.001,
          low: Math.min(open, close) * 0.999,
          close,
          volume: 1000 + ((i * 31) % 500),
        });
        price = close;
      }
      return candles;
    }

    it('analyzes trends across multiple timeframes', async () => {
      const { client } = await createTestPair();
      const candles1m = makeCandles1m(500);
      const result = await client.callTool({
        name: 'analyze_multi_timeframe',
        arguments: { candles1m },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.confirmation).toBeDefined();
      expect(data.confirmation.overall).toBeDefined();
      expect(['bullish', 'bearish', 'mixed']).toContain(data.confirmation.overall);
      expect(typeof data.confirmation.netBias).toBe('number');
      expect(data.timeframeCount).toBeGreaterThan(1);
      expect(data.trends).toBeDefined();
    });

    it('confirms a BUY signal against higher timeframes', async () => {
      const { client } = await createTestPair();
      const candles1m = makeCandles1m(500);
      const result = await client.callTool({
        name: 'analyze_multi_timeframe',
        arguments: {
          candles1m,
          signal: { action: 'BUY', confidence: 0.7 },
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(typeof data.confirmed).toBe('boolean');
      expect(typeof data.adjustedConfidence).toBe('number');
      expect(data.originalConfidence).toBe(0.7);
      expect(typeof data.alignment).toBe('number');
      expect(data.reason).toBeDefined();
    });

    it('accepts custom timeframes and confirmation mode', async () => {
      const { client } = await createTestPair();
      const candles1m = makeCandles1m(300);
      const result = await client.callTool({
        name: 'analyze_multi_timeframe',
        arguments: {
          candles1m,
          timeframes: ['5m', '15m', '1h'],
          confirmationMode: 'strict',
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.trends).toBeDefined();
      expect(data.confirmation).toBeDefined();
    });

    it('returns no confirmation for HOLD signal', async () => {
      const { client } = await createTestPair();
      const candles1m = makeCandles1m(200);
      const result = await client.callTool({
        name: 'analyze_multi_timeframe',
        arguments: {
          candles1m,
          signal: { action: 'HOLD', confidence: 0 },
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.confirmed).toBe(false);
      expect(data.adjustedConfidence).toBe(0);
    });
  });
});
