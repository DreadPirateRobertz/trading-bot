// ML Module - Intelligence Layer
// Provides neural network-based signal prediction for the trading bot

export { extractFeatures, extractPipelineFeatures, generateTrainingData, generatePipelineTrainingData, FEATURE_NAMES, PIPELINE_FEATURE_NAMES, NUM_FEATURES, NUM_PIPELINE_FEATURES, NUM_CLASSES, CLASS_NAMES } from './features.js';
export { NeuralNetwork } from './model.js';
export { Trainer, MLSignalEnhancer } from './trainer.js';
