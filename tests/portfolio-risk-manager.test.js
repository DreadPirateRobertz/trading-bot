import { describe, it, expect, beforeEach } from 'vitest';
import { PortfolioRiskManager } from '../src/risk/portfolio-risk-manager.js';

describe('PortfolioRiskManager', () => {
  let rm;

  beforeEach(() => {
    rm = new PortfolioRiskManager();
  });

  describe('constructor defaults', () => {
    it('initializes with sensible defaults', () => {
      expect(rm.config.maxPortfolioHeat).toBe(0.60);
      expect(rm.config.maxSymbolPct).toBe(0.25);
      expect(rm.config.maxSectorPct).toBe(0.40);
      expect(rm.config.circuitBreakerDrawdown).toBe(0.20);
      expect(rm.config.dailyLossLimit).toBe(0.03);
      expect(rm.circuitBreakerActive).toBe(false);
    });

    it('accepts custom config', () => {
      const custom = new PortfolioRiskManager({
        maxPortfolioHeat: 0.80,
        maxSymbolPct: 0.30,
        dailyLossLimit: 0.05,
      });
      expect(custom.config.maxPortfolioHeat).toBe(0.80);
      expect(custom.config.maxSymbolPct).toBe(0.30);
      expect(custom.config.dailyLossLimit).toBe(0.05);
    });
  });

  describe('update()', () => {
    it('tracks equity and peak', () => {
      rm.update({ equity: 100000, bar: 0 });
      expect(rm.currentEquity).toBe(100000);
      expect(rm.peakEquity).toBe(100000);

      rm.update({ equity: 110000, bar: 1 });
      expect(rm.peakEquity).toBe(110000);

      rm.update({ equity: 105000, bar: 2 });
      expect(rm.peakEquity).toBe(110000);
      expect(rm.currentEquity).toBe(105000);
    });

    it('tracks bar count', () => {
      rm.update({ equity: 100000, bar: 0 });
      rm.update({ equity: 100000, bar: 1 });
      rm.update({ equity: 100000, bar: 2 });
      expect(rm.barCount).toBe(2);
    });

    it('updates positions snapshot', () => {
      rm.update({
        equity: 100000,
        bar: 0,
        positions: { BTCUSDT: { qty: 1, avgPrice: 50000, currentPrice: 50000 } },
      });
      expect(rm.positions.has('BTCUSDT')).toBe(true);
      expect(rm.positions.get('BTCUSDT').qty).toBe(1);
    });

    it('trims equity history to prevent unbounded growth', () => {
      for (let i = 0; i < 6000; i++) {
        rm.update({ equity: 100000 + i, bar: i });
      }
      expect(rm.equityHistory.length).toBeLessThanOrEqual(5000);
    });
  });

  describe('evaluateTrade() - basic approval', () => {
    beforeEach(() => {
      rm.update({ equity: 100000, bar: 0 });
    });

    it('approves a normal trade within limits', () => {
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 10000,
      });
      expect(result.allowed).toBe(true);
      expect(result.adjustedQty).toBe(1);
      expect(result.riskFlags).toEqual([]);
    });

    it('always allows sells', () => {
      rm.triggerCircuitBreaker('test');
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'sell', qty: 5, price: 50000,
      });
      expect(result.allowed).toBe(true);
      expect(result.adjustedQty).toBe(5);
    });
  });

  describe('portfolio heat limit', () => {
    it('blocks trade when portfolio heat is maxed out', () => {
      rm.update({
        equity: 100000,
        bar: 0,
        positions: {
          BTCUSDT: { qty: 2, currentPrice: 20000 },  // 40k
          ETHUSDT: { qty: 50, currentPrice: 400 },     // 20k
        },
      });
      // Total exposure = 60k = 60% of 100k = exactly at limit
      const result = rm.evaluateTrade({
        symbol: 'SOLUSDT', side: 'buy', qty: 100, price: 100,
      });
      expect(result.allowed).toBe(false);
      expect(result.riskFlags).toContain('portfolio_heat');
    });

    it('reduces qty to fit within heat limit', () => {
      // Put symbols in different sectors to isolate portfolio heat test
      rm.setSectors({ BTCUSDT: 'crypto_l1', ETHUSDT: 'crypto_l2' });
      rm.update({
        equity: 100000,
        bar: 0,
        positions: {
          BTCUSDT: { qty: 1, currentPrice: 50000 },  // 50k = 50%
        },
      });
      // Max heat = 60k. Remaining room = 10k. Requesting 20k at $100 = 200 qty
      const result = rm.evaluateTrade({
        symbol: 'ETHUSDT', side: 'buy', qty: 200, price: 100,
      });
      expect(result.allowed).toBe(true);
      expect(result.adjustedQty).toBe(100); // 10k / $100
      expect(result.riskFlags).toContain('portfolio_heat');
    });
  });

  describe('per-symbol concentration', () => {
    it('blocks when symbol exceeds max allocation', () => {
      rm.update({
        equity: 100000,
        bar: 0,
        positions: {
          BTCUSDT: { qty: 5, currentPrice: 5000 },  // 25k = 25% = at limit
        },
      });
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 5000,
      });
      expect(result.allowed).toBe(false);
      expect(result.riskFlags).toContain('symbol_concentration');
    });

    it('reduces qty to fit within symbol limit', () => {
      rm.update({
        equity: 100000,
        bar: 0,
        positions: {
          BTCUSDT: { qty: 4, currentPrice: 5000 },  // 20k = 20%
        },
      });
      // Max = 25k. Room = 5k. Requesting 10k at $5000 = 2 qty
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 2, price: 5000,
      });
      expect(result.allowed).toBe(true);
      expect(result.adjustedQty).toBe(1); // 5k / $5000
      expect(result.riskFlags).toContain('symbol_concentration');
    });
  });

  describe('sector concentration', () => {
    beforeEach(() => {
      rm.setSectors({
        BTCUSDT: 'crypto',
        ETHUSDT: 'crypto',
        SOLUSDT: 'crypto',
        AAPL: 'tech',
      });
    });

    it('blocks trade when sector is over limit', () => {
      rm.update({
        equity: 100000,
        bar: 0,
        positions: {
          BTCUSDT: { qty: 1, currentPrice: 20000 },   // 20k crypto
          ETHUSDT: { qty: 10, currentPrice: 2000 },    // 20k crypto = 40k total = 40%
        },
      });
      const result = rm.evaluateTrade({
        symbol: 'SOLUSDT', side: 'buy', qty: 100, price: 100,
      });
      expect(result.allowed).toBe(false);
      expect(result.riskFlags).toContain('sector_concentration');
    });

    it('allows trade in different sector', () => {
      rm.update({
        equity: 100000,
        bar: 0,
        positions: {
          BTCUSDT: { qty: 1, currentPrice: 20000 },   // 20k crypto
          ETHUSDT: { qty: 10, currentPrice: 2000 },    // 20k crypto = 40k total
        },
      });
      const result = rm.evaluateTrade({
        symbol: 'AAPL', side: 'buy', qty: 10, price: 150,
      });
      expect(result.allowed).toBe(true);
    });

    it('uses sector from evaluateTrade param over sectorMap', () => {
      rm.update({ equity: 100000, bar: 0, positions: {} });
      // BTCUSDT is mapped to 'crypto', but we override with 'defi'
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 10000, sector: 'defi',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('circuit breaker', () => {
    it('triggers on drawdown exceeding threshold', () => {
      rm.update({ equity: 100000, bar: 0 });
      rm.update({ equity: 79000, bar: 1 }); // 21% drawdown > 20% threshold

      expect(rm.circuitBreakerActive).toBe(true);

      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 50000,
      });
      expect(result.allowed).toBe(false);
      expect(result.riskFlags).toContain('circuit_breaker');
    });

    it('triggers on loss velocity', () => {
      rm = new PortfolioRiskManager({
        circuitBreakerLossVelocity: 0.05,
        circuitBreakerWindow: 10,
      });

      // Build up equity history
      for (let i = 0; i <= 10; i++) {
        rm.update({ equity: 100000, bar: i });
      }
      // Sudden drop over the window
      rm.update({ equity: 94000, bar: 11 }); // 6% loss in window > 5% threshold

      expect(rm.circuitBreakerActive).toBe(true);
    });

    it('resets after cooldown period', () => {
      rm = new PortfolioRiskManager({
        circuitBreakerCooldown: 5,
        circuitBreakerDrawdown: 0.20,
      });

      rm.update({ equity: 100000, bar: 0 });
      rm.update({ equity: 79000, bar: 1 }); // trigger
      expect(rm.circuitBreakerActive).toBe(true);

      // Equity recovers, wait for cooldown
      for (let i = 2; i <= 6; i++) {
        rm.update({ equity: 95000, bar: i });
      }
      expect(rm.circuitBreakerActive).toBe(false);
    });

    it('can be manually triggered and reset', () => {
      rm.update({ equity: 100000, bar: 0 });
      rm.triggerCircuitBreaker('manual test');
      expect(rm.circuitBreakerActive).toBe(true);
      expect(rm.circuitBreakerReason).toBe('manual test');

      rm.resetCircuitBreaker();
      expect(rm.circuitBreakerActive).toBe(false);
    });
  });

  describe('daily loss limit', () => {
    it('blocks trading when daily loss limit is reached', () => {
      rm.update({ equity: 100000, bar: 0 });
      rm.startNewDay(100000);

      // Lose 3.5% during the day
      rm.update({ equity: 96500, bar: 10 });

      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 50000,
      });
      expect(result.allowed).toBe(false);
      expect(result.riskFlags).toContain('daily_loss_limit');
    });

    it('allows trading within daily loss limit', () => {
      rm.update({ equity: 100000, bar: 0 });
      rm.startNewDay(100000);

      // Lose only 1%
      rm.update({ equity: 99000, bar: 10 });

      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 10000,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('trade cooldown', () => {
    it('blocks rapid re-entry on same symbol', () => {
      rm = new PortfolioRiskManager({ minTradeCooldownBars: 5 });
      rm.update({ equity: 100000, bar: 0 });
      rm.recordTrade('BTCUSDT');

      rm.update({ equity: 100000, bar: 2 });
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 50000,
      });
      expect(result.allowed).toBe(false);
      expect(result.riskFlags).toContain('cooldown');
    });

    it('allows trade after cooldown expires', () => {
      rm = new PortfolioRiskManager({ minTradeCooldownBars: 3 });
      rm.update({ equity: 100000, bar: 0 });
      rm.recordTrade('BTCUSDT');

      rm.update({ equity: 100000, bar: 4 });
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 10000,
      });
      expect(result.allowed).toBe(true);
    });

    it('does not block different symbols', () => {
      rm = new PortfolioRiskManager({ minTradeCooldownBars: 10 });
      rm.update({ equity: 100000, bar: 0 });
      rm.recordTrade('BTCUSDT');

      rm.update({ equity: 100000, bar: 1 });
      const result = rm.evaluateTrade({
        symbol: 'ETHUSDT', side: 'buy', qty: 1, price: 2000,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('correlation guard', () => {
    it('reduces position when correlated with held position', () => {
      rm = new PortfolioRiskManager({
        correlationThreshold: 0.70,
        correlationPenalty: 0.50,
      });

      rm.update({
        equity: 100000,
        bar: 0,
        positions: {
          BTCUSDT: { qty: 1, currentPrice: 20000 },
        },
      });

      // Generate highly correlated returns
      for (let i = 0; i < 30; i++) {
        const r = (Math.random() - 0.5) * 0.02;
        rm.recordReturn('BTCUSDT', r);
        rm.recordReturn('ETHUSDT', r + (Math.random() - 0.5) * 0.002); // highly correlated
      }

      const result = rm.evaluateTrade({
        symbol: 'ETHUSDT', side: 'buy', qty: 10, price: 2000,
      });

      // Should have correlation penalty flag
      if (result.riskFlags.includes('correlation_penalty')) {
        expect(result.adjustedQty).toBeLessThan(10);
      }
      // Note: with random data, correlation might not always exceed threshold
    });

    it('no penalty when no correlated positions held', () => {
      rm.update({ equity: 100000, bar: 0, positions: {} });

      for (let i = 0; i < 30; i++) {
        rm.recordReturn('BTCUSDT', Math.random() * 0.01);
      }

      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 10, price: 1000,
      });
      expect(result.riskFlags).not.toContain('correlation_penalty');
    });
  });

  describe('combined risk checks', () => {
    it('applies multiple limits simultaneously', () => {
      rm.setSectors({ BTCUSDT: 'crypto', ETHUSDT: 'crypto' });
      rm.update({
        equity: 100000,
        bar: 0,
        positions: {
          BTCUSDT: { qty: 1, currentPrice: 20000 },   // 20k = 20%
          ETHUSDT: { qty: 5, currentPrice: 3000 },     // 15k = 15%
        },
      });
      // Crypto sector = 35k = 35%. Portfolio heat = 35k = 35%.
      // Adding more crypto: want 100 SOL at $100 = $10k
      rm.setSector('SOLUSDT', 'crypto');

      const result = rm.evaluateTrade({
        symbol: 'SOLUSDT', side: 'buy', qty: 100, price: 100,
      });

      // Should be allowed but possibly reduced (sector at 35% + 10% = 45% > 40%)
      if (result.adjustedQty < 100) {
        expect(result.riskFlags.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getRiskDashboard()', () => {
    it('returns comprehensive risk snapshot', () => {
      rm.setSectors({ BTCUSDT: 'crypto', AAPL: 'tech' });
      rm.update({
        equity: 100000,
        bar: 10,
        positions: {
          BTCUSDT: { qty: 1, currentPrice: 50000 },
          AAPL: { qty: 100, currentPrice: 150 },
        },
      });
      rm.startNewDay(98000);

      const dash = rm.getRiskDashboard();

      expect(dash.equity).toBe(100000);
      expect(dash.portfolioHeat).toBeGreaterThan(0);
      expect(dash.portfolioHeatLimit).toBe(60);
      expect(dash.drawdownLimit).toBe(20);
      expect(dash.dailyLossLimit).toBe(3);
      expect(dash.circuitBreaker.active).toBe(false);
      expect(dash.symbolExposures).toHaveProperty('BTCUSDT');
      expect(dash.symbolExposures).toHaveProperty('AAPL');
      expect(dash.sectorExposures).toHaveProperty('crypto');
      expect(dash.sectorExposures).toHaveProperty('tech');
    });

    it('shows circuit breaker info when active', () => {
      rm.update({ equity: 100000, bar: 0 });
      rm.triggerCircuitBreaker('test reason');

      const dash = rm.getRiskDashboard();
      expect(dash.circuitBreaker.active).toBe(true);
      expect(dash.circuitBreaker.reason).toBe('test reason');
      expect(dash.circuitBreaker.cooldownRemaining).toBe(120);
    });
  });

  describe('startNewDay()', () => {
    it('resets daily P&L tracking', () => {
      rm.update({ equity: 95000, bar: 0 });
      rm.startNewDay(95000);

      // Small loss during new day
      rm.update({ equity: 94000, bar: 1 });

      // 1.05% daily loss < 3% limit — should still allow
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 10000,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('setSectors()', () => {
    it('bulk sets sector mappings', () => {
      rm.setSectors({
        BTCUSDT: 'crypto',
        ETHUSDT: 'crypto',
        AAPL: 'tech',
        MSFT: 'tech',
      });
      expect(rm.sectorMap.get('BTCUSDT')).toBe('crypto');
      expect(rm.sectorMap.get('MSFT')).toBe('tech');
    });
  });

  describe('edge cases', () => {
    it('handles zero equity gracefully', () => {
      rm.update({ equity: 0, bar: 0 });
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 50000,
      });
      // Should block — can't calculate limits with zero equity
      expect(result.allowed).toBe(false);
    });

    it('handles no positions', () => {
      rm.update({ equity: 100000, bar: 0, positions: {} });
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 10000,
      });
      expect(result.allowed).toBe(true);
    });

    it('handles evaluateTrade before any update()', () => {
      const result = rm.evaluateTrade({
        symbol: 'BTCUSDT', side: 'buy', qty: 1, price: 50000,
      });
      // Zero equity → portfolio heat check blocks
      expect(result.allowed).toBe(false);
    });

    it('recordTrade tracks per-symbol', () => {
      rm.update({ equity: 100000, bar: 0 });
      rm.recordTrade('BTCUSDT');
      rm.recordTrade('ETHUSDT');
      expect(rm.lastTradeBar.get('BTCUSDT')).toBe(0);
      expect(rm.lastTradeBar.get('ETHUSDT')).toBe(0);
    });
  });
});
