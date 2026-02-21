#!/usr/bin/env node
// Strategy Comparison Script
// Runs backtests across multiple strategies and market regimes
// Output: strategy_backtest_results.md

import { Backtester } from '../src/backtest/index.js';
import { SignalEngine } from '../src/signals/engine.js';
import { Trainer, MLSignalEnhancer } from '../src/ml/trainer.js';

// Generate synthetic candle data with realistic market behavior
function generateMarketData(n, regime, seed = 42) {
  // Simple seeded random for reproducibility
  let s = seed;
  const rand = () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };

  const candles = [];
  let price = 100;

  for (let i = 0; i < n; i++) {
    let change;
    switch (regime) {
      case 'bull':
        change = 0.15 + (rand() - 0.4) * 2;
        break;
      case 'bear':
        change = -0.15 + (rand() - 0.6) * 2;
        break;
      case 'sideways':
        change = (100 - price) * 0.03 + (rand() - 0.5) * 1.5;
        break;
      case 'volatile':
        change = (rand() - 0.5) * 6;
        break;
      case 'mixed': {
        const phase = Math.floor(i / 100) % 4;
        if (phase === 0) change = 0.15 + (rand() - 0.4) * 2;
        else if (phase === 1) change = (100 - price) * 0.02 + (rand() - 0.5) * 1.5;
        else if (phase === 2) change = -0.15 + (rand() - 0.6) * 2;
        else change = (rand() - 0.5) * 4;
        break;
      }
    }

    price = Math.max(price + change, 5);
    const vol = regime === 'volatile' ? 3 : 1.5;
    candles.push({
      open: price - change / 2,
      high: price + rand() * vol + 0.3,
      low: Math.max(price - rand() * vol - 0.3, 1),
      close: price,
      volume: 1000 + rand() * 5000,
      openTime: Date.now() - (n - i) * 60000,
    });
  }
  return candles;
}

// Generate sentiment aligned with candles
function generateSentiment(candles, accuracy = 0.6) {
  let s = 123;
  const rand = () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };

  return candles.map((c, i) => {
    if (i < 5) return { timestamp: c.openTime, classification: 'neutral', score: 0 };
    const ret5 = (c.close - candles[i - 5].close) / candles[i - 5].close;
    const correct = rand() < accuracy;
    let classification, score;

    if (correct) {
      if (ret5 > 0.02) { classification = 'bullish'; score = 2; }
      else if (ret5 < -0.02) { classification = 'bearish'; score = -2; }
      else { classification = 'neutral'; score = 0; }
    } else {
      // Noisy sentiment
      classification = rand() > 0.5 ? 'bullish' : 'bearish';
      score = classification === 'bullish' ? 1 : -1;
    }
    return { timestamp: c.openTime, classification, score };
  });
}

// Run all strategy comparisons
function runComparison() {
  const regimes = ['bull', 'bear', 'sideways', 'volatile', 'mixed'];
  const candleCount = 500;
  const results = {};

  console.log('=== STRATEGY BACKTEST COMPARISON ===\n');

  for (const regime of regimes) {
    console.log(`\n--- ${regime.toUpperCase()} MARKET ---`);
    const candles = generateMarketData(candleCount, regime);
    const sentiment = generateSentiment(candles);
    results[regime] = {};

    // 1. Pure Technical (default signal engine)
    const techBacktester = new Backtester({ initialBalance: 100000 });
    const techResult = techBacktester.run('SYN', candles, { lookback: 30 });
    results[regime].technical = techResult;
    console.log(`  Technical: Return=${techResult.totalReturn}%, Sharpe=${techResult.sharpeRatio}, MaxDD=${techResult.maxDrawdown}%, WinRate=${techResult.winRate}%`);

    // 2. Pure Sentiment (build sentiment-only signal engine)
    const sentBacktester = new Backtester({ initialBalance: 100000 });
    const sentResult = sentBacktester.run('SYN', candles, { lookback: 30, sentiment });
    results[regime].sentiment = sentResult;
    console.log(`  +Sentiment: Return=${sentResult.totalReturn}%, Sharpe=${sentResult.sharpeRatio}, MaxDD=${sentResult.maxDrawdown}%, WinRate=${sentResult.winRate}%`);

    // 3. ML-Enhanced
    // Train model on first 60% of data, backtest on full dataset
    const trainer = new Trainer({ epochs: 30, lookback: 30, trainSplit: 0.8 });
    const mlTrainResult = trainer.trainOnCandles(candles, { sentiment });

    if (!mlTrainResult.error) {
      const enhancer = new MLSignalEnhancer(mlTrainResult.model, { mlWeight: 0.4 });
      const engine = new SignalEngine();

      // Run backtest with ML enhancement manually
      let mlTrades = 0;
      let mlBuys = 0;
      let mlSells = 0;
      const mlEquity = [100000];
      let cash = 100000;
      let position = null;

      for (let i = 30; i < candles.length; i++) {
        const window = candles.slice(i - 30, i + 1);
        const closes = window.map(c => c.close);
        const volumes = window.map(c => c.volume);
        const currentPrice = candles[i].close;

        const analysis = engine.analyze('SYN', {
          closes, volumes, currentPrice,
          sentiment: sentiment[i] || null,
        });

        const enhanced = enhancer.enhance(analysis, window, { sentiment: sentiment[i] });
        const signal = enhanced.signal;

        if (signal.action === 'BUY' && signal.confidence > 0.1 && !position) {
          const qty = Math.floor((cash * 0.1) / currentPrice);
          if (qty > 0) {
            position = { qty, entryPrice: currentPrice };
            cash -= qty * currentPrice;
            mlBuys++;
          }
        } else if (signal.action === 'SELL' && position) {
          cash += position.qty * currentPrice;
          mlTrades++;
          if (currentPrice > position.entryPrice) mlSells++;
          position = null;
        }

        const equity = cash + (position ? position.qty * currentPrice : 0);
        mlEquity.push(equity);
      }

      // Close remaining position
      if (position) {
        cash += position.qty * candles[candles.length - 1].close;
        mlTrades++;
        position = null;
      }

      const mlReturn = ((cash - 100000) / 100000 * 100).toFixed(2);
      const mlWinRate = mlTrades > 0 ? ((mlSells / mlTrades) * 100).toFixed(2) : '0.00';

      results[regime].ml = {
        totalReturn: parseFloat(mlReturn),
        winRate: parseFloat(mlWinRate),
        totalTrades: mlTrades,
        trainAccuracy: (mlTrainResult.trainMetrics.accuracy * 100).toFixed(1),
        valAccuracy: (mlTrainResult.valMetrics.accuracy * 100).toFixed(1),
      };
      console.log(`  ML-Enhanced: Return=${mlReturn}%, WinRate=${mlWinRate}%, Trades=${mlTrades}, TrainAcc=${results[regime].ml.trainAccuracy}%, ValAcc=${results[regime].ml.valAccuracy}%`);
    } else {
      results[regime].ml = { error: mlTrainResult.error };
      console.log(`  ML-Enhanced: ${mlTrainResult.error}`);
    }
  }

  return results;
}

// Generate markdown report
function generateReport(results) {
  const lines = [];
  lines.push('# Strategy Backtest Comparison Results');
  lines.push(`\n**Date**: ${new Date().toISOString().split('T')[0]}`);
  lines.push('**Data**: 500 synthetic candles per regime, seeded for reproducibility');
  lines.push('**Initial Balance**: $100,000');
  lines.push('**Position Size**: 10% max per trade');
  lines.push('');

  lines.push('## Summary Table');
  lines.push('');
  lines.push('| Regime | Strategy | Return % | Sharpe | Max DD % | Win Rate % | Trades |');
  lines.push('|--------|----------|----------|--------|----------|------------|--------|');

  for (const [regime, strats] of Object.entries(results)) {
    const t = strats.technical;
    lines.push(`| ${regime} | Technical | ${t.totalReturn} | ${t.sharpeRatio} | ${t.maxDrawdown} | ${t.winRate} | ${t.totalTrades} |`);

    const s = strats.sentiment;
    lines.push(`| ${regime} | +Sentiment | ${s.totalReturn} | ${s.sharpeRatio} | ${s.maxDrawdown} | ${s.winRate} | ${s.totalTrades} |`);

    if (strats.ml && !strats.ml.error) {
      const m = strats.ml;
      lines.push(`| ${regime} | ML-Enhanced | ${m.totalReturn} | - | - | ${m.winRate} | ${m.totalTrades} |`);
    }
  }

  lines.push('');
  lines.push('## Key Findings');
  lines.push('');

  // Analyze which strategy wins per regime
  for (const [regime, strats] of Object.entries(results)) {
    const returns = [
      { name: 'Technical', ret: strats.technical.totalReturn },
      { name: '+Sentiment', ret: strats.sentiment.totalReturn },
    ];
    if (strats.ml && !strats.ml.error) {
      returns.push({ name: 'ML-Enhanced', ret: strats.ml.totalReturn });
    }
    returns.sort((a, b) => b.ret - a.ret);
    lines.push(`- **${regime}**: Best strategy = ${returns[0].name} (${returns[0].ret}% return)`);
  }

  lines.push('');
  lines.push('## ML Model Performance');
  lines.push('');
  for (const [regime, strats] of Object.entries(results)) {
    if (strats.ml && !strats.ml.error) {
      lines.push(`- **${regime}**: Train accuracy ${strats.ml.trainAccuracy}%, Val accuracy ${strats.ml.valAccuracy}%`);
    }
  }

  lines.push('');
  lines.push('## Architecture Notes');
  lines.push('');
  lines.push('- **Model**: Feed-forward neural network [10 → 16 → 8 → 3] with softmax output');
  lines.push('- **Features**: RSI, MACD histogram, MACD signal, Bollinger position/bandwidth, volume ratio, 1/5/10-period returns, sentiment');
  lines.push('- **Training**: 30 epochs, SGD, walk-forward split (80/20), cross-entropy loss');
  lines.push('- **Integration**: MLSignalEnhancer blends rule-based signals (60%) with ML predictions (40%)');
  lines.push('- **Zero dependencies**: Pure JavaScript implementation, no external ML frameworks');
  lines.push('');
  lines.push('## Next Steps');
  lines.push('');
  lines.push('1. Test with real market data from Binance/Alpaca APIs');
  lines.push('2. Tune hyperparameters (learning rate, epochs, thresholds) per asset class');
  lines.push('3. Add walk-forward cross-validation for more robust evaluation');
  lines.push('4. Implement online learning (update model weights as new data arrives)');
  lines.push('5. Add feature importance analysis to identify most predictive signals');

  return lines.join('\n');
}

// Main
const results = runComparison();
const report = generateReport(results);

// Write to file
import { writeFileSync } from 'fs';
writeFileSync('strategy_backtest_results.md', report);
console.log('\n\nResults written to strategy_backtest_results.md');
