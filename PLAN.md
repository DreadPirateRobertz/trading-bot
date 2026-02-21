# YOLO Futures Trading Bot — Master Plan

> Quant leads overall plan. Each crew member contributes their section.

---

## Crew Status Sections

### Strategy (strategist)

**Implemented modules:**
- **Strategies**: momentum, mean-reversion, bollinger-bounce, pairs-trading, hybrid, ensemble
- **ML pipeline**: HMM regime detection, feature engineering, walk-forward evaluation, model training
- **Signals**: multi-timeframe confirmation engine, position sizing
- **Risk**: portfolio risk manager
- **Live trading**: LiveTrader with HMM regime integration, paper trading support
- **Sentiment**: Twitter/X crawler, Reddit, news scoring
- **Alerts**: Discord, Slack, Telegram webhook notifications
- **MCP tools**: Monte Carlo permutation test, walk-forward ML eval, multi-timeframe analysis, pairs backtester

**Key Gaps:**
1. Strategy parameter optimization — no automated walk-forward optimization loop
2. Ensemble weighting — static weights; needs dynamic regime-adaptive weighting
3. Execution quality — no slippage model beyond basic assumptions
4. Sentiment integration — crawlers exist but not weighted into ensemble
5. Risk limits enforcement — portfolio risk manager not wired into live order rejection
6. Live data reliability — no reconnection logic or data gap detection
7. Performance attribution — no per-strategy P&L decomposition in live mode

---

## YOLO Futures Plan

**Date**: 2026-02-21
**Author**: quant (tech lead)
**Status**: Planning — awaiting Melania approval on stories

### Vision

Transform the existing spot trading bot into a **high-leverage futures trading system** targeting perpetual swaps on Binance USDT-M. The bot will exploit leverage (10-50x), funding rate arbitrage, and momentum breakouts on crypto futures with aggressive sizing. HIGH RISK / HIGH REWARD — we accept liquidation risk in exchange for outsized returns.

**Target**: 100%+ monthly return potential with max 40% portfolio drawdown tolerance.

### Architecture

```
┌──────────────────────────────────────────────────┐
│                   LiveTrader                      │
│  (existing, extended for futures)                 │
├──────────┬───────────┬──────────┬────────────────┤
│ Exchange │ Margin    │ YOLO     │ Funding Rate   │
│ Connector│ Engine    │ Strategy │ Harvester      │
│ (CCXT)   │           │ Module   │                │
├──────────┴───────────┴──────────┴────────────────┤
│              ML Signal Enhancer                   │
│  (adapted for leveraged returns + liquidation)    │
├──────────────────────────────────────────────────┤
│         Futures Risk Manager                      │
│  (margin monitor, auto-deleverage, liquidation    │
│   guard, funding rate tracker)                    │
├──────────────────────────────────────────────────┤
│         Backtest Engine (leverage-aware)           │
│  (funding fees, liquidation sim, margin calls)    │
└──────────────────────────────────────────────────┘
```

### Stories

#### Epic 1: Futures Exchange Connector (P0) — Owner: algo

| Story | Description |
|-------|-------------|
| 1.1 CCXT Futures Adapter | Binance USDT-M perpetual swap API via CCXT. Market/limit orders, leverage (1-125x), position mode, cross/isolated margin. |
| 1.2 Position Manager | Track open positions, unrealized PnL, liquidation price, margin ratio. Real-time mark price monitoring. |
| 1.3 Order Router | IOC for entries, post-only for limit, reduce-only for exits. Partial fills, amendment, cancel-replace. |

#### Epic 2: Margin & Liquidation Engine (P0) — Owner: quant

| Story | Description |
|-------|-------------|
| 2.1 Margin Calculator | Initial/maintenance margin, available balance, margin ratio. Cross and isolated margin. Liquidation price estimator. |
| 2.2 Auto-Deleverage Guard | Margin ratio > 70%: reduce 50%. > 85%: emergency close all. Never get liquidated by exchange. |
| 2.3 Funding Rate Tracker | Fetch/predict 8h funding rates. Alert on extremes (>0.1%/8h). Feed into strategy decisions. |

#### Epic 3: YOLO Strategy Module (P0) — Owner: strategist

| Story | Description |
|-------|-------------|
| 3.1 Leveraged Momentum Breakout | 20x leverage on trend breakouts. Entry: 20-period high/low break + volume spike + ML. Exit: trailing stop 2x ATR. |
| 3.2 Liquidation Hunt | Detect liquidation cascades via OB depth + OI drops. Counter-trend after exhaustion. 10x leverage. |
| 3.3 Funding Rate Arbitrage | Funding > 0.05%/8h: short perp + long spot (delta neutral). 55% APY. |
| 3.4 Meme Coin Scalper | 50x leverage on new perp listings. First 24h extreme vol. 1-3% moves, tight stops. |

#### Epic 4: ML Adaptation for Futures (P1) — Owner: quant

| Story | Description |
|-------|-------------|
| 4.1 Leverage-Aware Features | Funding rate, OI change, long/short ratio, liquidation vol, mark-index spread. 10→16 dims. |
| 4.2 Regime Detection for Leverage | HMM: add liquidation_cascade + funding_squeeze regimes. Auto-reduce leverage. |
| 4.3 Kelly Criterion Position Sizing | Fractional Kelly (0.25x) for leveraged returns. Max leverage = min(Kelly, 50x). |

#### Epic 5: Futures Backtesting (P1) — Owner: tester

| Story | Description |
|-------|-------------|
| 5.1 Leverage-Aware Backtest | Margin requirements, 8h funding payments, liquidation sim, mark price divergence. |
| 5.2 Liquidation Stress Tests | Flash crash -30%/5min, cascading liquidations, exchange lag 2s, funding spike 1%/8h. |
| 5.3 Historical Futures Data | Binance perp OHLCV + funding + OI (2024-2026 BTC/ETH). |

#### Epic 6: Alerts & Dashboard (P2) — Owner: algo

| Story | Description |
|-------|-------------|
| 6.1 Futures Dashboard | Leverage, margin ratio, liquidation price, funding P&L, OI. Real-time margin health. |
| 6.2 Liquidation Alerts | Margin ratio > 60%, funding extremes, OI shifts, liquidation proximity. Discord > Telegram. |

### Leverage Guidelines

| Strategy | Default | Max | Stop Loss |
|----------|---------|-----|-----------|
| Momentum Breakout | 20x | 30x | 2x ATR |
| Liquidation Hunt | 10x | 15x | 1.5x ATR |
| Funding Arb | 1x | 3x | N/A (hedged) |
| Meme Scalper | 50x | 50x | 0.5% |

### Risk Constraints

- **Max portfolio leverage**: 30x aggregate
- **Max single position**: 25% of portfolio
- **Daily loss limit**: 30% → halt 24h
- **Margin ratio hard cap**: 85% → emergency close ALL
- **No holding through unknown exchange maintenance**

### Implementation Phases

1. **Phase 1 (P0)**: Exchange connector + margin engine + momentum breakout
2. **Phase 2 (P1)**: ML adaptation + funding arb + leverage backtesting
3. **Phase 3 (P2)**: Meme scalper + liquidation hunt + dashboard

### Crew Assignments

| Crew | Primary Epics | Key Deliverables |
|------|---------------|------------------|
| **quant** (tech lead) | Epic 2, Epic 4 | Margin engine, ML adaptation, architecture |
| **algo** | Epic 1, Epic 6 | Exchange connector, order routing, dashboard |
| **strategist** | Epic 3 | 4 YOLO strategies, entry/exit rules |
| **tester** | Epic 5 | Leverage backtesting, stress tests, data |

---

### Tester (tester)

**Current State:**
- **42 test files, 839 tests** — 39 passing files, 3 failing (MCP SDK missing dep)
- Runtime: ~8s, all unit/integration, no external services required
- Framework: Vitest v4.0.18, Node.js, better-sqlite3

**Coverage by Module:**

| Module | Files | Focus |
|--------|-------|-------|
| ML/AI | 8 | Model training, features, ensemble, pipeline, stress |
| Strategies | 4 | Signal engine, multi-timeframe, pairs trading |
| Risk | 4 | Kelly criterion, VaR/CVaR, position sizing, portfolio risk |
| Backtesting | 4 | Walk-forward, historical validation, pairs backtest |
| Paper/Live | 4 | Paper trading, ML stress, live trading |
| Market Data | 3 | Data pipeline, validation, realtime feeds |
| Sentiment | 3 | News, Reddit, Twitter |
| Infra | 4 | Config, dashboard, notifications, reports |
| MCP | 2 | MCP server tools (BLOCKED: missing @modelcontextprotocol/sdk) |
| Integration | 2 | E2E, extended session |

**Known Issues:**
1. MCP tests (2 files): `@modelcontextprotocol/sdk` not installed — import fails at load
2. 1 flaky test: intermittent stress test timing issue

**Testing Principles:**
- All tests run offline with mocked data — no API keys or network
- Deterministic math (Kelly, VaR) uses known-answer verification
- ML tests validate pipeline shape/contracts, not model accuracy
- Stress tests simulate flash crashes, extreme vol, regime changes

**Gaps (for when rig resumes):**
- No coverage for order execution layer
- No property-based / fuzz testing
- MCP dep needs resolving to unblock 2 test files
- No performance regression benchmarks

**Epic 5 readiness:** Ready to build leverage-aware backtests and liquidation stress tests when Phase 2 starts.
