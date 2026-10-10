import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
const SYMBOLS = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'AAPL', 'MSFT', 'NVDA'];
const fmt = new Intl.NumberFormat('en-US');
const time = at => new Date(at).toLocaleTimeString('en-GB', { hour12: false });
const price = cents => cents == null ? '—' : (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const initial = { hitRate: 85.4, ops: 12450, dbLatency: 1.2, hits: 10632, misses: 1818, at: Date.now(), logs: [], cache: [], node: 'demo-node-01', cacheCoherent: true };
function demoBook(symbol) {
  const base = { BTC_USDT: 6724500, ETH_USDT: 345000, SOL_USDT: 15800, AAPL: 22500, MSFT: 43500, NVDA: 13500 }[symbol];
  return { symbol, revision: 0, lastPrice: base, bids: Array.from({ length: 6 }, (_, i) => ({ priceCents: base - (i + 1) * 100, quantity: 2 + i * 3 })), asks: Array.from({ length: 6 }, (_, i) => ({ priceCents: base + (i + 1) * 100, quantity: 3 + i * 2 })), trades: [] };
}
const Chart = memo(function Chart({ history }) {
  return <ResponsiveContainer width="100%" height={240}><LineChart data={history} margin={{ top: 12, right: 12, left: -15, bottom: 0 }}>
    <CartesianGrid stroke="#202730" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" tick={{ fill: '#637080', fontSize: 10 }} minTickGap={48} axisLine={false} tickLine={false}/><YAxis tick={{ fill: '#637080', fontSize: 10 }} axisLine={false} tickLine={false}/>
    <Tooltip contentStyle={{ background: '#11171f', border: '1px solid #303b48', borderRadius: 6, fontSize: 11 }}/>
    <Line name="Cache hits / tick" type="linear" dataKey="hits" stroke="#5de4ae" strokeWidth={2} dot={false} isAnimationActive={false}/>
    <Line name="Database misses / tick" type="linear" dataKey="misses" stroke="#bc94ff" strokeWidth={1.5} dot={false} isAnimationActive={false}/>
  </LineChart></ResponsiveContainer>;
});
const Terminal = memo(function Terminal({ logs, running }) {
  const ref = useRef(null), stick = useRef(true);
  useEffect(() => { if (stick.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
  return <section className="panel terminal-panel"><div className="panel-head"><div><span className="eyebrow">MEMORY INSPECTOR</span><h2>Cache state terminal</h2></div><span className="muted">● {running ? 'STREAMING' : 'PAUSED'}</span></div>
    <div className="terminal-bar"><span className="dots">● ● ●</span><span>apex/cache-policy.log</span><span>LFU + LRU</span></div>
    <div className="terminal" ref={ref} onScroll={() => { const el = ref.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30; }} role="log" aria-label="Cache events" aria-live="off">
      <div className="terminal-intro">ApexEngine cache observer initialized.<br/>Frequency buckets online. Awaiting events…</div>
      {logs.map(l => <div className={`log ${l.message.includes('EVICT') ? 'evict' : ''}`} key={l.id}><span>{time(l.at)}</span> {l.message}</div>)}
      <span className="cursor">▌</span>
    </div><div className="terminal-foot"><span>{logs.length} buffered events</span><span>Bounded log buffer / 120</span></div>
  </section>;
});
function Metric({ label, value, unit, foot, accent }) { return <section className="metric"><div className="metric-label">{label}<span className={`mini-icon ${accent}`}>↗</span></div><div className="metric-value">{value}<span>{unit}</span></div><div className="metric-foot"><span className={accent}>●</span> {foot}</div></section>; }
export default function App() {
  const [mode, setMode] = useState('demo'), [connected, setConnected] = useState(false), [paused, setPaused] = useState(false);
  const [symbol, setSymbol] = useState('BTC_USDT'), [packet, setPacket] = useState(initial), [history, setHistory] = useState([]), [logs, setLogs] = useState([]);
  const [book, setBook] = useState(demoBook('BTC_USDT')), [side, setSide] = useState('buy'), [qty, setQty] = useState('1'), [limit, setLimit] = useState('67245.00');
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const socket = useRef(null), pending = useRef(null), pendingBook = useRef(null), demoCounter = useRef(0), lastLog = useRef(0), retry = useRef(null), activeSymbol = useRef(symbol);
  const historyLimit = 45;
  useEffect(() => { activeSymbol.current = symbol; pendingBook.current = null; setNotice(''); retry.current = null; setLimit((demoBook(symbol).lastPrice / 100).toFixed(2));
    if (mode === 'demo') { const next = demoBook(symbol); setBook(next); setLimit((next.lastPrice / 100).toFixed(2)); }
    else { setBook({ symbol, bids: [], asks: [], trades: [], lastPrice: null }); socket.current?.emit('subscribe', symbol); }
  }, [symbol, mode]);
  useEffect(() => {
    pending.current = null; lastLog.current = 0; setHistory([]); setLogs([]); setConnected(false);
    if (mode !== 'live') { setPacket(initial); return; }
    setPacket({ ...initial, ops: 0, hitRate: 0, dbLatency: null, cache: [], node: 'connecting' });
    const s = io({ transports: ['websocket'], reconnection: true }); socket.current = s;
    s.on('connect', () => { lastLog.current = 0; setLogs([]); setConnected(true); s.emit('subscribe', activeSymbol.current); });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', () => setNotice('Backend unavailable. Start Docker Compose or switch to Demo.'));
    s.on('telemetry', data => { pending.current = data; });
    s.on('book:update', data => { if (data.symbol === activeSymbol.current && (!pendingBook.current || data.revision >= pendingBook.current.revision)) pendingBook.current = data; });
    s.on('service:error', data => setNotice(data.error));
    return () => { s.removeAllListeners(); s.disconnect(); socket.current = null; pending.current = null; pendingBook.current = null; };
  }, [mode]);
  // Socket bursts only replace refs; React receives at most one batch every 800ms.
  useEffect(() => {
    const interval = setInterval(() => {
      if (paused) return;
      let next;
      if (mode === 'demo') {
        const n = ++demoCounter.current, hits = Math.round(10000 + Math.sin(n / 3) * 1600 + Math.random() * 700), misses = Math.round(1500 + Math.sin(n / 5) * 350 + Math.random() * 240);
        const key = SYMBOLS[n % SYMBOLS.length];
        const message = n % 5 === 0 ? `CACHE EVICT ${key} (Freq: 1) — LFU capacity` : n % 3 === 0 ? `LFU PUT ${key} (Freq: 1)` : `LFU HIT ${key} (Freq: ${2 + n % 11})`;
        next = { ...initial, at: Date.now(), hitRate: hits / (hits + misses) * 100, ops: Math.round((hits + misses) / .8), dbLatency: 1 + Math.random() * .65, hits, misses, logs: [{ id: n, at: Date.now(), message }], cache: SYMBOLS.slice(0, 4).map((key, i) => ({ key, freq: (n + i) % 12 + 1 })) };
      } else { next = pending.current; pending.current = null; }
      if (next) {
        setPacket(next); setHistory(old => [...old, { label: time(next.at), hits: next.hits, misses: next.misses }].slice(-historyLimit));
        const fresh = next.logs.filter(l => l.id > lastLog.current); if (fresh.length) lastLog.current = fresh.at(-1).id;
        setLogs(old => [...old, ...fresh].slice(-120));
      }
      if (mode === 'live' && pendingBook.current) { const b = pendingBook.current; pendingBook.current = null; setBook(old => old.symbol !== b.symbol || b.revision >= (old.revision ?? 0) ? b : old); }
    }, 800);
    return () => clearInterval(interval);
  }, [mode, paused]);
  const peak = useMemo(() => Math.max(0, ...history.map(h => h.hits + h.misses)), [history]);
  async function submit(e) {
    e.preventDefault(); if (mode === 'demo') { setNotice('Demo data is simulated. Switch to Live to submit a persistent order.'); return; }
    const numericPrice = Number(limit), quantity = Number(qty);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0 || !Number.isSafeInteger(quantity) || quantity < 1) { setNotice('Enter a positive price and whole-number quantity.'); return; }
    const body = { symbol, side, priceCents: Math.round(numericPrice * 100), quantity }, signature = JSON.stringify(body);
    if (!retry.current || retry.current.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': retry.current.key }, body: signature, signal: AbortSignal.timeout(12000) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setNotice(`Committed ${data.order.id.slice(0, 8)} · ${data.order.status} · revision ${data.revision}`); retry.current = null;
      socket.current?.emit('subscribe', symbol);
    } catch (error) { setNotice(`${error.message}. Retry keeps the same idempotency key.`); }
    finally { setBusy(false); }
  }
  const status = mode === 'demo' ? 'CONNECTED · SIMULATED' : connected ? 'CONNECTED' : 'DISCONNECTED';
  return <div className="app-shell"><header><div className="brand-mark">A<span>›</span></div><div className="brand"><h1>ApexEngine <span>// Live Analytics Cluster</span></h1><div className="header-sub">DISTRIBUTED ORDER BOOK <span>/</span> TELEMETRY CONSOLE <span>/</span> v1.0.0</div></div><div className={`connection ${mode === 'live' && !connected ? 'offline' : ''}`}><i/>{status}</div></header>
    <nav><div className="nav-tab">Overview <span>01</span></div><div className="nav-context"><span className="muted">environment</span><b>{mode === 'demo' ? 'simulation' : 'local cluster'}</b></div><div className="controls"><div className="segmented"><button className={mode === 'demo' ? 'active' : ''} onClick={() => { setMode('demo'); setPaused(false); }}>Demo</button><button className={mode === 'live' ? 'active' : ''} onClick={() => { setMode('live'); setPaused(false); }}>Live</button></div><button className="pause" onClick={() => setPaused(p => !p)}>{paused ? '▶ Resume' : 'Ⅱ Pause'}</button></div></nav>
    <main><div className="overview-heading"><div><span className="eyebrow">SYSTEM OVERVIEW</span><h2>Engine performance <span className="healthy">{mode === 'demo' ? 'SIMULATED DATA' : connected ? 'ONLINE' : 'OFFLINE'}</span></h2></div><span className="muted">{paused ? 'Display paused' : 'Refresh 800ms'} <span className="separator">/</span> {time(packet.at)} local</span></div>
    <div className="metrics"><Metric label="CACHE HIT RATE" value={packet.hitRate.toFixed(1)} unit="%" foot={mode === 'demo' ? 'Simulated hit ratio' : 'Cumulative reads served from memory'} accent="green"/><Metric label="TOTAL OPERATIONS / SEC" value={fmt.format(packet.ops)} unit="ops/s" foot={mode === 'demo' ? 'Simulated throughput' : 'Measured on connected API process'} accent="blue"/><Metric label="CORE DATABASE LATENCY" value={packet.dbLatency == null ? '—' : packet.dbLatency.toFixed(2)} unit="ms" foot={mode === 'demo' ? 'Simulated database response' : 'Mean book-read time in last interval'} accent="purple"/></div>
    <div className="visuals"><section className="panel chart-panel"><div className="panel-head"><div><span className="eyebrow">READ PATH ANALYSIS</span><h2>Cache hits vs. database misses</h2></div><span className="tag">LAST 36s</span></div><div className="chart-legend"><span><i className="green-dot"/>In-memory hits</span><span><i className="purple-dot"/>Database misses</span><span className="legend-unit">reads / 800ms interval</span></div><Chart history={history}/><div className="chart-foot"><span>Peak interval <b>{fmt.format(peak)} reads</b></span><span>Policy <b>LRU → LFU → MongoDB</b></span></div></section><Terminal logs={logs} running={!paused && (mode === 'demo' || connected)}/></div>
    <div className="lower"><section className="panel order-panel"><div className="panel-head compact"><h2>Market depth <span className="muted">/ {price(book.lastPrice)}</span></h2><select aria-label="Market symbol" value={symbol} onChange={e => setSymbol(e.target.value)}>{SYMBOLS.map(s => <option key={s}>{s}</option>)}</select></div><div className="depth"><div><div className="depth-label"><span>BID PRICE</span><span>QUANTITY</span></div>{book.bids.slice(0, 5).map(l => <div className="depth-row bid" key={l.priceCents} style={{ '--depth': `${Math.min(l.quantity * 3, 100)}%` }}><b>{price(l.priceCents)}</b><span>{l.quantity}</span></div>)}</div><div><div className="depth-label"><span>ASK PRICE</span><span>QUANTITY</span></div>{book.asks.slice(0, 5).map(l => <div className="depth-row ask" key={l.priceCents} style={{ '--depth': `${Math.min(l.quantity * 3, 100)}%` }}><b>{price(l.priceCents)}</b><span>{l.quantity}</span></div>)}</div></div></section>
    <section className="panel buckets"><div className="panel-head compact"><h2>Frequency buckets</h2><span className="tag">L2 / LFU</span></div><div className="bucket-list">{packet.cache.map(c => <div className="bucket" key={c.key}><span>{c.key}</span><div className="frequency-track"><i style={{ width: `${Math.min(c.freq * 6, 100)}%` }}/></div><b>f:{c.freq}</b></div>)}{!packet.cache.length && <p className="muted">Read a market to warm the cache.</p>}</div><div className="small-note">Least frequent key evicts first.<br/>Equal frequency → oldest access evicts.</div></section>
    <section className="panel submit-panel"><div className="panel-head compact"><h2>Submit limit order</h2><span className="tag">{mode.toUpperCase()}</span></div><form onSubmit={submit}><div className="form-grid"><label>Side<select value={side} onChange={e => setSide(e.target.value)}><option value="buy">Buy</option><option value="sell">Sell</option></select></label><label>Units<input type="number" min="1" max="1000000" step="1" value={qty} onChange={e => setQty(e.target.value)}/></label><label className="price-field">Limit price (USD)<input type="number" step="0.01" min="0.01" max="1000000" value={limit} onChange={e => setLimit(e.target.value)}/></label></div><button className="submit" disabled={busy || (mode === 'live' && !connected)}>{busy ? 'Committing…' : 'Submit order →'}</button><div className="notice" role="status">{notice || (mode === 'demo' ? 'Switch to Live for real API orders.' : 'Persistent commit · idempotent retries')}</div></form></section></div>
    </main><footer><span><i className="green-dot"/> {packet.node} <span className="separator">/</span> {mode === 'demo' ? 'synthetic telemetry' : packet.cacheCoherent ? 'change stream active' : 'cache bypassed'}</span><span>{mode === 'demo' ? 'DEMO MODE · NO REAL TRADES' : 'EDUCATIONAL SIMULATOR · LIMIT ORDERS ONLY'}</span></footer></div>;
}
