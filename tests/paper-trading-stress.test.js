import { describe, it, expect } from 'vitest';
import { PaperTrader } from '../src/paper-trading/index.js';

describe('PaperTrader stress tests', () => {
  describe('rapid order submission', () => {
    it('handles 1000 sequential buy/sell cycles', () => {
      const trader = new PaperTrader({ initialBalance: 1_000_000 });
      for (let i = 0; i < 1000; i++) {
        const price = 100 + Math.sin(i) * 20;
        trader.buy('AAPL', 1, price);
        trader.sell('AAPL', 1, price + 1);
      }
      expect(trader.tradeHistory).toHaveLength(2000);
      // Should have profited ~$1 per cycle
      expect(trader.cash).toBeGreaterThan(1_000_000);
      expect(trader.getPosition('AAPL')).toBeNull();
    });

    it('handles 100 different symbols concurrently', () => {
      const trader = new PaperTrader({ initialBalance: 10_000_000 });
      const symbols = Array.from({ length: 100 }, (_, i) => `SYM${i}`);
      // Buy one share of each
      for (const sym of symbols) {
        trader.buy(sym, 10, 100);
      }
      expect(trader.positions.size).toBe(100);
      expect(trader.cash).toBe(10_000_000 - 100 * 10 * 100);
      // Sell all
      for (const sym of symbols) {
        trader.sell(sym, 10, 110);
      }
      expect(trader.positions.size).toBe(0);
      expect(trader.tradeHistory).toHaveLength(200);
    });

    it('maintains accurate accounting under rapid partial fills', () => {
      const trader = new PaperTrader({ initialBalance: 100_000 });
      // Buy 100 shares in 10 separate orders
      for (let i = 0; i < 10; i++) {
        trader.buy('TSLA', 10, 200);
      }
      const pos = trader.getPosition('TSLA');
      expect(pos.qty).toBe(100);
      expect(pos.avgPrice).toBe(200);
      expect(trader.cash).toBe(100_000 - 100 * 200);
      // Sell in 5 orders
      for (let i = 0; i < 5; i++) {
        trader.sell('TSLA', 20, 210);
      }
      expect(trader.getPosition('TSLA')).toBeNull();
      expect(trader.cash).toBe(100_000 + 100 * 10); // profit: $10/share * 100 shares
    });
  });

  describe('large position sizes', () => {
    it('handles billion-dollar portfolio', () => {
      const trader = new PaperTrader({ initialBalance: 1_000_000_000 });
      trader.buy('BRK.A', 1000, 500_000);
      expect(trader.cash).toBe(500_000_000);
      const pos = trader.getPosition('BRK.A');
      expect(pos.qty).toBe(1000);
      expect(trader.portfolioValue).toBe(1_000_000_000);
    });

    it('handles micro-price assets (fractions of a cent)', () => {
      const trader = new PaperTrader({ initialBalance: 100 });
      trader.buy('SHIB', 1_000_000, 0.00001);
      expect(trader.cash).toBeCloseTo(90, 0);
      const pos = trader.getPosition('SHIB');
      expect(pos.qty).toBe(1_000_000);
    });

    it('rejects order that exactly exceeds balance', () => {
      const trader = new PaperTrader({ initialBalance: 10_000 });
      const result = trader.buy('AAPL', 101, 100); // $10,100 > $10,000
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Insufficient funds');
    });

    it('accepts order that exactly matches balance', () => {
      const trader = new PaperTrader({ initialBalance: 10_000 });
      const result = trader.buy('AAPL', 100, 100); // exactly $10,000
      expect(result.success).toBe(true);
      expect(trader.cash).toBe(0);
    });
  });

  describe('portfolio limit enforcement', () => {
    it('calculatePositionSize respects maxPositionPct', () => {
      const trader = new PaperTrader({ initialBalance: 100_000, maxPositionPct: 0.05 });
      const qty = trader.calculatePositionSize(100, { confidence: 1.0 });
      // maxValue = 100000 * 0.05 = 5000, scaled by confidence 1.0 = 5000, qty = 50
      expect(qty).toBe(50);
    });

    it('calculatePositionSize with zero confidence falls back to 0.5 (bug: tb-1tl)', () => {
      // BUG: uses || instead of ?? so confidence=0 becomes 0.5
      const trader = new PaperTrader({ initialBalance: 100_000 });
      const qty = trader.calculatePositionSize(100, { confidence: 0 });
      // Should be 0 but is 50 due to falsy fallback: (0 || 0.5) = 0.5
      expect(qty).toBe(50);
    });

    it('calculatePositionSize uses 0.5 as default confidence', () => {
      const trader = new PaperTrader({ initialBalance: 100_000, maxPositionPct: 0.10 });
      const qty = trader.calculatePositionSize(100, {});
      // maxValue = 10000, scaled = 10000 * 0.5 = 5000, qty = 50
      expect(qty).toBe(50);
    });

    it('calculatePositionSize returns 0 for very expensive assets', () => {
      const trader = new PaperTrader({ initialBalance: 100_000, maxPositionPct: 0.01 });
      // maxValue = 1000, scaled by 0.5 = 500, qty = floor(500/600) = 0
      const qty = trader.calculatePositionSize(600, { confidence: 0.5 });
      expect(qty).toBe(0);
    });
  });

  describe('sell edge cases', () => {
    it('rejects sell of more shares than held', () => {
      const trader = new PaperTrader();
      trader.buy('AAPL', 10, 150);
      const result = trader.sell('AAPL', 11, 150);
      expect(result.success).toBe(false);
    });

    it('partial sell preserves remaining position', () => {
      const trader = new PaperTrader();
      trader.buy('AAPL', 100, 150);
      trader.sell('AAPL', 60, 160);
      const pos = trader.getPosition('AAPL');
      expect(pos.qty).toBe(40);
      expect(pos.avgPrice).toBe(150);
    });

    it('complete sell removes position from map', () => {
      const trader = new PaperTrader();
      trader.buy('AAPL', 10, 150);
      trader.sell('AAPL', 10, 160);
      expect(trader.getPosition('AAPL')).toBeNull();
      expect(trader.positions.size).toBe(0);
    });

    it('sell tracks PnL correctly on loss', () => {
      const trader = new PaperTrader();
      trader.buy('AAPL', 10, 150);
      const result = trader.sell('AAPL', 10, 140);
      expect(result.trade.pnl).toBe(-100); // loss of $10/share * 10 shares
    });

    it('sell after averaged-down buy computes correct PnL', () => {
      const trader = new PaperTrader();
      trader.buy('AAPL', 10, 200); // avg = 200
      trader.buy('AAPL', 10, 100); // avg = 150
      const result = trader.sell('AAPL', 20, 160);
      expect(result.trade.pnl).toBe(200); // (160-150) * 20
    });
  });

  describe('PnL and summary accuracy', () => {
    it('portfolioValue equals initialBalance when no trades', () => {
      const trader = new PaperTrader({ initialBalance: 50_000 });
      expect(trader.portfolioValue).toBe(50_000);
      expect(trader.pnl).toBe(0);
      expect(trader.pnlPct).toBe(0);
    });

    it('portfolioValue uses cost basis, not market value', () => {
      const trader = new PaperTrader({ initialBalance: 100_000 });
      trader.buy('AAPL', 10, 150);
      // portfolioValue = cash + qty*avgPrice = 98500 + 10*150 = 100000
      expect(trader.portfolioValue).toBe(100_000);
      expect(trader.pnl).toBe(0);
    });

    it('summary rounds values to 2 decimal places', () => {
      const trader = new PaperTrader({ initialBalance: 100 });
      trader.buy('PENNY', 3, 33.333);
      const summary = trader.getSummary();
      // cash = 100 - 99.999 = 0.001
      expect(summary.cash).toBe(0); // rounded
    });

    it('pnlPct is correct after profit', () => {
      const trader = new PaperTrader({ initialBalance: 10_000 });
      trader.buy('X', 10, 100);
      trader.sell('X', 10, 200);
      // profit = 1000, pnlPct = 1000/10000 * 100 = 10%
      expect(trader.pnlPct).toBe(10);
    });

    it('handles many trades in summary', () => {
      const trader = new PaperTrader({ initialBalance: 1_000_000 });
      for (let i = 0; i < 500; i++) {
        trader.buy('X', 1, 10);
        trader.sell('X', 1, 10);
      }
      const summary = trader.getSummary();
      expect(summary.tradeCount).toBe(1000);
      expect(summary.cash).toBe(1_000_000);
    });
  });

  describe('cost basis averaging', () => {
    it('averages correctly with many small buys', () => {
      const trader = new PaperTrader({ initialBalance: 1_000_000 });
      // Buy at prices 100-109, 10 shares each
      for (let i = 0; i < 10; i++) {
        trader.buy('AAPL', 10, 100 + i);
      }
      const pos = trader.getPosition('AAPL');
      expect(pos.qty).toBe(100);
      // Average of 100..109 = 104.5
      expect(pos.avgPrice).toBeCloseTo(104.5, 1);
    });

    it('new buy after partial sell recomputes average correctly', () => {
      const trader = new PaperTrader({ initialBalance: 100_000 });
      trader.buy('X', 20, 100); // avg=100
      trader.sell('X', 10, 120); // sell 10, keep 10 at avg=100
      trader.buy('X', 10, 80);  // new avg = (100*10 + 80*10) / 20 = 90
      const pos = trader.getPosition('X');
      expect(pos.qty).toBe(20);
      expect(pos.avgPrice).toBe(90);
    });
  });
});
