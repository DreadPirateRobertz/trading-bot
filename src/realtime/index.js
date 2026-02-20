// Real-Time Paper Trading Engine
// Connects WebSocket price feeds to signal engine for live paper trading

import { SignalEngine } from '../signals/engine.js';
import { PositionSizer } from '../signals/position-sizer.js';
import { PaperTrader } from '../paper-trading/index.js';

export class RealtimeTrader {
  constructor({
    initialBalance = 100000,
    symbols = [],
    lookback = 30,
    signalEngineConfig,
    positionSizerConfig,
    onSignal,
    onTrade,
    onError,
  } = {}) {
    this.signalEngine = new SignalEngine(signalEngineConfig);
    this.positionSizer = new PositionSizer(positionSizerConfig);
    this.trader = new PaperTrader({ initialBalance });
    this.symbols = symbols;
    this.lookback = lookback;

    // Price buffer per symbol: stores recent closes and volumes
    this.priceBuffers = new Map();
    for (const symbol of symbols) {
      this.priceBuffers.set(symbol, { closes: [], volumes: [], candles: [] });
    }

    // Sentiment cache per symbol
    this.sentimentCache = new Map();

    // Event callbacks
    this.onSignal = onSignal || (() => {});
    this.onTrade = onTrade || (() => {});
    this.onError = onError || (() => {});

    this.running = false;
    this.ws = null;
  }

  // Feed a new candle/tick into the engine
  feedPrice(symbol, { close, volume, high, low, open, timestamp }) {
    let buffer = this.priceBuffers.get(symbol);
    if (!buffer) {
      buffer = { closes: [], volumes: [], candles: [] };
      this.priceBuffers.set(symbol, buffer);
    }

    buffer.closes.push(close);
    buffer.volumes.push(volume || 0);
    buffer.candles.push({ open: open || close, high: high || close, low: low || close, close, volume: volume || 0, timestamp });

    // Trim to lookback + some extra for indicator calculation
    const maxBuffer = this.lookback + 50;
    if (buffer.closes.length > maxBuffer) {
      buffer.closes = buffer.closes.slice(-maxBuffer);
      buffer.volumes = buffer.volumes.slice(-maxBuffer);
      buffer.candles = buffer.candles.slice(-maxBuffer);
    }

    // Only generate signals when we have enough data
    if (buffer.closes.length >= this.lookback) {
      return this.processSignal(symbol, close);
    }
    return null;
  }

  // Update sentiment for a symbol
  updateSentiment(symbol, sentiment) {
    this.sentimentCache.set(symbol, sentiment);
  }

  processSignal(symbol, currentPrice) {
    const buffer = this.priceBuffers.get(symbol);
    if (!buffer) return null;

    const sentiment = this.sentimentCache.get(symbol) || null;

    const analysis = this.signalEngine.analyze(symbol, {
      closes: buffer.closes,
      volumes: buffer.volumes,
      currentPrice,
      sentiment,
    });

    this.onSignal(analysis);

    // Execute trades
    const result = this.executeTrade(analysis);
    if (result) {
      this.onTrade(result);
    }

    return { analysis, trade: result };
  }

  executeTrade(analysis) {
    const { symbol, price, signal } = analysis;
    if (!signal || signal.action === 'HOLD') return null;

    if (signal.action === 'BUY') {
      const existingPos = this.trader.getPosition(symbol);
      if (existingPos) return null; // Already in position

      const buffer = this.priceBuffers.get(symbol);
      const volatility = buffer
        ? this.positionSizer.calculateVolatility(buffer.closes)
        : undefined;

      const sizing = this.positionSizer.calculate({
        portfolioValue: this.trader.portfolioValue,
        price,
        confidence: signal.confidence,
        volatility,
      });

      if (sizing.qty > 0) {
        const result = this.trader.buy(symbol, sizing.qty, price);
        if (result.success) {
          return { action: 'BUY', symbol, ...result.trade, sizing };
        }
      }
    } else if (signal.action === 'SELL') {
      const pos = this.trader.getPosition(symbol);
      if (!pos) return null;

      const result = this.trader.sell(symbol, pos.qty, price);
      if (result.success) {
        return { action: 'SELL', symbol, ...result.trade };
      }
    }

    return null;
  }

  // Connect to Binance WebSocket for real-time klines
  connectBinance(wsModule) {
    const streams = this.symbols
      .map(s => `${s.toLowerCase()}@kline_1m`)
      .join('/');

    const url = `wss://stream.binance.com:9443/ws/${streams}`;
    this.ws = new wsModule(url);
    this.running = true;

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.e === 'kline' && msg.k.x) { // x = is candle closed
          const k = msg.k;
          this.feedPrice(msg.s, {
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            timestamp: k.T,
          });
        }
      } catch (err) {
        this.onError(err);
      }
    });

    this.ws.on('error', (err) => this.onError(err));
    this.ws.on('close', () => { this.running = false; });

    return this.ws;
  }

  stop() {
    this.running = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getStatus() {
    const summary = this.trader.getSummary();
    const bufferStatus = {};
    for (const [symbol, buffer] of this.priceBuffers) {
      bufferStatus[symbol] = {
        dataPoints: buffer.closes.length,
        ready: buffer.closes.length >= this.lookback,
        latestPrice: buffer.closes.length > 0 ? buffer.closes[buffer.closes.length - 1] : null,
      };
    }
    return {
      running: this.running,
      portfolio: summary,
      buffers: bufferStatus,
    };
  }
}
