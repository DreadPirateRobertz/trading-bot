// Binance Market Data Connector
// Handles crypto trading via Binance API

import { createHmac } from 'node:crypto';

export class BinanceConnector {
  constructor({ apiKey, secretKey, testnet = true } = {}) {
    this.apiKey = apiKey || process.env.BINANCE_API_KEY;
    this.secretKey = secretKey || process.env.BINANCE_SECRET_KEY;
    this.testnet = testnet;
    this.baseUrl = testnet
      ? 'https://testnet.binance.vision/api'
      : 'https://api.binance.com/api';
  }

  sign(params) {
    const query = new URLSearchParams(params).toString();
    const signature = createHmac('sha256', this.secretKey)
      .update(query)
      .digest('hex');
    return `${query}&signature=${signature}`;
  }

  get headers() {
    return { 'X-MBX-APIKEY': this.apiKey };
  }

  async getAccountInfo() {
    const params = { timestamp: Date.now(), recvWindow: 5000 };
    const signed = this.sign(params);
    const res = await fetch(`${this.baseUrl}/v3/account?${signed}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Binance account error: ${res.status}`);
    return res.json();
  }

  async getPrice(symbol) {
    const res = await fetch(
      `${this.baseUrl}/v3/ticker/price?symbol=${symbol}`
    );
    if (!res.ok) throw new Error(`Binance price error: ${res.status}`);
    return res.json();
  }

  async getKlines(symbol, { interval = '1d', limit = 100 } = {}) {
    const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
    const res = await fetch(`${this.baseUrl}/v3/klines?${params}`);
    if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
    const data = await res.json();
    return data.map(k => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
    }));
  }

  async get24hTicker(symbol) {
    const res = await fetch(
      `${this.baseUrl}/v3/ticker/24hr?symbol=${symbol}`
    );
    if (!res.ok) throw new Error(`Binance 24h ticker error: ${res.status}`);
    return res.json();
  }

  async submitOrder({ symbol, side, type = 'MARKET', quantity }) {
    const params = {
      symbol,
      side: side.toUpperCase(),
      type,
      quantity: String(quantity),
      timestamp: Date.now(),
      recvWindow: 5000,
    };
    const signed = this.sign(params);
    const res = await fetch(`${this.baseUrl}/v3/order?${signed}`, {
      method: 'POST',
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Binance order error: ${res.status}`);
    return res.json();
  }

  async getOpenOrders(symbol) {
    const params = { symbol, timestamp: Date.now(), recvWindow: 5000 };
    const signed = this.sign(params);
    const res = await fetch(`${this.baseUrl}/v3/openOrders?${signed}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Binance open orders error: ${res.status}`);
    return res.json();
  }
}
