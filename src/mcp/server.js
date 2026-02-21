// MCP Server for AI-driven trade management
// Exposes trading bot capabilities as Model Context Protocol tools
// Transport: stdio (for Claude Code and other MCP clients)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SignalEngine } from '../signals/engine.js';
import { PositionSizer } from '../signals/position-sizer.js';
import { GaussianHMM } from '../ml/hmm.js';
import { Backtester, PairsBacktester } from '../backtest/index.js';
import { EnsembleStrategy } from '../strategies/ensemble.js';
import { WalkForwardEvaluator } from '../ml/walk-forward-evaluator.js';
import { MultiTimeframeAnalyzer } from '../analysis/multi-timeframe.js';

// Default candle format for examples and validation
const CandleSchema = z.object({
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

export function createServer(options = {}) {
  const {
    signalEngineConfig = {},
    positionSizerConfig = {},
    hmmConfig = {},
    backtestConfig = {},
  } = options;

  const server = new McpServer({
    name: 'tradingbot',
    version: '1.0.0',
    description: 'AI-driven crypto trading bot with regime detection, ML signals, and position sizing',
  });

  // Shared instances (lazy-initialized)
  let signalEngine = null;
  let positionSizer = null;
  let hmm = null;
  let ensemble = null;

  function getSignalEngine() {
    if (!signalEngine) signalEngine = new SignalEngine(signalEngineConfig);
    return signalEngine;
  }

  function getPositionSizer() {
    if (!positionSizer) positionSizer = new PositionSizer(positionSizerConfig);
    return positionSizer;
  }

  // ─── Tool: get_market_regime ─────────────────────────────────────────
  server.tool(
    'get_market_regime',
    'Detect current market regime using HMM (bull, bear, range_bound, high_vol). ' +
    'Provide OHLCV candles for the asset. Returns regime classification with confidence.',
    {
      candles: z.array(CandleSchema).min(30).describe('OHLCV candle data (minimum 30 candles)'),
      states: z.array(z.string()).optional().describe('Custom state names (default: bull, bear, range_bound, high_vol)'),
    },
    async ({ candles, states }) => {
      const detector = new GaussianHMM({
        ...(states ? { states } : {}),
        ...hmmConfig,
      });
      const observations = GaussianHMM.extractObservations(candles);

      if (observations.length < 10) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Insufficient data: need at least 30 candles' }) }] };
      }

      detector.fit(observations);
      const result = detector.currentRegime(observations);
      const decoded = detector.decode(observations);

      // Count regime distribution in recent history
      const recentDecoded = decoded.slice(-20);
      const distribution = {};
      for (const state of recentDecoded) {
        distribution[state] = (distribution[state] || 0) + 1;
      }
      for (const key of Object.keys(distribution)) {
        distribution[key] = Math.round((distribution[key] / recentDecoded.length) * 100);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            regime: result.regime,
            confidence: Math.round(result.confidence * 10000) / 10000,
            probabilities: result.probabilities,
            recentDistribution: distribution,
            candleCount: candles.length,
          }, null, 2),
        }],
      };
    },
  );

  // ─── Tool: get_trade_signals ─────────────────────────────────────────
  server.tool(
    'get_trade_signals',
    'Analyze an asset and generate trade signals using technical indicators ' +
    '(RSI, MACD, Bollinger Bands, volume analysis). Returns BUY/SELL/HOLD with confidence.',
    {
      symbol: z.string().describe('Asset symbol (e.g., BTC, ETH, SOL)'),
      closes: z.array(z.number()).min(30).describe('Closing prices (minimum 30)'),
      volumes: z.array(z.number()).optional().describe('Volume data (same length as closes)'),
      currentPrice: z.number().optional().describe('Current price (defaults to last close)'),
      sentiment: z.object({
        score: z.number().min(-1).max(1),
        magnitude: z.number().min(0).max(1),
      }).optional().describe('Sentiment data { score: -1 to 1, magnitude: 0 to 1 }'),
    },
    async ({ symbol, closes, volumes, currentPrice, sentiment }) => {
      const engine = getSignalEngine();
      const result = engine.analyze(symbol, {
        closes,
        volumes: volumes || [],
        currentPrice: currentPrice || closes[closes.length - 1],
        sentiment: sentiment || null,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            symbol: result.symbol,
            price: result.price,
            signal: result.signal,
            indicators: result.indicators,
          }, null, 2),
        }],
      };
    },
  );

  // ─── Tool: compute_position_size ─────────────────────────────────────
  server.tool(
    'compute_position_size',
    'Calculate optimal position size using Kelly criterion with VaR/CVaR constraints, ' +
    'regime adjustment, drawdown scaling, and transaction cost adjustment.',
    {
      portfolioValue: z.number().positive().describe('Total portfolio value in USD'),
      price: z.number().positive().describe('Current asset price'),
      confidence: z.number().min(0).max(1).describe('Signal confidence (0-1)'),
      strategyName: z.enum(['mean_reversion', 'momentum', 'pairs_trading', 'sentiment_momentum']).optional()
        .describe('Strategy name for default Kelly parameters'),
      regime: z.enum(['bull_low_vol', 'bear_high_vol', 'range_bound', 'uncertain']).optional()
        .describe('Market regime for Kelly fraction adjustment'),
      volatility: z.number().optional().describe('Daily return standard deviation'),
      currentDrawdown: z.number().min(0).max(1).optional().describe('Current portfolio drawdown (0-1)'),
      winRate: z.number().min(0).max(1).optional().describe('Historical win rate'),
      avgWinReturn: z.number().optional().describe('Average winning trade return'),
      avgLossReturn: z.number().optional().describe('Average losing trade return (positive number)'),
      maxVaRPct: z.number().optional().describe('Maximum daily VaR as portfolio fraction (e.g., 0.02)'),
      maxCVaRPct: z.number().optional().describe('Maximum daily CVaR as portfolio fraction (e.g., 0.03)'),
      transactionCostPct: z.number().optional().describe('Round-trip transaction cost (spread + fees + slippage)'),
      returns: z.array(z.number()).optional().describe('Historical returns for VaR/CVaR calculation'),
      useAdaptiveFraction: z.boolean().optional().describe('Use sample-size-adaptive Kelly fraction'),
    },
    async (params) => {
      const sizer = getPositionSizer();
      const result = sizer.calculate(params);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            quantity: result.qty,
            value: result.value,
            method: result.method,
            positionPct: result.positionPct,
            reason: result.reason || null,
          }, null, 2),
        }],
      };
    },
  );

  // ─── Tool: analyze_risk ──────────────────────────────────────────────
  server.tool(
    'analyze_risk',
    'Calculate risk metrics: VaR, Historical VaR, CVaR (Expected Shortfall), ' +
    'and optimal-f position sizing from trade history.',
    {
      returns: z.array(z.number()).min(10).describe('Historical return series (minimum 10 data points)'),
      confidenceLevel: z.number().min(0.80).max(0.99).optional().describe('Confidence level for VaR/CVaR (default 0.95)'),
      trades: z.array(z.object({ pnlPct: z.number() })).optional()
        .describe('Trade history for optimal-f calculation'),
    },
    async ({ returns, confidenceLevel = 0.95, trades }) => {
      const sizer = getPositionSizer();

      const var_ = sizer.calculateVaR(returns, confidenceLevel);
      const histVar = sizer.calculateHistoricalVaR(returns, confidenceLevel);
      const cvar = sizer.calculateCVaR(returns, confidenceLevel);

      const result = {
        confidenceLevel,
        sampleSize: returns.length,
        parametricVaR: var_ !== null ? Math.round(var_ * 10000) / 10000 : null,
        historicalVaR: histVar !== null ? Math.round(histVar * 10000) / 10000 : null,
        cvar: cvar !== null ? Math.round(cvar * 10000) / 10000 : null,
      };

      if (trades && trades.length >= 10) {
        const optF = sizer.optimalF(trades);
        if (optF) result.optimalF = optF;

        const ci = sizer.kellyConfidenceInterval(trades);
        if (ci) result.kellyCI = ci;

        const expKelly = sizer.exponentialKellyEstimate(trades);
        if (expKelly) result.exponentialKelly = expKelly;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    },
  );

  // ─── Tool: run_backtest ──────────────────────────────────────────────
  server.tool(
    'run_backtest',
    'Run a backtest on historical OHLCV data. Returns P&L, win rate, Sharpe ratio, ' +
    'max drawdown, and trade log.',
    {
      symbol: z.string().describe('Asset symbol'),
      candles: z.array(CandleSchema).min(50).describe('OHLCV candle data (minimum 50 candles)'),
      initialBalance: z.number().positive().optional().describe('Starting balance in USD (default 100000)'),
      maxPositionPct: z.number().min(0.01).max(0.50).optional().describe('Max position size as portfolio fraction'),
    },
    async ({ symbol, candles, initialBalance = 100000, maxPositionPct = 0.10 }) => {
      const backtester = new Backtester({
        initialBalance,
        maxPositionPct,
        ...backtestConfig,
      });

      const result = backtester.run(symbol, candles);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            symbol,
            candleCount: candles.length,
            initialBalance,
            totalPnl: result.totalPnl,
            totalReturn: result.totalReturn,
            totalTrades: result.totalTrades,
            wins: result.wins,
            losses: result.losses,
            winRate: result.winRate,
            avgWin: result.avgWin,
            avgLoss: result.avgLoss,
            profitFactor: result.profitFactor,
            maxDrawdown: result.maxDrawdown,
            sharpeRatio: result.sharpeRatio,
          }, null, 2),
        }],
      };
    },
  );

  // ─── Tool: get_ensemble_signal ───────────────────────────────────────
  server.tool(
    'get_ensemble_signal',
    'Generate a combined signal from momentum + mean-reversion strategies with ' +
    'optional HMM regime detection and ML enhancement.',
    {
      closes: z.array(z.number()).min(30).describe('Closing prices (minimum 30)'),
      candles: z.array(CandleSchema).optional().describe('Full OHLCV data for HMM regime detection'),
      useHMM: z.boolean().optional().describe('Enable HMM regime detection (requires candles)'),
      weights: z.object({
        momentum: z.number().min(0).max(1),
        meanReversion: z.number().min(0).max(1),
      }).optional().describe('Strategy weights (default: 0.5/0.5)'),
    },
    async ({ closes, candles, useHMM = false, weights }) => {
      const config = {};
      if (weights) config.weights = weights;

      if (useHMM && candles && candles.length >= 30) {
        const detector = new GaussianHMM(hmmConfig);
        const observations = GaussianHMM.extractObservations(candles);
        if (observations.length >= 10) {
          detector.fit(observations);
          config.hmmDetector = detector;
        }
      }

      const strategy = new EnsembleStrategy(config);
      const signal = strategy.generateSignal(closes, candles || null);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            action: signal.action,
            confidence: signal.confidence,
            signal: signal.signal,
            regime: signal.regime,
            weights: signal.weights,
            components: signal.components,
            hmmActive: signal.hmmActive || false,
            reasons: signal.reasons,
          }, null, 2),
        }],
      };
    },
  );

  // ─── Tool: compute_risk_parity ───────────────────────────────────────
  server.tool(
    'compute_risk_parity',
    'Calculate risk parity portfolio weights using inverse-volatility allocation ' +
    'across multiple strategies or assets.',
    {
      strategyVols: z.record(z.string(), z.number().nonnegative())
        .describe('Map of strategy/asset names to their realized volatilities'),
    },
    async ({ strategyVols }) => {
      const sizer = getPositionSizer();
      const weights = sizer.riskParityWeights(strategyVols);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            weights,
            strategyCount: Object.keys(weights).length,
            inputVols: strategyVols,
          }, null, 2),
        }],
      };
    },
  );

  // ─── Tool: compute_portfolio_kelly ───────────────────────────────────
  server.tool(
    'compute_portfolio_kelly',
    'Multi-asset portfolio Kelly sizing with correlation-aware diversification. ' +
    'Reduces position sizes for correlated assets to control portfolio risk.',
    {
      positions: z.array(z.object({
        name: z.string().describe('Asset/strategy name'),
        kellyPct: z.number().min(0).max(1).describe('Individual Kelly percentage'),
        returns: z.array(z.number()).min(10).describe('Historical returns for correlation'),
      })).min(1).describe('Array of position candidates with returns'),
    },
    async ({ positions }) => {
      const sizer = getPositionSizer();
      const adjusted = sizer.portfolioKelly(positions);

      // Calculate total allocation
      const totalOriginal = positions.reduce((s, p) => s + p.kellyPct, 0);
      const totalAdjusted = Object.values(adjusted).reduce((s, v) => s + v, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            adjustedPositions: adjusted,
            totalOriginalAllocation: Math.round(totalOriginal * 10000) / 10000,
            totalAdjustedAllocation: Math.round(totalAdjusted * 10000) / 10000,
            diversificationBenefit: Math.round((1 - totalAdjusted / totalOriginal) * 10000) / 100,
          }, null, 2),
        }],
      };
    },
  );

  // ─── Tool: run_pairs_backtest ─────────────────────────────────────────
  server.tool(
    'run_pairs_backtest',
    'Run a pairs trading backtest on two cointegrated assets. Tests spread mean-reversion ' +
    'with z-score entry/exit, ADF stationarity checks, and two-legged position tracking.',
    {
      closesA: z.array(z.number()).min(60).describe('Closing prices for asset A (minimum 60)'),
      closesB: z.array(z.number()).min(60).describe('Closing prices for asset B (minimum 60)'),
      symbolA: z.string().optional().describe('Symbol name for asset A'),
      symbolB: z.string().optional().describe('Symbol name for asset B'),
      initialBalance: z.number().positive().optional().describe('Starting balance (default 100000)'),
      maxPositionPct: z.number().min(0.01).max(0.50).optional().describe('Max position size as portfolio fraction'),
      entryZScore: z.number().positive().optional().describe('Z-score entry threshold (default 2.0)'),
      exitZScore: z.number().positive().optional().describe('Z-score exit threshold (default 0.5)'),
      lookback: z.number().int().positive().optional().describe('Lookback period for signals (default 60)'),
    },
    async ({ closesA, closesB, symbolA = 'A', symbolB = 'B', initialBalance = 100000,
             maxPositionPct = 0.10, entryZScore, exitZScore, lookback = 60 }) => {
      const strategyConfig = {};
      if (entryZScore) strategyConfig.entryZScore = entryZScore;
      if (exitZScore) strategyConfig.exitZScore = exitZScore;

      const bt = new PairsBacktester({
        initialBalance,
        maxPositionPct,
        strategyConfig,
      });

      const result = bt.run(closesA, closesB, { symbolA, symbolB, lookback });

      if (result.error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: result.error }) }] };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            symbolA: result.symbolA,
            symbolB: result.symbolB,
            dataPoints: result.dataPoints,
            initialBalance: result.initialBalance,
            finalBalance: result.finalBalance,
            totalPnl: result.totalPnl,
            totalReturn: result.totalReturn,
            totalTrades: result.totalTrades,
            wins: result.wins,
            losses: result.losses,
            winRate: result.winRate,
            profitFactor: result.profitFactor,
            maxDrawdown: result.maxDrawdown,
            sharpeRatio: result.sharpeRatio,
            sortinoRatio: result.sortinoRatio,
            avgDurationBars: result.avgDurationBars,
            exitReasons: result.exitReasons,
          }, null, 2),
        }],
      };
    },
  );

  // ─── Tool: run_walk_forward ─────────────────────────────────────────
  server.tool(
    'run_walk_forward',
    'Run walk-forward ML evaluation on OHLCV candle data. Trains neural net on expanding windows, ' +
    'compares ML-ensemble vs rules-only, Bollinger bounce, and momentum baselines. ' +
    'Returns Sharpe ratios, win rates, and strategy comparison.',
    {
      candles: z.array(CandleSchema).min(200).describe('OHLCV candle data (minimum 200 candles)'),
      initialBalance: z.number().positive().optional().describe('Starting balance (default 100000)'),
      retrainInterval: z.number().int().positive().optional().describe('Retrain model every N bars (default 60)'),
      mlWeight: z.number().min(0).max(1).optional().describe('ML signal weight in ensemble (default 0.3)'),
      slippageBps: z.number().nonnegative().optional().describe('Slippage in basis points (default 5)'),
      commissionBps: z.number().nonnegative().optional().describe('Commission in basis points (default 10)'),
    },
    async ({ candles, initialBalance = 100000, retrainInterval, mlWeight, slippageBps, commissionBps }) => {
      const config = {};
      if (retrainInterval) config.retrainInterval = retrainInterval;
      if (mlWeight !== undefined) config.mlWeight = mlWeight;
      if (slippageBps !== undefined) config.slippageBps = slippageBps;
      if (commissionBps !== undefined) config.commissionBps = commissionBps;

      const evaluator = new WalkForwardEvaluator(config);
      const result = evaluator.evaluate(candles, { initialBalance });

      if (result.error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: result.error }) }] };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            comparison: result.comparison,
            mlEnsemble: {
              name: result.mlEnsemble.name,
              totalReturn: result.mlEnsemble.totalReturn,
              sharpeRatio: result.mlEnsemble.sharpeRatio,
              sortinoRatio: result.mlEnsemble.sortinoRatio,
              maxDrawdown: result.mlEnsemble.maxDrawdown,
              totalTrades: result.mlEnsemble.totalTrades,
              winRate: result.mlEnsemble.winRate,
              profitFactor: result.mlEnsemble.profitFactor,
              executionCosts: result.mlEnsemble.executionCosts,
            },
            rulesOnlyEnsemble: {
              name: result.rulesOnlyEnsemble.name,
              totalReturn: result.rulesOnlyEnsemble.totalReturn,
              sharpeRatio: result.rulesOnlyEnsemble.sharpeRatio,
              maxDrawdown: result.rulesOnlyEnsemble.maxDrawdown,
              totalTrades: result.rulesOnlyEnsemble.totalTrades,
              winRate: result.rulesOnlyEnsemble.winRate,
            },
            bbConservative: {
              name: result.bbConservative.name,
              totalReturn: result.bbConservative.totalReturn,
              sharpeRatio: result.bbConservative.sharpeRatio,
              maxDrawdown: result.bbConservative.maxDrawdown,
              totalTrades: result.bbConservative.totalTrades,
              winRate: result.bbConservative.winRate,
            },
            momentum7d: {
              name: result.momentum7d.name,
              totalReturn: result.momentum7d.totalReturn,
              sharpeRatio: result.momentum7d.sharpeRatio,
              maxDrawdown: result.momentum7d.maxDrawdown,
              totalTrades: result.momentum7d.totalTrades,
              winRate: result.momentum7d.winRate,
            },
            candleCount: candles.length,
          }, null, 2),
        }],
      };
    },
  );

  // ─── Tool: analyze_multi_timeframe ────────────────────────────────────
  server.tool(
    'analyze_multi_timeframe',
    'Analyze trends across multiple timeframes from 1-minute candle data. ' +
    'Aggregates into 5m, 15m, 1h, 4h, 1d timeframes. Returns trend direction, strength, ' +
    'and hierarchical confirmation for signal filtering.',
    {
      candles1m: z.array(CandleSchema.extend({
        openTime: z.number().optional(),
        timestamp: z.number().optional(),
      })).min(60).describe('1-minute OHLCV candle data (minimum 60 candles)'),
      timeframes: z.array(z.enum(['5m', '15m', '1h', '4h', '1d'])).optional()
        .describe('Timeframes to analyze (default: all)'),
      confirmationMode: z.enum(['majority', 'strict', 'weighted']).optional()
        .describe('How to confirm signals across timeframes (default: majority)'),
      signal: z.object({
        action: z.enum(['BUY', 'SELL', 'HOLD']),
        confidence: z.number().min(0).max(1),
      }).optional().describe('Optional signal to confirm against higher timeframes'),
    },
    async ({ candles1m, timeframes, confirmationMode, signal }) => {
      const config = {};
      if (timeframes) config.timeframes = timeframes;
      if (confirmationMode) config.confirmationMode = confirmationMode;

      const analyzer = new MultiTimeframeAnalyzer(config);

      if (signal) {
        const confirmation = analyzer.confirmSignal(signal, candles1m);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              confirmed: confirmation.confirmed,
              adjustedConfidence: confirmation.adjustedConfidence,
              originalConfidence: confirmation.originalConfidence,
              alignment: confirmation.alignment,
              reason: confirmation.reason,
              trendSummary: confirmation.trendSummary,
            }, null, 2),
          }],
        };
      }

      const analysis = analyzer.analyze(candles1m);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            confirmation: analysis.confirmation,
            timeframeCount: analysis.timeframeCount,
            trends: analysis.trends,
          }, null, 2),
        }],
      };
    },
  );

  return server;
}

// CLI entry point: run as stdio server
export async function main() {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('tradingbot MCP server running on stdio');
}
