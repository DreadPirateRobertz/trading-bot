import { describe, it, expect, beforeEach } from 'vitest';
import { TradingBotState, createMcpServer } from '../src/mcp/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('TradingBotState', () => {
  it('initializes with defaults', () => {
    const state = new TradingBotState();
    expect(state.trader).toBeDefined();
    expect(state.activeStrategy).toBe('ensemble');
    expect(state.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('accepts custom configuration', () => {
    const state = new TradingBotState({
      initialBalance: 50000,
      symbols: ['SOLUSDT'],
      activeStrategy: 'momentum',
    });
    expect(state.trader.cash).toBe(50000);
    expect(state.symbols).toEqual(['SOLUSDT']);
    expect(state.activeStrategy).toBe('momentum');
  });

  describe('getPortfolio', () => {
    it('returns portfolio with no positions', () => {
      const state = new TradingBotState({ initialBalance: 100000 });
      const portfolio = state.getPortfolio();
      expect(portfolio.cash).toBe(100000);
      expect(portfolio.portfolioValue).toBe(100000);
      expect(portfolio.pnl).toBe(0);
      expect(portfolio.positions).toEqual([]);
      expect(portfolio.tradeCount).toBe(0);
    });

    it('reflects positions after trades', () => {
      const state = new TradingBotState({ initialBalance: 100000 });
      state.trader.buy('BTCUSDT', 1, 40000);
      const portfolio = state.getPortfolio();
      expect(portfolio.cash).toBe(60000);
      expect(portfolio.positions).toHaveLength(1);
      expect(portfolio.positions[0].symbol).toBe('BTCUSDT');
      expect(portfolio.tradeCount).toBe(1);
    });
  });

  describe('feedPrice', () => {
    it('stores prices in buffer', () => {
      const state = new TradingBotState();
      state.feedPrice('BTCUSDT', 40000);
      state.feedPrice('BTCUSDT', 40100);
      expect(state.priceBuffers.get('BTCUSDT').closes).toEqual([40000, 40100]);
    });

    it('caps buffer at 200 entries', () => {
      const state = new TradingBotState();
      for (let i = 0; i < 250; i++) {
        state.feedPrice('BTCUSDT', 40000 + i);
      }
      expect(state.priceBuffers.get('BTCUSDT').closes.length).toBe(200);
    });
  });
});

describe('MCP Server', () => {
  let client;
  let state;

  beforeEach(async () => {
    state = new TradingBotState({ initialBalance: 100000 });
    const { server } = createMcpServer(state);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  describe('get_portfolio tool', () => {
    it('returns portfolio state', async () => {
      const result = await client.callTool({ name: 'get_portfolio', arguments: {} });
      const portfolio = JSON.parse(result.content[0].text);
      expect(portfolio.cash).toBe(100000);
      expect(portfolio.portfolioValue).toBe(100000);
      expect(portfolio.pnl).toBe(0);
      expect(portfolio.positions).toEqual([]);
    });

    it('reflects trades', async () => {
      state.trader.buy('ETHUSDT', 10, 2500);
      const result = await client.callTool({ name: 'get_portfolio', arguments: {} });
      const portfolio = JSON.parse(result.content[0].text);
      expect(portfolio.cash).toBe(75000);
      expect(portfolio.positions).toHaveLength(1);
      expect(portfolio.tradeCount).toBe(1);
    });
  });

  describe('execute_trade tool', () => {
    it('executes a buy trade', async () => {
      const result = await client.callTool({
        name: 'execute_trade',
        arguments: { action: 'buy', symbol: 'BTCUSDT', quantity: 0.5, price: 40000 },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.action).toBe('buy');
      expect(data.cost).toBe(20000);
      expect(data.remainingCash).toBe(80000);
    });

    it('executes a sell trade', async () => {
      state.trader.buy('BTCUSDT', 1, 40000);
      const result = await client.callTool({
        name: 'execute_trade',
        arguments: { action: 'sell', symbol: 'BTCUSDT', quantity: 1, price: 42000 },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.action).toBe('sell');
    });

    it('fails on insufficient funds', async () => {
      const result = await client.callTool({
        name: 'execute_trade',
        arguments: { action: 'buy', symbol: 'BTCUSDT', quantity: 100, price: 40000 },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Insufficient funds');
    });

    it('fails on selling without position', async () => {
      const result = await client.callTool({
        name: 'execute_trade',
        arguments: { action: 'sell', symbol: 'BTCUSDT', quantity: 1, price: 40000 },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('generate_signal tool', () => {
    it('generates a signal from price data', async () => {
      const closes = Array.from({ length: 50 }, (_, i) => 40000 + Math.sin(i * 0.3) * 500);
      const result = await client.callTool({
        name: 'generate_signal',
        arguments: { symbol: 'BTCUSDT', closes },
      });
      const analysis = JSON.parse(result.content[0].text);
      expect(analysis.symbol).toBe('BTCUSDT');
      expect(analysis.signal).toBeDefined();
      expect(['BUY', 'SELL', 'HOLD']).toContain(analysis.signal.action);
    });
  });

  describe('switch_strategy tool', () => {
    it('switches to momentum', async () => {
      const result = await client.callTool({
        name: 'switch_strategy',
        arguments: { strategy: 'momentum' },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.switched).toBe(true);
      expect(data.previous).toBe('ensemble');
      expect(data.active).toBe('momentum');
      expect(state.activeStrategy).toBe('momentum');
    });

    it('switches to pairsTrading', async () => {
      const result = await client.callTool({
        name: 'switch_strategy',
        arguments: { strategy: 'pairsTrading' },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.active).toBe('pairsTrading');
      expect(data.description).toContain('Johansen');
    });
  });

  describe('pairs_signal tool', () => {
    function cointegratedPair(n = 200) {
      const b = [100];
      for (let i = 1; i < n; i++) b.push(b[i - 1] * (1 + (Math.random() - 0.5) * 0.03));
      const a = b.map(bi => 10 + 1.5 * bi + (Math.random() - 0.5) * 0.5);
      return { a, b };
    }

    it('generates pairs trading signal', async () => {
      const { a, b } = cointegratedPair(200);
      const result = await client.callTool({
        name: 'pairs_signal',
        arguments: { closesA: a, closesB: b },
      });
      const data = JSON.parse(result.content[0].text);
      expect(['BUY', 'SELL', 'HOLD']).toContain(data.action);
      expect(data.johansen).toBeDefined();
      expect(typeof data.johansen.isCointegrated).toBe('boolean');
    });

    it('includes Kalman filter info when requested', async () => {
      const { a, b } = cointegratedPair(200);
      const result = await client.callTool({
        name: 'pairs_signal',
        arguments: { closesA: a, closesB: b, useKalman: true },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.kalman).toBeDefined();
      expect(data.kalman.kalmanBeta).toBeDefined();
    });
  });

  describe('scan_pairs tool', () => {
    it('scans a universe of assets', async () => {
      const n = 200;
      const BTC = [40000];
      for (let i = 1; i < n; i++) BTC.push(BTC[i - 1] * (1 + (Math.random() - 0.5) * 0.03));
      const ETH = BTC.map(p => 0.06 * p + (Math.random() - 0.5) * 50);
      const DOGE = [0.1];
      for (let i = 1; i < n; i++) DOGE.push(DOGE[i - 1] * (1 + (Math.random() - 0.5) * 0.05));

      const result = await client.callTool({
        name: 'scan_pairs',
        arguments: {
          universe: { BTC, ETH, DOGE },
          minCorrelation: 0.3,
        },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.totalPairsScanned).toBe(3); // C(3,2) = 3
      expect(typeof data.qualifiedPairs).toBe('number');
      expect(Array.isArray(data.topPairs)).toBe(true);
    });
  });

  describe('calculate_position_size tool', () => {
    it('calculates position size', async () => {
      const result = await client.callTool({
        name: 'calculate_position_size',
        arguments: { price: 40000, confidence: 0.8 },
      });
      const sizing = JSON.parse(result.content[0].text);
      expect(sizing.qty).toBeDefined();
      expect(sizing.qty).toBeGreaterThanOrEqual(0);
    });
  });

  describe('get_trade_history tool', () => {
    it('returns empty history initially', async () => {
      const result = await client.callTool({
        name: 'get_trade_history',
        arguments: {},
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.totalTrades).toBe(0);
      expect(data.trades).toEqual([]);
    });

    it('returns trades after execution', async () => {
      state.trader.buy('BTCUSDT', 1, 40000);
      state.trader.sell('BTCUSDT', 1, 42000);
      const result = await client.callTool({
        name: 'get_trade_history',
        arguments: { limit: 10 },
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.totalTrades).toBe(2);
      expect(data.trades).toHaveLength(2);
    });
  });

  describe('resources', () => {
    it('reads portfolio resource', async () => {
      const result = await client.readResource({ uri: 'tradingbot://portfolio' });
      const portfolio = JSON.parse(result.contents[0].text);
      expect(portfolio.cash).toBe(100000);
    });

    it('reads strategy resource', async () => {
      const result = await client.readResource({ uri: 'tradingbot://strategy' });
      const strategy = JSON.parse(result.contents[0].text);
      expect(strategy.active).toBe('ensemble');
      expect(strategy.available).toContain('pairsTrading');
    });
  });

  describe('tool listing', () => {
    it('lists all available tools', async () => {
      const result = await client.listTools();
      const toolNames = result.tools.map(t => t.name);
      expect(toolNames).toContain('get_portfolio');
      expect(toolNames).toContain('execute_trade');
      expect(toolNames).toContain('generate_signal');
      expect(toolNames).toContain('switch_strategy');
      expect(toolNames).toContain('run_backtest');
      expect(toolNames).toContain('pairs_signal');
      expect(toolNames).toContain('scan_pairs');
      expect(toolNames).toContain('calculate_position_size');
      expect(toolNames).toContain('get_trade_history');
    });
  });
});
