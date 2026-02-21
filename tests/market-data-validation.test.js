import { describe, it, expect, vi } from 'vitest';
import { AlpacaConnector } from '../src/market-data/alpaca.js';
import { BinanceConnector } from '../src/market-data/binance.js';

describe('AlpacaConnector data validation', () => {
  describe('constructor defaults', () => {
    it('uses paper API URL by default', () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      expect(conn.baseUrl).toBe('https://paper-api.alpaca.markets');
    });

    it('uses live API URL when paper=false', () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test', paper: false });
      expect(conn.baseUrl).toBe('https://api.alpaca.markets');
    });

    it('falls back to environment variables for keys', () => {
      const origKey = process.env.ALPACA_KEY_ID;
      const origSecret = process.env.ALPACA_SECRET_KEY;
      process.env.ALPACA_KEY_ID = 'env-key';
      process.env.ALPACA_SECRET_KEY = 'env-secret';
      const conn = new AlpacaConnector();
      expect(conn.keyId).toBe('env-key');
      expect(conn.secretKey).toBe('env-secret');
      process.env.ALPACA_KEY_ID = origKey;
      process.env.ALPACA_SECRET_KEY = origSecret;
    });

    it('sets correct auth headers', () => {
      const conn = new AlpacaConnector({ keyId: 'mykey', secretKey: 'mysecret' });
      expect(conn.headers).toEqual({
        'APCA-API-KEY-ID': 'mykey',
        'APCA-API-SECRET-KEY': 'mysecret',
      });
    });
  });

  describe('API error handling', () => {
    it('throws on non-ok account response', async () => {
      const conn = new AlpacaConnector({ keyId: 'bad', secretKey: 'bad' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 401,
      });
      await expect(conn.getAccount()).rejects.toThrow('Alpaca account error: 401');
      vi.restoreAllMocks();
    });

    it('throws on non-ok quote response', async () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 404,
      });
      await expect(conn.getLatestQuote('INVALID')).rejects.toThrow('Alpaca quote error: 404');
      vi.restoreAllMocks();
    });

    it('throws on non-ok crypto quote response', async () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 500,
      });
      await expect(conn.getLatestCryptoQuote('BTCUSD')).rejects.toThrow('Alpaca crypto quote error: 500');
      vi.restoreAllMocks();
    });

    it('throws on non-ok bars response', async () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 429,
      });
      await expect(conn.getBars('AAPL')).rejects.toThrow('Alpaca bars error: 429');
      vi.restoreAllMocks();
    });

    it('throws on non-ok order submission', async () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 422,
      });
      await expect(conn.submitOrder({
        symbol: 'AAPL', qty: 1, side: 'buy',
      })).rejects.toThrow('Alpaca order error: 422');
      vi.restoreAllMocks();
    });

    it('throws on non-ok positions response', async () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 403,
      });
      await expect(conn.getPositions()).rejects.toThrow('Alpaca positions error: 403');
      vi.restoreAllMocks();
    });

    it('throws on non-ok orders response', async () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 500,
      });
      await expect(conn.getOrders()).rejects.toThrow('Alpaca orders error: 500');
      vi.restoreAllMocks();
    });
  });

  describe('successful data parsing', () => {
    it('getBars passes correct params', async () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      const mockBars = { bars: [{ o: 100, h: 105, l: 99, c: 103, v: 1000 }] };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBars),
      });
      const result = await conn.getBars('AAPL', { timeframe: '1Hour', limit: 50 });
      expect(result).toEqual(mockBars);
      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toContain('AAPL/bars');
      expect(calledUrl).toContain('timeframe=1Hour');
      expect(calledUrl).toContain('limit=50');
      vi.restoreAllMocks();
    });

    it('submitOrder sends correct body', async () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'order123' }),
      });
      await conn.submitOrder({
        symbol: 'AAPL', qty: 10, side: 'buy', type: 'limit', timeInForce: 'day',
      });
      const callArgs = fetchSpy.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.symbol).toBe('AAPL');
      expect(body.qty).toBe('10'); // stringified
      expect(body.side).toBe('buy');
      expect(body.type).toBe('limit');
      expect(body.time_in_force).toBe('day');
      vi.restoreAllMocks();
    });
  });
});

describe('BinanceConnector data validation', () => {
  describe('constructor defaults', () => {
    it('uses testnet URL by default', () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      expect(conn.baseUrl).toBe('https://testnet.binance.vision/api');
    });

    it('uses production URL when testnet=false', () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test', testnet: false });
      expect(conn.baseUrl).toBe('https://api.binance.com/api');
    });

    it('falls back to environment variables for keys', () => {
      const origKey = process.env.BINANCE_API_KEY;
      const origSecret = process.env.BINANCE_SECRET_KEY;
      process.env.BINANCE_API_KEY = 'env-binance-key';
      process.env.BINANCE_SECRET_KEY = 'env-binance-secret';
      const conn = new BinanceConnector();
      expect(conn.apiKey).toBe('env-binance-key');
      expect(conn.secretKey).toBe('env-binance-secret');
      process.env.BINANCE_API_KEY = origKey;
      process.env.BINANCE_SECRET_KEY = origSecret;
    });

    it('sets correct auth headers', () => {
      const conn = new BinanceConnector({ apiKey: 'mykey', secretKey: 'mysecret' });
      expect(conn.headers).toEqual({
        'X-MBX-APIKEY': 'mykey',
      });
    });
  });

  describe('HMAC signing', () => {
    it('produces a valid hex signature', () => {
      const conn = new BinanceConnector({ apiKey: 'key', secretKey: 'secret' });
      const signed = conn.sign({ timestamp: 12345, recvWindow: 5000 });
      expect(signed).toContain('timestamp=12345');
      expect(signed).toContain('recvWindow=5000');
      expect(signed).toContain('signature=');
      // Signature should be 64 hex chars
      const sig = signed.split('signature=')[1];
      expect(sig).toMatch(/^[a-f0-9]{64}$/);
    });

    it('different secrets produce different signatures', () => {
      const conn1 = new BinanceConnector({ apiKey: 'key', secretKey: 'secret1' });
      const conn2 = new BinanceConnector({ apiKey: 'key', secretKey: 'secret2' });
      const params = { timestamp: 99999 };
      const sig1 = conn1.sign(params).split('signature=')[1];
      const sig2 = conn2.sign(params).split('signature=')[1];
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('API error handling', () => {
    it('throws on non-ok account info response', async () => {
      const conn = new BinanceConnector({ apiKey: 'bad', secretKey: 'bad' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 401,
      });
      await expect(conn.getAccountInfo()).rejects.toThrow('Binance account error: 401');
      vi.restoreAllMocks();
    });

    it('throws on non-ok price response', async () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 400,
      });
      await expect(conn.getPrice('INVALID')).rejects.toThrow('Binance price error: 400');
      vi.restoreAllMocks();
    });

    it('throws on non-ok klines response', async () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 429,
      });
      await expect(conn.getKlines('BTCUSDT')).rejects.toThrow('Binance klines error: 429');
      vi.restoreAllMocks();
    });

    it('throws on non-ok 24h ticker response', async () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 500,
      });
      await expect(conn.get24hTicker('BTCUSDT')).rejects.toThrow('Binance 24h ticker error: 500');
      vi.restoreAllMocks();
    });

    it('throws on non-ok order submission', async () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 400,
      });
      await expect(conn.submitOrder({
        symbol: 'BTCUSDT', side: 'buy', quantity: 0.001,
      })).rejects.toThrow('Binance order error: 400');
      vi.restoreAllMocks();
    });

    it('throws on non-ok open orders response', async () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 403,
      });
      await expect(conn.getOpenOrders('BTCUSDT')).rejects.toThrow('Binance open orders error: 403');
      vi.restoreAllMocks();
    });
  });

  describe('data parsing', () => {
    it('getKlines transforms raw arrays into objects', async () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      const rawKlines = [
        [1672531200000, '16500.00', '16600.00', '16400.00', '16550.00', '1234.56', 1672617599999],
        [1672617600000, '16550.00', '16700.00', '16500.00', '16680.00', '2345.67', 1672703999999],
      ];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(rawKlines),
      });
      const result = await conn.getKlines('BTCUSDT');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        openTime: 1672531200000,
        open: 16500,
        high: 16600,
        low: 16400,
        close: 16550,
        volume: 1234.56,
        closeTime: 1672617599999,
      });
      expect(result[1].open).toBe(16550);
      vi.restoreAllMocks();
    });

    it('getKlines handles empty response', async () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      const result = await conn.getKlines('BTCUSDT');
      expect(result).toEqual([]);
      vi.restoreAllMocks();
    });

    it('submitOrder sends side uppercased', async () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ orderId: 123 }),
      });
      await conn.submitOrder({ symbol: 'BTCUSDT', side: 'buy', quantity: 1 });
      const url = fetchSpy.mock.calls[0][0];
      expect(url).toContain('side=BUY');
      vi.restoreAllMocks();
    });

    it('submitOrder stringifies quantity', async () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ orderId: 456 }),
      });
      await conn.submitOrder({ symbol: 'ETHUSDT', side: 'sell', quantity: 0.5 });
      const url = fetchSpy.mock.calls[0][0];
      expect(url).toContain('quantity=0.5');
      vi.restoreAllMocks();
    });
  });

  describe('network failure simulation', () => {
    it('Alpaca handles fetch rejection (network down)', async () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(conn.getAccount()).rejects.toThrow('ECONNREFUSED');
      vi.restoreAllMocks();
    });

    it('Binance handles fetch rejection (network down)', async () => {
      const conn = new BinanceConnector({ apiKey: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ETIMEDOUT'));
      await expect(conn.getPrice('BTCUSDT')).rejects.toThrow('ETIMEDOUT');
      vi.restoreAllMocks();
    });

    it('Alpaca handles timeout-like rejection', async () => {
      const conn = new AlpacaConnector({ keyId: 'test', secretKey: 'test' });
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('AbortError'));
      await expect(conn.getBars('AAPL')).rejects.toThrow('AbortError');
      vi.restoreAllMocks();
    });
  });
});
