# ML Framework Research: TensorFlow.js vs brain.js vs ONNX Runtime

> **Issue**: tb-v8l | **Date**: 2026-02-20
> **Purpose**: Evaluate ML frameworks for Node.js trading signal prediction

## Executive Summary

For real-time signal scoring on 15+ features in our Node.js trading bot, **ONNX Runtime** is the recommended framework. It provides the best inference performance, supports all model types we need (including gradient boosted trees which are the strongest fit for tabular trading data), and enables a "train in Python, deploy in Node.js" workflow that gives us access to the full Python ML ecosystem without runtime overhead.

---

## Comparison Matrix

| Dimension | TensorFlow.js | brain.js | ONNX Runtime |
|---|---|---|---|
| **npm package** | `@tensorflow/tfjs-node` | `brain.js` | `onnxruntime-node` |
| **Version** | 4.22.0 (Oct 2024) | 2.0.0-beta.24 | 1.24.1 (Jan 2026) |
| **npm weekly downloads** | ~114k | ~3.8k | ~651k |
| **GitHub stars** | ~18.5k | ~14.9k | ~19.2k |
| **Maintainer** | Google | Community (1-2 devs) | Microsoft |
| **License** | Apache-2.0 | MIT | MIT |
| **Install size** | ~350-500 MB | ~4.3 MB (+ gpu.js peer) | ~30-50 MB (CPU-only) |
| **Native deps** | libtensorflow C binary | headless-gl (optional) | Pre-built .node addon |
| **Training in Node.js** | Yes (full Keras-like API) | Yes (simple API) | No (inference-only) |
| **Inference latency** | ~0.1-1 ms (tfjs-node) | sub-ms (small nets) | ~0.5-2.5 ms |
| **Node 20/22 compat** | Problematic (binary issues) | Unknown (beta) | Supported |
| **Maintenance status** | Slowing (no release since Oct 2024) | Low (perpetual beta) | Very active |

### Model Type Support

| Model Type | TensorFlow.js | brain.js | ONNX Runtime |
|---|---|---|---|
| Dense / MLP | Train + Infer | Train + Infer | Infer (train in Python) |
| LSTM | Train + Infer | Train + Infer | Infer (train in Python) |
| GRU | Train + Infer | Train + Infer | Infer (train in Python) |
| CNN | Train + Infer | Not supported | Infer (train in Python) |
| Transformer | Manual build only | Not supported | Infer (train in Python) |
| XGBoost / LightGBM | Not supported | Not supported | Infer (train in Python) |
| Random Forest | Not supported | Not supported | Infer (train in Python) |
| scikit-learn pipelines | Not supported | Not supported | Infer (train in Python) |

### Training & Serialization

| Feature | TensorFlow.js | brain.js | ONNX Runtime |
|---|---|---|---|
| Training API | `model.fit()`, Sequential + Functional API | `net.train(data, opts)` | N/A (Python training) |
| Optimizers | adam, sgd, rmsprop, adagrad, etc. | Fixed (backprop only) | N/A |
| Custom layers | Yes | No | N/A |
| Dropout/BatchNorm | Yes | No | N/A |
| Model format | JSON + binary weights | Pure JSON | .onnx (protobuf) |
| Model size (small tabular) | ~15-55 KB | ~5-20 KB | ~10 KB - 5 MB |
| Cross-env portability | Node ↔ Browser | Node ↔ Browser | Any ONNX runtime |

---

## Framework Deep Dives

### 1. TensorFlow.js (`@tensorflow/tfjs-node`)

**Strengths:**
- Full Keras-like training API — train models entirely in Node.js
- Broadest neural network support (dense, CNN, LSTM, GRU, bidirectional)
- Multiple backends: native CPU, CUDA GPU, WASM, pure JS fallback
- Extensive documentation and official tutorials
- Google-backed with large community

**Weaknesses:**
- Massive install footprint (~350-500 MB with libtensorflow)
- Node 20/22 binary compatibility issues requiring source compilation
- No native gradient boosted tree training (inference only via converted models)
- Release cadence slowing — no release since Oct 2024
- Complex dependency chain (node-gyp, Python build tools may be needed)

**Best for:** When you need to train neural networks directly in Node.js without a Python dependency.

### 2. brain.js

**Strengths:**
- Simplest API — minimal learning curve, quick prototyping
- Pure JSON model export, including `toFunction()` for zero-dep inference
- Small bundle size (~128 KB gzipped)
- Good for educational use and simple pattern recognition

**Weaknesses:**
- Perpetual beta (2.0.0-beta.24 for years, never stable)
- Very limited model types — no CNN, no transformers, no tree ensembles
- No dropout, batch normalization, or regularization
- Only 4 activation functions (sigmoid, relu, leaky-relu, tanh)
- GPU support via gpu.js is unreliable (especially on Apple Silicon)
- Tiny community (~3.8k weekly downloads), minimal maintenance
- Not suitable for production ML workloads

**Best for:** Quick prototyping, educational demos, simple pattern recognition.

### 3. ONNX Runtime (`onnxruntime-node`)

**Strengths:**
- Fastest inference for production workloads (~5x faster than scikit-learn for tree models)
- Supports ALL model types via ONNX format — trees, neural nets, classical ML
- "Train in Python, deploy in Node" — access the full Python ML ecosystem
- Actively maintained by Microsoft (used in Office, Bing, Xbox)
- Highest npm downloads (~651k/week) — battle-tested at scale
- Good Node.js compatibility (v16+, v22 supported)
- Graph optimizations: operator fusion, constant folding, INT8 quantization
- Model-as-artifact: single `.onnx` file, easy versioning

**Weaknesses:**
- No training in Node.js — requires Python for model training
- Native binary dependency (~30-50 MB CPU-only)
- Node.js documentation thinner than Python docs
- Requires learning ONNX conversion tools (skl2onnx, onnxmltools)

**Best for:** Production inference with models trained in Python. Ideal for tabular data and gradient boosted trees.

---

## Code Examples: Binary Classifier on Tabular Trading Data

Each example trains/runs a binary classifier on 15-feature trading data (RSI, MACD histogram, Bollinger position, volume ratio, sentiment scores, etc.) predicting BUY (1) vs NOT-BUY (0).

### Example 1: TensorFlow.js

```javascript
import * as tf from '@tensorflow/tfjs-node';

// Sample training data: 15 features → binary output
const trainingData = [
  { input: [28, 0.5, 0.15, 2.1, 0.7, 0.3, 45000, 1.2, 0.8, 0.6, 0.4, 0.9, 3, 120, 0.65], output: 1 },
  { input: [72, -0.3, 0.85, 0.8, -0.2, -0.5, 44000, 0.9, 0.3, 0.2, 0.7, 0.1, 1, 30, 0.25], output: 0 },
  // ... hundreds more samples
];

// Normalize inputs to [0, 1] range (critical for neural nets)
function normalize(data, mins, maxes) {
  return data.map((val, i) => (val - mins[i]) / (maxes[i] - mins[i]));
}

// Build model
const model = tf.sequential({
  layers: [
    tf.layers.dense({ inputShape: [15], units: 64, activation: 'relu' }),
    tf.layers.dropout({ rate: 0.3 }),
    tf.layers.dense({ units: 32, activation: 'relu' }),
    tf.layers.dropout({ rate: 0.2 }),
    tf.layers.dense({ units: 1, activation: 'sigmoid' }),
  ],
});

model.compile({
  optimizer: tf.train.adam(0.001),
  loss: 'binaryCrossentropy',
  metrics: ['accuracy'],
});

// Prepare tensors
const xs = tf.tensor2d(trainingData.map(d => d.input));
const ys = tf.tensor2d(trainingData.map(d => [d.output]));

// Train
await model.fit(xs, ys, {
  epochs: 100,
  batchSize: 32,
  validationSplit: 0.2,
  callbacks: {
    onEpochEnd: (epoch, logs) => {
      if (epoch % 10 === 0) console.log(`Epoch ${epoch}: loss=${logs.loss.toFixed(4)}`);
    },
  },
});

// Save model
await model.save('file://./models/signal-classifier');

// Inference
const input = tf.tensor2d([[25, 0.8, 0.1, 2.5, 0.9, 0.6, 46000, 1.5, 0.9, 0.7, 0.3, 0.85, 4, 200, 0.8]]);
const prediction = model.predict(input);
const score = prediction.dataSync()[0]; // 0-1 probability
console.log(`BUY probability: ${(score * 100).toFixed(1)}%`);

// Cleanup tensors
xs.dispose(); ys.dispose(); input.dispose(); prediction.dispose();
```

### Example 2: brain.js

```javascript
import brain from 'brain.js';

// brain.js expects inputs/outputs as objects or arrays in [0, 1] range
const trainingData = [
  { input: [0.28, 0.65, 0.15, 0.52, 0.7, 0.65, 0.45, 0.6, 0.8, 0.6, 0.4, 0.9, 0.3, 0.6, 0.65], output: [1] },
  { input: [0.72, 0.35, 0.85, 0.2, 0.3, 0.25, 0.44, 0.45, 0.3, 0.2, 0.7, 0.1, 0.1, 0.15, 0.25], output: [0] },
  // ... pre-normalized to [0, 1]
];

const net = new brain.NeuralNetwork({
  hiddenLayers: [64, 32],
  activation: 'leaky-relu',
  learningRate: 0.01,
});

// Train — returns stats object
const stats = net.train(trainingData, {
  iterations: 5000,
  errorThresh: 0.005,
  log: true,
  logPeriod: 500,
});

console.log(`Training complete: ${stats.iterations} iterations, error: ${stats.error.toFixed(6)}`);

// Save model as JSON
const modelJSON = net.toJSON();
// fs.writeFileSync('./models/brain-model.json', JSON.stringify(modelJSON));

// Load model
// const loaded = new brain.NeuralNetwork();
// loaded.fromJSON(JSON.parse(fs.readFileSync('./models/brain-model.json')));

// Inference
const result = net.run([0.25, 0.8, 0.1, 0.63, 0.9, 0.8, 0.46, 0.75, 0.9, 0.7, 0.3, 0.85, 0.4, 1.0, 0.8]);
console.log(`BUY probability: ${(result[0] * 100).toFixed(1)}%`);

// Export as standalone function (zero deps for deployment)
const standaloneFn = net.toFunction();
const result2 = standaloneFn([0.25, 0.8, 0.1, 0.63, 0.9, 0.8, 0.46, 0.75, 0.9, 0.7, 0.3, 0.85, 0.4, 1.0, 0.8]);
```

### Example 3: ONNX Runtime (Train in Python, Infer in Node.js)

**Step 1: Train in Python (one-time)**

```python
# train_signal_model.py
import numpy as np
from xgboost import XGBClassifier
from onnxmltools import convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType

# Training data: 15 features → BUY (1) / NOT_BUY (0)
X_train = np.array([
    [28, 0.5, 0.15, 2.1, 0.7, 0.3, 45000, 1.2, 0.8, 0.6, 0.4, 0.9, 3, 120, 0.65],
    [72, -0.3, 0.85, 0.8, -0.2, -0.5, 44000, 0.9, 0.3, 0.2, 0.7, 0.1, 1, 30, 0.25],
    # ... hundreds more samples from backtesting
], dtype=np.float32)
y_train = np.array([1, 0, ...])

# XGBoost — best-in-class for tabular data
model = XGBClassifier(
    n_estimators=100,
    max_depth=6,
    learning_rate=0.1,
    objective='binary:logistic',
    eval_metric='auc',
)
model.fit(X_train, y_train)

# Export to ONNX
initial_type = [('features', FloatTensorType([None, 15]))]
onnx_model = convert_xgboost(model, initial_types=initial_type)

with open('signal_classifier.onnx', 'wb') as f:
    f.write(onnx_model.SerializeToString())

print(f"Model exported: signal_classifier.onnx")
```

**Step 2: Infer in Node.js (production)**

```javascript
import * as ort from 'onnxruntime-node';

// Load model once at startup
const session = await ort.InferenceSession.create('./models/signal_classifier.onnx', {
  executionProviders: ['CPUExecutionProvider'],
  graphOptimizationLevel: 'all',
  intraOpNumThreads: 1, // Best for single-prediction latency
});

// Feature vector: [rsi, macdHist, bollingerPos, volumeRatio, sentScore, ...]
const features = new Float32Array([25, 0.8, 0.1, 2.5, 0.9, 0.6, 46000, 1.5, 0.9, 0.7, 0.3, 0.85, 4, 200, 0.8]);
const inputTensor = new ort.Tensor('float32', features, [1, 15]);

// Run inference
const results = await session.run({ features: inputTensor });

// XGBoost ONNX outputs: 'label' (predicted class) and 'probabilities' (class probs)
const predictedClass = results.label.data[0];       // 0 or 1
const probabilities = results.probabilities.data;    // [p_not_buy, p_buy]
const buyProbability = probabilities[1];

console.log(`Prediction: ${predictedClass === 1 ? 'BUY' : 'HOLD'}`);
console.log(`BUY probability: ${(buyProbability * 100).toFixed(1)}%`);
```

---

## Performance Benchmark: Inference Latency

**Methodology**: Run 1000 predictions on a 15-feature input vector, measure average and P99 latency.

```javascript
// Benchmark scaffold (works for all three frameworks)
async function benchmarkInference(predictFn, name, iterations = 1000) {
  // Warm-up (first call has overhead)
  await predictFn();
  await predictFn();

  const latencies = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await predictFn();
    latencies.push(performance.now() - start);
  }

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((a, b) => a + b) / latencies.length;
  const p50 = latencies[Math.floor(iterations * 0.5)];
  const p99 = latencies[Math.floor(iterations * 0.99)];
  const total = latencies.reduce((a, b) => a + b);

  console.log(`${name} (${iterations} predictions):`);
  console.log(`  Total:  ${total.toFixed(1)} ms`);
  console.log(`  Avg:    ${avg.toFixed(3)} ms`);
  console.log(`  P50:    ${p50.toFixed(3)} ms`);
  console.log(`  P99:    ${p99.toFixed(3)} ms`);
  console.log(`  Throughput: ${(iterations / (total / 1000)).toFixed(0)} pred/sec`);
}
```

**Expected performance (based on published benchmarks and community data):**

| Framework | Avg Latency | P99 Latency | 1000-pred Total | Throughput |
|---|---|---|---|---|
| TensorFlow.js (tfjs-node) | ~0.3-1 ms | ~2-5 ms | ~300-1000 ms | ~1k-3k pred/sec |
| brain.js (CPU) | ~0.1-0.5 ms | ~1-3 ms | ~100-500 ms | ~2k-10k pred/sec |
| ONNX Runtime (CPU) | ~0.5-2 ms | ~3-5 ms | ~500-2000 ms | ~500-2k pred/sec |

**Notes:**
- brain.js wins on raw single-prediction speed for tiny networks due to minimal overhead
- TensorFlow.js with native backend is competitive for small models
- ONNX Runtime excels at batch inference and complex models (tree ensembles with 100+ trees)
- For our use case (single predictions every few seconds), ALL three meet latency requirements
- The differentiator is model quality, not inference speed

---

## Recommendation

### Primary: ONNX Runtime (`onnxruntime-node`)

**Rationale tied to our use case (real-time signal scoring on 15+ features):**

1. **Gradient boosted trees are the best model type for tabular trading data.** Research consistently shows XGBoost/LightGBM outperform neural networks on structured tabular data. Neither TensorFlow.js nor brain.js can train these models. ONNX Runtime can run them.

2. **"Train in Python, deploy in Node.js" is the right architecture.** Our bot runs in Node.js for WebSocket handling and real-time execution. Model training is a batch process that belongs in Python where scikit-learn, XGBoost, pandas, and Optuna (hyperparameter tuning) live. ONNX bridges the gap cleanly.

3. **Best production characteristics.** Highest download count (651k/week), Microsoft-backed, actively maintained, supports Node 22, MIT licensed. TensorFlow.js has compatibility issues with modern Node versions and is slowing down. brain.js is in perpetual beta.

4. **Model-as-artifact deployment.** Drop a new `.onnx` file to update the model. No code changes needed. This enables A/B testing, model versioning, and rollback — critical for a trading system.

5. **Inference speed is sufficient.** Sub-3ms per prediction easily meets our real-time requirements (signals generated every few seconds, not microseconds).

### Secondary: TensorFlow.js (`@tensorflow/tfjs-node`)

**When to use instead:**
- If we need online learning (updating model weights as new data arrives in real-time)
- If we want to train LSTM/GRU time-series models directly in Node.js without Python
- If we want to avoid the Python training pipeline entirely

**Note:** TensorFlow.js models can also be exported to ONNX format, so we could start with TF.js and migrate to ONNX Runtime later.

### Not Recommended: brain.js

brain.js is not suitable for production trading signal prediction. It lacks the model types we need (no tree ensembles), has no regularization (dropout, batch norm), is in perpetual beta, and has minimal community support. Its only advantage — simplicity — doesn't outweigh its limitations for our use case.

---

## Integration Plan

```
Current Architecture:
  Market Data → Technical Indicators → Rule-based Score → BUY/SELL/HOLD

Proposed Architecture:
  Market Data → Feature Extraction → ONNX Model → ML Score ─┐
  Sentiment  → Feature Extraction ──────────────────────────→├→ Combined Score → BUY/SELL/HOLD
  Technical Indicators → Rule-based Score ──────────────────→┘
```

**Feature vector (15+ features):**
1. RSI (14-period)
2. MACD histogram
3. MACD signal distance
4. Bollinger Band position (0-1)
5. Bollinger bandwidth
6. Volume ratio (current / 20-period avg)
7. Current price
8. Price change % (1h, 4h, 24h) — 3 features
9. Sentiment score (aggregate)
10. Sentiment velocity (rate of change)
11. Reddit mention count (normalized)
12. News sentiment score
13. RSI divergence signal
14. Time-of-day encoding (sin/cos) — 2 features

**Next steps:**
1. Build feature extraction pipeline in Node.js (extract from existing indicators + sentiment)
2. Set up Python training pipeline (XGBoost + scikit-learn)
3. Collect labeled training data from backtesting results
4. Train initial model, export to ONNX
5. Integrate `onnxruntime-node` into signal engine alongside existing rule-based scoring
6. A/B test ML predictions vs current heuristic scoring
