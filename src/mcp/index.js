// MCP Server for AI-Driven Trade Management
// tb-vqo: Expose trading bot via Model Context Protocol
// Tools: portfolio query, trade execution, strategy switching, backtesting
// Resources: live portfolio state, recent signals, trade history

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PaperTrader } from '../paper-trading/index.js';
import { SignalEngine } from '../signals/engine.js';
import { PositionSizer } from '../signals/position-sizer.js';
import { Backtester, computeSharpeRatio, computeMaxDrawdown } from '../backtest/index.js';
import { EnsembleStrategy } from '../strategies/ensemble.js';
import { MomentumStrategy } from '../strategies/momentum.js';
import { MeanReversionStrategy } from '../strategies/mean-reversion.js';
import { PairsTradingStrategy, KalmanHedgeRatio, PairScanner } from '../strategies/pairs-trading.js';

// Shared state for the MCP server
export class TradingBotState {
  constructor({
    initialBalance = 100000,
    symbols = ['BTCUSDT', 'ETHUSDT'],
    activeStrategy = 'ensemble',
  } = {}) {
    this.trader = new PaperTrader({ initialBalance });
    this.signalEngine = new SignalEngine();
    this.positionSizer = new PositionSizer();
    this.symbols = symbols;
    this.activeStrategy = activeStrategy;
    this.priceBuffers = new Map();
    this.signalLog = [];
    this.strategies = {
      ensemble: new EnsembleStrategy(),
      momentum: new MomentumStrategy(),
      meanReversion: new MeanReversionStrategy(),
      pairsTrading: new PairsTradingStrategy(),
    };
  }

  feedPrice(symbol, price) {
    let buffer = this.priceBuffers.get(symbol);
    if (!buffer) {
      buffer = { closes: [], volumes: [], candles: [] };
      this.priceBuffers.set(symbol, buffer);
    }
    buffer.closes.push(price);
    if (buffer.closes.length > 200) buffer.closes = buffer.closes.slice(-200);
  }

  getPortfolio() {
    const summary = this.trader.getSummary();
    const positions = [];
    for (const [symbol, pos] of this.trader.positions) {
      positions.push({ symbol, ...pos });
    }
    return {
      cash: Math.round(this.trader.cash * 100) / 100,
      portfolioValue: Math.round(this.trader.portfolioValue * 100) / 100,
      pnl: Math.round(this.trader.pnl * 100) / 100,
      pnlPct: Math.round(this.trader.pnlPct * 100) / 100,
      positions,
      tradeCount: this.trader.tradeHistory.length,
    };
  }
}

// Create and configure the MCP server
export function createMcpServer(state) {
  if (!state) state = new TradingBotState();

  const server = new McpServer({
    name: 'tradingbot',
    version: '1.0.0',
  });

  // --- TOOLS ---

  // Portfolio query
  server.tool(
    'get_portfolio',
    'Get current portfolio state: cash, positions, P&L, trade count',
    {},
    async () => {
      const portfolio = state.getPortfolio();
      return {
        content: [{ type: 'text', text: JSON.stringify(portfolio, null, 2) }],
      };
    }
  );

  // Execute trade
  server.tool(
    'execute_trade',
    'Execute a buy or sell trade on the paper trading account',
    {
      action: z.enum(['buy', 'sell']).describe('Trade direction'),
      symbol: z.string().describe('Trading symbol (e.g., BTCUSDT)'),
      quantity: z.number().positive().describe('Quantity to trade'),
      price: z.number().positive().describe('Execution price'),
    },
    async ({ action, symbol, quantity, price }) => {
      let result;
      if (action === 'buy') {
        result = state.trader.buy(symbol, quantity, price);
      } else {
        result = state.trader.sell(symbol, quantity, price);
      }

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Trade failed: ${result.reason}` }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action,
            symbol,
            quantity,
            price,
            cost: Math.round(quantity * price * 100) / 100,
            remainingCash: Math.round(state.trader.cash * 100) / 100,
            portfolioValue: Math.round(state.trader.portfolioValue * 100) / 100,
          }, null, 2),
        }],
      };
    }
  );

  // Generate signal
  server.tool(
    'generate_signal',
    'Generate a trading signal for a symbol using current strategy and price data',
    {
      symbol: z.string().describe('Trading symbol'),
      closes: z.array(z.number()).min(20).describe('Array of closing prices (most recent last)'),
      volumes: z.array(z.number()).optional().describe('Array of volumes (optional)'),
    },
    async ({ symbol, closes, volumes }) => {
      const analysis = state.signalEngine.analyze(symbol, {
        closes,
        volumes: volumes || closes.map(() => 1000),
        currentPrice: closes[closes.length - 1],
        sentiment: null,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(analysis, null, 2) }],
      };
    }
  );

  // Switch strategy
  server.tool(
    'switch_strategy',
    'Switch the active trading strategy',
    {
      strategy: z.enum(['ensemble', 'momentum', 'meanReversion', 'pairsTrading'])
        .describe('Strategy to activate'),
    },
    async ({ strategy }) => {
      const previous = state.activeStrategy;
      state.activeStrategy = strategy;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            switched: true,
            previous,
            active: strategy,
            description: {
              ensemble: 'Regime-dependent weighted combination of momentum + mean reversion + ML',
              momentum: 'RSI + MACD + ADX trend-following',
              meanReversion: 'Z-score + Bollinger Bands mean-reversion with Hurst filter',
              pairsTrading: 'Statistical arbitrage with Engle-Granger + Johansen cointegration',
            }[strategy],
          }, null, 2),
        }],
      };
    }
  );

  // Run backtest
  server.tool(
    'run_backtest',
    'Run a backtest on historical candle data and return performance metrics',
    {
      symbol: z.string().describe('Trading symbol'),
      candles: z.array(z.object({
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        volume: z.number(),
      })).min(50).describe('Historical OHLCV candles'),
      initialBalance: z.number().positive().optional().describe('Starting balance (default 100000)'),
      lookback: z.number().int().positive().optional().describe('Lookback period (default 30)'),
    },
    async ({ symbol, candles, initialBalance, lookback }) => {
      const bt = new Backtester({
        initialBalance: initialBalance || 100000,
      });
      const result = bt.run(symbol, candles, { lookback: lookback || 30 });

      if (result.error) {
        return {
          content: [{ type: 'text', text: `Backtest failed: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Pairs trading signal
  server.tool(
    'pairs_signal',
    'Generate a pairs trading signal for two cointegrated assets',
    {
      closesA: z.array(z.number()).min(60).describe('Closing prices for asset A'),
      closesB: z.array(z.number()).min(60).describe('Closing prices for asset B'),
      entryZScore: z.number().positive().optional().describe('Z-score entry threshold (default 2.0)'),
      useKalman: z.boolean().optional().describe('Use Kalman filter for hedge ratio (default false)'),
    },
    async ({ closesA, closesB, entryZScore, useKalman }) => {
      const pts = new PairsTradingStrategy({
        entryZScore: entryZScore || 2.0,
      });

      const signal = pts.generateSignal(closesA, closesB);

      // Optionally add Kalman filter analysis
      let kalmanInfo = null;
      if (useKalman) {
        const kf = new KalmanHedgeRatio();
        const kalmanResult = kf.filter(closesA, closesB);
        if (kalmanResult) {
          kalmanInfo = {
            kalmanBeta: Math.round(kalmanResult.finalBeta * 10000) / 10000,
            olsBeta: signal.hedgeRatio,
            betaDrift: Math.round(Math.abs(kalmanResult.finalBeta - (signal.hedgeRatio || 0)) * 10000) / 10000,
          };
        }
      }

      // Add Johansen test
      const johansen = pts.johansenTest(closesA, closesB);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ...signal,
            johansen: {
              isCointegrated: johansen.isCointegrated,
              rank: johansen.rank,
              traceStats: johansen.traceStats,
            },
            ...(kalmanInfo ? { kalman: kalmanInfo } : {}),
          }, null, 2),
        }],
      };
    }
  );

  // Scan pair universe
  server.tool(
    'scan_pairs',
    'Scan a universe of assets to find the best cointegrated pairs for trading',
    {
      universe: z.record(z.string(), z.array(z.number()).min(60))
        .describe('Map of symbol to closing prices'),
      minCorrelation: z.number().optional().describe('Minimum correlation threshold (default 0.5)'),
      maxResults: z.number().int().positive().optional().describe('Max pairs to return (default 10)'),
    },
    async ({ universe, minCorrelation, maxResults }) => {
      const scanner = new PairScanner({
        minCorrelation: minCorrelation || 0.5,
      });
      const results = scanner.scan(universe);
      const limited = results.slice(0, maxResults || 10);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            totalPairsScanned: Object.keys(universe).length * (Object.keys(universe).length - 1) / 2,
            qualifiedPairs: results.length,
            topPairs: limited,
          }, null, 2),
        }],
      };
    }
  );

  // Position sizing
  server.tool(
    'calculate_position_size',
    'Calculate optimal position size using Kelly criterion with risk constraints',
    {
      price: z.number().positive().describe('Current asset price'),
      confidence: z.number().min(0).max(1).describe('Signal confidence (0-1)'),
      portfolioValue: z.number().positive().optional().describe('Portfolio value (uses current if omitted)'),
      volatility: z.number().positive().optional().describe('Asset volatility estimate'),
    },
    async ({ price, confidence, portfolioValue, volatility }) => {
      const pv = portfolioValue || state.trader.portfolioValue;
      const sizing = state.positionSizer.calculate({
        portfolioValue: pv,
        price,
        confidence,
        volatility,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(sizing, null, 2) }],
      };
    }
  );

  // Trade history
  server.tool(
    'get_trade_history',
    'Get recent trade history from the paper trading account',
    {
      limit: z.number().int().positive().optional().describe('Number of trades to return (default 50)'),
    },
    async ({ limit }) => {
      const n = limit || 50;
      const trades = state.trader.tradeHistory.slice(-n);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            totalTrades: state.trader.tradeHistory.length,
            showing: trades.length,
            trades,
          }, null, 2),
        }],
      };
    }
  );

  // --- RESOURCES ---

  // Portfolio resource
  server.resource(
    'portfolio',
    'tradingbot://portfolio',
    { mimeType: 'application/json' },
    async () => ({
      contents: [{
        uri: 'tradingbot://portfolio',
        mimeType: 'application/json',
        text: JSON.stringify(state.getPortfolio(), null, 2),
      }],
    })
  );

  // Active strategy resource
  server.resource(
    'strategy',
    'tradingbot://strategy',
    { mimeType: 'application/json' },
    async () => ({
      contents: [{
        uri: 'tradingbot://strategy',
        mimeType: 'application/json',
        text: JSON.stringify({
          active: state.activeStrategy,
          available: Object.keys(state.strategies),
        }, null, 2),
      }],
    })
  );

  return { server, state };
}

// CLI entry point: run as stdio MCP server
export async function startMcpServer(options = {}) {
  const { server } = createMcpServer(new TradingBotState(options));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
