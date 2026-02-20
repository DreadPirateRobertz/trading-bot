# Trading Bot — Report to Human

**Last Updated:** 2026-02-20 14:04 MST
**Project:** Aggressive Crypto/Traditional Market Trading Bot
**Status:** RESEARCH PHASE — Foundation being built
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
| **obsidian** | Polecat | Research trading APIs + build sentiment foundation (tb-sr9) | Working |
| **quant** | Crew | Lead strategist (available for future work) | Standby |

## Architecture (from STRATEGY.md)

```
Market Data Pipeline → Signal Generation → Trade Execution
       ↑                      ↑                    ↓
Social Sentiment Engine ──────┘              Dashboard/Monitoring
(Reddit, Twitter, News)
```

## Phase Plan

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 1** | Research APIs, build sentiment crawler, paper trading | IN PROGRESS |
| **Phase 2** | Signal engine (technical + sentiment combined) | PLANNED |
| **Phase 3** | Live trading with real money, autonomous execution | PLANNED |

## Progress Log

| Time | Event |
|------|-------|
| 14:00 | Rig created, repo pushed, polecat obsidian spawned |
| 14:00 | Research bead tb-sr9 slung to obsidian |
| — | Awaiting first research commits from obsidian |

---

*Report maintained by mayor. Updated each watchdog cycle.*
