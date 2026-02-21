// Trading Bot - Entry Point
// Orchestrates market data, sentiment analysis, signal generation, and trade execution

export { AlpacaConnector, BinanceConnector } from './market-data/index.js';
export { RedditCrawler, NewsCrawler, TwitterCrawler, scoreSentiment, scoreRedditPost, scoreNewsArticle, scoreTweet, aggregateScores } from './sentiment/index.js';
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

// Phase 4: Historical OHLCV data pipeline + feature engineering
export { CandleStore, HistoricalFetcher, DataPipeline, computeAllFeatures } from './data-pipeline/index.js';

// Phase 5: MCP server for AI-driven trade management
export { createMcpServer, startMcpServer, TradingBotState } from './mcp/index.js';

// Phase 6: Portfolio risk management
export { PortfolioRiskManager } from './risk/portfolio-risk-manager.js';

// Phase 6: Multi-timeframe analysis
export { MultiTimeframeAnalyzer } from './analysis/multi-timeframe.js';

// Phase 6: Alert & notification system
export { Notifier, ALERT_TYPES, SEVERITY } from './alerts/notifier.js';
