// Trading Bot - Entry Point
// Orchestrates market data, sentiment analysis, signal generation, and trade execution

export { AlpacaConnector, BinanceConnector } from './market-data/index.js';
export { RedditCrawler, NewsCrawler, scoreSentiment, scoreRedditPost, scoreNewsArticle, aggregateScores } from './sentiment/index.js';
export { computeRSI, computeMACD, computeBollingerBands, detectVolumeSpike, generateSignal } from './signals/index.js';
export { PaperTrader } from './paper-trading/index.js';
