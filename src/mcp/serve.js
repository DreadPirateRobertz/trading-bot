#!/usr/bin/env node
// MCP Server entry point — run via: node src/mcp/serve.js
// Or: npm run mcp
// Connects via stdio transport for Claude Desktop / Claude Code integration

import { startMcpServer } from './index.js';

const server = await startMcpServer({
  initialBalance: Number(process.env.INITIAL_BALANCE || 100000),
  symbols: (process.env.TRADING_SYMBOLS || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()),
  activeStrategy: process.env.ACTIVE_STRATEGY || 'ensemble',
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
