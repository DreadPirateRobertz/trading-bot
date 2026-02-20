import { describe, it, expect } from 'vitest';
import { PaperTrader } from '../src/paper-trading/index.js';

describe('PaperTrader', () => {
  it('initializes with correct balance', () => {
    const trader = new PaperTrader({ initialBalance: 50000 });
    expect(trader.cash).toBe(50000);
    expect(trader.portfolioValue).toBe(50000);
    expect(trader.pnl).toBe(0);
  });

  it('executes buy order and updates state', () => {
    const trader = new PaperTrader({ initialBalance: 100000 });
    const result = trader.buy('AAPL', 10, 150);
    expect(result.success).toBe(true);
    expect(trader.cash).toBe(98500);
    expect(trader.getPosition('AAPL')).toEqual({ qty: 10, avgPrice: 150, side: 'long' });
    expect(trader.tradeHistory).toHaveLength(1);
  });

  it('rejects buy when insufficient funds', () => {
    const trader = new PaperTrader({ initialBalance: 1000 });
    const result = trader.buy('AAPL', 100, 150);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Insufficient funds');
  });

  it('executes sell order and computes PnL', () => {
    const trader = new PaperTrader();
    trader.buy('BTC', 1, 40000);
    const result = trader.sell('BTC', 1, 45000);
    expect(result.success).toBe(true);
    expect(result.trade.pnl).toBe(5000);
    expect(trader.cash).toBe(100000 + 5000);
    expect(trader.getPosition('BTC')).toBeNull();
  });

  it('rejects sell when no position', () => {
    const trader = new PaperTrader();
    const result = trader.sell('ETH', 5, 3000);
    expect(result.success).toBe(false);
  });

  it('averages cost on multiple buys', () => {
    const trader = new PaperTrader();
    trader.buy('AAPL', 10, 100);
    trader.buy('AAPL', 10, 200);
    const pos = trader.getPosition('AAPL');
    expect(pos.qty).toBe(20);
    expect(pos.avgPrice).toBe(150);
  });

  it('calculates position size from signal confidence', () => {
    const trader = new PaperTrader({ initialBalance: 100000, maxPositionPct: 0.10 });
    const qty = trader.calculatePositionSize(100, { confidence: 0.8 });
    // maxValue = 100000 * 0.10 = 10000, scaled = 10000 * 0.8 = 8000, qty = 80
    expect(qty).toBe(80);
  });

  it('provides accurate summary', () => {
    const trader = new PaperTrader();
    trader.buy('AAPL', 10, 150);
    const summary = trader.getSummary();
    expect(summary.cash).toBe(98500);
    expect(summary.tradeCount).toBe(1);
    expect(summary.positions).toHaveProperty('AAPL');
  });
});
