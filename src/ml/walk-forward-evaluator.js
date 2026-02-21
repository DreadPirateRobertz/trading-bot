// Walk-Forward ML Training & Backtest Evaluator
// Trains [10->16->8->3] neural net on expanding windows of OHLCV data
// Evaluates Sharpe ratio of ML-enhanced ensemble vs rule-only baselines
// Target: beat BB-Conservative Sharpe 0.64

import { NeuralNetwork } from './model.js';
import { extractFeatures, generateTrainingData, NUM_FEATURES, NUM_CLASSES } from './features.js';
import { GaussianHMM } from './hmm.js';
import { EnsembleStrategy } from '../strategies/ensemble.js';
import { BollingerBounceStrategy } from '../strategies/bollinger-bounce.js';
import { MomentumStrategy } from '../strategies/momentum.js';
import { PaperTrader } from '../paper-trading/index.js';
import { PositionSizer } from '../signals/position-sizer.js';
import { computeMaxDrawdown, computeSharpeRatio, computeSortinoRatio, computeCalmarRatio, ExecutionModel } from '../backtest/index.js';

// Walk-forward training: expanding window, retrain every `retrainInterval` bars
export class WalkForwardEvaluator {
  constructor({
    layers = [NUM_FEATURES, 16, 8, NUM_CLASSES],
    learningRate = 0.01,
    epochs = 80,
    horizon = 5,
    buyThreshold = 0.02,
    sellThreshold = -0.02,
    lookback = 30,
    retrainInterval = 60,  // retrain model every N bars
    minTrainSamples = 100, // minimum samples before first training
    mlWeight = 0.3,
    useHMM = true,
    slippageBps = 5,    // execution cost: slippage in basis points
    commissionBps = 10, // execution cost: commission in basis points
  } = {}) {
    this.config = {
      layers, learningRate, epochs, horizon,
      buyThreshold, sellThreshold, lookback,
      retrainInterval, minTrainSamples, mlWeight, useHMM,
      slippageBps, commissionBps,
    };
  }

  // Run walk-forward evaluation on candle data
  // Returns { mlEnsemble, bbConservative, momentum7d, rulesOnlyEnsemble, comparison }
  evaluate(candles, { initialBalance = 100000 } = {}) {
    const cfg = this.config;
    const warmup = Math.max(cfg.lookback + 26, 60); // need enough data for features + indicators

    if (candles.length < warmup + cfg.minTrainSamples + cfg.horizon) {
      return { error: `Need at least ${warmup + cfg.minTrainSamples + cfg.horizon} candles` };
    }

    // Train HMM on full data for regime detection
    let hmm = null;
    if (cfg.useHMM) {
      hmm = new GaussianHMM();
      const hmmObs = GaussianHMM.extractObservations(candles, { volWindow: 20 });
      if (hmmObs.length >= 50) {
        hmm.fit(hmmObs);
      }
    }

    // Run all strategies through same candle data
    const mlResult = this._runMLEnsemble(candles, hmm, initialBalance);
    const rulesResult = this._runRulesEnsemble(candles, hmm, initialBalance);
    const bbResult = this._runBBConservative(candles, initialBalance);
    const momResult = this._runMomentum7d(candles, initialBalance);

    const comparison = {
      mlEnsembleSharpe: mlResult.sharpeRatio,
      rulesEnsembleSharpe: rulesResult.sharpeRatio,
      bbConservativeSharpe: bbResult.sharpeRatio,
      momentum7dSharpe: momResult.sharpeRatio,
      mlBeatsBB: mlResult.sharpeRatio > bbResult.sharpeRatio,
      mlBeatsMom: mlResult.sharpeRatio > momResult.sharpeRatio,
      mlBeatsRules: mlResult.sharpeRatio > rulesResult.sharpeRatio,
      mlImprovement: rulesResult.sharpeRatio !== 0
        ? ((mlResult.sharpeRatio - rulesResult.sharpeRatio) / Math.abs(rulesResult.sharpeRatio) * 100)
        : 0,
    };

    return {
      mlEnsemble: mlResult,
      rulesOnlyEnsemble: rulesResult,
      bbConservative: bbResult,
      momentum7d: momResult,
      comparison,
      hmm: hmm ? {
        trained: hmm.trained,
        states: hmm.states,
        transitionMatrix: hmm.A.map(row => row.map(v => Math.round(v * 100) / 100)),
      } : null,
    };
  }

  _makeExecModel() {
    const cfg = this.config;
    if (cfg.slippageBps === 0 && cfg.commissionBps === 0) return null;
    return new ExecutionModel({ slippageBps: cfg.slippageBps, commissionBps: cfg.commissionBps });
  }

  // Apply execution costs to a buy trade
  _execBuy(trader, symbol, qty, price, execModel) {
    if (!execModel) {
      trader.buy(symbol, qty, price);
      return;
    }
    const execPrice = execModel.getExecutionPrice('buy', price, { qty });
    const commission = execModel.getCommission(execPrice, qty);
    trader.buy(symbol, qty, execPrice);
    if (commission > 0) trader.cash -= commission;
  }

  // Apply execution costs to a sell trade
  _execSell(trader, symbol, qty, price, execModel) {
    if (!execModel) {
      trader.sell(symbol, qty, price);
      return;
    }
    const execPrice = execModel.getExecutionPrice('sell', price, { qty });
    const commission = execModel.getCommission(execPrice, qty);
    trader.sell(symbol, qty, execPrice);
    if (commission > 0) trader.cash -= commission;
  }

  // ML-enhanced ensemble with walk-forward retraining
  _runMLEnsemble(candles, hmm, initialBalance) {
    const cfg = this.config;
    const trader = new PaperTrader({ initialBalance, maxPositionPct: 0.25 });
    const sizer = new PositionSizer({ maxPositionPct: 0.25, kellyFraction: 0.33 });
    const execModel = this._makeExecModel();
    const equityCurve = [initialBalance];
    const lookback = Math.max(cfg.lookback + 26, 60);
    let model = null;
    let lastTrainBar = 0;
    let trainCount = 0;
    let highWaterMark = 0;
    let entryPrice = 0;

    for (let i = lookback; i < candles.length; i++) {
      const currentPrice = candles[i].close;
      trader.updatePrices({ asset: currentPrice });

      // Walk-forward: retrain model periodically on all data up to current bar
      const trainCandles = candles.slice(0, i - cfg.horizon); // no lookahead
      if (trainCandles.length >= lookback + cfg.minTrainSamples &&
          (model === null || i - lastTrainBar >= cfg.retrainInterval)) {
        model = this._trainModel(trainCandles);
        lastTrainBar = i;
        trainCount++;
      }

      // Generate ML-enhanced ensemble signal
      const closes = candles.slice(0, i + 1).map(c => c.close);
      const windowCandles = candles.slice(Math.max(0, i - lookback), i + 1);

      // Detect regime via HMM if available
      let regime = null;
      if (hmm && hmm.trained) {
        const hmmObs = GaussianHMM.extractObservations(candles.slice(0, i + 1), { volWindow: 20 });
        if (hmmObs.length > 0) {
          const regimeInfo = hmm.currentRegime(hmmObs);
          regime = regimeInfo.regime;
        }
      }

      // Dynamic ML weight: increase when model is confident, decrease in high-vol regimes
      let dynamicMLWeight = cfg.mlWeight;
      if (regime === 'high_vol' || regime === 'bear') {
        dynamicMLWeight = cfg.mlWeight * 0.5; // halve ML influence in volatile/bear regimes
      }

      const ensemble = new EnsembleStrategy({
        momentumConfig: { lookback: 7, targetRisk: 0.015 },
        meanReversionConfig: { entryZScore: 1.5, exitZScore: 0.3 },
        mlModel: model,
        mlFeatureExtractor: extractFeatures,
        mlWeight: dynamicMLWeight,
        hmmDetector: hmm,
      });

      const signal = ensemble.generateSignal(closes, windowCandles);

      // Override regime if HMM provides one
      const effectiveRegime = regime || signal.regime;

      // Position management with trailing stop
      const pos = trader.getPosition('asset');
      if (pos) {
        highWaterMark = Math.max(highWaterMark, currentPrice);
        const drawdownFromPeak = (highWaterMark - currentPrice) / highWaterMark;
        if (drawdownFromPeak >= 0.15) {
          this._execSell(trader, 'asset', pos.qty, currentPrice, execModel);
          highWaterMark = 0;
          entryPrice = 0;
          equityCurve.push(trader.cash);
          continue;
        }
        // Take profit at 25%
        const profitFromEntry = (currentPrice - entryPrice) / entryPrice;
        if (profitFromEntry >= 0.25 && pos.qty > 1) {
          const halfQty = Math.floor(pos.qty / 2);
          if (halfQty > 0) this._execSell(trader, 'asset', halfQty, currentPrice, execModel);
        }
      }

      // Execute signal
      if (signal.action === 'BUY' && signal.confidence > 0.05 && !trader.getPosition('asset')) {
        const sizing = sizer.calculate({
          portfolioValue: trader.portfolioValue,
          price: currentPrice,
          confidence: signal.confidence,
        });
        if (sizing.qty > 0) {
          this._execBuy(trader, 'asset', sizing.qty, currentPrice, execModel);
          entryPrice = currentPrice;
          highWaterMark = currentPrice;
        }
      } else if (signal.action === 'SELL') {
        const currentPos = trader.getPosition('asset');
        if (currentPos) {
          this._execSell(trader, 'asset', currentPos.qty, currentPrice, execModel);
          highWaterMark = 0;
          entryPrice = 0;
        }
      }

      const finalPos = trader.getPosition('asset');
      const equity = trader.cash + (finalPos ? finalPos.qty * currentPrice : 0);
      equityCurve.push(equity);
    }

    // Close remaining
    const remainingPos = trader.getPosition('asset');
    if (remainingPos) {
      this._execSell(trader, 'asset', remainingPos.qty, candles[candles.length - 1].close, execModel);
    }

    return this._computeResults('ML-Ensemble', trader, equityCurve, initialBalance, {
      trainCount,
      executionCosts: execModel ? round(execModel.totalSlippagePaid + execModel.totalCommissionPaid) : 0,
    });
  }

  // Rules-only ensemble (no ML, but with HMM if available)
  _runRulesEnsemble(candles, hmm, initialBalance) {
    const trader = new PaperTrader({ initialBalance, maxPositionPct: 0.25 });
    const sizer = new PositionSizer({ maxPositionPct: 0.25, kellyFraction: 0.33 });
    const execModel = this._makeExecModel();
    const equityCurve = [initialBalance];
    const lookback = 60;
    let highWaterMark = 0;
    let entryPrice = 0;

    const ensemble = new EnsembleStrategy({
      momentumConfig: { lookback: 7, targetRisk: 0.015 },
      meanReversionConfig: { entryZScore: 1.5, exitZScore: 0.3 },
    });

    for (let i = lookback; i < candles.length; i++) {
      const currentPrice = candles[i].close;
      trader.updatePrices({ asset: currentPrice });

      const closes = candles.slice(0, i + 1).map(c => c.close);
      const signal = ensemble.generateSignal(closes);

      const pos = trader.getPosition('asset');
      if (pos) {
        highWaterMark = Math.max(highWaterMark, currentPrice);
        if ((highWaterMark - currentPrice) / highWaterMark >= 0.15) {
          this._execSell(trader, 'asset', pos.qty, currentPrice, execModel);
          highWaterMark = 0;
          entryPrice = 0;
          equityCurve.push(trader.cash);
          continue;
        }
        if (entryPrice > 0 && (currentPrice - entryPrice) / entryPrice >= 0.25 && pos.qty > 1) {
          const halfQty = Math.floor(pos.qty / 2);
          if (halfQty > 0) this._execSell(trader, 'asset', halfQty, currentPrice, execModel);
        }
      }

      if (signal.action === 'BUY' && signal.confidence > 0.05 && !trader.getPosition('asset')) {
        const sizing = sizer.calculate({
          portfolioValue: trader.portfolioValue,
          price: currentPrice,
          confidence: signal.confidence,
        });
        if (sizing.qty > 0) {
          this._execBuy(trader, 'asset', sizing.qty, currentPrice, execModel);
          entryPrice = currentPrice;
          highWaterMark = currentPrice;
        }
      } else if (signal.action === 'SELL') {
        const currentPos = trader.getPosition('asset');
        if (currentPos) {
          this._execSell(trader, 'asset', currentPos.qty, currentPrice, execModel);
          highWaterMark = 0;
          entryPrice = 0;
        }
      }

      const finalPos = trader.getPosition('asset');
      equityCurve.push(trader.cash + (finalPos ? finalPos.qty * currentPrice : 0));
    }

    const remainingPos = trader.getPosition('asset');
    if (remainingPos) this._execSell(trader, 'asset', remainingPos.qty, candles[candles.length - 1].close, execModel);

    return this._computeResults('Rules-Ensemble', trader, equityCurve, initialBalance, {
      executionCosts: execModel ? round(execModel.totalSlippagePaid + execModel.totalCommissionPaid) : 0,
    });
  }

  // BB-Conservative baseline (the 0.64 Sharpe target)
  _runBBConservative(candles, initialBalance) {
    const bb = new BollingerBounceStrategy({
      percentBBuy: 0.0, percentBSell: 1.0,
      rsiBuyThreshold: 35, rsiSellThreshold: 65,
    });
    return this._runSingleStrategy('BB-Conservative', bb, candles, initialBalance);
  }

  // Momentum-7d baseline
  _runMomentum7d(candles, initialBalance) {
    const mom = new MomentumStrategy({ lookback: 7, targetRisk: 0.015 });
    return this._runSingleStrategy('Momentum-7d', mom, candles, initialBalance);
  }

  _runSingleStrategy(name, strategy, candles, initialBalance) {
    const trader = new PaperTrader({ initialBalance, maxPositionPct: 0.25 });
    const sizer = new PositionSizer({ maxPositionPct: 0.25, kellyFraction: 0.33 });
    const execModel = this._makeExecModel();
    const equityCurve = [initialBalance];
    const lookback = 60;
    let highWaterMark = 0;
    let entryPrice = 0;

    for (let i = lookback; i < candles.length; i++) {
      const closes = candles.slice(0, i + 1).map(c => c.close);
      const currentPrice = candles[i].close;
      trader.updatePrices({ asset: currentPrice });

      const signal = strategy.generateSignal(closes);

      const pos = trader.getPosition('asset');
      if (pos) {
        highWaterMark = Math.max(highWaterMark, currentPrice);
        if ((highWaterMark - currentPrice) / highWaterMark >= 0.15) {
          this._execSell(trader, 'asset', pos.qty, currentPrice, execModel);
          highWaterMark = 0;
          entryPrice = 0;
          equityCurve.push(trader.cash);
          continue;
        }
        if (entryPrice > 0 && (currentPrice - entryPrice) / entryPrice >= 0.25 && pos.qty > 1) {
          const halfQty = Math.floor(pos.qty / 2);
          if (halfQty > 0) this._execSell(trader, 'asset', halfQty, currentPrice, execModel);
        }
      }

      if (signal.action === 'BUY' && signal.confidence > 0.05 && !trader.getPosition('asset')) {
        const sizing = sizer.calculate({
          portfolioValue: trader.portfolioValue,
          price: currentPrice,
          confidence: signal.confidence,
        });
        if (sizing.qty > 0) {
          this._execBuy(trader, 'asset', sizing.qty, currentPrice, execModel);
          entryPrice = currentPrice;
          highWaterMark = currentPrice;
        }
      } else if (signal.action === 'SELL') {
        const currentPos = trader.getPosition('asset');
        if (currentPos) {
          this._execSell(trader, 'asset', currentPos.qty, currentPrice, execModel);
          highWaterMark = 0;
          entryPrice = 0;
        }
      }

      const finalPos = trader.getPosition('asset');
      equityCurve.push(trader.cash + (finalPos ? finalPos.qty * currentPrice : 0));
    }

    const remainingPos = trader.getPosition('asset');
    if (remainingPos) this._execSell(trader, 'asset', remainingPos.qty, candles[candles.length - 1].close, execModel);

    return this._computeResults(name, trader, equityCurve, initialBalance, {
      executionCosts: execModel ? round(execModel.totalSlippagePaid + execModel.totalCommissionPaid) : 0,
    });
  }

  _trainModel(candles) {
    const cfg = this.config;
    const data = generateTrainingData(candles, {
      lookback: cfg.lookback,
      horizon: cfg.horizon,
      buyThreshold: cfg.buyThreshold,
      sellThreshold: cfg.sellThreshold,
    });

    if (data.length < 20) return null;

    // Train with learning rate decay: start high, decay to retain generalization
    const model = new NeuralNetwork({
      layers: cfg.layers,
      learningRate: cfg.learningRate,
    });

    // Phase 1: aggressive learning
    const phase1Epochs = Math.floor(cfg.epochs * 0.6);
    const phase2Epochs = cfg.epochs - phase1Epochs;
    model.trainBalanced(data, { epochs: phase1Epochs, shuffle: true });

    // Phase 2: fine-tuning with lower LR
    model.learningRate = cfg.learningRate * 0.3;
    model.trainBalanced(data, { epochs: phase2Epochs, shuffle: true });

    // Restore LR for next retrain cycle
    model.learningRate = cfg.learningRate;
    return model;
  }

  _computeResults(name, trader, equityCurve, initialBalance, extra = {}) {
    const trades = trader.tradeHistory;
    const sellTrades = trades.filter(t => t.side === 'sell' && t.pnl !== undefined);
    const wins = sellTrades.filter(t => t.pnl > 0);
    const losses = sellTrades.filter(t => t.pnl <= 0);
    const totalPnl = trader.cash - initialBalance;
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

    return {
      name,
      totalReturn: round((totalPnl / initialBalance) * 100),
      sharpeRatio: round(computeSharpeRatio(equityCurve)),
      sortinoRatio: round(computeSortinoRatio(equityCurve)),
      calmarRatio: round(computeCalmarRatio(equityCurve)),
      maxDrawdown: round(computeMaxDrawdown(equityCurve) * 100),
      totalTrades: sellTrades.length,
      winRate: round(sellTrades.length > 0 ? (wins.length / sellTrades.length) * 100 : 0),
      profitFactor: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0),
      finalEquity: round(equityCurve[equityCurve.length - 1]),
      ...extra,
    };
  }
}

// Run multiple evaluation sessions and aggregate
export function runMultiSessionEvaluation({
  sessions = 10,
  candlesPerSession = 500,
  config = {},
} = {}) {
  const evaluator = new WalkForwardEvaluator(config);
  const results = [];

  for (let s = 0; s < sessions; s++) {
    const candles = generateRegimeData(40000 + Math.random() * 20000, candlesPerSession);
    const result = evaluator.evaluate(candles);
    if (!result.error) results.push(result);
  }

  if (results.length === 0) return { error: 'No valid sessions' };

  // Aggregate
  const strategies = ['mlEnsemble', 'rulesOnlyEnsemble', 'bbConservative', 'momentum7d'];
  const agg = {};
  for (const key of strategies) {
    const sharpes = results.map(r => r[key].sharpeRatio);
    const returns = results.map(r => r[key].totalReturn);
    const dds = results.map(r => r[key].maxDrawdown);
    agg[key] = {
      avgSharpe: round(avg(sharpes)),
      medianSharpe: round(median(sharpes)),
      avgReturn: round(avg(returns)),
      avgMaxDD: round(avg(dds)),
      minSharpe: round(Math.min(...sharpes)),
      maxSharpe: round(Math.max(...sharpes)),
    };
  }

  const mlWins = results.filter(r => r.comparison.mlBeatsBB).length;

  return {
    sessions: results.length,
    aggregate: agg,
    mlBeatsBBRate: round((mlWins / results.length) * 100),
    perSession: results.map((r, i) => ({
      session: i + 1,
      mlSharpe: r.mlEnsemble.sharpeRatio,
      bbSharpe: r.bbConservative.sharpeRatio,
      mlBeatsBB: r.comparison.mlBeatsBB,
    })),
  };
}

// Synthetic data generator (regime-aware GBM)
function generateRegimeData(startPrice, totalCandles) {
  const candles = [];
  let price = startPrice;
  const regimes = [
    { name: 'bull_trend', drift: 0.003, vol: 0.015, duration: 0.25 },
    { name: 'high_vol', drift: -0.001, vol: 0.04, duration: 0.2 },
    { name: 'range_bound', drift: 0.0001, vol: 0.01, duration: 0.25 },
    { name: 'bear_trend', drift: -0.002, vol: 0.025, duration: 0.15 },
    { name: 'recovery', drift: 0.002, vol: 0.02, duration: 0.15 },
  ];

  for (const regime of regimes) {
    const n = Math.round(totalCandles * regime.duration);
    for (let j = 0; j < n; j++) {
      const z = boxMuller();
      const ret = regime.drift + regime.vol * z;
      const open = price;
      price = price * Math.exp(ret);
      const range = price * regime.vol * (0.5 + Math.random());
      candles.push({
        openTime: Date.now() - (totalCandles - candles.length) * 86400000,
        open: round(open),
        high: round(Math.max(open, price) + range * Math.random()),
        low: round(Math.max(Math.min(open, price) - range * Math.random(), 0.01)),
        close: round(price),
        volume: Math.round(1000000 * (0.5 + 2 * Math.random())),
        regime: regime.name,
      });
    }
  }
  return candles;
}

function boxMuller() {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
}

function round(n) { return Math.round(n * 100) / 100; }
function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export { generateRegimeData };
