// ML Training Pipeline
// Walk-forward training with validation using backtest candle data

import { NeuralNetwork } from './model.js';
import { generateTrainingData, extractFeatures, NUM_FEATURES, NUM_CLASSES } from './features.js';

export class Trainer {
  constructor({
    layers = [NUM_FEATURES, 16, 8, NUM_CLASSES],
    learningRate = 0.01,
    epochs = 50,
    trainSplit = 0.8,
    horizon = 5,
    buyThreshold = 0.02,
    sellThreshold = -0.02,
    lookback = 30,
  } = {}) {
    this.config = { layers, learningRate, epochs, trainSplit, horizon, buyThreshold, sellThreshold, lookback };
  }

  // Train model on candle data with walk-forward split
  // Returns { model, trainMetrics, valMetrics, history, dataStats }
  trainOnCandles(candles, { sentiment = [] } = {}) {
    const { epochs, trainSplit, horizon, buyThreshold, sellThreshold, lookback, layers, learningRate } = this.config;

    // Generate labeled data
    const allData = generateTrainingData(candles, {
      lookback,
      horizon,
      buyThreshold,
      sellThreshold,
      sentiment,
    });

    if (allData.length < 20) {
      return { error: `Insufficient training data: ${allData.length} samples (need >= 20)` };
    }

    // Walk-forward split (no shuffle across time boundary)
    const splitIdx = Math.floor(allData.length * trainSplit);
    const trainData = allData.slice(0, splitIdx);
    const valData = allData.slice(splitIdx);

    if (trainData.length < 10 || valData.length < 5) {
      return { error: `Split too small: train=${trainData.length}, val=${valData.length}` };
    }

    // Class distribution
    const dataStats = computeDataStats(allData, trainData, valData);

    // Create and train model
    const model = new NeuralNetwork({ layers, learningRate });
    const history = model.train(trainData, { epochs, shuffle: true });

    // Evaluate
    const trainMetrics = model.evaluate(trainData);
    const valMetrics = model.evaluate(valData);

    return {
      model,
      history,
      trainMetrics,
      valMetrics,
      dataStats,
    };
  }

  // Walk-forward cross-validation: train on expanding window, validate on next segment
  walkForwardCV(candles, { folds = 5, sentiment = [] } = {}) {
    const { epochs, horizon, buyThreshold, sellThreshold, lookback, layers, learningRate } = this.config;

    const allData = generateTrainingData(candles, {
      lookback, horizon, buyThreshold, sellThreshold, sentiment,
    });

    if (allData.length < folds * 10) {
      return { error: `Insufficient data for ${folds}-fold CV: ${allData.length} samples` };
    }

    const foldSize = Math.floor(allData.length / (folds + 1));
    const foldResults = [];

    for (let fold = 0; fold < folds; fold++) {
      const trainEnd = (fold + 1) * foldSize;
      const valEnd = Math.min(trainEnd + foldSize, allData.length);
      const trainData = allData.slice(0, trainEnd);
      const valData = allData.slice(trainEnd, valEnd);

      if (trainData.length < 5 || valData.length < 3) continue;

      const model = new NeuralNetwork({ layers, learningRate });
      model.train(trainData, { epochs, shuffle: true });

      const valMetrics = model.evaluate(valData);
      foldResults.push({
        fold: fold + 1,
        trainSize: trainData.length,
        valSize: valData.length,
        accuracy: valMetrics.accuracy,
        loss: valMetrics.loss,
      });
    }

    // Average metrics across folds
    const avgAccuracy = foldResults.reduce((s, f) => s + f.accuracy, 0) / foldResults.length;
    const avgLoss = foldResults.reduce((s, f) => s + f.loss, 0) / foldResults.length;

    return {
      folds: foldResults,
      avgAccuracy,
      avgLoss,
      totalSamples: allData.length,
    };
  }
}

// Enhanced signal engine that combines rule-based signals with ML predictions
export class MLSignalEnhancer {
  constructor(model, { mlWeight = 0.4 } = {}) {
    this.model = model;
    this.mlWeight = mlWeight; // Weight given to ML prediction vs rule-based signal
  }

  // Enhance a signal engine analysis with ML prediction
  enhance(analysis, candles, { sentiment = null } = {}) {
    if (!this.model || !this.model.trained) {
      return analysis; // Pass through if no trained model
    }

    const features = extractFeatures(candles, { sentiment });
    if (!features) return analysis;

    const prediction = this.model.predictSignal(features);
    const ruleSignal = analysis.signal;

    // Combine rule-based and ML signals
    const mlScore = prediction.action === 'BUY' ? 2 : prediction.action === 'SELL' ? -2 : 0;
    const combinedScore = ruleSignal.score * (1 - this.mlWeight) + mlScore * prediction.confidence * this.mlWeight * 5;

    const combinedConfidence = Math.min(
      ruleSignal.confidence * (1 - this.mlWeight) + prediction.confidence * this.mlWeight,
      1
    );

    const reasons = [...ruleSignal.reasons];
    if (prediction.action !== 'HOLD') {
      reasons.push(`ML predicts ${prediction.action} (${(prediction.confidence * 100).toFixed(0)}%)`);
    }

    return {
      ...analysis,
      signal: {
        action: combinedScore >= 2 ? 'BUY' : combinedScore <= -2 ? 'SELL' : 'HOLD',
        score: Math.round(combinedScore * 100) / 100,
        confidence: Math.round(combinedConfidence * 100) / 100,
        reasons,
      },
      ml: {
        prediction: prediction.action,
        confidence: prediction.confidence,
        probabilities: prediction.probabilities,
      },
    };
  }
}

function computeDataStats(allData, trainData, valData) {
  const countClasses = (data) => {
    const counts = { BUY: 0, HOLD: 0, SELL: 0 };
    for (const { output } of data) {
      if (output[0] === 1) counts.BUY++;
      else if (output[1] === 1) counts.HOLD++;
      else counts.SELL++;
    }
    return counts;
  };

  return {
    total: allData.length,
    train: trainData.length,
    val: valData.length,
    classes: countClasses(allData),
    trainClasses: countClasses(trainData),
    valClasses: countClasses(valData),
  };
}
