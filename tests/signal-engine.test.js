import { describe, it, expect } from 'vitest';
import { SignalEngine, generateSignalWithPrice } from '../src/signals/engine.js';

// Helper: generate synthetic price data
function makePrices(length, start = 100, trend = 0, noise = 2) {
  return Array.from({ length }, (_, i) => start + trend * i + (Math.sin(i) * noise));
}

function makeVolumes(length, base = 1000) {
  return Array.from({ length }, () => base + Math.floor(Math.random() * 200));
}

describe('SignalEngine', () => {
  it('analyzes a single asset', () => {
    const engine = new SignalEngine();
    const closes = makePrices(40);
    const volumes = makeVolumes(40);
    const result = engine.analyze('AAPL', { closes, volumes });
    expect(result.symbol).toBe('AAPL');
    expect(result.price).toBeCloseTo(closes[closes.length - 1]);
    expect(result.signal).toBeDefined();
    expect(result.signal.action).toMatch(/^(BUY|SELL|HOLD)$/);
    expect(result.signal.confidence).toBeGreaterThanOrEqual(0);
    expect(result.signal.confidence).toBeLessThanOrEqual(1);
    expect(result.indicators).toBeDefined();
    expect(result.indicators.rsi).toBeDefined();
  });

  it('returns error for empty data', () => {
    const engine = new SignalEngine();
    const result = engine.analyze('BTC', { closes: [] });
    expect(result.error).toBe('No price data');
  });

  it('analyzes multiple assets', () => {
    const engine = new SignalEngine();
    const assets = [
      { symbol: 'AAPL', closes: makePrices(40), volumes: makeVolumes(40) },
      { symbol: 'TSLA', closes: makePrices(40, 200, -0.5), volumes: makeVolumes(40) },
    ];
    const results = engine.analyzeMultiple(assets);
    expect(results).toHaveLength(2);
    expect(results[0].symbol).toBe('AAPL');
    expect(results[1].symbol).toBe('TSLA');
  });

  it('ranks analyses by actionability and confidence', () => {
    const engine = new SignalEngine();
    const analyses = [
      { signal: { action: 'HOLD', confidence: 0.5 } },
      { signal: { action: 'BUY', confidence: 0.8 } },
      { signal: { action: 'BUY', confidence: 0.3 } },
      { signal: { action: 'SELL', confidence: 0.9 } },
    ];
    const ranked = engine.rank(analyses);
    // BUY/SELL should come before HOLD
    expect(ranked[0].signal.action).not.toBe('HOLD');
    // Highest confidence actionable first
    expect(ranked[0].signal.confidence).toBe(0.9);
  });

  it('uses custom RSI period', () => {
    const engine = new SignalEngine({ rsiPeriod: 10 });
    const closes = makePrices(30);
    const result = engine.analyze('ETH', { closes });
    expect(result.indicators.rsi).not.toBeNull();
  });

  it('includes sentiment in analysis when provided', () => {
    const engine = new SignalEngine();
    const closes = makePrices(40);
    const sentiment = { classification: 'very_bullish', score: 5 };
    const result = engine.analyze('DOGE', { closes, sentiment });
    expect(result.sentiment).toEqual(sentiment);
    const hasSentimentReason = result.signal.reasons.some(r => r.includes('sentiment'));
    expect(hasSentimentReason).toBe(true);
  });
});

describe('generateSignalWithPrice', () => {
  it('generates BUY when price is below lower Bollinger Band', () => {
    const result = generateSignalWithPrice({
      rsi: 25,
      macd: { macd: 1, signal: 0.5, histogram: 0.5 },
      bollinger: { upper: 110, middle: 100, lower: 90, bandwidth: 0.2 },
      volumeSpike: false,
      sentiment: null,
      price: 85,
    });
    expect(result.action).toBe('BUY');
    expect(result.reasons).toContain('Price below lower Bollinger Band');
  });

  it('generates SELL when price is above upper Bollinger Band', () => {
    const result = generateSignalWithPrice({
      rsi: 75,
      macd: { macd: -1, signal: 0.5, histogram: -1.5 },
      bollinger: { upper: 110, middle: 100, lower: 90, bandwidth: 0.2 },
      volumeSpike: false,
      sentiment: null,
      price: 115,
    });
    expect(result.action).toBe('SELL');
    expect(result.reasons).toContain('Price above upper Bollinger Band');
  });

  it('handles null indicators gracefully', () => {
    const result = generateSignalWithPrice({
      rsi: null,
      macd: null,
      bollinger: null,
      volumeSpike: false,
      sentiment: null,
      price: 100,
    });
    expect(result.action).toBe('HOLD');
    expect(result.score).toBe(0);
  });

  it('combines all bullish signals for high confidence', () => {
    const result = generateSignalWithPrice({
      rsi: 20,
      macd: { macd: 2, signal: 1, histogram: 1 },
      bollinger: { upper: 110, middle: 100, lower: 90, bandwidth: 0.2 },
      volumeSpike: true,
      sentiment: { classification: 'very_bullish' },
      price: 85,
    });
    expect(result.action).toBe('BUY');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
  });
});
