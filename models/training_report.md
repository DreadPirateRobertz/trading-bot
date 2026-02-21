# Directional Model Training Report

**Date**: 2026-02-21
**Seed**: 42 (fully reproducible)
**Architecture**: [13 → 24 → 12 → 2] feed-forward, sigmoid + softmax
**Training**: 300 epochs, LR=0.008, balanced SGD
**Data**: 1945 samples from 2000 synthetic candles (5 market regimes)
**Split**: 80% train / 19.999999999999996% holdout (walk-forward)
**Class balance**: UP 1065 (54.8%) / DOWN 880 (45.2%)

## Results

| Metric | Train | Holdout |
|--------|-------|---------|
| Directional accuracy | 50.6% | 59.9% |
| Precision (UP) | 58.0% | 61.9% |
| Recall (UP) | 37.1% | 64.9% |
| F1 (UP) | 45.3% | 63.4% |
| Profit factor | 0.79 | 1.55 |
| Loss | 0.7035 | 0.6796 |

## Features (13 pipeline-engineered)

RSI, RSI divergence, MACD histogram (ATR-normalized), MACD momentum,
Bollinger position, Bollinger bandwidth, Bollinger squeeze, Volume profile,
SMA trend (20/50), EMA trend (12/26), ATR% volatility, Price change %, Sentiment velocity