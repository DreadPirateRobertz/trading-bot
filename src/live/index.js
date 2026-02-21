// Live Data Integration
// Connects Alpaca SSE + Binance WebSocket feeds to RealtimeTrader

import { RealtimeTrader } from '../realtime/index.js';
import { AlpacaConnector } from '../market-data/alpaca.js';
import { BinanceConnector } from '../market-data/binance.js';
import { RedditCrawler } from '../sentiment/reddit.js';
import { NewsCrawler } from '../sentiment/news.js';
import { TwitterCrawler } from '../sentiment/twitter.js';
import { scoreSentiment, scoreTweet, aggregateScores } from '../sentiment/scorer.js';
import { PortfolioRiskManager } from '../risk/portfolio-risk-manager.js';
import { Notifier } from '../alerts/notifier.js';
import { GaussianHMM } from '../ml/hmm.js';

export class LiveTrader {
  constructor({ config, onSignal, onTrade, onError, onStatus }) {
    this.config = config;
    this.onStatus = onStatus || (() => {});

    // HMM regime detection config
    this.useHMM = config.hmm?.enabled !== false; // on by default
    this.hmmRetrainInterval = config.hmm?.retrainInterval || 500; // retrain every N bars
    this.hmmMinObs = config.hmm?.minObservations || 50;
    this.hmm = null;
    this.hmmBarsSinceRetrain = 0;

    // Initialize RealtimeTrader (paper trading engine underneath)
    // Use ensemble strategy when HMM is enabled
    const signalEngineConfig = config.signalEngine || (this.useHMM
      ? { strategy: 'ensemble', strategyConfig: {} }
      : undefined);

    this.realtimeTrader = new RealtimeTrader({
      initialBalance: config.trading.initialBalance,
      symbols: config.trading.symbols,
      lookback: config.trading.lookback,
      signalEngineConfig,
      positionSizerConfig: {
        maxPositionPct: config.trading.maxPositionPct,
        yoloThreshold: config.trading.yoloThreshold,
      },
      onSignal: onSignal || (() => {}),
      onTrade: onTrade || (() => {}),
      onError: onError || (() => {}),
    });

    // Exchange connectors for historical data seeding
    this.alpaca = config.alpaca.keyId
      ? new AlpacaConnector(config.alpaca)
      : null;
    this.binance = config.binance.apiKey
      ? new BinanceConnector(config.binance)
      : null;

    // Sentiment crawlers
    this.redditCrawler = config.reddit.clientId
      ? new RedditCrawler(config.reddit)
      : null;
    this.newsCrawler = new NewsCrawler();
    this.twitterCrawler = config.twitter?.bearerToken
      ? new TwitterCrawler({ bearerToken: config.twitter.bearerToken })
      : null;

    // Portfolio risk manager
    this.riskManager = new PortfolioRiskManager(config.risk || {});
    if (config.sectors) this.riskManager.setSectors(config.sectors);
    this.riskManager.update({ equity: config.trading.initialBalance, bar: 0 });
    this.riskManager.startNewDay(config.trading.initialBalance);

    // Alert notifier
    this.notifier = new Notifier(config.alerts || {});

    // State
    this.wsConnections = [];
    this.sentimentInterval = null;
    this.running = false;
    this.startTime = null;
    this.signalLog = [];
    this.tradeLog = [];
    this.errorLog = [];
    this.barCount = 0;
  }

  async seedHistoricalData() {
    this.onStatus({ event: 'seeding', message: 'Loading historical data for indicators...' });

    for (const symbol of this.config.trading.symbols) {
      try {
        let candles = null;

        // Try Binance for crypto symbols
        if (this.binance && symbol.endsWith('USDT')) {
          const klines = await this.binance.getKlines(symbol, {
            interval: '1m',
            limit: this.config.trading.lookback + 50,
          });
          candles = klines;
        }
        // Try Alpaca for stock symbols
        else if (this.alpaca) {
          const bars = await this.alpaca.getBars(symbol, {
            timeframe: '1Min',
            limit: this.config.trading.lookback + 50,
          });
          candles = bars;
        }

        if (candles && candles.length > 0) {
          for (const c of candles) {
            this.realtimeTrader.feedPrice(symbol, {
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
              timestamp: c.timestamp || Date.now(),
            });
          }
          this.onStatus({ event: 'seeded', symbol, candles: candles.length });
        }
      } catch (err) {
        this.onStatus({ event: 'seed_error', symbol, error: err.message });
      }
    }
  }

  // Train HMM on available candle buffers and inject into ensemble strategy
  trainHMM() {
    if (!this.useHMM) return null;

    // Collect all candle buffers across symbols
    const allCandles = [];
    for (const [, buffer] of this.realtimeTrader.priceBuffers) {
      if (buffer.candles.length > 0) {
        allCandles.push(...buffer.candles);
      }
    }

    const obs = GaussianHMM.extractObservations(allCandles, { volWindow: 20 });
    if (obs.length < this.hmmMinObs) {
      this.onStatus({ event: 'hmm_skip', reason: `Insufficient observations: ${obs.length}/${this.hmmMinObs}` });
      return null;
    }

    const hmm = new GaussianHMM();
    const result = hmm.fit(obs);

    if (hmm.trained) {
      this.hmm = hmm;
      this.hmmBarsSinceRetrain = 0;

      // Inject into ensemble strategy if available
      const strategy = this.realtimeTrader.signalEngine.strategy;
      if (strategy && typeof strategy.detectRegimeHMM === 'function') {
        strategy.hmmDetector = hmm;
      }

      const regime = hmm.currentRegime(obs);
      this.onStatus({
        event: 'hmm_trained',
        observations: obs.length,
        logLikelihood: result.logLikelihood,
        currentRegime: regime.regime,
        confidence: regime.confidence,
      });
      return regime;
    }

    return null;
  }

  connectBinanceWS(WebSocketClass) {
    const cryptoSymbols = this.config.trading.symbols.filter(s => s.endsWith('USDT'));
    if (cryptoSymbols.length === 0) return null;

    const streams = cryptoSymbols.map(s => `${s.toLowerCase()}@kline_1m`).join('/');
    const url = `wss://stream.binance.com:9443/ws/${streams}`;
    const ws = new WebSocketClass(url);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.e === 'kline' && msg.k.x) {
          const k = msg.k;
          this.realtimeTrader.feedPrice(msg.s, {
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            timestamp: k.T,
          });
        }
      } catch (err) {
        this.errorLog.push({ time: Date.now(), source: 'binance_ws', error: err.message });
      }
    });

    ws.on('error', (err) => {
      this.errorLog.push({ time: Date.now(), source: 'binance_ws', error: err.message });
    });

    ws.on('close', () => {
      this.onStatus({ event: 'ws_closed', source: 'binance' });
    });

    this.wsConnections.push(ws);
    return ws;
  }

  connectAlpacaWS(WebSocketClass) {
    const stockSymbols = this.config.trading.symbols.filter(s => !s.endsWith('USDT'));
    if (stockSymbols.length === 0 || !this.alpaca) return null;

    const baseUrl = this.config.alpaca.paper
      ? 'wss://stream.data.sandbox.alpaca.markets/v2/iex'
      : 'wss://stream.data.alpaca.markets/v2/iex';

    const ws = new WebSocketClass(baseUrl);

    ws.on('open', () => {
      // Authenticate
      ws.send(JSON.stringify({
        action: 'auth',
        key: this.config.alpaca.keyId,
        secret: this.config.alpaca.secretKey,
      }));
    });

    ws.on('message', (data) => {
      try {
        const messages = JSON.parse(data.toString());
        for (const msg of Array.isArray(messages) ? messages : [messages]) {
          if (msg.T === 'success' && msg.msg === 'authenticated') {
            // Subscribe to minute bars
            ws.send(JSON.stringify({
              action: 'subscribe',
              bars: stockSymbols,
            }));
          } else if (msg.T === 'b') {
            // Minute bar
            this.realtimeTrader.feedPrice(msg.S, {
              open: msg.o,
              high: msg.h,
              low: msg.l,
              close: msg.c,
              volume: msg.v,
              timestamp: new Date(msg.t).getTime(),
            });
          }
        }
      } catch (err) {
        this.errorLog.push({ time: Date.now(), source: 'alpaca_ws', error: err.message });
      }
    });

    ws.on('error', (err) => {
      this.errorLog.push({ time: Date.now(), source: 'alpaca_ws', error: err.message });
    });

    ws.on('close', () => {
      this.onStatus({ event: 'ws_closed', source: 'alpaca' });
    });

    this.wsConnections.push(ws);
    return ws;
  }

  async updateSentiment() {
    for (const symbol of this.config.trading.symbols) {
      try {
        const scores = [];

        // News sentiment
        const articles = await this.newsCrawler.fetchAllFeeds();
        const recent = this.newsCrawler.filterRecent(articles, 4);
        const symbolArticles = recent.filter(a =>
          (a.title + ' ' + (a.description || '')).toUpperCase().includes(symbol.replace('USDT', ''))
        );
        for (const article of symbolArticles) {
          const s = scoreSentiment(article.title + ' ' + (article.description || ''));
          scores.push(s);
        }

        // Reddit sentiment
        if (this.redditCrawler) {
          try {
            const posts = await this.redditCrawler.scanSubreddits({ limit: 25 });
            const mentions = this.redditCrawler.aggregateTickerMentions(posts);
            const ticker = symbol.replace('USDT', '');
            const mention = mentions.find(m => m.ticker === ticker);
            if (mention) {
              scores.push({ score: mention.score > 5 ? 2 : mention.score > 0 ? 1 : -1 });
            }
          } catch {
            // Reddit auth may fail - continue without
          }
        }

        // Twitter/X sentiment
        if (this.twitterCrawler) {
          try {
            const ticker = symbol.replace('USDT', '');
            const tweets = await this.twitterCrawler.searchRecent(`$${ticker}`, { maxResults: 100 });
            for (const tweet of tweets) {
              const sentiment = scoreSentiment(tweet.text);
              scores.push(scoreTweet(tweet, sentiment));
            }
          } catch {
            // Twitter API may fail (rate limits, auth) - continue without
          }
        }

        if (scores.length > 0) {
          const agg = aggregateScores(scores);
          this.realtimeTrader.updateSentiment(symbol, agg);
        }
      } catch {
        // Sentiment failures are non-critical
      }
    }
  }

  startSentimentLoop(intervalMs = 300000) {
    // Update sentiment every 5 minutes by default
    this.updateSentiment();
    this.sentimentInterval = setInterval(() => this.updateSentiment(), intervalMs);
  }

  async start(WebSocketClass) {
    this.running = true;
    this.startTime = Date.now();

    // Wrap callbacks to capture logs and enforce risk limits
    const origOnSignal = this.realtimeTrader.onSignal;
    this.realtimeTrader.onSignal = (analysis) => {
      this.signalLog.push({ time: Date.now(), ...analysis });
      if (this.signalLog.length > 1000) this.signalLog = this.signalLog.slice(-500);
      origOnSignal(analysis);
    };

    // Intercept trade execution to enforce risk limits
    const origExecuteTrade = this.realtimeTrader.executeTrade.bind(this.realtimeTrader);
    this.realtimeTrader.executeTrade = (analysis) => {
      const { symbol, price, signal } = analysis;
      if (signal && signal.action === 'BUY') {
        // Update risk manager with current portfolio state
        this.barCount++;
        const status = this.realtimeTrader.getStatus();
        const positions = {};
        for (const [sym, buf] of this.realtimeTrader.priceBuffers) {
          const pos = this.realtimeTrader.trader.getPosition(sym);
          if (pos) {
            positions[sym] = {
              qty: pos.qty,
              avgPrice: pos.avgPrice,
              currentPrice: buf.closes.length > 0 ? buf.closes[buf.closes.length - 1] : pos.avgPrice,
            };
          }
        }
        this.riskManager.update({
          equity: this.realtimeTrader.trader.portfolioValue,
          positions,
          bar: this.barCount,
        });

        // Evaluate risk
        const sizing = this.realtimeTrader.positionSizer.calculate({
          portfolioValue: this.realtimeTrader.trader.portfolioValue,
          price,
          confidence: signal.confidence,
        });
        const riskCheck = this.riskManager.evaluateTrade({
          symbol,
          side: 'buy',
          qty: sizing.qty,
          price,
        });

        if (!riskCheck.allowed) {
          this.onStatus({ event: 'risk_blocked', symbol, reason: riskCheck.reason, flags: riskCheck.riskFlags });
          // Fire risk event alert (non-blocking)
          const alertType = riskCheck.riskFlags.includes('circuit_breaker') ? 'circuit_breaker' : 'risk_blocked';
          if (alertType === 'circuit_breaker') {
            this.notifier.circuitBreaker({ reason: riskCheck.reason }).catch(() => {});
          } else {
            this.notifier.riskEvent({
              type: alertType, reason: riskCheck.reason, flags: riskCheck.riskFlags, symbol,
            }).catch(() => {});
          }
          return null;
        }
      }
      const result = origExecuteTrade(analysis);
      if (result) {
        this.riskManager.recordTrade(result.symbol);
      }
      return result;
    };

    const origOnTrade = this.realtimeTrader.onTrade;
    this.realtimeTrader.onTrade = (trade) => {
      this.tradeLog.push({ time: Date.now(), ...trade });
      // Fire trade alert (non-blocking)
      this.notifier.tradeExecuted({
        symbol: trade.symbol,
        action: trade.action,
        qty: trade.qty,
        price: trade.price,
        pnl: trade.pnl,
        confidence: trade.sizing?.positionPct || 0,
        method: trade.sizing?.method,
      }).catch(() => {}); // alerts are best-effort
      origOnTrade(trade);
    };

    // Seed historical data
    await this.seedHistoricalData();

    // Train HMM on seeded data for regime detection
    this.trainHMM();

    // Connect WebSockets
    if (WebSocketClass) {
      this.connectBinanceWS(WebSocketClass);
      this.connectAlpacaWS(WebSocketClass);
    }

    // Start sentiment loop
    this.startSentimentLoop();

    // Start HMM retraining loop
    if (this.useHMM && this.hmmRetrainInterval > 0) {
      this.hmmRetrainInterval_id = setInterval(() => {
        this.hmmBarsSinceRetrain++;
        if (this.hmmBarsSinceRetrain >= this.hmmRetrainInterval) {
          this.trainHMM();
        }
      }, 60000); // Check every minute
    }

    this.onStatus({ event: 'started', symbols: this.config.trading.symbols });
  }

  stop() {
    this.running = false;
    for (const ws of this.wsConnections) {
      try { ws.close(); } catch { /* ignore */ }
    }
    this.wsConnections = [];
    if (this.sentimentInterval) {
      clearInterval(this.sentimentInterval);
      this.sentimentInterval = null;
    }
    if (this.hmmRetrainInterval_id) {
      clearInterval(this.hmmRetrainInterval_id);
      this.hmmRetrainInterval_id = null;
    }
    this.onStatus({ event: 'stopped' });
  }

  getFullStatus() {
    const traderStatus = this.realtimeTrader.getStatus();
    return {
      running: this.running,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      portfolio: traderStatus.portfolio,
      buffers: traderStatus.buffers,
      risk: this.riskManager.getRiskDashboard(),
      hmm: this.hmm ? {
        trained: this.hmm.trained,
        states: this.hmm.states,
        barsSinceRetrain: this.hmmBarsSinceRetrain,
      } : null,
      recentSignals: this.signalLog.slice(-20),
      recentTrades: this.tradeLog.slice(-50),
      recentErrors: this.errorLog.slice(-20),
      connections: this.wsConnections.length,
    };
  }
}
