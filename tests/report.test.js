import { describe, it, expect } from 'vitest';
import { generateReport } from '../src/report.js';

describe('Strategy Report', () => {
  it('generates full report without errors', () => {
    // Capture console output
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    const report = generateReport();

    console.log = origLog;

    expect(report).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(report.title).toContain('Strategy Performance Report');
  });

  it('includes all major report sections', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    generateReport();

    console.log = origLog;

    const output = logs.join('\n');
    expect(output).toContain('STRATEGY PERFORMANCE BY MARKET REGIME');
    expect(output).toContain('PAIRS TRADING');
    expect(output).toContain('KELLY CRITERION');
    expect(output).toContain('RISK PARITY');
    expect(output).toContain('VALUE AT RISK');
    expect(output).toContain('SIGNAL ENGINE BACKTEST');
    expect(output).toContain('SUMMARY');
  });

  it('includes all strategies', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    generateReport();

    console.log = origLog;

    const output = logs.join('\n');
    expect(output).toContain('momentum');
    expect(output).toContain('mean_reversion');
    expect(output).toContain('bollinger_bounce');
    expect(output).toContain('ensemble');
    expect(output).toContain('hybrid');
    expect(output).toContain('pairs_trading');
  });

  it('includes all market scenarios', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    generateReport();

    console.log = origLog;

    const output = logs.join('\n');
    expect(output).toContain('Bull Market');
    expect(output).toContain('Bear Market');
    expect(output).toContain('Mean-Reverting');
    expect(output).toContain('Volatile Chop');
    expect(output).toContain('Regime Switching');
  });
});
