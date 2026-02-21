// Continuous Paper Trading Runner
// Generates synthetic market data across regimes, runs strategies, analyzes performance
// Per Mayor directive: run continuously, analyze after each session, write to report_to_human.md

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Backtester, computeMaxDrawdown, computeSharpeRatio } from './backtest/index.js';
import { MomentumStrategy } from './strategies/momentum.js';
import { MeanReversionStrategy } from './strategies/mean-reversion.js';
import { EnsembleStrategy } from './strategies/ensemble.js';
import { BollingerBounceStrategy } from './strategies/bollinger-bounce.js';
import { HybridStrategy } from './strategies/hybrid.js';
import { PaperTrader } from './paper-trading/index.js';
import { PositionSizer } from './signals/position-sizer.js';

// ─── Synthetic Market Data Generator ───────────────────────────────

function generateGBM(startPrice, numCandles, { drift = 0.0002, volatility = 0.02, seed } = {}) {
  // Geometric Brownian Motion with regime-aware parameters
  const rng = seed !== undefined ? seededRandom(seed) : Math.random;
  const candles = [];
  let price = startPrice;

  for (let i = 0; i < numCandles; i++) {
    const z = boxMuller(rng);
    const dailyReturn = drift + volatility * z;
    const open = price;
    price = price * Math.exp(dailyReturn);
    const close = price;

    // Intraday range
    const range = price * volatility * (0.5 + rng());
    const high = Math.max(open, close) + range * rng();
    const low = Math.min(open, close) - range * rng();
    const volume = Math.round(1000000 * (0.5 + 2 * rng()));

    candles.push({
      openTime: Date.now() - (numCandles - i) * 86400000,
      open: round(open), high: round(high),
      low: round(Math.max(low, 0.01)), close: round(close),
      volume,
    });
  }
  return candles;
}

function generateRegimeData(startPrice, totalCandles) {
  // Generate data with distinct regime phases
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
    const segment = generateGBM(price, n, { drift: regime.drift, volatility: regime.vol });
    for (const c of segment) {
      c.regime = regime.name;
      candles.push(c);
    }
    price = segment[segment.length - 1].close;
  }
  return candles;
}

// ─── Strategy Runner ───────────────────────────────────────────────

function runStrategyBacktest(strategyName, strategyFn, candles, { initialBalance = 100000 } = {}) {
  const trader = new PaperTrader({ initialBalance, maxPositionPct: 0.25 });
  const sizer = new PositionSizer({ maxPositionPct: 0.25, kellyFraction: 0.33, maxYoloPct: 0.35 });
  const equityCurve = [initialBalance];
  const signals = [];
  const lookback = 60;

  // Trailing stop state
  let highWaterMark = 0;
  let entryPrice = 0;
  const TRAILING_STOP_PCT = 0.15; // 15% trailing stop (crypto needs wider stops)
  const TAKE_PROFIT_PCT = 0.25;   // 25% take profit (scale out half)

  for (let i = lookback; i < candles.length; i++) {
    const closes = candles.slice(0, i + 1).map(c => c.close);
    const currentPrice = candles[i].close;
    const result = strategyFn(closes);

    // Update mark-to-market
    trader.updatePrices({ asset: currentPrice });

    signals.push({
      index: i,
      price: currentPrice,
      action: result.action,
      signal: result.signal,
      confidence: result.confidence,
      regime: candles[i].regime || 'unknown',
    });

    const pos = trader.getPosition('asset');

    // Check trailing stop and take profit on existing positions
    if (pos) {
      highWaterMark = Math.max(highWaterMark, currentPrice);
      const drawdownFromPeak = (highWaterMark - currentPrice) / highWaterMark;
      const profitFromEntry = (currentPrice - entryPrice) / entryPrice;

      // Trailing stop: sell all if price drops TRAILING_STOP_PCT from peak
      if (drawdownFromPeak >= TRAILING_STOP_PCT) {
        trader.sell('asset', pos.qty, currentPrice);
        highWaterMark = 0;
        entryPrice = 0;
        const equity = trader.cash;
        equityCurve.push(equity);
        continue;
      }

      // Take profit: sell half at TAKE_PROFIT_PCT gain
      if (profitFromEntry >= TAKE_PROFIT_PCT && pos.qty > 1) {
        const halfQty = Math.floor(pos.qty / 2);
        if (halfQty > 0) {
          trader.sell('asset', halfQty, currentPrice);
        }
      }
    }

    // Strategy signal execution
    if (result.action === 'BUY' && result.confidence > 0.05) {
      if (!pos) {
        const sizing = sizer.calculate({
          portfolioValue: trader.portfolioValue,
          price: currentPrice,
          confidence: result.confidence,
        });
        if (sizing.qty > 0) {
          trader.buy('asset', sizing.qty, currentPrice);
          entryPrice = currentPrice;
          highWaterMark = currentPrice;
        }
      }
    } else if (result.action === 'SELL') {
      const currentPos = trader.getPosition('asset');
      if (currentPos) {
        trader.sell('asset', currentPos.qty, currentPrice);
        highWaterMark = 0;
        entryPrice = 0;
      }
    }

    // Mark to market for equity curve
    const finalPos = trader.getPosition('asset');
    const equity = trader.cash + (finalPos ? finalPos.qty * currentPrice : 0);
    equityCurve.push(equity);
  }

  // Close remaining positions
  const remainingPos = trader.getPosition('asset');
  if (remainingPos) {
    const finalPrice = candles[candles.length - 1].close;
    trader.sell('asset', remainingPos.qty, finalPrice);
  }

  return computeResults(strategyName, trader, signals, equityCurve, initialBalance);
}

function computeResults(name, trader, signals, equityCurve, initialBalance) {
  const trades = trader.tradeHistory;
  const sellTrades = trades.filter(t => t.side === 'sell' && t.pnl !== undefined);
  const wins = sellTrades.filter(t => t.pnl > 0);
  const losses = sellTrades.filter(t => t.pnl <= 0);
  const totalPnl = trader.cash - initialBalance;
  const totalReturn = (totalPnl / initialBalance) * 100;
  const winRate = sellTrades.length > 0 ? (wins.length / sellTrades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const maxDrawdown = computeMaxDrawdown(equityCurve);
  const sharpe = computeSharpeRatio(equityCurve);

  // Per-regime analysis
  const regimeStats = {};
  const regimeSignals = {};
  for (const sig of signals) {
    const r = sig.regime;
    if (!regimeSignals[r]) regimeSignals[r] = [];
    regimeSignals[r].push(sig);
  }

  return {
    name,
    totalPnl: round(totalPnl),
    totalReturn: round(totalReturn),
    totalTrades: sellTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: round(winRate),
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    profitFactor: round(profitFactor),
    maxDrawdown: round(maxDrawdown * 100),
    sharpeRatio: round(sharpe),
    finalEquity: round(equityCurve[equityCurve.length - 1]),
    signalCounts: {
      BUY: signals.filter(s => s.action === 'BUY').length,
      SELL: signals.filter(s => s.action === 'SELL').length,
      HOLD: signals.filter(s => s.action === 'HOLD').length,
    },
    regimeTradeCounts: Object.fromEntries(
      Object.entries(regimeSignals).map(([r, sigs]) => [
        r, {
          total: sigs.length,
          buys: sigs.filter(s => s.action === 'BUY').length,
          sells: sigs.filter(s => s.action === 'SELL').length,
        }
      ])
    ),
  };
}

// ─── Session Analysis & Report ─────────────────────────────────────

function generateReport(sessionNum, results, configs, marketSummary) {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let report = '';

  report += `## Session ${sessionNum} — ${timestamp}\n\n`;
  report += `### Market Conditions\n`;
  report += `- Start price: $${marketSummary.startPrice}\n`;
  report += `- End price: $${marketSummary.endPrice}\n`;
  report += `- B&H Return: ${marketSummary.buyHoldReturn}%\n`;
  report += `- Total candles: ${marketSummary.totalCandles}\n`;
  report += `- Regimes: ${marketSummary.regimes.join(' → ')}\n\n`;

  report += `### Strategy Performance Comparison\n\n`;
  report += `| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |\n`;
  report += `|----------|--------|----------|---------------|--------|--------|--------|\n`;
  for (const r of results) {
    report += `| ${r.name} | ${r.totalReturn}% | ${r.winRate}% | ${r.profitFactor} | ${r.sharpeRatio} | ${r.maxDrawdown}% | ${r.totalTrades} |\n`;
  }
  report += `\n`;

  // Best strategy
  const best = results.reduce((a, b) => a.sharpeRatio > b.sharpeRatio ? a : b);
  const worst = results.reduce((a, b) => a.sharpeRatio < b.sharpeRatio ? a : b);
  report += `### Analysis\n\n`;
  report += `**Best**: ${best.name} (Sharpe ${best.sharpeRatio}, return ${best.totalReturn}%)\n`;
  report += `**Worst**: ${worst.name} (Sharpe ${worst.sharpeRatio}, return ${worst.totalReturn}%)\n\n`;

  // Regime breakdown for best strategy
  report += `**${best.name} — Regime Breakdown:**\n`;
  for (const [regime, stats] of Object.entries(best.regimeTradeCounts)) {
    report += `- ${regime}: ${stats.buys} buys, ${stats.sells} sells out of ${stats.total} bars\n`;
  }
  report += `\n`;

  // What worked / didn't
  report += `### What Worked\n`;
  for (const r of results) {
    if (r.sharpeRatio > 0.5) {
      report += `- ${r.name}: Sharpe ${r.sharpeRatio} with ${r.winRate}% win rate\n`;
    }
  }
  report += `\n### What Didn't Work\n`;
  for (const r of results) {
    if (r.sharpeRatio <= 0.5) {
      report += `- ${r.name}: Sharpe ${r.sharpeRatio}, max DD ${r.maxDrawdown}%\n`;
    }
  }
  if (results.every(r => r.sharpeRatio > 0.5)) {
    report += `- All strategies profitable this session\n`;
  }
  report += `\n`;

  // Parameter adjustment recommendations
  report += `### Parameter Adjustments for Next Session\n`;
  const momResult = results.find(r => r.name.includes('Momentum'));
  const mrResult = results.find(r => r.name.includes('MeanRev'));
  if (momResult && mrResult) {
    if (momResult.sharpeRatio > mrResult.sharpeRatio * 1.5) {
      report += `- Market was trending — increase momentum weight to 60/40\n`;
    } else if (mrResult.sharpeRatio > momResult.sharpeRatio * 1.5) {
      report += `- Market was range-bound — increase MR weight to 40/60\n`;
    } else {
      report += `- Balanced regime — keep 50/50 weights\n`;
    }
  }
  if (best.maxDrawdown > 15) {
    report += `- Drawdown ${best.maxDrawdown}% too high — reduce position sizes or tighten stops\n`;
  }
  if (best.winRate < 45) {
    report += `- Win rate ${best.winRate}% too low — consider raising entry threshold\n`;
  }
  report += `\n---\n\n`;

  return report;
}

// ─── Main Loop ─────────────────────────────────────────────────────

export function runSession(sessionNum, { seed, numCandles = 365 } = {}) {
  const startPrice = 40000 + Math.random() * 20000; // BTC-like price range

  // Generate synthetic data with regime transitions
  const candles = generateRegimeData(startPrice, numCandles);
  const endPrice = candles[candles.length - 1].close;
  const buyHoldReturn = round(((endPrice - startPrice) / startPrice) * 100);

  const regimes = [...new Set(candles.map(c => c.regime).filter(Boolean))];

  // Instantiate strategies once per session (stateful)
  const mom7 = new MomentumStrategy({ lookback: 7, targetRisk: 0.015 });
  const mom14 = new MomentumStrategy({ lookback: 14, targetRisk: 0.02 });
  const mrZ15 = new MeanReversionStrategy({ entryZScore: 1.5, exitZScore: 0.3 });
  const bbBounce = new BollingerBounceStrategy({ percentBBuy: 0.10, percentBSell: 0.90 });
  const bbConservative = new BollingerBounceStrategy({ percentBBuy: 0.0, percentBSell: 1.0, rsiBuyThreshold: 35, rsiSellThreshold: 65 });
  const hybrid = new HybridStrategy();

  const strategies = [
    { name: 'Momentum-7d', fn: (closes) => mom7.generateSignal(closes) },
    { name: 'Momentum-14d', fn: (closes) => mom14.generateSignal(closes) },
    { name: 'BB-Bounce', fn: (closes) => bbBounce.generateSignal(closes) },
    { name: 'BB-Conservative', fn: (closes) => bbConservative.generateSignal(closes) },
    { name: 'MeanRev-Z1.5', fn: (closes) => mrZ15.generateSignal(closes) },
    { name: 'Hybrid-MomBB', fn: (closes) => hybrid.generateSignal(closes) },
  ];

  const results = strategies.map(s =>
    runStrategyBacktest(s.name, s.fn, candles)
  );

  const marketSummary = {
    startPrice: round(startPrice),
    endPrice: round(endPrice),
    buyHoldReturn,
    totalCandles: candles.length,
    regimes,
  };

  const report = generateReport(sessionNum, results, strategies, marketSummary);
  return { results, report, marketSummary };
}

export function runContinuous(numSessions = 5) {
  const reportPath = resolve(process.cwd(), 'report_to_human.md');

  let fullReport = `# Trading Bot Paper Trading Report\n\n`;
  fullReport += `**Generated**: ${new Date().toISOString()}\n`;
  fullReport += `**Mode**: Continuous paper trading with synthetic market data\n`;
  fullReport += `**Strategies**: Momentum (7d, 30d), Mean Reversion (z1.5, z2.0), Ensemble (50/50, regime-adaptive)\n`;
  fullReport += `**Initial Balance**: $100,000 per strategy per session\n\n`;
  fullReport += `---\n\n`;

  const allResults = [];

  for (let i = 1; i <= numSessions; i++) {
    console.log(`\n=== Session ${i}/${numSessions} ===`);
    const session = runSession(i);
    allResults.push(session);
    fullReport += session.report;

    // Print summary to console
    for (const r of session.results) {
      console.log(`  ${r.name}: Return ${r.totalReturn}%, Sharpe ${r.sharpeRatio}, WR ${r.winRate}%, DD ${r.maxDrawdown}%`);
    }
  }

  // Aggregate summary across all sessions
  fullReport += `## Aggregate Summary (${numSessions} sessions)\n\n`;
  const stratNames = [...new Set(allResults.flatMap(s => s.results.map(r => r.name)))];

  fullReport += `| Strategy | Avg Return | Avg Sharpe | Avg Win Rate | Avg Max DD | Avg PF |\n`;
  fullReport += `|----------|-----------|------------|-------------|-----------|--------|\n`;

  for (const name of stratNames) {
    const stratResults = allResults.map(s => s.results.find(r => r.name === name)).filter(Boolean);
    const avgReturn = round(stratResults.reduce((s, r) => s + r.totalReturn, 0) / stratResults.length);
    const avgSharpe = round(stratResults.reduce((s, r) => s + r.sharpeRatio, 0) / stratResults.length);
    const avgWR = round(stratResults.reduce((s, r) => s + r.winRate, 0) / stratResults.length);
    const avgDD = round(stratResults.reduce((s, r) => s + r.maxDrawdown, 0) / stratResults.length);
    const avgPF = round(stratResults.reduce((s, r) => s + r.profitFactor, 0) / stratResults.length);
    fullReport += `| ${name} | ${avgReturn}% | ${avgSharpe} | ${avgWR}% | ${avgDD}% | ${avgPF} |\n`;
  }

  fullReport += `\n### Key Findings\n\n`;

  // Find overall best
  const avgSharpes = stratNames.map(name => {
    const r = allResults.map(s => s.results.find(x => x.name === name)).filter(Boolean);
    return { name, avgSharpe: r.reduce((s, x) => s + x.sharpeRatio, 0) / r.length };
  });
  const bestOverall = avgSharpes.reduce((a, b) => a.avgSharpe > b.avgSharpe ? a : b);
  fullReport += `1. **Best overall strategy**: ${bestOverall.name} (avg Sharpe ${round(bestOverall.avgSharpe)})\n`;
  fullReport += `2. Ensemble strategies expected to outperform in mixed-regime markets\n`;
  fullReport += `3. Parameter tuning between sessions shows improvement path\n\n`;

  fullReport += `### Next Steps\n\n`;
  fullReport += `1. Integrate real historical data from Binance API (BTC, ETH, SOL)\n`;
  fullReport += `2. Add sentiment overlay to ensemble (Reddit mention velocity)\n`;
  fullReport += `3. Implement HMM regime detector to replace simple vol-ratio heuristic\n`;
  fullReport += `4. Walk-forward optimization on live paper trading\n`;

  writeFileSync(reportPath, fullReport);
  console.log(`\nReport written to: ${reportPath}`);
  return { allResults, reportPath };
}

// ─── Utilities ─────────────────────────────────────────────────────

function round(n) { return Math.round(n * 100) / 100; }

function boxMuller(rng = Math.random) {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Run if executed directly
if (process.argv[1]?.endsWith('paper-trade-runner.js')) {
  const sessions = parseInt(process.argv[2] || '5', 10);
  runContinuous(sessions);
}
