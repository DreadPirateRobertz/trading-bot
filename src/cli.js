#!/usr/bin/env node
// CLI Runner - Command line interface for the trading bot

import { loadConfig, validateConfig } from './config/index.js';
import { LiveTrader } from './live/index.js';
import { createDashboard } from './dashboard/index.js';
import { Backtester } from './backtest/index.js';
import { AlpacaConnector } from './market-data/alpaca.js';
import { BinanceConnector } from './market-data/binance.js';

function parseArgs(argv) {
  const args = { mode: null, envFile: null, symbols: null, help: false };
  const raw = argv.slice(2);

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--env' && raw[i + 1]) args.envFile = raw[++i];
    else if (arg === '--symbols' && raw[i + 1]) args.symbols = raw[++i].split(',');
    else if (!arg.startsWith('-') && !args.mode) args.mode = arg;
  }

  return args;
}

function printUsage() {
  console.log(`
Trading Bot CLI

Usage: node src/cli.js <mode> [options]

Modes:
  live       Start live trading with WebSocket feeds
  paper      Start paper trading (default, same as live but always paper mode)
  backtest   Run backtester on historical data
  status     Show config and validate credentials

Options:
  --env <path>        Path to .env file (default: ./.env)
  --symbols <list>    Comma-separated symbols (overrides .env)
  -h, --help          Show this help

Environment Variables (via .env):
  ALPACA_KEY_ID         Alpaca API key
  ALPACA_SECRET_KEY     Alpaca secret key
  ALPACA_PAPER          Use paper trading (default: true)
  BINANCE_API_KEY       Binance API key
  BINANCE_SECRET_KEY    Binance secret key
  BINANCE_TESTNET       Use testnet (default: true)
  TRADING_SYMBOLS       Comma-separated symbols
  INITIAL_BALANCE       Starting balance (default: 100000)
  DASHBOARD_PORT        Dashboard port (default: 3000)
  BOT_MODE              Default mode (live/paper/backtest)
  LOG_LEVEL             Log level (default: info)
`);
}

function log(level, ...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

async function runLive(config) {
  log('info', `Starting ${config.mode} trading...`);
  log('info', `Symbols: ${config.trading.symbols.join(', ')}`);
  log('info', `Initial balance: $${config.trading.initialBalance.toLocaleString()}`);

  const trader = new LiveTrader({
    config,
    onSignal: (analysis) => {
      if (analysis.signal && analysis.signal.action !== 'HOLD') {
        log('signal', `${analysis.symbol}: ${analysis.signal.action} (conf: ${analysis.signal.confidence.toFixed(2)})`);
      }
    },
    onTrade: (trade) => {
      log('trade', `${trade.action} ${trade.symbol} qty:${trade.qty} @$${trade.price}`);
    },
    onError: (err) => {
      log('error', err.message || err);
    },
    onStatus: (status) => {
      log('status', status.event, status.message || '');
    },
  });

  // Start dashboard
  let dashboard;
  try {
    const express = (await import('express')).default;
    dashboard = createDashboard(trader, config);
    dashboard.startServer(express);
    log('info', `Dashboard running at http://${config.dashboard.host}:${config.dashboard.port}`);
  } catch {
    log('warn', 'Express not available - dashboard disabled. Install with: npm install express');
  }

  // Start trading
  try {
    const WebSocket = (await import('ws')).default;
    await trader.start(WebSocket);
  } catch {
    log('warn', 'ws module not available - running without live WebSocket feeds');
    log('info', 'Install with: npm install ws');
    await trader.start(null);
  }

  log('info', 'Bot is running. Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = () => {
    log('info', 'Shutting down...');
    trader.stop();
    if (dashboard) dashboard.stopServer();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runBacktest(config) {
  log('info', 'Running backtest...');
  log('info', `Symbols: ${config.trading.symbols.join(', ')}`);

  const backtester = new Backtester({
    initialBalance: config.trading.initialBalance,
  });

  for (const symbol of config.trading.symbols) {
    log('info', `Fetching historical data for ${symbol}...`);
    let candles = [];

    try {
      if (symbol.endsWith('USDT') && config.binance.apiKey) {
        const connector = new BinanceConnector(config.binance);
        candles = await connector.getKlines(symbol, { interval: '1h', limit: 500 });
      } else if (config.alpaca.keyId) {
        const connector = new AlpacaConnector(config.alpaca);
        candles = await connector.getBars(symbol, { timeframe: '1Hour', limit: 500 });
      }
    } catch (err) {
      log('error', `Failed to fetch data for ${symbol}: ${err.message}`);
      continue;
    }

    if (candles.length < 50) {
      log('warn', `Not enough data for ${symbol} (${candles.length} candles)`);
      continue;
    }

    const result = backtester.run(symbol, candles);
    log('info', `\n── ${symbol} Backtest Results ──`);
    log('info', `Total Return: ${(result.totalReturn * 100).toFixed(2)}%`);
    log('info', `Win Rate: ${(result.winRate * 100).toFixed(1)}%`);
    log('info', `Total Trades: ${result.totalTrades}`);
    log('info', `Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
    log('info', `Max Drawdown: ${(result.maxDrawdown * 100).toFixed(2)}%`);
    log('info', `Profit Factor: ${result.profitFactor.toFixed(2)}`);
  }
}

async function showStatus(config) {
  const validation = validateConfig(config);
  log('info', 'Configuration:');
  log('info', `  Mode: ${config.mode}`);
  log('info', `  Symbols: ${config.trading.symbols.join(', ')}`);
  log('info', `  Balance: $${config.trading.initialBalance.toLocaleString()}`);
  log('info', `  Dashboard: ${config.dashboard.host}:${config.dashboard.port}`);
  log('info', `  Alpaca: ${config.alpaca.keyId ? 'Configured' : 'Not configured'} (paper: ${config.alpaca.paper})`);
  log('info', `  Binance: ${config.binance.apiKey ? 'Configured' : 'Not configured'} (testnet: ${config.binance.testnet})`);
  log('info', `  Reddit: ${config.reddit.clientId ? 'Configured' : 'Not configured'}`);
  log('info', `  Valid: ${validation.valid}`);
  if (!validation.valid) {
    for (const err of validation.errors) {
      log('error', `  - ${err}`);
    }
  }
}

// Main entry
const args = parseArgs(process.argv);

if (args.help) {
  printUsage();
  process.exit(0);
}

const config = loadConfig(args.envFile);

// Override mode/symbols from CLI
if (args.mode) config.mode = args.mode;
if (args.symbols) config.trading.symbols = args.symbols;

const validation = validateConfig(config);
if (!validation.valid && config.mode === 'live') {
  for (const err of validation.errors) {
    log('error', err);
  }
  process.exit(1);
}

switch (config.mode) {
  case 'live':
  case 'paper':
    runLive(config);
    break;
  case 'backtest':
    runBacktest(config);
    break;
  case 'status':
    showStatus(config);
    break;
  default:
    log('error', `Unknown mode: ${config.mode}`);
    printUsage();
    process.exit(1);
}
