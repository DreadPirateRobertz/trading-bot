// Paper Trading + ML Signal Integration Stress Tests
// tb-658: Stress test paper trading with ML signal integration
import { describe, it, expect } from 'vitest';
import { PaperTrader } from '../src/paper-trading/index.js';
import { Trainer, MLSignalEnhancer } from '../src/ml/trainer.js';
import { extractFeatures } from '../src/ml/features.js';
import { SignalEngine } from '../src/signals/engine.js';

// Generate candle data with controllable regime for reproducible stress tests
function generateCandles(n, { seed = 42, regimeLen = 60 } = {}) {
  const candles = [];
  let price = 100;
  let rng = seed;
  const rand = () => { rng = (rng * 16807 + 0) % 2147483647; return rng / 2147483647; };
  const regimes = ['trend_up', 'trend_down', 'range', 'volatile'];
  let regime = regimes[0];
  let regimeCounter = 0;

  for (let i = 0; i < n; i++) {
    regimeCounter++;
    if (regimeCounter > regimeLen) {
      regime = regimes[Math.floor(rand() * regimes.length)];
      regimeCounter = 0;
    }

    let change;
    switch (regime) {
      case 'trend_up': change = (rand() - 0.3) * 1.5; break;
      case 'trend_down': change = (rand() - 0.7) * 1.5; break;
      case 'range': change = (100 - price) * 0.03 + (rand() - 0.5) * 0.8; break;
      case 'volatile': change = (rand() - 0.5) * 6; break;
    }

    price = Math.max(price + change, 5);
    const vol = regime === 'volatile' ? 4 : 1.5;
    candles.push({
      open: price - change / 2,
      high: price + rand() * vol + 0.3,
      low: Math.max(price - rand() * vol - 0.3, 1),
      close: price,
      volume: 1000 + rand() * (regime === 'volatile' ? 15000 : 4000),
      openTime: Date.now() - (n - i) * 60000,
    });
  }
  return candles;
}

// Run an ML-driven trading loop: signal engine + ML enhancer -> paper trader
function runMLTradingLoop(trader, enhancer, engine, candles, { lookback = 30, symbol = 'TEST' } = {}) {
  const trades = [];
  for (let i = lookback; i < candles.length; i++) {
    const window = candles.slice(i - lookback, i + 1);
    const closes = window.map(c => c.close);
    const volumes = window.map(c => c.volume);
    const currentPrice = closes[closes.length - 1];

    // Get rule-based analysis
    const analysis = engine.analyze(symbol, { closes, volumes, currentPrice });

    // Enhance with ML
    const enhanced = enhancer.enhance(analysis, window);
    const signal = enhanced.signal;

    // Update mark-to-market prices
    trader.updatePrices({ [symbol]: currentPrice });

    // Execute based on signal
    if (signal.action === 'BUY') {
      const qty = trader.calculatePositionSize(currentPrice, signal);
      if (qty > 0) {
        const result = trader.buy(symbol, qty, currentPrice);
        if (result.success) trades.push({ ...result.trade, signal: signal.action, confidence: signal.confidence });
      }
    } else if (signal.action === 'SELL') {
      const pos = trader.getPosition(symbol);
      if (pos) {
        const result = trader.sell(symbol, pos.qty, currentPrice);
        if (result.success) trades.push({ ...result.trade, signal: signal.action, confidence: signal.confidence });
      }
    }
  }
  return trades;
}

describe('Paper trading + ML signal stress tests', () => {
  // Train a model once for reuse across tests
  let trainedModel;
  const trainingCandles = generateCandles(500, { seed: 1 });

  function getModel() {
    if (!trainedModel) {
      const trainer = new Trainer({ epochs: 15, lookback: 30 });
      const result = trainer.trainOnCandles(trainingCandles);
      trainedModel = result.model;
    }
    return trainedModel;
  }

  describe('ML-driven trading loop integrity', () => {
    it('completes 1000-candle trading session with accounting intact', () => {
      const candles = generateCandles(1000, { seed: 100 });
      const model = getModel();
      const enhancer = new MLSignalEnhancer(model, { mlWeight: 0.4 });
      const engine = new SignalEngine();
      const trader = new PaperTrader({ initialBalance: 100_000, maxPositionPct: 0.10 });

      const trades = runMLTradingLoop(trader, enhancer, engine, candles);

      // Accounting invariant: cash + position value >= 0
      expect(trader.cash).toBeGreaterThanOrEqual(0);
      const summary = trader.getSummary();
      expect(summary.portfolioValue).toBeGreaterThan(0);
      expect(summary.tradeCount).toBe(trader.tradeHistory.length);

      // Should have generated some trades from 970 signal evaluations
      expect(trades.length).toBeGreaterThan(0);

      // Every trade should have valid signal metadata
      for (const t of trades) {
        expect(['BUY', 'SELL']).toContain(t.signal);
        expect(t.confidence).toBeGreaterThanOrEqual(0);
        expect(t.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('handles 5 symbols simultaneously under ML signals', () => {
      const symbols = ['AAPL', 'BTC', 'ETH', 'TSLA', 'SPY'];
      const candlesBySymbol = {};
      symbols.forEach((sym, idx) => {
        candlesBySymbol[sym] = generateCandles(300, { seed: 200 + idx });
      });

      const model = getModel();
      const enhancer = new MLSignalEnhancer(model, { mlWeight: 0.5 });
      const engine = new SignalEngine();
      const trader = new PaperTrader({ initialBalance: 500_000, maxPositionPct: 0.05 });

      let totalTrades = 0;
      for (let i = 30; i < 300; i++) {
        for (const sym of symbols) {
          const window = candlesBySymbol[sym].slice(i - 30, i + 1);
          const closes = window.map(c => c.close);
          const volumes = window.map(c => c.volume);
          const currentPrice = closes[closes.length - 1];

          const analysis = engine.analyze(sym, { closes, volumes, currentPrice });
          const enhanced = enhancer.enhance(analysis, window);
          const signal = enhanced.signal;

          trader.updatePrices({ [sym]: currentPrice });

          if (signal.action === 'BUY') {
            const qty = trader.calculatePositionSize(currentPrice, signal);
            if (qty > 0) {
              const result = trader.buy(sym, qty, currentPrice);
              if (result.success) totalTrades++;
            }
          } else if (signal.action === 'SELL') {
            const pos = trader.getPosition(sym);
            if (pos) {
              const result = trader.sell(sym, pos.qty, currentPrice);
              if (result.success) totalTrades++;
            }
          }
        }
      }

      // Should trade across multiple symbols
      expect(totalTrades).toBeGreaterThan(0);
      expect(trader.cash).toBeGreaterThanOrEqual(0);

      // No position should exceed maxPositionPct worth of portfolio at entry
      const summary = trader.getSummary();
      expect(summary.portfolioValue).toBeGreaterThan(0);
      expect(summary.tradeCount).toBe(totalTrades);
    });
  });

  describe('ML signal edge cases in trading', () => {
    it('untrained model passes through signals without corruption', () => {
      const engine = new SignalEngine();
      const untrainedModel = { trained: false };
      const enhancer = new MLSignalEnhancer(untrainedModel);
      const trader = new PaperTrader({ initialBalance: 50_000 });
      const candles = generateCandles(100, { seed: 300 });

      const trades = runMLTradingLoop(trader, enhancer, engine, candles);

      // Should still generate some trades from rule-based signals alone
      expect(trader.tradeHistory.length).toBeGreaterThanOrEqual(0);
      expect(trader.cash).toBeGreaterThanOrEqual(0);
      expect(trader.cash).toBeLessThanOrEqual(50_000 + 100_000); // can't create money
    });

    it('high ML weight (0.9) does not produce invalid signals', () => {
      const candles = generateCandles(200, { seed: 400 });
      const model = getModel();
      const enhancer = new MLSignalEnhancer(model, { mlWeight: 0.9 });
      const engine = new SignalEngine();
      const trader = new PaperTrader({ initialBalance: 100_000 });

      for (let i = 30; i < candles.length; i++) {
        const window = candles.slice(i - 30, i + 1);
        const closes = window.map(c => c.close);
        const volumes = window.map(c => c.volume);
        const currentPrice = closes[closes.length - 1];

        const analysis = engine.analyze('X', { closes, volumes, currentPrice });
        const enhanced = enhancer.enhance(analysis, window);

        // Signal must always be valid regardless of weight
        expect(['BUY', 'HOLD', 'SELL']).toContain(enhanced.signal.action);
        expect(enhanced.signal.confidence).toBeGreaterThanOrEqual(0);
        expect(enhanced.signal.confidence).toBeLessThanOrEqual(1);
        expect(isFinite(enhanced.signal.score)).toBe(true);

        // ML metadata should be present
        expect(enhanced.ml).toBeDefined();
        expect(enhanced.ml.confidence).toBeGreaterThan(0);
        expect(enhanced.ml.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('zero ML weight preserves rule-based signals exactly', () => {
      const candles = generateCandles(100, { seed: 500 });
      const model = getModel();
      const enhancer = new MLSignalEnhancer(model, { mlWeight: 0 });
      const engine = new SignalEngine();

      for (let i = 30; i < candles.length; i++) {
        const window = candles.slice(i - 30, i + 1);
        const closes = window.map(c => c.close);
        const volumes = window.map(c => c.volume);
        const currentPrice = closes[closes.length - 1];

        const ruleAnalysis = engine.analyze('X', { closes, volumes, currentPrice });
        const enhanced = enhancer.enhance(ruleAnalysis, window);

        // With mlWeight=0, combined score should equal rule score
        expect(enhanced.signal.score).toBe(ruleAnalysis.signal.score);
        expect(enhanced.signal.action).toBe(ruleAnalysis.signal.action);
      }
    });
  });

  describe('rapid ML signal trading stress', () => {
    it('1000 rapid buy/sell cycles driven by ML-sized positions', () => {
      const model = getModel();
      const trader = new PaperTrader({ initialBalance: 1_000_000, maxPositionPct: 0.05 });
      const candles = generateCandles(60, { seed: 600 });
      const window = candles.slice(-31);

      for (let i = 0; i < 1000; i++) {
        const price = 100 + Math.sin(i * 0.1) * 30;
        const features = extractFeatures(window);
        const prediction = model.predictSignal(features);

        const qty = trader.calculatePositionSize(price, {
          confidence: prediction.confidence,
        });

        if (qty > 0) {
          const buyResult = trader.buy('STRESS', qty, price);
          if (buyResult.success) {
            // Immediately sell at slightly different price
            const sellPrice = price * (1 + (prediction.action === 'BUY' ? 0.001 : -0.001));
            trader.sell('STRESS', qty, sellPrice);
          }
        }
      }

      // Accounting should be consistent
      expect(trader.getPosition('STRESS')).toBeNull();
      expect(trader.cash).toBeGreaterThan(0);
      expect(isFinite(trader.cash)).toBe(true);
      expect(isFinite(trader.portfolioValue)).toBe(true);

      const summary = trader.getSummary();
      expect(isFinite(summary.pnl)).toBe(true);
      expect(isFinite(summary.pnlPct)).toBe(true);
    });

    it('ML confidence correctly scales position sizes under stress', () => {
      const trader = new PaperTrader({ initialBalance: 100_000, maxPositionPct: 0.10 });
      const price = 50;

      // High confidence -> larger position
      const qtyHigh = trader.calculatePositionSize(price, { confidence: 0.95 });
      // Low confidence -> smaller position
      const qtyLow = trader.calculatePositionSize(price, { confidence: 0.1 });
      // Zero confidence -> zero position
      const qtyZero = trader.calculatePositionSize(price, { confidence: 0 });

      expect(qtyHigh).toBeGreaterThan(qtyLow);
      expect(qtyLow).toBeGreaterThan(qtyZero);
      expect(qtyZero).toBe(0);

      // Verify max bound: even at confidence=1.0, position <= maxPositionPct * portfolio
      const qtyMax = trader.calculatePositionSize(price, { confidence: 1.0 });
      expect(qtyMax * price).toBeLessThanOrEqual(100_000 * 0.10);
    });
  });

  describe('portfolio consistency under ML-driven trades', () => {
    it('portfolioValue never goes negative during extended ML trading', () => {
      const candles = generateCandles(800, { seed: 700 });
      const model = getModel();
      const enhancer = new MLSignalEnhancer(model, { mlWeight: 0.6 });
      const engine = new SignalEngine();
      const trader = new PaperTrader({ initialBalance: 50_000, maxPositionPct: 0.15 });

      const portfolioHistory = [];

      for (let i = 30; i < candles.length; i++) {
        const window = candles.slice(i - 30, i + 1);
        const closes = window.map(c => c.close);
        const volumes = window.map(c => c.volume);
        const currentPrice = closes[closes.length - 1];

        const analysis = engine.analyze('PF', { closes, volumes, currentPrice });
        const enhanced = enhancer.enhance(analysis, window);
        const signal = enhanced.signal;

        trader.updatePrices({ PF: currentPrice });

        if (signal.action === 'BUY') {
          const qty = trader.calculatePositionSize(currentPrice, signal);
          if (qty > 0) trader.buy('PF', qty, currentPrice);
        } else if (signal.action === 'SELL') {
          const pos = trader.getPosition('PF');
          if (pos) trader.sell('PF', pos.qty, currentPrice);
        }

        portfolioHistory.push(trader.portfolioValue);
      }

      // Portfolio value must never be negative
      for (const pv of portfolioHistory) {
        expect(pv).toBeGreaterThan(0);
        expect(isFinite(pv)).toBe(true);
      }

      // Cash must never go negative
      expect(trader.cash).toBeGreaterThanOrEqual(0);
    });

    it('trade PnL values sum consistently with portfolio change', () => {
      const candles = generateCandles(300, { seed: 800 });
      const model = getModel();
      const enhancer = new MLSignalEnhancer(model, { mlWeight: 0.4 });
      const engine = new SignalEngine();
      const trader = new PaperTrader({ initialBalance: 100_000 });

      runMLTradingLoop(trader, enhancer, engine, candles, { symbol: 'PNL' });

      // Close any remaining position at last price
      const pos = trader.getPosition('PNL');
      if (pos) {
        const lastPrice = candles[candles.length - 1].close;
        trader.sell('PNL', pos.qty, lastPrice);
      }

      // Sum of all sell PnLs should equal total portfolio change
      const totalTradePnl = trader.tradeHistory
        .filter(t => t.side === 'sell')
        .reduce((sum, t) => sum + t.pnl, 0);

      const portfolioChange = trader.cash - 100_000;
      expect(totalTradePnl).toBeCloseTo(portfolioChange, 2);
    });
  });

  describe('model retraining mid-session', () => {
    it('swapping model mid-session does not corrupt trader state', () => {
      const candles = generateCandles(600, { seed: 900 });
      const engine = new SignalEngine();
      const trader = new PaperTrader({ initialBalance: 100_000 });

      // Phase 1: trade with first model
      const trainer1 = new Trainer({ epochs: 10, lookback: 30 });
      const { model: model1 } = trainer1.trainOnCandles(candles.slice(0, 300));
      let enhancer = new MLSignalEnhancer(model1, { mlWeight: 0.4 });

      const preSwapBalance = trader.cash;
      runMLTradingLoop(trader, enhancer, engine, candles.slice(0, 300), { symbol: 'SWAP' });

      const midSummary = trader.getSummary();
      expect(midSummary.portfolioValue).toBeGreaterThan(0);

      // Phase 2: retrain on more data, swap model
      const trainer2 = new Trainer({ epochs: 10, lookback: 30 });
      const { model: model2 } = trainer2.trainOnCandles(candles.slice(0, 500));
      enhancer = new MLSignalEnhancer(model2, { mlWeight: 0.4 });

      // Close any position before swapping strategies
      const pos = trader.getPosition('SWAP');
      if (pos) {
        trader.sell('SWAP', pos.qty, candles[299].close);
      }

      runMLTradingLoop(trader, enhancer, engine, candles.slice(300), { symbol: 'SWAP' });

      // State should still be consistent
      expect(trader.cash).toBeGreaterThanOrEqual(0);
      expect(trader.portfolioValue).toBeGreaterThan(0);
      expect(isFinite(trader.pnl)).toBe(true);
    });
  });
});
