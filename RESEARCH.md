# Phase 1 Research: Trading APIs & Sentiment Analysis

## Trading APIs

### Alpaca Markets (Recommended for Stocks + Crypto)
- **Auth**: API Key + Secret via headers
- **Rate limits**: 200 req/min, 10 req/sec burst
- **Paper trading**: Full support via `paper-api.alpaca.markets` (separate keys)
- **WebSocket**: Real-time market data + order streaming (V2)
- **npm**: `@alpacahq/alpaca-trade-api`
- **Assets**: US stocks, options, crypto

### Binance (Recommended for Crypto)
- **Auth**: HMAC SHA256 with API key + secret
- **Rate limits**: Weight-based per IP, auto-ban on violation (2min to 3 days)
- **Paper trading**: Spot testnet (`testnet.binance.vision`), Futures mock trading
- **WebSocket**: Excellent — spot, margin, futures streams, 1024 streams/connection
- **npm**: `binance` (by tiagosiebler, TypeScript, actively maintained)
- **Assets**: Crypto only (spot, margin, futures, options)

### Coinbase Advanced Trade
- **Auth**: CDP API Keys with JWT (ES256)
- **Rate limits**: 30 req/sec private, 10 req/sec public, 8 msg/sec WebSocket
- **Paper trading**: Sandbox at `api-sandbox.coinbase.com` (limited endpoints)
- **npm**: `coinbase-advanced-node` (community maintained)
- **Assets**: Crypto only

### Robinhood — SKIP
- No official public API for stocks/options
- Unofficial wrappers are unmaintained and ToS-violating
- Only has official crypto API (limited scope)

## Social Sentiment Sources

### Reddit API (Primary)
- **Auth**: OAuth 2.0, register script app at reddit.com/prefs/apps
- **Rate limits**: 100 QPM authenticated, 10 QPM unauthenticated
- **npm**: `snoowrap` (most full-featured, still functional)
- **Target subs**: r/wallstreetbets, r/CryptoCurrency, r/stocks, r/options
- **Strategy**: Poll new/hot listings every 30-60 seconds

### Twitter/X API — SKIP (for now)
- Free tier is write-only, Basic ($200/mo) gives only 10K reads
- Cost-prohibitive for real-time tracking
- May revisit with third-party scrapers later

### Financial News RSS (Primary)
- **CoinDesk**: `https://www.coindesk.com/arc/outboundfeeds/rss/`
- **Cointelegraph**: `https://cointelegraph.com/rss`
- **CNBC Markets**: `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135`
- **npm**: `rss-parser` (simple, handles RSS + Atom)

## Sentiment Analysis

### Approach: AFINN lexicon + custom financial keywords
- **npm**: `sentiment` (AFINN-165, ~2M weekly downloads)
- **Custom layer**: Finance-specific bullish/bearish keyword regex
- **Scoring**: Combine AFINN score + keyword hits + engagement metrics

## Architecture Decision

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Stock trading | Alpaca | Only viable option with official Node.js SDK + paper trading |
| Crypto trading | Binance | Best volume, WebSocket infra, maintained SDK |
| Social sentiment | Reddit via snoowrap | Free, good rate limits, WSB is ground zero |
| News sentiment | RSS via rss-parser | Free, no auth, stable feeds |
| NLP | sentiment + custom lexicon | Lightweight, no external deps |
| Paper trading | Alpaca paper mode + Binance testnet | Both have dedicated test environments |
