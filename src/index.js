// Trading Bot - Entry Point
// Orchestrates market data, sentiment analysis, signal generation, and trade execution

export { AlpacaConnector, BinanceConnector } from './market-data/index.js';
export { RedditCrawler, NewsCrawler, scoreSentiment, scoreRedditPost, scoreNewsArticle, aggregateScores } from './sentiment/index.js';
export { computeRSI, computeMACD, computeBollingerBands, detectVolumeSpike, generateSignal } from './signals/index.js';
export { SignalEngine, generateSignalWithPrice } from './signals/engine.js';
export { PositionSizer } from './signals/position-sizer.js';
export { PaperTrader } from './paper-trading/index.js';
export { Backtester, computeMaxDrawdown, computeSharpeRatio } from './backtest/index.js';
export { RealtimeTrader } from './realtime/index.js';

// Phase 3: Live data integration + monitoring
export { loadConfig, validateConfig } from './config/index.js';
export { LiveTrader } from './live/index.js';
export { createDashboard } from './dashboard/index.js';
