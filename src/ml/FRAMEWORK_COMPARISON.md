# ML Framework Comparison for Node.js Signal Prediction

## Frameworks Evaluated

### 1. TensorFlow.js (@tensorflow/tfjs / @tensorflow/tfjs-node)
- **npm size**: ~170MB with native backend (tfjs-node), ~3MB CPU-only (tfjs)
- **Model types**: Dense, LSTM, CNN, RNN, custom layers - full Keras API
- **Training**: Full training + inference in Node.js
- **Strengths**: Production-grade, GPU support, model zoo, excellent LSTM support
- **Weaknesses**: Heavy install (native bindings break frequently on macOS/ARM), slow cold start, overkill for small models
- **npm downloads**: ~200k/week
- **Best for**: Complex models, production deployment, teams with TF experience

### 2. brain.js
- **npm size**: ~2MB (v2 has GPU deps via gpu.js)
- **Model types**: Feed-forward, LSTM, RNN, GRU
- **Training**: Full training + inference in Node.js
- **Strengths**: Simple API, decent LSTM support, lighter than TF.js
- **Weaknesses**: v2 GPU deps can be problematic, smaller community, less maintained (last major release 2023), limited architecture flexibility
- **npm downloads**: ~30k/week
- **Best for**: Quick prototypes, simple neural networks

### 3. ONNX Runtime (onnxruntime-node)
- **npm size**: ~30MB (native bindings)
- **Model types**: Any model exported from Python (PyTorch, sklearn, XGBoost, etc.)
- **Training**: Inference only - must train in Python
- **Strengths**: Best inference performance, supports any model format, production-grade
- **Weaknesses**: Cannot train in Node.js, requires Python toolchain for model development, native bindings
- **npm downloads**: ~100k/week
- **Best for**: Deploying pre-trained models, hybrid Python/Node.js workflows

### 4. Tree-based Libraries (ml-random-forest, ml-cart)
- **npm size**: <1MB, pure JS
- **Model types**: Random forest, decision trees, CART
- **Training**: Full training + inference in Node.js
- **Strengths**: Pure JS, lightweight, good for tabular data
- **Weaknesses**: Small community (~5k downloads/week), limited to tree-based models, no GPU
- **Best for**: Tabular feature classification when lightweight matters

## Decision Matrix

| Criteria | TF.js | brain.js | ONNX | ml-random-forest | Custom NN |
|----------|-------|----------|------|-------------------|-----------|
| Zero native deps | No | Partial | No | Yes | **Yes** |
| Install size | 170MB | 2MB | 30MB | <1MB | **0MB** |
| Train in Node.js | Yes | Yes | No | Yes | **Yes** |
| Model flexibility | High | Medium | High | Low | **Medium** |
| Testability | Good | Good | Fair | Good | **Excellent** |
| Debug transparency | Low | Medium | Low | Medium | **Full** |
| Existing dep alignment | Poor | Poor | Poor | Fair | **Perfect** |

## Recommendation: Zero-Dependency Custom Neural Network

For this trading bot, we chose a **custom feed-forward neural network** with zero additional dependencies:

### Rationale
1. **Dependency philosophy**: The project uses only `express` + `ws`. Adding a 170MB ML framework breaks this ethos.
2. **Transparency**: A trading system needs full auditability. Custom code is fully inspectable.
3. **Feature engineering > model complexity**: Our features (RSI, MACD, Bollinger, sentiment) are already excellent time-series extractors. A simple network on these features performs well.
4. **Testability**: Pure JS, no native bindings, no GPU issues. Works perfectly with vitest.
5. **Right-sized**: We need ~100 parameters, not a framework designed for millions.

### Architecture: Feed-Forward on Engineered Features
- **Input**: 10 normalized features (RSI, MACD, Bollinger position/bandwidth, volume ratio, returns, sentiment)
- **Hidden**: 16 → 8 neurons with sigmoid activation
- **Output**: 3 neurons (BUY/HOLD/SELL) with softmax
- **Training**: SGD with backpropagation, walk-forward validation

### Future Path
If model complexity grows beyond what the custom NN handles well:
1. First upgrade: brain.js for LSTM (if raw time-series modeling needed)
2. Second upgrade: ONNX Runtime (train in Python, deploy in Node.js)
3. Nuclear option: TensorFlow.js (full framework, heavy but powerful)

The architecture is designed so the `MLSignalEnhancer` interface stays the same regardless of what model backend powers it.
