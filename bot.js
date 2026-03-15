// ═══════════════════════════════════════════════════════════════
//  NOVA NEXUS BOT ENGINE v1.0
//  Corre en Node.js — sin dependencias externas
//  Uso: node bot.js
// ═══════════════════════════════════════════════════════════════
'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN  (edita este bloque o usa .env)
// ─────────────────────────────────────────────────────────────
const CFG = {
  // Par y timeframe
  PAIR      : process.env.PAIR       || 'BTCUSDT',
  TIMEFRAME : process.env.TIMEFRAME  || '1h',
  EXCHANGE  : process.env.EXCHANGE   || 'binance',  // binance | bitget

  // Nova Nexus — mismos valores que tu indicador en TV
  MIN_SCORE : parseInt(process.env.MIN_SCORE  || '2'),
  COOLDOWN  : parseInt(process.env.COOLDOWN   || '10'),
  SL_MULT   : parseFloat(process.env.SL_MULT  || '1.0'),
  TP1_MULT  : parseFloat(process.env.TP1_MULT || '1.5'),
  TP2_MULT  : parseFloat(process.env.TP2_MULT || '2.5'),
  TP3_MULT  : parseFloat(process.env.TP3_MULT || '4.0'),
  TP_BARS   : parseInt(process.env.TP_BARS    || '40'),

  // Gestión de capital
  CAPITAL_PCT : parseFloat(process.env.CAPITAL_PCT || '10'),
  TP1_CLOSE   : parseFloat(process.env.TP1_CLOSE   || '33'),
  TP2_CLOSE   : parseFloat(process.env.TP2_CLOSE   || '33'),
  TP3_CLOSE   : parseFloat(process.env.TP3_CLOSE   || '34'),
  BREAKEVEN   : process.env.BREAKEVEN !== 'false',
  MAX_TRADES  : parseInt(process.env.MAX_TRADES || '3'),

  // Balance paper
  INIT_BALANCE: parseFloat(process.env.INIT_BALANCE || '10000'),

  // Discord
  DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK || '',

  // Intervalo del bot en ms (default: 1 minuto)
  TICK_MS: parseInt(process.env.TICK_MS || '60000'),

  // Archivos
  STATE_FILE : './nova_state.json',
  LOG_FILE   : './nova_log.txt',
  CONFIG_FILE: './nova_config.json',
};

// ─────────────────────────────────────────────────────────────
//  ESTADO PERSISTENTE
// ─────────────────────────────────────────────────────────────
let STATE = {
  balance    : CFG.INIT_BALANCE,
  positions  : [],
  closed     : [],
  equity     : [CFG.INIT_BALANCE],
  signals    : [],
  totalPnL   : 0,
  startedAt  : new Date().toISOString(),
  lastTick   : null,
  tickCount  : 0,
  running    : true,
  lastBuyBar : -9999,
  lastSellBar: -9999,
  lastAnyBar : -9999,
};

function loadState() {
  try {
    if (fs.existsSync(CFG.STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(CFG.STATE_FILE, 'utf8'));
      STATE = { ...STATE, ...s };
      log('📂 Estado restaurado — balance: $' + STATE.balance.toFixed(2));
    }
  } catch(e) { log('⚠ No se pudo cargar estado: ' + e.message); }
}

function saveState() {
  try { fs.writeFileSync(CFG.STATE_FILE, JSON.stringify(STATE, null, 2)); }
  catch(e) {}
}

function loadConfig() {
  try {
    if (fs.existsSync(CFG.CONFIG_FILE)) {
      const c = JSON.parse(fs.readFileSync(CFG.CONFIG_FILE, 'utf8'));
      Object.assign(CFG, c);
      log('⚙ Config recargada desde ' + CFG.CONFIG_FILE);
    }
  } catch(e) {}
}

// ─────────────────────────────────────────────────────────────
//  LOGGER
// ─────────────────────────────────────────────────────────────
function log(...args) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${args.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(CFG.LOG_FILE, line + '\n'); } catch(e) {}
}

// ─────────────────────────────────────────────────────────────
//  HTTP HELPERS
// ─────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 10000 }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.slice(0,100))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST', timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data); req.end();
  });
}

// ─────────────────────────────────────────────────────────────
//  EXCHANGE API
// ─────────────────────────────────────────────────────────────
async function fetchCandles(pair, tf, limit = 300) {
  if (CFG.EXCHANGE === 'binance') {
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${tf}&limit=${limit}`;
    const data = await httpGet(url);
    if (!Array.isArray(data)) throw new Error('Binance bad response');
    return data.map(k => ({ t:+k[0], open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] }));
  }
  // Bitget
  const tfMap = { '1m':'1min','5m':'5min','15m':'15min','1h':'1H','4h':'4H','1d':'1D' };
  const url = `https://api.bitget.com/api/v2/spot/market/candles?symbol=${pair}&granularity=${tfMap[tf]||'1H'}&limit=${limit}`;
  const data = await httpGet(url);
  if (!data.data) throw new Error('Bitget bad response');
  return data.data.reverse().map(k => ({ t:+k[0], open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] }));
}

// ─────────────────────────────────────────────────────────────
//  INDICADORES — TRADUCCIÓN EXACTA DE PINE SCRIPT
// ─────────────────────────────────────────────────────────────
function rma(arr, n) {
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) out.push((out[i-1] * (n-1) + arr[i]) / n);
  return out;
}
function sma(arr, n) {
  return arr.map((_, i) => {
    if (i < n-1) return arr[i];
    return arr.slice(i-n+1, i+1).reduce((a,b) => a+b, 0) / n;
  });
}
function ema(arr, n) {
  const k = 2/(n+1), out = [arr[0]];
  for (let i = 1; i < arr.length; i++) out.push(arr[i]*k + out[i-1]*(1-k));
  return out;
}
function linreg(arr, n) {
  return arr.map((_, i) => {
    if (i < n-1) return arr[i];
    const sl = arr.slice(i-n+1, i+1);
    const xm = (n-1)/2;
    const mean = sl.reduce((a,b)=>a+b,0)/n;
    let num = 0, den = 0;
    sl.forEach((v,j) => { num += (j-xm)*(v-mean); den += (j-xm)**2; });
    const slope = den ? num/den : 0;
    return slope*(n-1) + (mean - slope*xm);
  });
}
function highest(arr, n) { return arr.map((_, i) => Math.max(...arr.slice(Math.max(0,i-n+1), i+1))); }
function lowest(arr, n)  { return arr.map((_, i) => Math.min(...arr.slice(Math.max(0,i-n+1), i+1))); }
function change(arr)     { return arr.map((v,i) => i===0 ? 0 : v - arr[i-1]); }
function maxArr(arr)     { return arr.map(v => Math.max(v, 0)); }

// ─── NOVA NEXUS — lógica completa ───────────────────────────
function runNovaNexus(cArr) {
  const n = cArr.length;
  const O=cArr.map(c=>c.open),  H=cArr.map(c=>c.high);
  const L=cArr.map(c=>c.low),   C=cArr.map(c=>c.close);

  // Constantes del indicador
  const _len=20,_sig=3,_dfl=30;
  const _obLevel=40,_osLevel=-40,_obRange=35,_osRange=-35;
  const _emaLen=200,_mfMin=3.0,_adxLen=14,_adxThr=25;
  const _divLook=5,_divTrs=25,_atrLen=14;

  // True Range
  const tr = cArr.map((c,i) => i===0 ? c.high-c.low :
    Math.max(c.high-c.low, Math.abs(c.high-cArr[i-1].close), Math.abs(c.low-cArr[i-1].close)));
  const atrFull = rma(tr, _atrLen);

  // Oscillator
  const hl2   = cArr.map(c => (c.high+c.low)/2);
  const av    = sma(hl2, _len);
  const hh    = highest(H, _len);
  const ll    = lowest(L, _len);
  const hlAvg = hh.map((v,i) => ((v+ll[i])/2 + av[i])/2);
  const atrOsc= rma(tr, _len);
  const oscRaw= C.map((c,i) => atrOsc[i]>0 ? (c-hlAvg[i])/atrOsc[i]*100 : 0);
  const oscArr= linreg(oscRaw, _len);
  const sigArr= sma(oscArr, _sig);

  // Heikin Ashi Money Flow
  const haC = cArr.map(c => (c.open+c.high+c.low+c.close)/4);
  const haO = new Array(n).fill(0);
  haO[0] = (O[0]+C[0])/2;
  for (let i=1; i<n; i++) haO[i] = (haO[i-1]+haC[i-1])/2;
  const haH = cArr.map((c,i) => Math.max(c.high, haO[i], haC[i]));
  const haL = cArr.map((c,i) => Math.min(c.low,  haO[i], haC[i]));
  const haTR= haH.map((h,i) => i===0 ? h-haL[i] :
    Math.max(h-haL[i], Math.abs(h-haC[i-1]), Math.abs(haL[i]-haC[i-1])));
  const haAtr   = rma(haTR, _dfl);
  const chgHaH  = haH.map((v,i) => i===0 ? 0 : Math.max(v-haH[i-1], 0));
  const chgHaL  = haL.map((v,i) => i===0 ? 0 : Math.max(haL[i-1]-v, 0));
  const fluxUp  = rma(chgHaH, _dfl).map((v,i) => haAtr[i]>0 ? v/haAtr[i] : 0);
  const fluxDn  = rma(chgHaL, _dfl).map((v,i) => haAtr[i]>0 ? v/haAtr[i] : 0);
  const fluxRaw = fluxUp.map((u,i) => { const d=fluxDn[i], s=u+d; return s>0?(u-d)/s*100:0; });
  const fluxArr = rma(fluxRaw, Math.floor(_dfl/2));

  // EMA 200
  const ema200 = ema(C, _emaLen);

  // ADX (Wilder)
  const plusDM  = H.map((h,i) => i===0 ? 0 : Math.max(h-H[i-1],0)>Math.max(L[i-1]-L[i],0) ? Math.max(h-H[i-1],0) : 0);
  const minusDM = L.map((l,i) => i===0 ? 0 : Math.max(L[i-1]-l,0)>Math.max(H[i]-H[i-1],0) ? Math.max(L[i-1]-l,0) : 0);
  const smATR   = rma(tr, _adxLen);
  const smPlus  = rma(plusDM, _adxLen);
  const smMinus = rma(minusDM, _adxLen);
  const diPlus  = smPlus.map((v,i)  => smATR[i]>0 ? v/smATR[i]*100 : 0);
  const diMinus = smMinus.map((v,i) => smATR[i]>0 ? v/smATR[i]*100 : 0);
  const dx      = diPlus.map((p,i)  => { const s=p+diMinus[i]; return s>0?Math.abs(p-diMinus[i])/s*100:0; });
  const adxArr  = rma(dx, _adxLen);

  // Pivot arrays para divergencias
  const plLow      = lowest(L, _divLook);
  const phHigh     = highest(H, _divLook);
  const plOscLow   = lowest(oscArr, _divLook);
  const phOscHigh  = highest(oscArr, _divLook);

  // ── Señales barra por barra ──────────────────────────────
  const minScore = CFG.MIN_SCORE;
  const cdBars   = CFG.COOLDOWN;
  let lastBuyBar  = STATE.lastBuyBar  || -9999;
  let lastSellBar = STATE.lastSellBar || -9999;
  let lastAnyBar  = STATE.lastAnyBar  || -9999;
  const newSignals = [];

  const START = Math.max(_emaLen, _dfl*2, 60);

  for (let i = START; i < n; i++) {
    const osc = oscArr[i], sig = sigArr[i], flux = fluxArr[i];
    const adx = adxArr[i], atr = atrFull[i];
    const isRange = adx < _adxThr, isTrend = !isRange;
    const obUse = isRange ? _obRange : _obLevel;
    const osUse = isRange ? _osRange : _osLevel;
    const mfUse = isRange ? _mfMin/2 : _mfMin;

    const inOB = osc >= obUse, inOS = osc <= osUse;
    const crossBuy  = oscArr[i] > sigArr[i] && oscArr[i-1] <= sigArr[i-1] && inOS;
    const crossSell = oscArr[i] < sigArr[i] && oscArr[i-1] >= sigArr[i-1] && inOB;
    const f2Buy  = isTrend ? C[i] > ema200[i] : true;
    const f2Sell = isTrend ? C[i] < ema200[i] : true;
    const f3Buy  = flux >  mfUse;
    const f3Sell = flux < -mfUse;

    const divBull = L[i]  < plLow[i-1]   && osc > plOscLow[i-1]  && osc < -_divTrs && crossBuy;
    const divBear = H[i]  > phHigh[i-1]  && osc < phOscHigh[i-1] && osc >  _divTrs && crossSell;

    // Score
    const sBuyOsc=inOS?1:0, sBuyEma=C[i]>ema200[i]?1:0, sBuyFlux=f3Buy?1:0;
    const sBuyTrend=isTrend?1:0, sBuyDiv=divBull?1:0;
    const sSelOsc=inOB?1:0, sSelEma=C[i]<ema200[i]?1:0, sSelFlux=f3Sell?1:0;
    const sSelTrend=isTrend?1:0, sSelDiv=divBear?1:0;
    const scoreBuy  = sBuyOsc+sBuyEma+sBuyFlux+sBuyTrend+sBuyDiv;
    const scoreSell = sSelOsc+sSelEma+sSelFlux+sSelTrend+sSelDiv;

    const rawBuy  = crossBuy  && f2Buy  && f3Buy  && scoreBuy  >= minScore;
    const rawSell = crossSell && f2Sell && f3Sell && scoreSell >= minScore;

    // Cooldown
    const bsSinceBuy  = i - lastBuyBar;
    const bsSinceSell = i - lastSellBar;
    const bsSinceAny  = i - lastAnyBar;
    const cdOkBuy  = bsSinceBuy  >= cdBars;
    const cdOkSell = bsSinceSell >= cdBars;

    const finalBuy  = rawBuy  && cdOkBuy;
    const finalSell = rawSell && cdOkSell;

    if (finalBuy)  { lastBuyBar=i;  lastAnyBar=i; }
    if (finalSell) { lastSellBar=i; lastAnyBar=i; }

    if (finalBuy || finalSell) {
      const side  = finalBuy ? 'buy' : 'sell';
      const score = finalBuy ? scoreBuy : scoreSell;
      newSignals.push({
        barIndex: i, side, score, atr,
        entry: C[i], isRange, isTrend,
        osc: +osc.toFixed(2), flux: +flux.toFixed(2),
        adx: +adx.toFixed(2), divBull, divBear,
        scoreBuy, scoreSell,
        time: new Date(cArr[i].t).toISOString(),
      });
    }
  }

  // Actualizar cooldown en STATE para próximo tick
  STATE.lastBuyBar  = lastBuyBar;
  STATE.lastSellBar = lastSellBar;
  STATE.lastAnyBar  = lastAnyBar;

  return { newSignals, oscArr, fluxArr, adxArr, atrFull };
}

// ─────────────────────────────────────────────────────────────
//  PAPER TRADING
// ─────────────────────────────────────────────────────────────
function openPosition(sig, currentPrice) {
  const size = STATE.balance * (CFG.CAPITAL_PCT / 100);
  if (size < 5) { log('⚠ Balance insuficiente para abrir posición'); return null; }
  if (STATE.positions.length >= CFG.MAX_TRADES) { log('⚠ Máximo de posiciones alcanzado'); return null; }

  const isBuy = sig.side === 'buy';
  const atr   = sig.atr;
  const entry = currentPrice;

  STATE.balance -= size;

  const pos = {
    id        : Date.now(),
    pair      : CFG.PAIR,
    side      : isBuy ? 'long' : 'short',
    entry, size, atr,
    sl  : isBuy ? entry - atr * CFG.SL_MULT  : entry + atr * CFG.SL_MULT,
    tp1 : isBuy ? entry + atr * CFG.TP1_MULT : entry - atr * CFG.TP1_MULT,
    tp2 : isBuy ? entry + atr * CFG.TP2_MULT : entry - atr * CFG.TP2_MULT,
    tp3 : isBuy ? entry + atr * CFG.TP3_MULT : entry - atr * CFG.TP3_MULT,
    tpHits    : { tp1: false, tp2: false, tp3: false },
    closedPct : 0,
    realizedPnl: 0,
    pnl       : 0,
    score     : sig.score,
    isRange   : sig.isRange,
    openedAt  : new Date().toISOString(),
  };

  STATE.positions.push(pos);
  STATE.signals.push({ ...sig, posId: pos.id });
  if (STATE.signals.length > 200) STATE.signals.shift();

  log(`📈 ABIERTO ${pos.side.toUpperCase()} ${pos.pair} @ ${entry.toFixed(entry>100?2:5)} | Score ${sig.score}/5 | SL:${pos.sl.toFixed(2)} TP1:${pos.tp1.toFixed(2)}`);
  return pos;
}

function checkPositions(candle) {
  const hi = candle.high, lo = candle.low;

  STATE.positions = STATE.positions.filter(pos => {
    const isBuy = pos.side === 'long';

    // TP1
    if (!pos.tpHits.tp1 && (isBuy ? hi >= pos.tp1 : lo <= pos.tp1)) {
      const amt = pos.size * (CFG.TP1_CLOSE/100);
      const pnl = amt * (isBuy ? (pos.tp1-pos.entry)/pos.entry : (pos.entry-pos.tp1)/pos.entry);
      pos.tpHits.tp1 = true; pos.closedPct += CFG.TP1_CLOSE/100;
      pos.realizedPnl += pnl; STATE.balance += pnl;
      STATE.totalPnL += pnl;
      if (CFG.BREAKEVEN) pos.sl = pos.entry;
      log(`🎯 TP1 ${pos.pair} ${pos.side} | +$${pnl.toFixed(2)} ${CFG.BREAKEVEN?'| SL→Breakeven':''}`);
      sendDiscord(`🎯 **TP1 alcanzado** — ${pos.pair}\n💲 Precio: $${pos.tp1.toFixed(pos.tp1>100?2:5)}\n💵 P&L parcial: **+$${pnl.toFixed(2)}**${CFG.BREAKEVEN?'\n🔁 SL movido a breakeven':''}`, 0x11cf77);
    }

    // TP2
    if (pos.tpHits.tp1 && !pos.tpHits.tp2 && (isBuy ? hi >= pos.tp2 : lo <= pos.tp2)) {
      const amt = pos.size * (CFG.TP2_CLOSE/100);
      const pnl = amt * (isBuy ? (pos.tp2-pos.entry)/pos.entry : (pos.entry-pos.tp2)/pos.entry);
      pos.tpHits.tp2 = true; pos.closedPct += CFG.TP2_CLOSE/100;
      pos.realizedPnl += pnl; STATE.balance += pnl;
      STATE.totalPnL += pnl;
      log(`🎯 TP2 ${pos.pair} ${pos.side} | +$${pnl.toFixed(2)}`);
      sendDiscord(`🎯 **TP2 alcanzado** — ${pos.pair}\n💲 Precio: $${pos.tp2.toFixed(pos.tp2>100?2:5)}\n💵 P&L parcial: **+$${pnl.toFixed(2)}**`, 0x00aaff);
    }

    // TP3
    if (pos.tpHits.tp2 && !pos.tpHits.tp3 && (isBuy ? hi >= pos.tp3 : lo <= pos.tp3)) {
      const rem = 1 - pos.closedPct;
      const pnl = pos.size * rem * (isBuy ? (pos.tp3-pos.entry)/pos.entry : (pos.entry-pos.tp3)/pos.entry);
      pos.realizedPnl += pnl; pos.closedPct = 1;
      STATE.balance += pos.size * rem + pnl;
      STATE.totalPnL += pnl;
      const total = pos.realizedPnl;
      log(`🏆 TP3 COMPLETO ${pos.pair} ${pos.side} | Total: $${total.toFixed(2)}`);
      sendDiscord(`🏆 **TP3 — TRADE COMPLETO** — ${pos.pair}\n💵 P&L total: **+$${total.toFixed(2)}**\n💼 Balance: $${STATE.balance.toFixed(2)}`, 0xff9900);
      closeTrade(pos, pos.tp3, 'TP3');
      return false;
    }

    // SL
    const hitSL = isBuy ? lo <= pos.sl : hi >= pos.sl;
    if (hitSL) {
      const rem  = 1 - pos.closedPct;
      const pnl  = pos.size * rem * (isBuy ? (pos.sl-pos.entry)/pos.entry : (pos.entry-pos.sl)/pos.entry);
      const total= pos.realizedPnl + pnl;
      STATE.balance += pos.size * rem + pnl;
      STATE.totalPnL += pnl;
      const isBE = Math.abs(pos.sl - pos.entry) < pos.entry * 0.0001;
      log(`${isBE?'🔁 BREAKEVEN':'🛑 SL'} ${pos.pair} ${pos.side} | $${total.toFixed(2)}`);
      sendDiscord(`${isBE?'🔁 **Breakeven**':'🛑 **Stop Loss**'} — ${pos.pair}\n💲 Cierre: $${pos.sl.toFixed(pos.sl>100?2:5)}\n💵 P&L: ${total>=0?'+':''}$${total.toFixed(2)}\n💼 Balance: $${STATE.balance.toFixed(2)}`, isBE?0x00aaff:0xd11645);
      closeTrade(pos, pos.sl, isBE?'Breakeven':'SL');
      return false;
    }

    // Actualizar PnL no realizado
    const price  = (hi + lo) / 2;
    const rem2   = 1 - pos.closedPct;
    pos.pnl = pos.realizedPnl + pos.size * rem2 * (isBuy ? (price-pos.entry)/pos.entry : (pos.entry-price)/pos.entry);
    return true;
  });
}

function closeTrade(pos, exitPrice, reason) {
  const total = pos.realizedPnl;
  STATE.equity.push(STATE.balance);
  if (STATE.equity.length > 500) STATE.equity.shift();
  STATE.closed.unshift({
    ...pos, exitPrice, reason,
    pnl: total, closedAt: new Date().toISOString()
  });
  if (STATE.closed.length > 100) STATE.closed.pop();
  saveState();
}

// ─────────────────────────────────────────────────────────────
//  DISCORD
// ─────────────────────────────────────────────────────────────
async function sendDiscord(message, color = 0x11cf77) {
  if (!CFG.DISCORD_WEBHOOK) return;
  try {
    await httpPost(CFG.DISCORD_WEBHOOK, {
      username: '🤖 Nova Nexus Bot',
      embeds: [{ description: message, color, timestamp: new Date().toISOString() }]
    });
  } catch(e) { log('⚠ Discord error: ' + e.message); }
}

function formatSignalDiscord(sig, pos) {
  const isBuy = sig.side === 'buy';
  const stars = '★'.repeat(sig.score) + '☆'.repeat(5 - sig.score);
  const fmt = v => v > 100 ? v.toFixed(2) : v.toFixed(5);
  const type = sig.isTrend ? '📈 Tendencia' : '📊 Rango';
  const div  = sig.divBull ? '\n📈 Divergencia D+' : sig.divBear ? '\n📉 Divergencia D-' : '';
  return `${isBuy ? '🟢' : '🔴'} **${isBuy?'LONG':'SHORT'} ${pos.pair}** — ${stars} (${sig.score}/5)\n\n` +
    `💲 Entrada: **$${fmt(pos.entry)}**\n` +
    `🛑 SL:  $${fmt(pos.sl)} (${CFG.SL_MULT}× ATR)\n` +
    `🎯 TP1: $${fmt(pos.tp1)} (${CFG.TP1_MULT}× ATR) → ${CFG.TP1_CLOSE}%\n` +
    `🎯 TP2: $${fmt(pos.tp2)} (${CFG.TP2_MULT}× ATR) → ${CFG.TP2_CLOSE}%\n` +
    `🎯 TP3: $${fmt(pos.tp3)} (${CFG.TP3_MULT}× ATR) → ${CFG.TP3_CLOSE}%\n\n` +
    `${type}${div}\n` +
    `📊 Capital: $${pos.size.toFixed(2)} | Balance: $${STATE.balance.toFixed(2)}`;
}

// ─────────────────────────────────────────────────────────────
//  BOT TICK PRINCIPAL
// ─────────────────────────────────────────────────────────────
async function tick() {
  if (!STATE.running) return;
  STATE.tickCount++;
  STATE.lastTick = new Date().toISOString();

  try {
    loadConfig(); // Recargar config por si el dashboard la cambió

    // Fetch candles
    const candles = await fetchCandles(CFG.PAIR, CFG.TIMEFRAME, 500);
    const lastCandle = candles[candles.length - 1];
    log(`🔄 Tick #${STATE.tickCount} | ${CFG.PAIR} ${CFG.TIMEFRAME} | $${lastCandle.close.toFixed(lastCandle.close>100?2:5)} | Pos: ${STATE.positions.length} | Bal: $${STATE.balance.toFixed(2)}`);

    // Check existing positions
    checkPositions(lastCandle);

    // Run Nova Nexus on latest candles
    const { newSignals } = runNovaNexus(candles);

    // Only act on signal from the last completed bar
    const latestSig = newSignals.filter(s => s.barIndex === candles.length - 2).pop();

    if (latestSig) {
      log(`⚡ Señal detectada: ${latestSig.side.toUpperCase()} | Score: ${latestSig.score}/5 | ${latestSig.isRange?'Rango':'Tendencia'}`);

      // Don't open if already have position on same side
      const alreadyOpen = STATE.positions.find(p =>
        p.pair === CFG.PAIR && p.side === (latestSig.side === 'buy' ? 'long' : 'short')
      );

      if (!alreadyOpen) {
        const pos = openPosition(latestSig, lastCandle.close);
        if (pos) {
          await sendDiscord(formatSignalDiscord(latestSig, pos), latestSig.side === 'buy' ? 0x11cf77 : 0xd11645);
        }
      } else {
        log(`ℹ Señal ignorada — ya hay posición ${latestSig.side} abierta`);
      }
    }

    saveState();

  } catch(e) {
    log(`❌ Error en tick: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
//  HTTP SERVER — API para el dashboard
// ─────────────────────────────────────────────────────────────
function startServer() {
  const PORT = process.env.PORT || 4000;

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = req.url.split('?')[0];

    // GET /state — estado completo
    if (req.method === 'GET' && url === '/state') {
      const openPnL = STATE.positions.reduce((a,p) => a+(p.pnl||0), 0);
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        balance   : +STATE.balance.toFixed(2),
        openPnL   : +openPnL.toFixed(2),
        totalPnL  : +STATE.totalPnL.toFixed(2),
        equity    : STATE.equity.slice(-200),
        positions : STATE.positions,
        closed    : STATE.closed.slice(0, 50),
        signals   : STATE.signals.slice(0, 30),
        tickCount : STATE.tickCount,
        lastTick  : STATE.lastTick,
        startedAt : STATE.startedAt,
        running   : STATE.running,
        config    : CFG,
      }));
      return;
    }

    // GET /candles — last candles with signals overlay
    if (req.method === 'GET' && url === '/candles') {
      fetchCandles(CFG.PAIR, CFG.TIMEFRAME, 200).then(c => {
        res.writeHead(200);
        res.end(JSON.stringify({ ok:true, candles: c }));
      }).catch(e => {
        res.writeHead(500);
        res.end(JSON.stringify({ ok:false, error: e.message }));
      });
      return;
    }

    // POST /config — actualizar config desde dashboard
    if (req.method === 'POST' && url === '/config') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const cfg = JSON.parse(body);
          Object.assign(CFG, cfg);
          fs.writeFileSync(CFG.CONFIG_FILE, JSON.stringify(cfg, null, 2));
          log('⚙ Config actualizada desde dashboard');
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
        } catch(e) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // POST /command — pause / resume / reset / close_all
    if (req.method === 'POST' && url === '/command') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { cmd } = JSON.parse(body);
          if (cmd === 'pause')  { STATE.running = false; log('⏸ Bot pausado'); }
          if (cmd === 'resume') { STATE.running = true;  log('▶ Bot reanudado'); }
          if (cmd === 'reset') {
            STATE.balance = CFG.INIT_BALANCE;
            STATE.positions = []; STATE.closed = [];
            STATE.equity = [CFG.INIT_BALANCE]; STATE.totalPnL = 0;
            STATE.lastBuyBar=-9999; STATE.lastSellBar=-9999; STATE.lastAnyBar=-9999;
            log('🔄 Estado reseteado');
          }
          if (cmd === 'close_all') {
            STATE.positions.forEach(p => closeTrade(p, p.entry, 'Manual'));
            STATE.positions = [];
            log('🔒 Todas las posiciones cerradas manualmente');
          }
          saveState();
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, state: STATE.running ? 'running' : 'paused' }));
        } catch(e) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // GET /log — últimas líneas del log
    if (req.method === 'GET' && url === '/log') {
      try {
        const lines = fs.readFileSync(CFG.LOG_FILE, 'utf8').split('\n').slice(-50).join('\n');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, log: lines }));
      } catch(e) {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, log: 'Sin logs aún' }));
      }
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });

  server.listen(PORT, () => {
    log(`🌐 API del bot en http://localhost:${PORT}`);
    log(`   GET  /state    — estado completo`);
    log(`   GET  /candles  — velas con señales`);
    log(`   POST /config   — actualizar config`);
    log(`   POST /command  — {cmd: pause|resume|reset|close_all}`);
    log(`   GET  /log      — últimas 50 líneas del log`);
  });
}

// ─────────────────────────────────────────────────────────────
//  ARRANQUE
// ─────────────────────────────────────────────────────────────
async function start() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     NOVA NEXUS BOT ENGINE v1.0          ║');
  console.log('╚══════════════════════════════════════════╝\n');
  log(`Par: ${CFG.PAIR} | TF: ${CFG.TIMEFRAME} | Exchange: ${CFG.EXCHANGE}`);
  log(`Score mín: ${CFG.MIN_SCORE} | Cooldown: ${CFG.COOLDOWN} | Capital: ${CFG.CAPITAL_PCT}%`);
  log(`SL: ${CFG.SL_MULT}×ATR | TP1: ${CFG.TP1_MULT}×ATR | TP2: ${CFG.TP2_MULT}×ATR | TP3: ${CFG.TP3_MULT}×ATR`);
  log(`Modo: Paper Trading | Balance inicial: $${CFG.INIT_BALANCE}`);
  if (CFG.DISCORD_WEBHOOK) log('🎮 Discord: conectado');
  else log('⚠ Discord: no configurado (opcional)');
  console.log('');

  loadState();
  startServer();

  await sendDiscord(`🚀 **Nova Nexus Bot iniciado**\n\n📊 Par: **${CFG.PAIR}** | TF: ${CFG.TIMEFRAME}\n💼 Balance: **$${STATE.balance.toFixed(2)}**\n⭐ Score mín: ${CFG.MIN_SCORE}/5\n🔄 Tick: cada ${CFG.TICK_MS/1000}s`);

  // Primer tick inmediato
  await tick();

  // Loop
  setInterval(tick, CFG.TICK_MS);
  log(`\n✅ Bot corriendo — tick cada ${CFG.TICK_MS/1000}s\n`);
}

process.on('uncaughtException',  e => log('❌ Error no capturado: ' + e.message));
process.on('unhandledRejection', e => log('❌ Promise rechazada: ' + (e?.message||e)));
process.on('SIGTERM', async () => { await sendDiscord('⏹ Bot detenido (SIGTERM)'); process.exit(0); });
process.on('SIGINT',  async () => {
  log('\n⏹ Cerrando bot...');
  await sendDiscord('⏹ Bot detenido manualmente');
  saveState();
  process.exit(0);
});

start().catch(e => { log('❌ Fatal: '+e.message); process.exit(1); });
