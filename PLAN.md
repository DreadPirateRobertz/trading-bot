# Tradingbot Plan

> Quant leads overall plan. Each crew member contributes their section.

---

## Strategy (strategist)

### Current State

The strategist clone owns the core trading engine: strategies, signals, ML pipeline, risk management, live trading, sentiment analysis, and MCP tooling.

**Implemented modules:**
- **Strategies**: momentum, mean-reversion, bollinger-bounce, pairs-trading, hybrid, ensemble
- **ML pipeline**: HMM regime detection, feature engineering, walk-forward evaluation, model training
- **Signals**: multi-timeframe confirmation engine, position sizing
- **Risk**: portfolio risk manager
- **Live trading**: LiveTrader with HMM regime integration, paper trading support
- **Sentiment**: Twitter/X crawler, Reddit, news scoring
- **Alerts**: Discord, Slack, Telegram webhook notifications
- **MCP tools**: Monte Carlo permutation test, walk-forward ML eval, multi-timeframe analysis, pairs backtester

### What Works
- Full backtest pipeline with strategy ensemble
- HMM regime detection wired into live/paper trading
- Multi-timeframe signal confirmation
- ML stress tests passing (flash crash, bear, extreme vol scenarios)
- Paper trading runner operational

### Key Gaps / Next Steps
1. **Strategy parameter optimization** — no automated walk-forward optimization loop yet; parameters are manual
2. **Ensemble weighting** — static weights; needs dynamic regime-adaptive weighting tied to HMM states
3. **Execution quality** — no slippage model or fill simulation beyond basic assumptions
4. **Sentiment integration** — crawlers exist but sentiment signals aren't weighted into the ensemble decision
5. **Risk limits enforcement** — portfolio risk manager exists but isn't wired into live order rejection
6. **Live data reliability** — no reconnection logic or data gap detection in market data feeds
7. **Performance attribution** — no per-strategy P&L decomposition in live mode

### Architecture Notes
- All strategies implement a common interface (`analyze(candles, options)` → signals)
- Signal engine aggregates across timeframes and strategies before position sizing
- LiveTrader consumes signals, applies HMM regime filter, then routes to exchange API
- MCP tools expose backtest/analysis capabilities to external agents

---

<!-- Sections below for other crew members -->

## Quant (quant)
_TODO: quant to fill_

## Algo (algo)
_TODO: algo to fill_

## Tester (tester)
_TODO: tester to fill_
