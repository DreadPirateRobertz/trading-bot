// Alert & Notification System
// Sends trade alerts, risk events, and daily summaries via webhooks.
// Supports Discord, Slack, and Telegram with rate limiting.

const ALERT_TYPES = {
  TRADE_EXECUTED: 'trade_executed',
  SIGNAL_GENERATED: 'signal_generated',
  RISK_EVENT: 'risk_event',
  CIRCUIT_BREAKER: 'circuit_breaker',
  DAILY_SUMMARY: 'daily_summary',
  SYSTEM_ERROR: 'system_error',
};

const SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

export class Notifier {
  constructor({
    channels = [],          // [{ type: 'discord'|'slack'|'telegram', url, chatId?, token? }]
    rateLimitPerMinute = 10,
    alertFilters = null,    // { minConfidence: 0.3, types: [...] } — only send matching alerts
    enabled = true,
    fetchFn = null,         // injectable fetch for testing
  } = {}) {
    this.channels = channels;
    this.rateLimitPerMinute = rateLimitPerMinute;
    this.alertFilters = alertFilters;
    this.enabled = enabled;
    this.fetchFn = fetchFn || globalThis.fetch;

    // Rate limiting state
    this.sentTimestamps = [];
    this.alertHistory = [];
    this.errorCount = 0;
    this.successCount = 0;
  }

  // Send a trade execution alert
  async tradeExecuted({ symbol, action, qty, price, pnl, confidence, method }) {
    const emoji = action === 'BUY' ? '🟢' : '🔴';
    const pnlStr = pnl !== undefined ? ` | P&L: $${pnl.toFixed(2)}` : '';

    return this._send({
      type: ALERT_TYPES.TRADE_EXECUTED,
      severity: SEVERITY.INFO,
      title: `${emoji} ${action} ${symbol}`,
      message: `${qty} @ $${price.toFixed(2)}${pnlStr}`,
      fields: {
        Symbol: symbol,
        Action: action,
        Quantity: String(qty),
        Price: `$${price.toFixed(2)}`,
        Confidence: `${(confidence * 100).toFixed(0)}%`,
        Method: method || 'n/a',
        ...(pnl !== undefined ? { 'P&L': `$${pnl.toFixed(2)}` } : {}),
      },
    });
  }

  // Send a signal alert (for high-confidence signals)
  async signalGenerated({ symbol, action, confidence, reasons, regime }) {
    if (this.alertFilters?.minConfidence && confidence < this.alertFilters.minConfidence) {
      return { sent: false, reason: 'below confidence threshold' };
    }

    return this._send({
      type: ALERT_TYPES.SIGNAL_GENERATED,
      severity: SEVERITY.INFO,
      title: `Signal: ${action} ${symbol}`,
      message: `Confidence: ${(confidence * 100).toFixed(0)}%${regime ? ` | Regime: ${regime}` : ''}`,
      fields: {
        Symbol: symbol,
        Action: action,
        Confidence: `${(confidence * 100).toFixed(0)}%`,
        ...(regime ? { Regime: regime } : {}),
        Reasons: (reasons || []).join(', ') || 'n/a',
      },
    });
  }

  // Send a risk event alert
  async riskEvent({ type, reason, flags, symbol }) {
    return this._send({
      type: ALERT_TYPES.RISK_EVENT,
      severity: SEVERITY.WARNING,
      title: `Risk: ${type}`,
      message: reason,
      fields: {
        Type: type,
        ...(symbol ? { Symbol: symbol } : {}),
        Flags: (flags || []).join(', ') || 'none',
        Reason: reason,
      },
    });
  }

  // Send circuit breaker alert
  async circuitBreaker({ reason, drawdown, cooldownBars }) {
    return this._send({
      type: ALERT_TYPES.CIRCUIT_BREAKER,
      severity: SEVERITY.CRITICAL,
      title: 'CIRCUIT BREAKER TRIGGERED',
      message: reason,
      fields: {
        Reason: reason,
        ...(drawdown !== undefined ? { Drawdown: `${(drawdown * 100).toFixed(1)}%` } : {}),
        ...(cooldownBars !== undefined ? { Cooldown: `${cooldownBars} bars` } : {}),
      },
    });
  }

  // Send daily summary
  async dailySummary({ date, equity, dailyPnl, trades, winRate, sharpe, riskDashboard }) {
    const pnlEmoji = dailyPnl >= 0 ? '📈' : '📉';

    return this._send({
      type: ALERT_TYPES.DAILY_SUMMARY,
      severity: SEVERITY.INFO,
      title: `${pnlEmoji} Daily Summary — ${date}`,
      message: `Equity: $${equity.toFixed(2)} | P&L: $${dailyPnl.toFixed(2)}`,
      fields: {
        Date: date,
        Equity: `$${equity.toFixed(2)}`,
        'Daily P&L': `$${dailyPnl.toFixed(2)}`,
        Trades: String(trades || 0),
        'Win Rate': winRate !== undefined ? `${winRate.toFixed(0)}%` : 'n/a',
        Sharpe: sharpe !== undefined ? sharpe.toFixed(2) : 'n/a',
        ...(riskDashboard ? {
          'Portfolio Heat': `${riskDashboard.portfolioHeat}%`,
          Drawdown: `${riskDashboard.drawdown}%`,
        } : {}),
      },
    });
  }

  // Send system error alert
  async systemError({ source, error, context }) {
    return this._send({
      type: ALERT_TYPES.SYSTEM_ERROR,
      severity: SEVERITY.CRITICAL,
      title: `System Error: ${source}`,
      message: typeof error === 'string' ? error : error?.message || 'Unknown error',
      fields: {
        Source: source,
        Error: typeof error === 'string' ? error : error?.message || 'Unknown',
        ...(context ? { Context: JSON.stringify(context) } : {}),
      },
    });
  }

  // Core send method — formats and dispatches to all channels
  async _send({ type, severity, title, message, fields }) {
    if (!this.enabled) return { sent: false, reason: 'disabled' };

    // Alert type filter
    if (this.alertFilters?.types && !this.alertFilters.types.includes(type)) {
      return { sent: false, reason: 'filtered by type' };
    }

    // Rate limiting
    if (this._isRateLimited()) {
      return { sent: false, reason: 'rate limited' };
    }

    const alert = { type, severity, title, message, fields, timestamp: Date.now() };
    this.alertHistory.push(alert);
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-500);
    }

    const results = [];
    for (const channel of this.channels) {
      try {
        const payload = this._formatForChannel(channel, alert);
        const result = await this._dispatch(channel, payload);
        results.push({ channel: channel.type, success: true, ...result });
        this.successCount++;
      } catch (err) {
        results.push({ channel: channel.type, success: false, error: err.message });
        this.errorCount++;
      }
    }

    this.sentTimestamps.push(Date.now());

    return { sent: true, results };
  }

  // Format alert for specific channel type
  _formatForChannel(channel, alert) {
    switch (channel.type) {
      case 'discord':
        return this._formatDiscord(alert);
      case 'slack':
        return this._formatSlack(alert);
      case 'telegram':
        return this._formatTelegram(alert);
      default:
        return this._formatGeneric(alert);
    }
  }

  _formatDiscord(alert) {
    const colorMap = {
      [SEVERITY.INFO]: 0x3498db,     // blue
      [SEVERITY.WARNING]: 0xf39c12,  // orange
      [SEVERITY.CRITICAL]: 0xe74c3c, // red
    };

    const fields = Object.entries(alert.fields || {}).map(([name, value]) => ({
      name,
      value: String(value),
      inline: value.length < 30,
    }));

    return {
      embeds: [{
        title: alert.title,
        description: alert.message,
        color: colorMap[alert.severity] || 0x95a5a6,
        fields,
        timestamp: new Date(alert.timestamp).toISOString(),
        footer: { text: `Trading Bot | ${alert.type}` },
      }],
    };
  }

  _formatSlack(alert) {
    const emojiMap = {
      [SEVERITY.INFO]: ':information_source:',
      [SEVERITY.WARNING]: ':warning:',
      [SEVERITY.CRITICAL]: ':rotating_light:',
    };

    const fieldBlocks = Object.entries(alert.fields || {}).map(([key, value]) => ({
      type: 'mrkdwn',
      text: `*${key}:* ${value}`,
    }));

    return {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${emojiMap[alert.severity] || ''} ${alert.title}` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: alert.message },
        },
        ...(fieldBlocks.length > 0 ? [{
          type: 'section',
          fields: fieldBlocks.slice(0, 10), // Slack max 10 fields per section
        }] : []),
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `_${alert.type} | ${new Date(alert.timestamp).toLocaleString()}_` }],
        },
      ],
    };
  }

  _formatTelegram(alert) {
    const emojiMap = {
      [SEVERITY.INFO]: 'ℹ️',
      [SEVERITY.WARNING]: '⚠️',
      [SEVERITY.CRITICAL]: '🚨',
    };

    const fieldLines = Object.entries(alert.fields || {})
      .map(([key, value]) => `<b>${key}:</b> ${escapeHtml(String(value))}`)
      .join('\n');

    const text = [
      `${emojiMap[alert.severity] || ''} <b>${escapeHtml(alert.title)}</b>`,
      escapeHtml(alert.message),
      '',
      fieldLines,
      '',
      `<i>${alert.type} | ${new Date(alert.timestamp).toLocaleString()}</i>`,
    ].join('\n');

    return { text, parse_mode: 'HTML' };
  }

  _formatGeneric(alert) {
    return {
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      type: alert.type,
      fields: alert.fields,
      timestamp: alert.timestamp,
    };
  }

  // Dispatch payload to channel endpoint
  async _dispatch(channel, payload) {
    switch (channel.type) {
      case 'discord':
      case 'slack':
        return this._postWebhook(channel.url, payload);
      case 'telegram':
        return this._postTelegram(channel, payload);
      default:
        if (channel.url) return this._postWebhook(channel.url, payload);
        throw new Error(`Unknown channel type: ${channel.type}`);
    }
  }

  async _postWebhook(url, payload) {
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Webhook error: ${res.status} ${res.statusText}`);
    }
    return { status: res.status };
  }

  async _postTelegram(channel, payload) {
    const url = `https://api.telegram.org/bot${channel.token}/sendMessage`;
    const body = {
      chat_id: channel.chatId,
      text: payload.text,
      parse_mode: payload.parse_mode,
    };
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Telegram error: ${res.status} ${res.statusText}`);
    }
    return { status: res.status };
  }

  _isRateLimited() {
    const now = Date.now();
    const windowStart = now - 60000;
    this.sentTimestamps = this.sentTimestamps.filter(ts => ts > windowStart);
    return this.sentTimestamps.length >= this.rateLimitPerMinute;
  }

  // Get notifier stats
  getStats() {
    return {
      enabled: this.enabled,
      channels: this.channels.length,
      totalSent: this.successCount,
      totalErrors: this.errorCount,
      recentAlerts: this.alertHistory.slice(-10).map(a => ({
        type: a.type,
        severity: a.severity,
        title: a.title,
        timestamp: a.timestamp,
      })),
      rateLimitRemaining: Math.max(0, this.rateLimitPerMinute - this.sentTimestamps.filter(
        ts => ts > Date.now() - 60000
      ).length),
    };
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export { ALERT_TYPES, SEVERITY };
