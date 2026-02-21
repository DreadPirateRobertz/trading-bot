import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, validateConfig } from '../src/config/index.js';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Config Module', () => {
  let tmpDir;
  let envFile;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tb-test-'));
    envFile = join(tmpDir, '.env');
  });

  afterEach(() => {
    try { unlinkSync(envFile); } catch { /* ignore */ }
    // Clean env vars we set
    delete process.env.ALPACA_KEY_ID;
    delete process.env.BINANCE_API_KEY;
    delete process.env.DASHBOARD_PORT;
  });

  it('loads defaults when no .env file exists', () => {
    const config = loadConfig(join(tmpDir, 'nonexistent'));
    expect(config.alpaca.keyId).toBe('');
    expect(config.alpaca.paper).toBe(true);
    expect(config.binance.testnet).toBe(true);
    expect(config.trading.initialBalance).toBe(100000);
    expect(config.dashboard.port).toBe(3000);
    expect(config.mode).toBe('paper');
  });

  it('loads values from .env file', () => {
    writeFileSync(envFile, [
      'ALPACA_KEY_ID=test-key',
      'ALPACA_SECRET_KEY=test-secret',
      'ALPACA_PAPER=false',
      'BINANCE_API_KEY=bn-key',
      'TRADING_SYMBOLS=BTCUSDT,SOLUSDT',
      'INITIAL_BALANCE=50000',
      'DASHBOARD_PORT=8080',
      'BOT_MODE=live',
    ].join('\n'));

    const config = loadConfig(envFile);
    expect(config.alpaca.keyId).toBe('test-key');
    expect(config.alpaca.secretKey).toBe('test-secret');
    expect(config.alpaca.paper).toBe(false);
    expect(config.binance.apiKey).toBe('bn-key');
    expect(config.trading.symbols).toEqual(['BTCUSDT', 'SOLUSDT']);
    expect(config.trading.initialBalance).toBe(50000);
    expect(config.dashboard.port).toBe(8080);
    expect(config.mode).toBe('live');
  });

  it('strips quotes from values', () => {
    writeFileSync(envFile, 'ALPACA_KEY_ID="quoted-key"\nBINANCE_API_KEY=\'single-quoted\'');
    const config = loadConfig(envFile);
    expect(config.alpaca.keyId).toBe('quoted-key');
    expect(config.binance.apiKey).toBe('single-quoted');
  });

  it('ignores comments and blank lines', () => {
    writeFileSync(envFile, '# comment\n\nALPACA_KEY_ID=mykey\n# another comment');
    const config = loadConfig(envFile);
    expect(config.alpaca.keyId).toBe('mykey');
  });

  it('env vars override .env file', () => {
    writeFileSync(envFile, 'ALPACA_KEY_ID=file-key');
    process.env.ALPACA_KEY_ID = 'env-key';
    const config = loadConfig(envFile);
    expect(config.alpaca.keyId).toBe('env-key');
  });

  it('parses boolean values correctly', () => {
    writeFileSync(envFile, 'ALPACA_PAPER=true\nBINANCE_TESTNET=1');
    const config = loadConfig(envFile);
    expect(config.alpaca.paper).toBe(true);
    expect(config.binance.testnet).toBe(true);
  });

  describe('validateConfig', () => {
    it('validates live mode requires API keys', () => {
      const config = loadConfig(join(tmpDir, 'nonexistent'));
      config.mode = 'live';
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('passes with alpaca key in live mode', () => {
      writeFileSync(envFile, 'ALPACA_KEY_ID=test\nBOT_MODE=live');
      const config = loadConfig(envFile);
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('passes in paper mode without keys', () => {
      const config = loadConfig(join(tmpDir, 'nonexistent'));
      config.mode = 'paper';
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('fails with invalid maxPositionPct', () => {
      const config = loadConfig(join(tmpDir, 'nonexistent'));
      config.trading.maxPositionPct = 2;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  it('loads Twitter bearer token from .env', () => {
    writeFileSync(envFile, 'TWITTER_BEARER_TOKEN=my-twitter-token');
    const config = loadConfig(envFile);
    expect(config.twitter.bearerToken).toBe('my-twitter-token');
  });

  it('defaults Twitter bearer token to empty string', () => {
    const config = loadConfig(join(tmpDir, 'nonexistent'));
    expect(config.twitter.bearerToken).toBe('');
  });
});
