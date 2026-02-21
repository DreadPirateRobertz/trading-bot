// Neural Network Model Tests
import { describe, it, expect } from 'vitest';
import { NeuralNetwork } from '../src/ml/model.js';

describe('NeuralNetwork', () => {
  describe('Construction', () => {
    it('creates network with correct layer structure', () => {
      const nn = new NeuralNetwork({ layers: [10, 16, 8, 3] });
      expect(nn.layers).toEqual([10, 16, 8, 3]);
      expect(nn.weights).toHaveLength(3); // 3 layer transitions
      expect(nn.biases).toHaveLength(3);
    });

    it('initializes weights with correct dimensions', () => {
      const nn = new NeuralNetwork({ layers: [4, 6, 3] });
      // First layer: 6 neurons, each with 4 weights
      expect(nn.weights[0]).toHaveLength(6);
      expect(nn.weights[0][0]).toHaveLength(4);
      // Second layer: 3 neurons, each with 6 weights
      expect(nn.weights[1]).toHaveLength(3);
      expect(nn.weights[1][0]).toHaveLength(6);
    });

    it('uses default architecture when no config provided', () => {
      const nn = new NeuralNetwork();
      expect(nn.layers).toEqual([10, 16, 8, 3]);
      expect(nn.trained).toBe(false);
    });
  });

  describe('Forward Pass', () => {
    it('produces output of correct shape', () => {
      const nn = new NeuralNetwork({ layers: [4, 6, 3] });
      const input = [0.5, 0.3, 0.7, 0.1];
      const output = nn.predict(input);
      expect(output).toHaveLength(3);
    });

    it('output sums to ~1 (softmax)', () => {
      const nn = new NeuralNetwork({ layers: [4, 6, 3] });
      const input = [0.5, 0.3, 0.7, 0.1];
      const output = nn.predict(input);
      const sum = output.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it('all probabilities are in [0, 1]', () => {
      const nn = new NeuralNetwork({ layers: [10, 16, 8, 3] });
      const input = Array(10).fill(0).map(() => Math.random());
      const output = nn.predict(input);
      for (const p of output) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    });

    it('returns all layer activations in forward()', () => {
      const nn = new NeuralNetwork({ layers: [4, 6, 3] });
      const input = [0.5, 0.3, 0.7, 0.1];
      const activations = nn.forward(input);
      expect(activations).toHaveLength(3); // input, hidden, output
      expect(activations[0]).toHaveLength(4);
      expect(activations[1]).toHaveLength(6);
      expect(activations[2]).toHaveLength(3);
    });
  });

  describe('PredictSignal', () => {
    it('returns action, confidence, and probabilities', () => {
      const nn = new NeuralNetwork({ layers: [4, 6, 3] });
      const input = [0.5, 0.3, 0.7, 0.1];
      const signal = nn.predictSignal(input);
      expect(['BUY', 'HOLD', 'SELL']).toContain(signal.action);
      expect(signal.confidence).toBeGreaterThan(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
      expect(signal.probabilities).toHaveProperty('buy');
      expect(signal.probabilities).toHaveProperty('hold');
      expect(signal.probabilities).toHaveProperty('sell');
    });

    it('confidence equals the max probability', () => {
      const nn = new NeuralNetwork({ layers: [4, 6, 3] });
      const input = [0.5, 0.3, 0.7, 0.1];
      const signal = nn.predictSignal(input);
      const maxProb = Math.max(signal.probabilities.buy, signal.probabilities.hold, signal.probabilities.sell);
      expect(signal.confidence).toBeCloseTo(maxProb, 10);
    });
  });

  describe('Training', () => {
    it('reduces loss over epochs on simple data', () => {
      const nn = new NeuralNetwork({ layers: [2, 4, 2], learningRate: 0.1 });
      // Simple XOR-like data
      const data = [
        { input: [0, 0], output: [1, 0] },
        { input: [0, 1], output: [0, 1] },
        { input: [1, 0], output: [0, 1] },
        { input: [1, 1], output: [1, 0] },
      ];
      const history = nn.train(data, { epochs: 100, shuffle: false });
      expect(history).toHaveLength(100);
      // Loss should decrease
      expect(history[history.length - 1].loss).toBeLessThan(history[0].loss);
    });

    it('sets trained flag after training', () => {
      const nn = new NeuralNetwork({ layers: [2, 4, 2] });
      const data = [
        { input: [0, 1], output: [1, 0] },
        { input: [1, 0], output: [0, 1] },
      ];
      nn.train(data, { epochs: 5 });
      expect(nn.trained).toBe(true);
    });

    it('history contains epoch, loss, accuracy', () => {
      const nn = new NeuralNetwork({ layers: [2, 4, 2] });
      const data = [
        { input: [0, 1], output: [1, 0] },
        { input: [1, 0], output: [0, 1] },
      ];
      const history = nn.train(data, { epochs: 3 });
      for (const h of history) {
        expect(h).toHaveProperty('epoch');
        expect(h).toHaveProperty('loss');
        expect(h).toHaveProperty('accuracy');
        expect(h.loss).toBeGreaterThanOrEqual(0);
        expect(h.accuracy).toBeGreaterThanOrEqual(0);
        expect(h.accuracy).toBeLessThanOrEqual(1);
      }
    });

    it('learns simple linear separation', () => {
      const nn = new NeuralNetwork({ layers: [2, 8, 2], learningRate: 0.1 });
      // Linearly separable data
      const data = [];
      for (let i = 0; i < 50; i++) {
        const x = Math.random();
        const y = Math.random();
        data.push({
          input: [x, y],
          output: x + y > 1 ? [1, 0] : [0, 1],
        });
      }
      nn.train(data, { epochs: 200 });
      const metrics = nn.evaluate(data);
      expect(metrics.accuracy).toBeGreaterThan(0.7);
    });
  });

  describe('Evaluation', () => {
    it('returns accuracy, loss, confusion matrix', () => {
      const nn = new NeuralNetwork({ layers: [2, 4, 3] });
      const data = [
        { input: [0, 0], output: [1, 0, 0] },
        { input: [0, 1], output: [0, 1, 0] },
        { input: [1, 0], output: [0, 0, 1] },
      ];
      nn.train(data, { epochs: 50 });
      const metrics = nn.evaluate(data);
      expect(metrics).toHaveProperty('accuracy');
      expect(metrics).toHaveProperty('loss');
      expect(metrics).toHaveProperty('correct');
      expect(metrics).toHaveProperty('total');
      expect(metrics).toHaveProperty('confusion');
      expect(metrics.total).toBe(3);
      expect(metrics.confusion).toHaveProperty('BUY');
      expect(metrics.confusion).toHaveProperty('HOLD');
      expect(metrics.confusion).toHaveProperty('SELL');
    });
  });

  describe('Serialization', () => {
    it('toJSON and fromJSON round-trip preserves predictions', () => {
      const nn = new NeuralNetwork({ layers: [4, 6, 3] });
      const data = [
        { input: [0.1, 0.2, 0.3, 0.4], output: [1, 0, 0] },
        { input: [0.9, 0.8, 0.7, 0.6], output: [0, 0, 1] },
      ];
      nn.train(data, { epochs: 10 });

      const json = nn.toJSON();
      const restored = NeuralNetwork.fromJSON(json);

      const input = [0.5, 0.5, 0.5, 0.5];
      const originalPred = nn.predict(input);
      const restoredPred = restored.predict(input);

      for (let i = 0; i < originalPred.length; i++) {
        expect(restoredPred[i]).toBeCloseTo(originalPred[i], 10);
      }
    });

    it('preserves trained flag in serialization', () => {
      const nn = new NeuralNetwork({ layers: [2, 3, 2] });
      nn.train([{ input: [0, 1], output: [1, 0] }], { epochs: 1 });
      const json = nn.toJSON();
      const restored = NeuralNetwork.fromJSON(json);
      expect(restored.trained).toBe(true);
    });

    it('preserves layer configuration', () => {
      const nn = new NeuralNetwork({ layers: [5, 10, 7, 3], learningRate: 0.05 });
      const json = nn.toJSON();
      const restored = NeuralNetwork.fromJSON(json);
      expect(restored.layers).toEqual([5, 10, 7, 3]);
      expect(restored.learningRate).toBe(0.05);
    });
  });
});
