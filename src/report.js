#!/usr/bin/env node
// Strategy Performance Report Generator
// Runs all strategies through backtests on synthetic and/or historical data
// Outputs a comprehensive comparison report

import { MomentumStrategy } from './strategies/momentum.js';
import { MeanReversionStrategy } from './strategies/mean-reversion.js';
import { BollingerBounceStrategy } from './strategies/bollinger-bounce.js';
import { EnsembleStrategy } from './strategies/ensemble.js';
import { HybridStrategy } from './strategies/hybrid.js';
import { PairsTradingStrategy } from './strategies/pairs-trading.js';
import { PositionSizer } from './signals/position-sizer.js';
import { PaperTrader } from './paper-trading/index.js';
import { Backtester, computeMaxDrawdown, computeSharpeRatio } from './backtest/index.js';

// ── Synthetic Data Generators ──

function generateTrendingUp(n = 500, start = 100, dailyDrift = 0.002, vol = 0.02) {
  const closes = [start];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 + dailyDrift + (Math.random() - 0.5) * vol));
  }
  return closes;
}

function generateTrendingDown(n = 500, start = 100, dailyDrift = -0.002, vol = 0.02) {
  const closes = [start];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 + dailyDrift + (Math.random() - 0.5) * vol));
  }
  return closes;
}

function generateMeanReverting(n = 500, center = 100, amplitude = 8, period = 0.15) {
  return Array.from({ length: n }, (_, i) =>
    center + amplitude * Math.sin(i * period) + (Math.random() - 0.5) * 3
  );
}

function generateVolatileChoppy(n = 500, center = 100, vol = 0.04) {
  const closes = [center];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 + (Math.random() - 0.5) * vol));
  }
  return closes;
}

function generateRegimeSwitching(n = 500, start = 100) {
  const closes = [start];
  const phaseLen = Math.floor(n / 4);
  for (let i = 1; i < n; i++) {
    const phase = Math.floor(i / phaseLen);
    let drift, vol;
    if (phase === 0) { drift = 0.003; vol = 0.015; }       // Bull
    else if (phase === 1) { drift = 0; vol = 0.035; }       // Choppy
    else if (phase === 2) { drift = -0.002; vol = 0.025; }  // Bear
    else { drift = 0.001; vol = 0.02; }                     // Recovery
    closes.push(closes[i - 1] * (1 + drift + (Math.random() - 0.5) * vol));
  }
  return closes;
}

function generateCointegratedPair(n = 500, beta = 1.5, noiseScale = 0.5) {
  const b = [100];
  for (let i = 1; i < n; i++) {
    b.push(b[i - 1] * (1 + (Math.random() - 0.5) * 0.025));
  }
  const a = b.map(bi => 10 + beta * bi + (Math.random() - 0.5) * noiseScale);
  return { a, b };
}

function closesToCandles(closes) {
  return closes.map((close, i) => ({
    open: i > 0 ? closes[i - 1] : close,
    high: close * (1 + Math.random() * 0.01),
    low: close * (1 - Math.random() * 0.01),
    close,
    volume: 1000 + Math.random() * 5000,
    openTime: Date.now() - (closes.length - i) * 60000,
  }));
}

// ── Strategy Backtest Runner ──

function runStrategyBacktest(strategyName, strategy, closes, initialBalance = 100000) {
  const sizer = new PositionSizer({ maxPositionPct: 0.10, kellyFraction: 0.33 });
  const trader = new PaperTrader({ initialBalance });
  const equity = [initialBalance];
  const signals = [];
  const lookback = 60;

  for (let i = lookback; i < closes.length; i++) {
    const window = closes.slice(i - lookback, i + 1);
    const price = closes[i];
    let result;

    if (strategyName === 'pairs_trading') {
      // Pairs trading needs two series — skip in single-series mode
      result = { signal: 0, confidence: 0, action: 'HOLD', reasons: ['N/A'] };
    } else {
      result = strategy.generateSignal(window);
    }

    signals.push({ i, price, ...result });

    if (result.action === 'BUY' && result.confidence > 0.1) {
      const pos = trader.getPosition('SYM');
      if (!pos) {
        const sizing = sizer.calculate({
          portfolioValue: trader.portfolioValue,
          price,
          confidence: result.confidence,
          strategyName: strategyName,
        });
        if (sizing.qty > 0) trader.buy('SYM', sizing.qty, price);
      }
    } else if (result.action === 'SELL') {
      const pos = trader.getPosition('SYM');
      if (pos) trader.sell('SYM', pos.qty, price);
    }

    const pos = trader.getPosition('SYM');
    equity.push(trader.cash + (pos ? pos.qty * price : 0));
  }

  // Close remaining
  const finalPos = trader.getPosition('SYM');
  if (finalPos) trader.sell('SYM', finalPos.qty, closes[closes.length - 1]);

  const trades = trader.tradeHistory.filter(t => t.side === 'sell' && t.pnl !== undefined);
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  return {
    strategy: strategyName,
    totalReturn: ((trader.cash - initialBalance) / initialBalance * 100).toFixed(2),
    totalTrades: trades.length,
    winRate: trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : '0.0',
    avgWin: wins.length > 0 ? (wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(2) : '0.00',
    avgLoss: losses.length > 0 ? (Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length)).toFixed(2) : '0.00',
    sharpe: computeSharpeRatio(equity).toFixed(2),
    maxDrawdown: (computeMaxDrawdown(equity) * 100).toFixed(2),
    profitFactor: losses.length > 0
      ? (wins.reduce((s, t) => s + t.pnl, 0) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0))).toFixed(2)
      : wins.length > 0 ? 'Inf' : '0.00',
    finalEquity: trader.cash.toFixed(2),
  };
}

function runPairsBacktest(closesA, closesB, initialBalance = 100000) {
  const strategy = new PairsTradingStrategy({ minDataPoints: 60, entryZScore: 2.0 });
  const sizer = new PositionSizer({ maxPositionPct: 0.10, kellyFraction: 0.33 });
  const trader = new PaperTrader({ initialBalance });
  const equity = [initialBalance];
  const lookback = 80;

  const n = Math.min(closesA.length, closesB.length);
  const a = closesA.slice(-n);
  const b = closesB.slice(-n);

  for (let i = lookback; i < n; i++) {
    const windowA = a.slice(0, i + 1);
    const windowB = b.slice(0, i + 1);
    const priceA = a[i];

    const result = strategy.generateSignal(windowA, windowB);

    if (result.action === 'BUY' && result.confidence > 0.1) {
      const pos = trader.getPosition('PAIR');
      if (!pos) {
        const sizing = sizer.calculate({
          portfolioValue: trader.portfolioValue,
          price: priceA,
          confidence: result.confidence,
          strategyName: 'pairs_trading',
        });
        if (sizing.qty > 0) trader.buy('PAIR', sizing.qty, priceA);
      }
    } else if (result.action === 'SELL') {
      const pos = trader.getPosition('PAIR');
      if (pos) trader.sell('PAIR', pos.qty, priceA);
    }

    const pos = trader.getPosition('PAIR');
    equity.push(trader.cash + (pos ? pos.qty * priceA : 0));
  }

  const finalPos = trader.getPosition('PAIR');
  if (finalPos) trader.sell('PAIR', finalPos.qty, a[n - 1]);

  const trades = trader.tradeHistory.filter(t => t.side === 'sell' && t.pnl !== undefined);
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  return {
    strategy: 'pairs_trading',
    totalReturn: ((trader.cash - initialBalance) / initialBalance * 100).toFixed(2),
    totalTrades: trades.length,
    winRate: trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : '0.0',
    avgWin: wins.length > 0 ? (wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(2) : '0.00',
    avgLoss: losses.length > 0 ? (Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length)).toFixed(2) : '0.00',
    sharpe: computeSharpeRatio(equity).toFixed(2),
    maxDrawdown: (computeMaxDrawdown(equity) * 100).toFixed(2),
    profitFactor: losses.length > 0
      ? (wins.reduce((s, t) => s + t.pnl, 0) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0))).toFixed(2)
      : wins.length > 0 ? 'Inf' : '0.00',
    finalEquity: trader.cash.toFixed(2),
  };
}

// ── Kelly / Risk Analysis ──

function kellyAnalysis() {
  const sizer = new PositionSizer({ kellyFraction: 0.33 });

  const strategies = ['mean_reversion', 'momentum', 'pairs_trading', 'sentiment_momentum'];
  const regimes = ['bull_low_vol', 'bear_high_vol', 'range_bound', 'uncertain'];

  const rows = [];
  for (const strat of strategies) {
    const row = { strategy: strat };
    for (const regime of regimes) {
      row[regime] = (sizer.strategyKellySize(strat, regime) * 100).toFixed(2) + '%';
    }
    row.default = (sizer.strategyKellySize(strat) * 100).toFixed(2) + '%';
    rows.push(row);
  }
  return rows;
}

function riskParityAnalysis() {
  const sizer = new PositionSizer();
  return sizer.riskParityWeights({
    mean_reversion: 0.15,
    momentum: 0.30,
    pairs_trading: 0.17,
    sentiment_momentum: 0.25,
  });
}

// ── VaR/CVaR Analysis ──

function varAnalysis(closes) {
  const sizer = new PositionSizer();
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return {
    var95: sizer.calculateVaR(returns, 0.95),
    var99: sizer.calculateVaR(returns, 0.99),
    historicalVaR95: sizer.calculateHistoricalVaR(returns, 0.95),
    cvar95: sizer.calculateCVaR(returns, 0.95),
    cvar99: sizer.calculateCVaR(returns, 0.99),
  };
}

// ── Report Generation ──

export function generateReport() {
  const report = {
    timestamp: new Date().toISOString(),
    title: 'Trading Bot Strategy Performance Report',
  };

  console.log('\n' + '='.repeat(80));
  console.log('  TRADING BOT — FULL STRATEGY PERFORMANCE REPORT');
  console.log('  Generated:', report.timestamp);
  console.log('='.repeat(80));

  // ── Market Scenarios ──
  const scenarios = {
    'Bull Market (trending up)':    generateTrendingUp(500),
    'Bear Market (trending down)':  generateTrendingDown(500),
    'Mean-Reverting (oscillating)': generateMeanReverting(500),
    'Volatile Chop':                generateVolatileChoppy(500),
    'Regime Switching (4 phases)':  generateRegimeSwitching(500),
  };

  // ── Strategies ──
  const strategies = {
    momentum:         new MomentumStrategy({ lookback: 30 }),
    mean_reversion:   new MeanReversionStrategy({ entryZScore: 2.0 }),
    bollinger_bounce: new BollingerBounceStrategy(),
    ensemble:         new EnsembleStrategy(),
    hybrid:           new HybridStrategy(),
  };

  // ── Run all strategies across all scenarios ──
  console.log('\n' + '-'.repeat(80));
  console.log('  STRATEGY PERFORMANCE BY MARKET REGIME');
  console.log('-'.repeat(80));

  const allResults = {};

  for (const [scenarioName, closes] of Object.entries(scenarios)) {
    console.log(`\n>>> ${scenarioName} (${closes.length} bars)`);
    console.log('    ' + '-'.repeat(70));
    console.log(`    ${'Strategy'.padEnd(20)} ${'Return'.padStart(10)} ${'Trades'.padStart(8)} ${'Win%'.padStart(8)} ${'Sharpe'.padStart(8)} ${'MaxDD'.padStart(8)} ${'PF'.padStart(8)}`);
    console.log('    ' + '-'.repeat(70));

    for (const [name, strat] of Object.entries(strategies)) {
      const result = runStrategyBacktest(name, strat, closes);
      console.log(`    ${name.padEnd(20)} ${(result.totalReturn + '%').padStart(10)} ${result.totalTrades.toString().padStart(8)} ${(result.winRate + '%').padStart(8)} ${result.sharpe.padStart(8)} ${(result.maxDrawdown + '%').padStart(8)} ${result.profitFactor.padStart(8)}`);
      if (!allResults[name]) allResults[name] = [];
      allResults[name].push({ scenario: scenarioName, ...result });
    }
  }

  // ── Pairs Trading ──
  console.log('\n' + '-'.repeat(80));
  console.log('  PAIRS TRADING (Cointegrated Pair Backtest)');
  console.log('-'.repeat(80));

  const pair = generateCointegratedPair(500, 1.5, 0.5);
  const pairsResult = runPairsBacktest(pair.a, pair.b);
  console.log(`    ${'pairs_trading'.padEnd(20)} ${(pairsResult.totalReturn + '%').padStart(10)} ${pairsResult.totalTrades.toString().padStart(8)} ${(pairsResult.winRate + '%').padStart(8)} ${pairsResult.sharpe.padStart(8)} ${(pairsResult.maxDrawdown + '%').padStart(8)} ${pairsResult.profitFactor.padStart(8)}`);

  // ── Kelly Criterion Analysis ──
  console.log('\n' + '-'.repeat(80));
  console.log('  KELLY CRITERION — REGIME-ADJUSTED POSITION SIZING');
  console.log('-'.repeat(80));

  const kellyRows = kellyAnalysis();
  console.log(`    ${'Strategy'.padEnd(22)} ${'Bull'.padStart(10)} ${'Bear'.padStart(10)} ${'Range'.padStart(10)} ${'Uncertain'.padStart(10)} ${'Default'.padStart(10)}`);
  console.log('    ' + '-'.repeat(72));
  for (const row of kellyRows) {
    console.log(`    ${row.strategy.padEnd(22)} ${row.bull_low_vol.padStart(10)} ${row.bear_high_vol.padStart(10)} ${row.range_bound.padStart(10)} ${row.uncertain.padStart(10)} ${row.default.padStart(10)}`);
  }

  // ── Risk Parity ──
  console.log('\n' + '-'.repeat(80));
  console.log('  RISK PARITY ALLOCATION (Inverse-Volatility Weighted)');
  console.log('-'.repeat(80));

  const rpWeights = riskParityAnalysis();
  for (const [name, weight] of Object.entries(rpWeights)) {
    console.log(`    ${name.padEnd(25)} ${(weight * 100).toFixed(1)}%`);
  }

  // ── VaR / CVaR Analysis ──
  console.log('\n' + '-'.repeat(80));
  console.log('  VALUE AT RISK / CONDITIONAL VaR ANALYSIS');
  console.log('-'.repeat(80));

  for (const [scenarioName, closes] of Object.entries(scenarios)) {
    const risk = varAnalysis(closes);
    console.log(`  ${scenarioName}:`);
    console.log(`    VaR(95%):  ${(risk.var95 * 100).toFixed(3)}%   VaR(99%):  ${(risk.var99 * 100).toFixed(3)}%`);
    console.log(`    CVaR(95%): ${(risk.cvar95 * 100).toFixed(3)}%   CVaR(99%): ${(risk.cvar99 * 100).toFixed(3)}%`);
    console.log(`    Hist VaR(95%): ${(risk.historicalVaR95 * 100).toFixed(3)}%`);
  }

  // ── Backtester (built-in signal engine) ──
  console.log('\n' + '-'.repeat(80));
  console.log('  SIGNAL ENGINE BACKTEST (Full pipeline: RSI + MACD + BB + Sentiment)');
  console.log('-'.repeat(80));

  for (const [scenarioName, closes] of Object.entries(scenarios)) {
    const candles = closesToCandles(closes);
    const bt = new Backtester({ initialBalance: 100000, maxPositionPct: 0.10 });
    const result = bt.run('SYN', candles, { lookback: 30 });
    if (result.error) {
      console.log(`  ${scenarioName}: ${result.error}`);
    } else {
      console.log(`  ${scenarioName}: Return=${result.totalReturn}% Trades=${result.totalTrades} WinRate=${result.winRate}% Sharpe=${result.sharpeRatio} MaxDD=${result.maxDrawdown}%`);
    }
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(80));
  console.log('  SUMMARY');
  console.log('='.repeat(80));

  // Aggregate across scenarios for each strategy
  console.log(`\n  Average Performance Across All Market Regimes:`);
  console.log(`    ${'Strategy'.padEnd(20)} ${'Avg Return'.padStart(12)} ${'Avg Sharpe'.padStart(12)} ${'Avg MaxDD'.padStart(12)}`);
  console.log('    ' + '-'.repeat(56));

  for (const [name, results] of Object.entries(allResults)) {
    const avgReturn = results.reduce((s, r) => s + parseFloat(r.totalReturn), 0) / results.length;
    const avgSharpe = results.reduce((s, r) => s + parseFloat(r.sharpe), 0) / results.length;
    const avgDD = results.reduce((s, r) => s + parseFloat(r.maxDrawdown), 0) / results.length;
    console.log(`    ${name.padEnd(20)} ${(avgReturn.toFixed(2) + '%').padStart(12)} ${avgSharpe.toFixed(2).padStart(12)} ${(avgDD.toFixed(2) + '%').padStart(12)}`);
  }

  console.log('\n  Recommendation: Use ENSEMBLE strategy for all-regime deployment');
  console.log('  with regime-adjusted Kelly sizing (0.25x-0.50x) and CVaR constraints.');
  console.log('\n' + '='.repeat(80));

  return report;
}

// Run if executed directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('report.js') ||
  process.argv[1].endsWith('src/report.js')
);
if (isMain) {
  generateReport();
}
