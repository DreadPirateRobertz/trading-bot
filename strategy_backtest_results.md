# Strategy Backtest Comparison Results

**Date**: 2026-02-21
**Data**: 500 synthetic candles per regime, seeded for reproducibility
**Initial Balance**: $100,000
**Position Size**: 10% max per trade

## Summary Table

| Regime | Strategy | Return % | Sharpe | Max DD % | Win Rate % | Trades |
|--------|----------|----------|--------|----------|------------|--------|
| bull | Technical | 0.02 | 1.23 | 0 | 100 | 1 |
| bull | +Sentiment | 0.01 | 1 | 0 | 100 | 1 |
| bull | ML-Enhanced | 0 | - | - | 0 | 0 |
| bear | Technical | -1.36 | -1.84 | 1.92 | 66.67 | 3 |
| bear | +Sentiment | -2.15 | -1.06 | 2.98 | 29.41 | 17 |
| bear | ML-Enhanced | 0 | - | - | 0 | 0 |
| sideways | Technical | 0.2 | 1.17 | 0.12 | 87.5 | 8 |
| sideways | +Sentiment | 0.21 | 1.17 | 0.1 | 80 | 20 |
| sideways | ML-Enhanced | 0.56 | - | - | 100 | 2 |
| volatile | Technical | -0.54 | -0.56 | 1.5 | 50 | 4 |
| volatile | +Sentiment | 0.27 | 0.43 | 0.71 | 68.75 | 16 |
| volatile | ML-Enhanced | 1.23 | - | - | 50 | 2 |
| mixed | Technical | -0.87 | -4.1 | 1.01 | 50 | 2 |
| mixed | +Sentiment | -0.52 | -1.95 | 1 | 80 | 5 |
| mixed | ML-Enhanced | -3.9 | - | - | 0 | 1 |

## Key Findings

- **bull**: Best strategy = Technical (0.02% return)
- **bear**: Best strategy = ML-Enhanced (0% return)
- **sideways**: Best strategy = ML-Enhanced (0.56% return)
- **volatile**: Best strategy = ML-Enhanced (1.23% return)
- **mixed**: Best strategy = +Sentiment (-0.52% return)

## ML Model Performance

- **bull**: Train accuracy 86.3%, Val accuracy 100.0%
- **bear**: Train accuracy 56.7%, Val accuracy 30.1%
- **sideways**: Train accuracy 96.2%, Val accuracy 98.9%
- **volatile**: Train accuracy 34.1%, Val accuracy 34.4%
- **mixed**: Train accuracy 51.3%, Val accuracy 36.6%

## Architecture Notes

- **Model**: Feed-forward neural network [10 → 16 → 8 → 3] with softmax output
- **Features**: RSI, MACD histogram, MACD signal, Bollinger position/bandwidth, volume ratio, 1/5/10-period returns, sentiment
- **Training**: 30 epochs, SGD, walk-forward split (80/20), cross-entropy loss
- **Integration**: MLSignalEnhancer blends rule-based signals (60%) with ML predictions (40%)
- **Zero dependencies**: Pure JavaScript implementation, no external ML frameworks

## Next Steps

1. Test with real market data from Binance/Alpaca APIs
2. Tune hyperparameters (learning rate, epochs, thresholds) per asset class
3. Add walk-forward cross-validation for more robust evaluation
4. Implement online learning (update model weights as new data arrives)
5. Add feature importance analysis to identify most predictive signals