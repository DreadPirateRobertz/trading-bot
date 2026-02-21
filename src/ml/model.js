// Neural Network Model
// Simple feed-forward network with backpropagation for signal prediction
// Zero dependencies - pure JavaScript implementation

import { NUM_FEATURES, NUM_CLASSES } from './features.js';

export class NeuralNetwork {
  // layers: array of layer sizes, e.g. [10, 16, 8, 3]
  constructor({ layers = [NUM_FEATURES, 16, 8, NUM_CLASSES], learningRate = 0.01 } = {}) {
    this.layers = layers;
    this.learningRate = learningRate;
    this.weights = [];
    this.biases = [];
    this.trained = false;

    // Initialize weights with Xavier initialization
    for (let i = 0; i < layers.length - 1; i++) {
      const fanIn = layers[i];
      const fanOut = layers[i + 1];
      const scale = Math.sqrt(2 / (fanIn + fanOut));
      this.weights.push(
        Array.from({ length: fanOut }, () =>
          Array.from({ length: fanIn }, () => (Math.random() * 2 - 1) * scale)
        )
      );
      this.biases.push(Array.from({ length: fanOut }, () => 0));
    }
  }

  // Forward pass: input → activations at each layer
  forward(input) {
    const activations = [input];
    let current = input;

    for (let l = 0; l < this.weights.length; l++) {
      const w = this.weights[l];
      const b = this.biases[l];
      const isOutput = l === this.weights.length - 1;
      const next = [];

      for (let j = 0; j < w.length; j++) {
        let sum = b[j];
        for (let k = 0; k < current.length; k++) {
          sum += w[j][k] * current[k];
        }
        next.push(sum);
      }

      // Activation: sigmoid for hidden layers, softmax for output
      if (isOutput) {
        current = softmax(next);
      } else {
        current = next.map(sigmoid);
      }
      activations.push(current);
    }

    return activations;
  }

  // Predict: returns [buyProb, holdProb, sellProb]
  predict(input) {
    const activations = this.forward(input);
    return activations[activations.length - 1];
  }

  // Predict with action label
  predictSignal(input) {
    const probs = this.predict(input);
    const maxIdx = probs.indexOf(Math.max(...probs));
    const actions = ['BUY', 'HOLD', 'SELL'];
    return {
      action: actions[maxIdx],
      confidence: probs[maxIdx],
      probabilities: { buy: probs[0], hold: probs[1], sell: probs[2] },
    };
  }

  // Train on a single sample using backpropagation
  trainSample(input, target) {
    const activations = this.forward(input);
    const output = activations[activations.length - 1];

    // Output layer error (cross-entropy derivative with softmax = output - target)
    let deltas = output.map((o, i) => o - target[i]);

    // Backpropagate
    for (let l = this.weights.length - 1; l >= 0; l--) {
      const prevActivation = activations[l];
      const nextDeltas = l > 0 ? Array(this.weights[l][0].length).fill(0) : null;

      for (let j = 0; j < this.weights[l].length; j++) {
        // Update bias
        this.biases[l][j] -= this.learningRate * deltas[j];

        for (let k = 0; k < this.weights[l][j].length; k++) {
          // Accumulate error for previous layer
          if (nextDeltas) {
            nextDeltas[k] += this.weights[l][j][k] * deltas[j];
          }
          // Update weight
          this.weights[l][j][k] -= this.learningRate * deltas[j] * prevActivation[k];
        }
      }

      // Compute deltas for previous hidden layer (sigmoid derivative)
      if (nextDeltas) {
        deltas = nextDeltas.map((d, k) => {
          const a = activations[l][k];
          return d * a * (1 - a); // sigmoid derivative
        });
      }
    }

    // Cross-entropy loss
    let loss = 0;
    for (let i = 0; i < target.length; i++) {
      if (target[i] > 0) {
        loss -= target[i] * Math.log(Math.max(output[i], 1e-15));
      }
    }
    return loss;
  }

  // Train on dataset for multiple epochs
  train(data, { epochs = 50, batchSize = 32, shuffle = true, onEpoch = null } = {}) {
    const history = [];

    for (let epoch = 0; epoch < epochs; epoch++) {
      let indices = Array.from({ length: data.length }, (_, i) => i);
      if (shuffle) {
        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
      }

      let totalLoss = 0;
      let correct = 0;

      for (const idx of indices) {
        const { input, output } = data[idx];
        const loss = this.trainSample(input, output);
        totalLoss += loss;

        // Check accuracy
        const predicted = this.predict(input);
        const predClass = predicted.indexOf(Math.max(...predicted));
        const trueClass = output.indexOf(Math.max(...output));
        if (predClass === trueClass) correct++;
      }

      const avgLoss = totalLoss / data.length;
      const accuracy = correct / data.length;
      history.push({ epoch: epoch + 1, loss: avgLoss, accuracy });

      if (onEpoch) onEpoch({ epoch: epoch + 1, loss: avgLoss, accuracy });
    }

    this.trained = true;
    return history;
  }

  // Evaluate on test data
  evaluate(data) {
    let correct = 0;
    let totalLoss = 0;
    const confusion = { BUY: { BUY: 0, HOLD: 0, SELL: 0 }, HOLD: { BUY: 0, HOLD: 0, SELL: 0 }, SELL: { BUY: 0, HOLD: 0, SELL: 0 } };
    const classes = ['BUY', 'HOLD', 'SELL'];

    for (const { input, output } of data) {
      const predicted = this.predict(input);
      const predClass = predicted.indexOf(Math.max(...predicted));
      const trueClass = output.indexOf(Math.max(...output));

      if (predClass === trueClass) correct++;
      confusion[classes[trueClass]][classes[predClass]]++;

      // Cross-entropy loss
      for (let i = 0; i < output.length; i++) {
        if (output[i] > 0) {
          totalLoss -= output[i] * Math.log(Math.max(predicted[i], 1e-15));
        }
      }
    }

    return {
      accuracy: correct / data.length,
      loss: totalLoss / data.length,
      correct,
      total: data.length,
      confusion,
    };
  }

  // Serialize model to JSON
  toJSON() {
    return {
      layers: this.layers,
      learningRate: this.learningRate,
      weights: this.weights,
      biases: this.biases,
      trained: this.trained,
    };
  }

  // Deserialize model from JSON
  static fromJSON(json) {
    const nn = new NeuralNetwork({ layers: json.layers, learningRate: json.learningRate });
    nn.weights = json.weights;
    nn.biases = json.biases;
    nn.trained = json.trained;
    return nn;
  }
}

function sigmoid(x) {
  if (x > 500) return 1;
  if (x < -500) return 0;
  return 1 / (1 + Math.exp(-x));
}

function softmax(values) {
  const max = Math.max(...values);
  const exps = values.map(v => Math.exp(v - max)); // Numerical stability
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}
