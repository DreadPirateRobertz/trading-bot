// Alpaca Market Data Connector
// Handles stocks + crypto via Alpaca Markets API

export class AlpacaConnector {
  constructor({ keyId, secretKey, paper = true } = {}) {
    this.keyId = keyId || process.env.ALPACA_KEY_ID;
    this.secretKey = secretKey || process.env.ALPACA_SECRET_KEY;
    this.paper = paper;
    this.baseUrl = paper
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';
    this.dataUrl = 'https://data.alpaca.markets';
  }

  get headers() {
    return {
      'APCA-API-KEY-ID': this.keyId,
      'APCA-API-SECRET-KEY': this.secretKey,
    };
  }

  async getAccount() {
    const res = await fetch(`${this.baseUrl}/v2/account`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Alpaca account error: ${res.status}`);
    return res.json();
  }

  async getLatestQuote(symbol) {
    const res = await fetch(
      `${this.dataUrl}/v2/stocks/${symbol}/quotes/latest`,
      { headers: this.headers }
    );
    if (!res.ok) throw new Error(`Alpaca quote error: ${res.status}`);
    return res.json();
  }

  async getLatestCryptoQuote(symbol) {
    const res = await fetch(
      `${this.dataUrl}/v1beta3/crypto/us/latest/quotes?symbols=${symbol}`,
      { headers: this.headers }
    );
    if (!res.ok) throw new Error(`Alpaca crypto quote error: ${res.status}`);
    return res.json();
  }

  async getBars(symbol, { timeframe = '1Day', start, end, limit = 100 } = {}) {
    const params = new URLSearchParams({ timeframe, limit: String(limit) });
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const res = await fetch(
      `${this.dataUrl}/v2/stocks/${symbol}/bars?${params}`,
      { headers: this.headers }
    );
    if (!res.ok) throw new Error(`Alpaca bars error: ${res.status}`);
    return res.json();
  }

  async submitOrder({ symbol, qty, side, type = 'market', timeInForce = 'gtc' }) {
    const res = await fetch(`${this.baseUrl}/v2/orders`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, qty: String(qty), side, type, time_in_force: timeInForce }),
    });
    if (!res.ok) throw new Error(`Alpaca order error: ${res.status}`);
    return res.json();
  }

  async getPositions() {
    const res = await fetch(`${this.baseUrl}/v2/positions`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Alpaca positions error: ${res.status}`);
    return res.json();
  }

  async getOrders({ status = 'open' } = {}) {
    const res = await fetch(`${this.baseUrl}/v2/orders?status=${status}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Alpaca orders error: ${res.status}`);
    return res.json();
  }
}
