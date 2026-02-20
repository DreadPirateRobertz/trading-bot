import { describe, it, expect } from 'vitest';
import { computeRSI, computeMACD, computeBollingerBands, detectVolumeSpike, generateSignal } from '../src/signals/index.js';

describe('computeRSI', () => {
  it('returns null for insufficient data', () => {
    expect(computeRSI([1, 2, 3])).toBeNull();
  });

  it('returns 100 for monotonically increasing prices', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const rsi = computeRSI(closes);
    expect(rsi).toBe(100);
  });

  it('returns value between 0 and 100', () => {
    const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
      46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
    const rsi = computeRSI(closes);
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });
});

describe('computeMACD', () => {
  it('returns null for insufficient data', () => {
    expect(computeMACD([1, 2, 3])).toBeNull();
  });

  it('returns macd, signal, and histogram', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const result = computeMACD(closes);
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('histogram');
    expect(typeof result.macd).toBe('number');
  });
});

describe('computeBollingerBands', () => {
  it('returns null for insufficient data', () => {
    expect(computeBollingerBands([1, 2, 3])).toBeNull();
  });

  it('returns upper, middle, lower bands', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + Math.random() * 10);
    const result = computeBollingerBands(closes);
    expect(result.upper).toBeGreaterThan(result.middle);
    expect(result.middle).toBeGreaterThan(result.lower);
    expect(result.bandwidth).toBeGreaterThan(0);
  });
});

describe('detectVolumeSpike', () => {
  it('returns false for insufficient data', () => {
    expect(detectVolumeSpike([100, 200, 300])).toBe(false);
  });

  it('detects spike when current volume is 3x average', () => {
    const volumes = Array.from({ length: 20 }, () => 1000);
    volumes.push(5000);
    expect(detectVolumeSpike(volumes)).toBe(true);
  });

  it('returns false for normal volume', () => {
    const volumes = Array.from({ length: 21 }, () => 1000);
    expect(detectVolumeSpike(volumes)).toBe(false);
  });
});

describe('generateSignal', () => {
  it('generates BUY signal for oversold RSI with bullish sentiment', () => {
    const signal = generateSignal({
      rsi: 25,
      macd: { macd: 1, signal: 0.5, histogram: 0.5 },
      bollinger: null,
      volumeSpike: true,
      sentiment: { classification: 'very_bullish' },
    });
    expect(signal.action).toBe('BUY');
    expect(signal.confidence).toBeGreaterThan(0);
    expect(signal.reasons.length).toBeGreaterThan(0);
  });

  it('generates SELL signal for overbought RSI with bearish sentiment', () => {
    const signal = generateSignal({
      rsi: 80,
      macd: { macd: -1, signal: 0.5, histogram: -1.5 },
      bollinger: null,
      volumeSpike: false,
      sentiment: { classification: 'very_bearish' },
    });
    expect(signal.action).toBe('SELL');
  });

  it('generates HOLD for mixed signals', () => {
    const signal = generateSignal({
      rsi: 50,
      macd: null,
      bollinger: null,
      volumeSpike: false,
      sentiment: { classification: 'neutral' },
    });
    expect(signal.action).toBe('HOLD');
    expect(signal.score).toBe(0);
  });
});
