import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Notifier, ALERT_TYPES, SEVERITY } from '../src/alerts/notifier.js';

// Mock fetch that records calls
function createMockFetch(status = 200) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Error' };
  };
  fn.calls = calls;
  return fn;
}

describe('Notifier', () => {
  let notifier;
  let mockFetch;

  beforeEach(() => {
    mockFetch = createMockFetch();
    notifier = new Notifier({
      channels: [
        { type: 'discord', url: 'https://discord.com/api/webhooks/test' },
      ],
      fetchFn: mockFetch,
    });
  });

  describe('constructor', () => {
    it('initializes with defaults', () => {
      const n = new Notifier();
      expect(n.enabled).toBe(true);
      expect(n.rateLimitPerMinute).toBe(10);
      expect(n.channels).toEqual([]);
    });

    it('accepts custom config', () => {
      const n = new Notifier({
        channels: [{ type: 'slack', url: 'https://hooks.slack.com/test' }],
        rateLimitPerMinute: 5,
        enabled: false,
      });
      expect(n.channels.length).toBe(1);
      expect(n.rateLimitPerMinute).toBe(5);
      expect(n.enabled).toBe(false);
    });
  });

  describe('tradeExecuted()', () => {
    it('sends trade alert to Discord', async () => {
      const result = await notifier.tradeExecuted({
        symbol: 'BTCUSDT', action: 'BUY', qty: 0.5, price: 50000,
        confidence: 0.75, method: 'kelly+regime',
      });

      expect(result.sent).toBe(true);
      expect(mockFetch.calls.length).toBe(1);

      const body = mockFetch.calls[0].body;
      expect(body.embeds[0].title).toContain('BUY BTCUSDT');
      expect(body.embeds[0].color).toBe(0x3498db); // info = blue
    });

    it('includes P&L when provided', async () => {
      await notifier.tradeExecuted({
        symbol: 'ETHUSDT', action: 'SELL', qty: 10, price: 3000,
        confidence: 0.6, pnl: 500.50,
      });

      const body = mockFetch.calls[0].body;
      expect(body.embeds[0].description).toContain('P&L');
      const pnlField = body.embeds[0].fields.find(f => f.name === 'P&L');
      expect(pnlField.value).toBe('$500.50');
    });
  });

  describe('signalGenerated()', () => {
    it('sends signal alert', async () => {
      const result = await notifier.signalGenerated({
        symbol: 'BTCUSDT', action: 'BUY', confidence: 0.8,
        reasons: ['RSI oversold', 'MACD bullish'], regime: 'bull_low_vol',
      });

      expect(result.sent).toBe(true);
      const body = mockFetch.calls[0].body;
      expect(body.embeds[0].title).toContain('Signal: BUY BTCUSDT');
    });

    it('filters by minimum confidence', async () => {
      notifier.alertFilters = { minConfidence: 0.5 };

      const result = await notifier.signalGenerated({
        symbol: 'BTCUSDT', action: 'BUY', confidence: 0.3,
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('below confidence threshold');
      expect(mockFetch.calls.length).toBe(0);
    });
  });

  describe('riskEvent()', () => {
    it('sends risk event with warning severity', async () => {
      await notifier.riskEvent({
        type: 'portfolio_heat', reason: 'Heat at 58%', flags: ['portfolio_heat'], symbol: 'BTCUSDT',
      });

      const body = mockFetch.calls[0].body;
      expect(body.embeds[0].color).toBe(0xf39c12); // warning = orange
    });
  });

  describe('circuitBreaker()', () => {
    it('sends critical alert for circuit breaker', async () => {
      await notifier.circuitBreaker({
        reason: 'Drawdown 22% exceeds 20% limit', drawdown: 0.22, cooldownBars: 120,
      });

      const body = mockFetch.calls[0].body;
      expect(body.embeds[0].title).toBe('CIRCUIT BREAKER TRIGGERED');
      expect(body.embeds[0].color).toBe(0xe74c3c); // critical = red
    });
  });

  describe('dailySummary()', () => {
    it('sends daily summary', async () => {
      await notifier.dailySummary({
        date: '2026-02-21', equity: 105000, dailyPnl: 3200,
        trades: 8, winRate: 62.5, sharpe: 1.2,
        riskDashboard: { portfolioHeat: 45, drawdown: 3.5 },
      });

      const body = mockFetch.calls[0].body;
      expect(body.embeds[0].title).toContain('Daily Summary');
      expect(body.embeds[0].description).toContain('$105000');
    });
  });

  describe('systemError()', () => {
    it('sends error alert', async () => {
      await notifier.systemError({
        source: 'binance_ws', error: 'Connection refused', context: { attempts: 3 },
      });

      const body = mockFetch.calls[0].body;
      expect(body.embeds[0].title).toContain('System Error');
      expect(body.embeds[0].color).toBe(0xe74c3c);
    });

    it('handles Error objects', async () => {
      await notifier.systemError({
        source: 'api', error: new Error('timeout'),
      });

      const body = mockFetch.calls[0].body;
      const errorField = body.embeds[0].fields.find(f => f.name === 'Error');
      expect(errorField.value).toBe('timeout');
    });
  });

  describe('Slack formatting', () => {
    it('formats messages for Slack', async () => {
      const slackNotifier = new Notifier({
        channels: [{ type: 'slack', url: 'https://hooks.slack.com/test' }],
        fetchFn: mockFetch,
      });

      await slackNotifier.tradeExecuted({
        symbol: 'BTCUSDT', action: 'BUY', qty: 1, price: 50000, confidence: 0.8,
      });

      const body = mockFetch.calls[0].body;
      expect(body.blocks).toBeDefined();
      expect(body.blocks[0].type).toBe('header');
      expect(body.blocks[1].type).toBe('section');
    });
  });

  describe('Telegram formatting', () => {
    it('formats messages for Telegram', async () => {
      const tgNotifier = new Notifier({
        channels: [{ type: 'telegram', token: 'bot123', chatId: '456' }],
        fetchFn: mockFetch,
      });

      await tgNotifier.tradeExecuted({
        symbol: 'BTCUSDT', action: 'BUY', qty: 1, price: 50000, confidence: 0.8,
      });

      const call = mockFetch.calls[0];
      expect(call.url).toContain('api.telegram.org/bot');
      expect(call.body.chat_id).toBe('456');
      expect(call.body.parse_mode).toBe('HTML');
      expect(call.body.text).toContain('BUY BTCUSDT');
    });

    it('escapes HTML in messages', async () => {
      const tgNotifier = new Notifier({
        channels: [{ type: 'telegram', token: 'bot123', chatId: '456' }],
        fetchFn: mockFetch,
      });

      await tgNotifier.riskEvent({
        type: 'test', reason: 'Value <script>alert(1)</script>',
      });

      const body = mockFetch.calls[0].body;
      expect(body.text).not.toContain('<script>');
      expect(body.text).toContain('&lt;script&gt;');
    });
  });

  describe('multi-channel', () => {
    it('sends to all configured channels', async () => {
      const multiNotifier = new Notifier({
        channels: [
          { type: 'discord', url: 'https://discord.com/webhook1' },
          { type: 'slack', url: 'https://hooks.slack.com/webhook2' },
        ],
        fetchFn: mockFetch,
      });

      const result = await multiNotifier.tradeExecuted({
        symbol: 'BTCUSDT', action: 'BUY', qty: 1, price: 50000, confidence: 0.8,
      });

      expect(result.sent).toBe(true);
      expect(result.results.length).toBe(2);
      expect(mockFetch.calls.length).toBe(2);
    });
  });

  describe('rate limiting', () => {
    it('blocks after reaching rate limit', async () => {
      const limited = new Notifier({
        channels: [{ type: 'discord', url: 'https://discord.com/test' }],
        rateLimitPerMinute: 3,
        fetchFn: mockFetch,
      });

      await limited.tradeExecuted({ symbol: 'A', action: 'BUY', qty: 1, price: 100, confidence: 0.5 });
      await limited.tradeExecuted({ symbol: 'B', action: 'BUY', qty: 1, price: 100, confidence: 0.5 });
      await limited.tradeExecuted({ symbol: 'C', action: 'BUY', qty: 1, price: 100, confidence: 0.5 });
      const result = await limited.tradeExecuted({ symbol: 'D', action: 'BUY', qty: 1, price: 100, confidence: 0.5 });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('rate limited');
      expect(mockFetch.calls.length).toBe(3); // only 3 sent
    });
  });

  describe('alert filters', () => {
    it('filters by alert type', async () => {
      notifier.alertFilters = { types: [ALERT_TYPES.CIRCUIT_BREAKER, ALERT_TYPES.SYSTEM_ERROR] };

      const tradeResult = await notifier.tradeExecuted({
        symbol: 'BTCUSDT', action: 'BUY', qty: 1, price: 50000, confidence: 0.5,
      });
      expect(tradeResult.sent).toBe(false);
      expect(tradeResult.reason).toBe('filtered by type');

      const cbResult = await notifier.circuitBreaker({ reason: 'test' });
      expect(cbResult.sent).toBe(true);
    });
  });

  describe('disabled notifier', () => {
    it('returns immediately when disabled', async () => {
      notifier.enabled = false;

      const result = await notifier.tradeExecuted({
        symbol: 'BTCUSDT', action: 'BUY', qty: 1, price: 50000, confidence: 0.5,
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('disabled');
      expect(mockFetch.calls.length).toBe(0);
    });
  });

  describe('error handling', () => {
    it('records errors when webhook fails', async () => {
      const failFetch = createMockFetch(500);
      const errorNotifier = new Notifier({
        channels: [{ type: 'discord', url: 'https://discord.com/test' }],
        fetchFn: failFetch,
      });

      const result = await errorNotifier.tradeExecuted({
        symbol: 'BTCUSDT', action: 'BUY', qty: 1, price: 50000, confidence: 0.5,
      });

      expect(result.sent).toBe(true); // alert was attempted
      expect(result.results[0].success).toBe(false);
      expect(errorNotifier.errorCount).toBe(1);
    });
  });

  describe('getStats()', () => {
    it('returns notifier statistics', async () => {
      await notifier.tradeExecuted({
        symbol: 'BTCUSDT', action: 'BUY', qty: 1, price: 50000, confidence: 0.5,
      });

      const stats = notifier.getStats();
      expect(stats.enabled).toBe(true);
      expect(stats.channels).toBe(1);
      expect(stats.totalSent).toBe(1);
      expect(stats.totalErrors).toBe(0);
      expect(stats.recentAlerts.length).toBe(1);
      expect(stats.rateLimitRemaining).toBeLessThanOrEqual(10);
    });
  });

  describe('ALERT_TYPES and SEVERITY exports', () => {
    it('exports all alert types', () => {
      expect(ALERT_TYPES.TRADE_EXECUTED).toBe('trade_executed');
      expect(ALERT_TYPES.CIRCUIT_BREAKER).toBe('circuit_breaker');
      expect(ALERT_TYPES.DAILY_SUMMARY).toBe('daily_summary');
    });

    it('exports severity levels', () => {
      expect(SEVERITY.INFO).toBe('info');
      expect(SEVERITY.WARNING).toBe('warning');
      expect(SEVERITY.CRITICAL).toBe('critical');
    });
  });
});
