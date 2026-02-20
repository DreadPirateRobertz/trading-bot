# Trading Bot — Report to Human

**Last Updated:** 2026-02-20 14:20 MST
**Project:** Aggressive Crypto/Traditional Market Trading Bot
**Status:** PHASE 2 IN PROGRESS — Signal engine + real-time paper trading
**Repo:** git@github.com:DreadPirateRobertz/trading-bot.git

---

## Mission
Build an autonomous trading bot that:
- Monitors crypto + traditional markets in real-time
- Crawls Reddit (WSB, r/CryptoCurrency), Twitter/X, and news
- Makes HIGH RISK / HIGH REWARD trading decisions
- Eventually executes trades autonomously via Robinhood/Alpaca/exchange APIs

## Active Workers

| Worker | Type | Task | Status |
|--------|------|------|--------|
| **obsidian** | Polecat | Phase 1: Research + sentiment foundation (tb-sr9) | COMPLETE |
| **quartz** | Polecat | Phase 2: Signal engine + real-time paper trading (tb-j8j) | WORKING |
| **quant** | Crew | Lead strategist (available for future work) | Standby |

## Architecture (from STRATEGY.md)

```
Market Data Pipeline → Signal Generation → Trade Execution
       ↑                      ↑                    ↓
Social Sentiment Engine ──────┘              Dashboard/Monitoring
(Reddit, Twitter, News)
```

## Phase 1 Deliverables (COMPLETE — obsidian)

| Module | Files | Description |
|--------|-------|-------------|
| Market Data | `src/market-data/alpaca.js`, `binance.js` | Alpaca + Binance WebSocket connectors |
| Sentiment | `src/sentiment/reddit.js`, `news.js`, `scorer.js` | Reddit crawler, news crawler, sentiment scoring |
| Signals | `src/signals/index.js` | RSI, MACD, Bollinger Bands, combined signals |
| Paper Trading | `src/paper-trading/index.js` | Paper trading with PnL tracking |
| Research | `RESEARCH.md` | API evaluation: Alpaca (stocks), Binance (crypto), Reddit/News APIs |
| Tests | 5 files, 42 tests | Full coverage of all Phase 1 modules |

**2,664 lines of code across 18 files.**

## Phase Plan

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 1** | Research APIs, build sentiment crawler, paper trading | COMPLETE ✓ |
| **Phase 2** | Combined confidence scoring, backtesting, real-time paper trading | IN PROGRESS |
| **Phase 3** | Live trading with real money, autonomous execution | PLANNED |

## Phase 2 Objectives (quartz working)

1. **Combined confidence scoring** — merge technical signals (RSI/MACD/Bollinger) with sentiment scores into unified per-asset confidence
2. **Backtesting framework** — load historical data, replay signals, measure PnL and win rate
3. **Real-time paper trading** — connect WebSocket feeds to signal engine, execute paper trades
4. **Position sizing algorithm** — based on confidence + volatility
5. **Vitest tests** for all new modules

## Progress Log

| Time | Event |
|------|-------|
| 14:00 | Rig created, repo pushed, polecat obsidian spawned for Phase 1 |
| 14:00 | Research bead tb-sr9 slung to obsidian |
| ~14:10 | Obsidian completed Phase 1: 2,664 lines, 18 files, 42 tests |
| 14:13 | Obsidian session exited. Mayor merged polecat branch to main (`43f64ae`) |
| 14:20 | Bead tb-j8j created for Phase 2. Polecat quartz spawned and working |

---

*Report maintained by mayor. Updated each watchdog cycle.*
