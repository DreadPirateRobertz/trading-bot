// Express.js Monitoring Dashboard
// REST API + HTML dashboard for live trading bot monitoring

export function createDashboard(liveTrader, config) {
  let expressApp = null;
  let server = null;

  function createApp(express) {
    const app = express();
    app.use(express.json());

    // ── REST API ──

    app.get('/api/status', (_req, res) => {
      res.json(liveTrader.getFullStatus());
    });

    app.get('/api/portfolio', (_req, res) => {
      const status = liveTrader.realtimeTrader.getStatus();
      res.json(status.portfolio);
    });

    app.get('/api/positions', (_req, res) => {
      const summary = liveTrader.realtimeTrader.trader.getSummary();
      res.json(summary.positions);
    });

    app.get('/api/trades', (_req, res) => {
      const limit = parseInt(_req.query.limit) || 50;
      res.json(liveTrader.tradeLog.slice(-limit));
    });

    app.get('/api/signals', (_req, res) => {
      const limit = parseInt(_req.query.limit) || 20;
      res.json(liveTrader.signalLog.slice(-limit));
    });

    app.get('/api/errors', (_req, res) => {
      res.json(liveTrader.errorLog.slice(-50));
    });

    app.get('/api/health', (_req, res) => {
      const status = liveTrader.getFullStatus();
      res.json({
        healthy: status.running,
        uptime: status.uptime,
        connections: status.connections,
        errorCount: liveTrader.errorLog.length,
      });
    });

    // ── HTML Dashboard ──

    app.get('/', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.send(getDashboardHTML());
    });

    expressApp = app;
    return app;
  }

  function startServer(express) {
    const app = createApp(express);
    const port = config.dashboard.port;
    const host = config.dashboard.host;
    server = app.listen(port, host);
    return server;
  }

  function stopServer() {
    if (server) {
      server.close();
      server = null;
    }
  }

  return { createApp, startServer, stopServer, getApp: () => expressApp };
}

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trading Bot Dashboard</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; background:#0d1117; color:#c9d1d9; }
.header { background:#161b22; padding:16px 24px; border-bottom:1px solid #30363d; display:flex; justify-content:space-between; align-items:center; }
.header h1 { font-size:18px; color:#58a6ff; }
.status-dot { width:10px; height:10px; border-radius:50%; display:inline-block; margin-right:8px; }
.status-dot.on { background:#3fb950; }
.status-dot.off { background:#f85149; }
.grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:16px; padding:24px; }
.card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px; }
.card h2 { font-size:14px; color:#8b949e; text-transform:uppercase; margin-bottom:12px; }
.metric { font-size:28px; font-weight:bold; }
.metric.green { color:#3fb950; }
.metric.red { color:#f85149; }
.metric.neutral { color:#c9d1d9; }
.sub { font-size:12px; color:#8b949e; margin-top:4px; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; color:#8b949e; padding:6px 8px; border-bottom:1px solid #30363d; }
td { padding:6px 8px; border-bottom:1px solid #21262d; }
.buy { color:#3fb950; }
.sell { color:#f85149; }
.hold { color:#8b949e; }
.signal-bar { display:flex; gap:4px; margin-top:8px; }
.signal-bar .bar { height:4px; border-radius:2px; flex:1; }
.log { max-height:300px; overflow-y:auto; font-size:12px; font-family:monospace; }
.log-entry { padding:4px 0; border-bottom:1px solid #21262d; }
.log-entry .time { color:#8b949e; }
#refresh-timer { font-size:12px; color:#8b949e; }
</style>
</head>
<body>
<div class="header">
  <h1><span class="status-dot" id="status-dot"></span>Trading Bot</h1>
  <span id="refresh-timer">Refreshing...</span>
</div>
<div class="grid">
  <div class="card">
    <h2>Portfolio</h2>
    <div class="metric" id="portfolio-value">--</div>
    <div class="sub" id="portfolio-pnl">--</div>
  </div>
  <div class="card">
    <h2>Cash</h2>
    <div class="metric neutral" id="cash-value">--</div>
  </div>
  <div class="card">
    <h2>Uptime</h2>
    <div class="metric neutral" id="uptime">--</div>
    <div class="sub" id="connections">--</div>
  </div>
  <div class="card">
    <h2>Trades</h2>
    <div class="metric neutral" id="trade-count">--</div>
    <div class="sub" id="error-count">--</div>
  </div>
</div>
<div class="grid">
  <div class="card" style="grid-column: span 2">
    <h2>Positions</h2>
    <table>
      <thead><tr><th>Symbol</th><th>Qty</th><th>Avg Price</th><th>Value</th></tr></thead>
      <tbody id="positions-body"></tbody>
    </table>
  </div>
</div>
<div class="grid">
  <div class="card">
    <h2>Recent Signals</h2>
    <div class="log" id="signals-log"></div>
  </div>
  <div class="card">
    <h2>Recent Trades</h2>
    <div class="log" id="trades-log"></div>
  </div>
</div>
<div class="grid">
  <div class="card" style="grid-column: span 2">
    <h2>Errors</h2>
    <div class="log" id="errors-log"></div>
  </div>
</div>
<script>
const $ = id => document.getElementById(id);
function fmt(n) { return typeof n === 'number' ? n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) : '--'; }
function fmtTime(ms) {
  if (!ms) return '--';
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
  return h > 0 ? h+'h '+m%60+'m' : m > 0 ? m+'m '+s%60+'s' : s+'s';
}
function ts(t) { return t ? new Date(t).toLocaleTimeString() : ''; }
async function refresh() {
  try {
    const res = await fetch('/api/status');
    const d = await res.json();
    $('status-dot').className = 'status-dot ' + (d.running ? 'on' : 'off');
    const p = d.portfolio || {};
    const pv = p.portfolioValue || 0;
    const pnl = p.pnl || 0;
    $('portfolio-value').textContent = '$' + fmt(pv);
    $('portfolio-value').className = 'metric ' + (pnl >= 0 ? 'green' : 'red');
    $('portfolio-pnl').textContent = 'PnL: $' + fmt(pnl) + ' (' + fmt(p.pnlPct) + '%)';
    $('cash-value').textContent = '$' + fmt(p.cash);
    $('uptime').textContent = fmtTime(d.uptime);
    $('connections').textContent = d.connections + ' WS connections';
    $('trade-count').textContent = (d.recentTrades||[]).length + ' trades';
    $('error-count').textContent = (d.recentErrors||[]).length + ' errors';
    // Positions
    const pb = $('positions-body');
    const positions = (p.positions || []);
    pb.innerHTML = positions.length === 0 ? '<tr><td colspan="4" style="color:#8b949e">No positions</td></tr>'
      : positions.map(pos => '<tr><td>'+pos.symbol+'</td><td>'+fmt(pos.qty)+'</td><td>$'+fmt(pos.avgPrice)+'</td><td>$'+fmt(pos.qty*pos.avgPrice)+'</td></tr>').join('');
    // Signals
    const sl = $('signals-log');
    sl.innerHTML = (d.recentSignals||[]).slice(-10).reverse().map(s =>
      '<div class="log-entry"><span class="time">'+ts(s.time)+'</span> '+s.symbol+' <span class="'+(s.signal&&s.signal.action||'hold').toLowerCase()+'">'+((s.signal&&s.signal.action)||'HOLD')+'</span> conf:'+((s.signal&&s.signal.confidence)||0).toFixed(2)+'</div>'
    ).join('');
    // Trades
    const tl = $('trades-log');
    tl.innerHTML = (d.recentTrades||[]).slice(-10).reverse().map(t =>
      '<div class="log-entry"><span class="time">'+ts(t.time)+'</span> <span class="'+(t.action||'').toLowerCase()+'">'+t.action+'</span> '+t.symbol+' qty:'+fmt(t.qty)+' @$'+fmt(t.price)+'</div>'
    ).join('');
    // Errors
    const el = $('errors-log');
    el.innerHTML = (d.recentErrors||[]).slice(-10).reverse().map(e =>
      '<div class="log-entry"><span class="time">'+ts(e.time)+'</span> ['+e.source+'] '+e.error+'</div>'
    ).join('') || '<div class="log-entry" style="color:#8b949e">No errors</div>';
    $('refresh-timer').textContent = 'Last refresh: ' + new Date().toLocaleTimeString();
  } catch(e) {
    $('refresh-timer').textContent = 'Refresh failed: ' + e.message;
  }
}
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}
