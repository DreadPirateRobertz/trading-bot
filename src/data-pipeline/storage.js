// SQLite storage layer for OHLCV candles with feature columns
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  rsi_14 REAL,
  rsi_divergence INTEGER,
  macd_line REAL,
  macd_signal REAL,
  macd_histogram REAL,
  macd_momentum REAL,
  bb_upper REAL,
  bb_middle REAL,
  bb_lower REAL,
  bb_bandwidth REAL,
  bb_squeeze INTEGER,
  volume_profile REAL,
  sma_20 REAL,
  sma_50 REAL,
  ema_12 REAL,
  ema_26 REAL,
  sentiment_velocity REAL,
  atr_14 REAL,
  price_change_pct REAL,
  PRIMARY KEY (symbol, timestamp)
)`;

const FEATURE_COLUMNS = [
  'rsi_14', 'rsi_divergence', 'macd_line', 'macd_signal', 'macd_histogram',
  'macd_momentum', 'bb_upper', 'bb_middle', 'bb_lower', 'bb_bandwidth',
  'bb_squeeze', 'volume_profile', 'sma_20', 'sma_50', 'ema_12', 'ema_26',
  'sentiment_velocity', 'atr_14', 'price_change_pct',
];

export class CandleStore {
  constructor(dbPath = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this._prepareStatements();
  }

  _prepareStatements() {
    this._upsertCandle = this.db.prepare(`
      INSERT OR REPLACE INTO candles (symbol, timestamp, open, high, low, close, volume)
      VALUES (@symbol, @timestamp, @open, @high, @low, @close, @volume)
    `);

    this._upsertCandleBatch = this.db.transaction((candles) => {
      for (const c of candles) {
        this._upsertCandle.run(c);
      }
    });

    const setClauses = FEATURE_COLUMNS.map(col => `${col} = @${col}`).join(', ');
    this._updateFeatures = this.db.prepare(`
      UPDATE candles SET ${setClauses}
      WHERE symbol = @symbol AND timestamp = @timestamp
    `);

    this._updateFeaturesBatch = this.db.transaction((rows) => {
      for (const r of rows) {
        this._updateFeatures.run(r);
      }
    });
  }

  insertCandles(candles) {
    this._upsertCandleBatch(candles);
  }

  updateFeatures(rows) {
    this._updateFeaturesBatch(rows);
  }

  getCandles(symbol, { limit, startTs, endTs } = {}) {
    let sql = 'SELECT * FROM candles WHERE symbol = ?';
    const params = [symbol];
    if (startTs != null) { sql += ' AND timestamp >= ?'; params.push(startTs); }
    if (endTs != null) { sql += ' AND timestamp <= ?'; params.push(endTs); }
    sql += ' ORDER BY timestamp ASC';
    if (limit != null) { sql += ' LIMIT ?'; params.push(limit); }
    return this.db.prepare(sql).all(...params);
  }

  getLatestTimestamp(symbol) {
    const row = this.db.prepare(
      'SELECT MAX(timestamp) as ts FROM candles WHERE symbol = ?'
    ).get(symbol);
    return row?.ts ?? null;
  }

  getRowCount(symbol) {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM candles WHERE symbol = ?'
    ).get(symbol);
    return row?.cnt ?? 0;
  }

  getSymbols() {
    return this.db.prepare('SELECT DISTINCT symbol FROM candles ORDER BY symbol')
      .all()
      .map(r => r.symbol);
  }

  close() {
    this.db.close();
  }
}
