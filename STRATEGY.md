# Trading Bot Strategy

## Mission
Build an aggressive, autonomous trading bot that monitors crypto and traditional markets, analyzes social media sentiment (Reddit/WSB, Twitter/X, news), and makes high-risk/high-reward trade decisions.

## Architecture

### 1. Market Data Pipeline
- **Crypto**: Binance, Coinbase, Kraken WebSocket feeds (BTC, ETH, SOL, meme coins)
- **Traditional**: Alpaca or Robinhood API for stocks/options
- **Real-time**: WebSocket connections for sub-second price data
- **Historical**: Candlestick data for pattern recognition

### 2. Social Sentiment Engine
- **Reddit**: r/wallstreetbets, r/CryptoCurrency, r/stocks, r/options
  - Track post volume, comment sentiment, ticker mentions
  - Detect pump signals (sudden mention spikes)
- **Twitter/X**: Crypto influencer feeds, trending hashtags
- **News**: Financial news RSS/APIs (Bloomberg, CoinDesk, Reuters)
- **Sentiment scoring**: NLP pipeline → bullish/bearish/neutral per asset

### 3. Signal Generation
- **Technical signals**: RSI, MACD, Bollinger Bands, volume spikes
- **Sentiment signals**: Social mention velocity, sentiment shift detection
- **Combined scoring**: Weight technical + sentiment → confidence score
- **Risk parameters**: Position sizing based on confidence + volatility

### 4. Trade Execution
- **Robinhood**: Stocks and options via unofficial API or Alpaca
- **Crypto exchanges**: Direct exchange APIs (Binance, Coinbase Pro)
- **Order types**: Market, limit, stop-loss, trailing stop
- **Risk management**: Max position size, daily loss limit, auto-stop

### 5. Dashboard & Monitoring
- Real-time P&L tracking
- Open positions and pending signals
- Sentiment heatmap
- Trade history and performance metrics

## Risk Strategy
- **High conviction trades**: 5-10% of portfolio per trade
- **YOLO mode**: Up to 25% on extreme confidence signals
- **Stop-loss**: Always set, but wide (15-20% for crypto, 8% for stocks)
- **Take profit**: Scale out at 2x, 3x, let runners run
- **Diversification**: Spread across crypto + stocks + options

## Tech Stack (Research Phase)
- **Runtime**: Node.js or Python (TBD based on API support)
- **Data storage**: SQLite for signals/trades, Redis for real-time cache
- **APIs**: Alpaca (stocks), Binance/Coinbase (crypto), Reddit API, Twitter API
- **NLP**: Simple keyword/regex sentiment or Claude API for analysis
- **Scheduling**: Cron jobs for periodic scans, WebSockets for real-time

## Phase 1 — Research & Foundation
1. Evaluate trading APIs (Robinhood vs Alpaca vs direct exchange)
2. Set up Reddit and Twitter data collection
3. Build basic sentiment scoring pipeline
4. Create paper trading framework (no real money)
5. Backtest signal strategies on historical data

## Phase 2 — Signal Engine
1. Technical indicator library
2. Sentiment-to-signal conversion
3. Combined scoring model
4. Paper trading with real-time data

## Phase 3 — Live Trading
1. Small position sizes with real money
2. Monitor and tune parameters
3. Scale up as strategy proves profitable
4. Full autonomous mode
