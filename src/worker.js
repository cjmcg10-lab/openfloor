/**
 * Openfloor Terminal — server (one free Cloudflare Worker).
 *
 * What it does:
 *  - Serves the terminal pages (static files in /public).
 *  - Proxies free public data sites from an allow list, adding the contact header SEC asks for
 *    and any free keys you set (Finnhub, FRED). Keys never reach the browser.
 *  - Stores your private data in your own D1 database: alerts, typed-in holdings, history, audit log.
 *  - Connects brokerages (SnapTrade, Alpaca) and a built-in practice account, with guarded trading.
 *  - Runs scheduled jobs every minute: price alerts, odds/funding history, scans, phone briefs.
 *
 * Security model:
 *  - Cloudflare Access sits in front of the whole site. This code ALSO verifies Access's signed
 *    token (Cf-Access-Jwt-Assertion) on every private request, pinned to your team and app AUD.
 *  - Private routes refuse to work at all until Access is configured.
 *  - State-changing requests must come from this site (custom header + Origin check).
 *  - Trading is off by default. Orders need a server-issued, single-use, 90-second review token,
 *    a PIN (with lockout), and must fit hard dollar and daily limits. Everything is audit-logged.
 */

const HOSTS = {
  "query1.finance.yahoo.com": 10, "query2.finance.yahoo.com": 10, "feeds.finance.yahoo.com": 300,
  "fred.stlouisfed.org": 3600, "api.stlouisfed.org": 3600,
  "data.sec.gov": 1800, "www.sec.gov": 600,
  "api.frankfurter.dev": 3600, "gamma-api.polymarket.com": 60, "api.coingecko.com": 30,
  "finnhub.io": 30, "api.nasdaq.com": 300, "cdn-api.cboe.com": 120, "cdn.cboe.com": 120,
  "apewisdom.io": 600, "api.alternative.me": 1800, "api.hyperliquid.xyz": 60,
  "disclosures-clerk.house.gov": 3600, "www.federalreserve.gov": 86400,
};
const POST_HOSTS = new Set(["api.hyperliquid.xyz"]);
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const BOT_HOSTS = /^(raw\.githubusercontent\.com|gist\.githubusercontent\.com|[a-z0-9-]+\.github\.io)$/i;
const SYM_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; this.publicMessage = msg; } }
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
const now = () => Date.now();
const enc = new TextEncoder();

/* ---------------- small crypto helpers ---------------- */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlToBytes = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function hmac(keyStr, msg, raw = false) {
  const k = await crypto.subtle.importKey("raw", enc.encode(keyStr), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg)); return raw ? sig : b64url(sig);
}
async function sha256hex(s) { const d = await crypto.subtle.digest("SHA-256", enc.encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function safeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const rid = (n = 12) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/* ---------------- Cloudflare Access verification ---------------- */
let CERTS = { team: null, keys: null, at: 0 };
const normTeam = t => { if (!t) return null; t = String(t).trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""); if (!t) return null; if (!t.includes(".")) t += ".cloudflareaccess.com"; return "https://" + t; };
async function accessKeys(team) {
  if (CERTS.team === team && CERTS.keys && now() - CERTS.at < 3600e3) return CERTS.keys;
  const r = await fetch(team + "/cdn-cgi/access/certs"); if (!r.ok) throw new Error("certs " + r.status);
  const j = await r.json(); CERTS = { team, keys: j.keys || [], at: now() }; return CERTS.keys;
}
async function verifyAccess(req, env) {
  const team = normTeam(env.TEAM_DOMAIN), aud = (env.POLICY_AUD || "").trim();
  if (!team || !aud) return { configured: false, ok: false };
  const tok = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!tok) return { configured: true, ok: false, why: "no token" };
  try {
    const [h, p, s] = tok.split(".");
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    if (header.alg !== "RS256") throw 0;
    let keys = await accessKeys(team); let jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) { CERTS.at = 0; keys = await accessKeys(team); jwk = keys.find(k => k.kid === header.kid); }
    if (!jwk) throw 0;
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), enc.encode(h + "." + p));
    if (!ok) throw 0;
    const t = Math.floor(now() / 1000);
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) throw 0;
    if (payload.iss && payload.iss.replace(/\/+$/, "") !== team) throw 0;
    if (!payload.exp || payload.exp < t - 30 || (payload.nbf && payload.nbf > t + 30)) throw 0;
    const email = (payload.email || "").toLowerCase();
    const allowed = (env.ALLOWED_EMAIL || "").toLowerCase().split(/[,\s]+/).filter(Boolean);
    if (email && allowed.length && !allowed.includes(email)) return { configured: true, ok: false, why: "email not allowed" };
    return { configured: true, ok: true, email, service: !email && payload.common_name ? payload.common_name : null };
  } catch (e) { return { configured: true, ok: false, why: "bad token" }; }
}

/* ---------------- database ---------------- */
let DB_READY = false;
async function initDb(env) {
  if (DB_READY || !env.DB) return;
  await env.DB.batch([
    "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, t INTEGER)",
    "CREATE TABLE IF NOT EXISTS hist (series TEXT NOT NULL, t INTEGER NOT NULL, v REAL, PRIMARY KEY(series, t))",
    "CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, sym TEXT, op TEXT, px REAL, created INTEGER, hit INTEGER DEFAULT 0, hit_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS holdings (id TEXT PRIMARY KEY, account TEXT, sym TEXT, qty REAL, cost REAL, created INTEGER)",
    "CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, event TEXT, summary TEXT, status TEXT, detail TEXT)",
    "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, t INTEGER, kind TEXT, sym TEXT, text TEXT, level INTEGER, run TEXT)",
    "CREATE TABLE IF NOT EXISTS porders (id TEXT PRIMARY KEY, t INTEGER, sym TEXT, side TEXT, qty REAL, type TEXT, limit_px REAL, tif TEXT, status TEXT, fill_px REAL, filled_at INTEGER)",
    "CREATE INDEX IF NOT EXISTS hist_t ON hist(t)",
    "CREATE INDEX IF NOT EXISTS audit_t ON audit(t)",
  ].map(s => env.DB.prepare(s)));
  DB_READY = true;
}
const needDb = env => { if (!env.DB) throw new HttpError(503, "The database isn't connected yet (setup step 3)."); };
async function kvGet(env, k, def = null) { if (!env.DB) return def; const r = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first(); if (!r) return def; try { return JSON.parse(r.v); } catch { return def; } }
async function kvSet(env, k, v) { if (!env.DB) return; await env.DB.prepare("INSERT INTO kv (k,v,t) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, t=excluded.t").bind(k, JSON.stringify(v), now()).run(); }
async function histAdd(env, series, v, t = now()) { if (!env.DB || v == null || !isFinite(v)) return; await env.DB.prepare("INSERT OR REPLACE INTO hist (series,t,v) VALUES (?,?,?)").bind(series, t, v).run(); }
async function audit(env, event, summary, status, detail) {
  if (!env.DB) return; await env.DB.prepare("INSERT INTO audit (t,event,summary,status,detail) VALUES (?,?,?,?,?)").bind(now(), event, String(summary).slice(0, 300), status, detail ? String(detail).slice(0, 1500) : null).run();
}
async function serverSecret(env) {
  if (env.TOKEN_SECRET) return env.TOKEN_SECRET;
  let s = await kvGet(env, "srv_secret"); if (!s) { s = rid(32); await kvSet(env, "srv_secret", s); } return s;
}

/* ---------------- outbound fetch helpers ---------------- */
const contactUA = env => `OpenfloorTerminal/2.0 (personal, non-commercial; ${env.CONTACT_EMAIL || "set-CONTACT_EMAIL@example.com"})`;
async function upstream(env, url, init = {}) {
  const u = new URL(url);
  const h = { Accept: "application/json, text/plain, */*", "User-Agent": u.hostname === "api.nasdaq.com" ? BROWSER_UA : contactUA(env), ...(init.headers || {}) };
  if (u.hostname === "finnhub.io") { if (!env.FINNHUB_KEY) throw new HttpError(501, "Add FINNHUB_KEY (setup step 9)."); u.searchParams.set("token", String(env.FINNHUB_KEY).trim()); }
  if (u.hostname === "api.stlouisfed.org") { if (!env.FRED_KEY) throw new HttpError(501, "Add FRED_KEY (setup step 9)."); u.searchParams.set("api_key", String(env.FRED_KEY).trim()); u.searchParams.set("file_type", "json"); }
  return fetch(u.toString(), { ...init, headers: h });
}
async function getJSON(env, url, init) { const r = await upstream(env, url, init); if (!r.ok) throw new Error(new URL(url).hostname + " " + r.status); return r.json(); }
const MEMO = new Map();
async function proxy(req, env, url) {
  let target; try { target = new URL(url.searchParams.get("u") || ""); } catch { throw new HttpError(400, "Missing or bad ?u= address"); }
  const ttl = HOSTS[target.hostname];
  if (target.protocol !== "https:" || ttl === undefined) throw new HttpError(403, "That site is not on the allow list");
  const isPost = req.method === "POST";
  if (isPost && !POST_HOSTS.has(target.hostname)) throw new HttpError(405, "POST not allowed for that site");
  let body = null; if (isPost) { body = await req.text(); if (body.length > 4000) throw new HttpError(413, "Too large"); }
  const key = (isPost ? "P " + body + " " : "") + target.toString();
  const m = MEMO.get(key); if (m && now() - m.t < ttl * 1000) return new Response(m.body, { status: 200, headers: { "Content-Type": m.type, "Cache-Control": `private, max-age=${Math.min(ttl, 30)}`, "X-Cache": "memo" } });
  let up;
  try { up = await upstream(env, target.toString(), isPost ? { method: "POST", body, headers: { "Content-Type": "application/json" } } : { cf: { cacheTtl: ttl, cacheEverything: true } }); }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, "Could not reach " + target.hostname); }
  const type = up.headers.get("Content-Type") || "application/octet-stream";
  const len = +(up.headers.get("Content-Length") || 0);
  if (up.ok && len && len < 400000) { const buf = await up.arrayBuffer(); if (MEMO.size > 300) MEMO.clear(); MEMO.set(key, { t: now(), body: buf, type }); return new Response(buf, { status: 200, headers: { "Content-Type": type, "Cache-Control": `private, max-age=${Math.min(ttl, 30)}` } }); }
  return new Response(up.body, { status: up.status, headers: { "Content-Type": type, "Cache-Control": `private, max-age=${Math.min(ttl, 30)}` } });
}
async function quotes(env, syms) {
  const out = {}; syms = [...new Set(syms)].filter(Boolean);
  for (let i = 0; i < syms.length; i += 20) {
    const ch = syms.slice(i, i + 20);
    try {
      const j = await getJSON(env, `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(ch.join(","))}&range=1d&interval=1d`);
      (j.spark?.result || []).forEach(r => { const m = r.response?.[0]?.meta; if (m) out[r.symbol] = { px: m.regularMarketPrice, prev: m.previousClose ?? m.chartPreviousClose, name: m.shortName || r.symbol, t: m.regularMarketTime }; });
    } catch (e) {}
  }
  return out;
}
function nyNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const h = +p.hour % 24, m = +p.minute; return { date: `${p.year}-${p.month}-${p.day}`, h, m, mins: h * 60 + m, wd: p.weekday, weekday: !["Sat", "Sun"].includes(p.weekday) };
}
const marketOpen = () => { const n = nyNow(); return n.weekday && n.mins >= 570 && n.mins < 960; };

/* ---------------- brokers: SnapTrade ---------------- */
function canon(v) { if (v === null || typeof v !== "object") return JSON.stringify(v); if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"; }
const hasSnap = env => !!(env.SNAPTRADE_CLIENT_ID && env.SNAPTRADE_CONSUMER_KEY);
async function snap(env, method, path, { query = {}, body = null } = {}) {
  const qp = { clientId: env.SNAPTRADE_CLIENT_ID, timestamp: String(Math.floor(now() / 1000)) };
  if (env.SNAPTRADE_USER_ID && env.SNAPTRADE_USER_SECRET) { qp.userId = env.SNAPTRADE_USER_ID; qp.userSecret = env.SNAPTRADE_USER_SECRET; }
  const q = new URLSearchParams({ ...qp, ...query }).toString();
  const content = body && Object.keys(body).length ? body : null;
  const sig = b64(await hmac(env.SNAPTRADE_CONSUMER_KEY, canon({ content, path: "/api/v1" + path, query: q }), true));
  const r = await fetch(`https://api.snaptrade.com/api/v1${path}?${q}`, { method, headers: { Signature: sig, "Content-Type": "application/json", Accept: "application/json" }, body: content ? canon(content) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const msg = (j && (j.detail || j.message || j.error)) || t.slice(0, 160); throw new Error(`SnapTrade ${r.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg).slice(0, 160)}`); }
  return j;
}
const mask = n => n ? "••" + String(n).slice(-4) : "";
function snapSym(inst) {
  if (!inst) return null; let s = inst.symbol; if (s && typeof s === "object") s = s.symbol || s.raw_symbol;
  s = s || inst.raw_symbol || inst.ticker || inst.code; if (!s) return null; s = String(s).toUpperCase();
  const kind = String(inst.kind || inst.type?.code || inst.type || "").toLowerCase();
  if (/crypto/.test(kind) && !/-USD$/.test(s)) s = s.replace(/[-\/]?(USD|USDT|USDC)$/, "") + "-USD";
  return s;
}
async function snapAccounts(env) {
  const [res, auths] = await Promise.all([snap(env, "GET", "/accounts/all"), snap(env, "GET", "/authorizations").catch(() => [])]);
  const list = Array.isArray(res) ? res : (res.results || res.accounts || []);
  const authType = {}; (Array.isArray(auths) ? auths : []).forEach(a => authType[a.id] = a.type);
  return Promise.all(list.map(async a => {
    const authId = typeof a.brokerage_authorization === "object" ? a.brokerage_authorization?.id : a.brokerage_authorization;
    const [pos, bal] = await Promise.all([snap(env, "GET", `/accounts/${a.id}/positions/all`).catch(() => ({ results: [] })), snap(env, "GET", `/accounts/${a.id}/balances`).catch(() => [])]);
    const usdBal = (Array.isArray(bal) ? bal : []).find(b => (b.currency?.code || b.currency) === "USD") || (Array.isArray(bal) ? bal[0] : null) || {};
    const positions = (pos.results || pos || []).map(p => { const sym = snapSym(p.instrument || p.symbol?.symbol || p.symbol); if (!sym || p.cash_equivalent) return null;
      const qty = +p.units || +p.fractional_units || 0; return qty ? { sym, qty, price: p.price != null ? +p.price : null, cost: p.cost_basis != null ? +p.cost_basis : (p.average_purchase_price != null ? +p.average_purchase_price : null), currency: p.currency?.code || p.currency || "USD", type: /-USD$/.test(sym) ? "crypto" : "equity" } : null; }).filter(Boolean);
    const type = authType[authId] || "read";
    return { id: "snap:" + a.id, raw: a.id, broker: a.institution_name || "SnapTrade", name: a.name || "Account", mask: mask(a.number), kind: "broker", paper: !!a.is_paper,
      canTrade: type === "trade", cash: usdBal.cash != null ? +usdBal.cash : null, buyingPower: usdBal.buying_power != null ? +usdBal.buying_power : null, value: a.balance?.total?.amount, currency: "USD", positions };
  }));
}
/* ---------------- brokers: Alpaca ---------------- */
const hasAlpaca = env => !!(String(env.ALPACA_KEY_ID || "").trim() && String(env.ALPACA_SECRET || "").trim());
// Paper keys start with "PK", live keys with "AK". ALPACA_PAPER=yes/no overrides the guess.
const alpacaPaper = env => { const v = String(env.ALPACA_PAPER || "").trim().toLowerCase(); if (v === "no" || v === "false") return false; if (v === "yes" || v === "true") return true; return !/^AK/i.test(String(env.ALPACA_KEY_ID || "").trim()); };
async function alpaca(env, method, path, body) {
  const base = alpacaPaper(env) ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
  const r = await fetch(base + path, { method, headers: { "APCA-API-KEY-ID": String(env.ALPACA_KEY_ID).trim(), "APCA-API-SECRET-KEY": String(env.ALPACA_SECRET).trim(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (r.status === 401 || (r.status === 403 && /forbidden|unauthorized/i.test(t))) throw new Error(`Alpaca didn't accept the key (${r.status}). Check ALPACA_KEY_ID and ALPACA_SECRET were pasted without spaces, and that you used ${alpacaPaper(env) ? "paper-trading keys (they start with PK)" : "live-account keys (they start with AK)"}. Paper and live accounts have separate keys.`);
  if (!r.ok) throw new Error(`Alpaca ${r.status}: ${(j && j.message) || t.slice(0, 160)}`); return j;
}
async function alpacaAccount(env) {
  const [a, pos] = await Promise.all([alpaca(env, "GET", "/v2/account"), alpaca(env, "GET", "/v2/positions")]);
  return { id: "alpaca", broker: "Alpaca", name: alpacaPaper(env) ? "Paper account" : "Live account", mask: mask(a.account_number), kind: "broker", paper: alpacaPaper(env), canTrade: true,
    cash: +a.cash, buyingPower: +a.buying_power, value: +a.equity, currency: "USD",
    positions: pos.map(p => ({ sym: p.asset_class === "crypto" ? p.symbol.replace(/\/?USD$/, "") + "-USD" : p.symbol, qty: +p.qty, price: +p.current_price, cost: +p.avg_entry_price, type: p.asset_class === "crypto" ? "crypto" : "equity" })) };
}
/* ---------------- practice account ---------------- */
async function practiceState(env) { return (await kvGet(env, "practice")) || { cash: 100000, positions: {}, created: now() }; }
async function practiceAccount(env) {
  const s = await practiceState(env);
  return { id: "practice", broker: "Openfloor", name: "Practice account", mask: "", kind: "practice", paper: true, canTrade: true, cash: s.cash, buyingPower: s.cash, currency: "USD",
    positions: Object.entries(s.positions).filter(([, p]) => p.qty > 1e-9).map(([sym, p]) => ({ sym, qty: p.qty, cost: p.cost, type: /-USD$/.test(sym) ? "crypto" : "equity" })) };
}
async function practiceFill(env, o, price) {
  const s = await practiceState(env); const slip = o.type === "MARKET" ? 0.0005 : 0;
  const fill = o.side === "BUY" ? price * (1 + slip) : price * (1 - slip); const amt = fill * o.qty;
  const p = s.positions[o.sym] || { qty: 0, cost: 0 };
  if (o.side === "BUY") { if (amt > s.cash + 1e-6) throw new HttpError(400, "Not enough practice cash."); p.cost = (p.cost * p.qty + amt) / (p.qty + o.qty); p.qty += o.qty; s.cash -= amt; }
  else { if (o.qty > p.qty + 1e-9) throw new HttpError(400, "You don't hold that many shares in the practice account."); p.qty -= o.qty; s.cash += amt; if (p.qty < 1e-9) { delete s.positions[o.sym]; } }
  if (p.qty > 1e-9) s.positions[o.sym] = p; await kvSet(env, "practice", s); return fill;
}
/* ---------------- all accounts ---------------- */
let ACCT_CACHE = { at: 0, v: null };
async function allAccounts(env, fresh) {
  if (!fresh && ACCT_CACHE.v && now() - ACCT_CACHE.at < 25e3) return ACCT_CACHE.v;
  const accounts = [], errors = [];
  accounts.push(await practiceAccount(env));
  const man = await env.DB.prepare("SELECT * FROM holdings ORDER BY account, sym").all();
  const groups = {}; (man.results || []).forEach(h => (groups[h.account] = groups[h.account] || []).push({ id: h.id, sym: h.sym, qty: h.qty, cost: h.cost, type: /-USD$/.test(h.sym) ? "crypto" : "equity" }));
  Object.entries(groups).forEach(([n, ps]) => accounts.push({ id: "manual:" + n, broker: "Typed in", name: n, mask: "", kind: "manual", paper: false, canTrade: false, cash: 0, currency: "USD", positions: ps }));
  const jobs = [];
  if (hasAlpaca(env)) jobs.push(alpacaAccount(env).then(a => accounts.push(a)).catch(e => errors.push("Alpaca: " + e.message)));
  if (hasSnap(env)) jobs.push(snapAccounts(env).then(l => accounts.push(...l)).catch(e => errors.push(e.message)));
  await Promise.all(jobs);
  ACCT_CACHE = { at: now(), v: { accounts, errors } }; return ACCT_CACHE.v;
}

/* ---------------- trading ---------------- */
const tradingMode = env => { const m = String(env.TRADING_MODE || "off").toLowerCase(); return ["off", "paper", "live"].includes(m) ? m : "off"; };
const maxOrder = env => Math.max(1, +(env.MAX_ORDER_USD || 1000));
const maxDaily = env => Math.max(1, +(env.MAX_ORDERS_PER_DAY || 10));
async function ordersToday(env) { const d = new Date(); d.setUTCHours(0, 0, 0, 0); const r = await env.DB.prepare("SELECT COUNT(*) n FROM audit WHERE event='order_sent' AND t>=?").bind(d.getTime()).first(); return r?.n || 0; }
function tradeRules(env, acct) {
  if (!acct) throw new HttpError(400, "That account wasn't found. Refresh and try again.");
  if (!acct.canTrade) throw new HttpError(403, "This account is view-only. Reconnect it with trading turned on (CONN).");
  if (acct.kind === "practice") return { pin: false, practice: true };
  const mode = tradingMode(env);
  if (mode === "off") throw new HttpError(403, "Trading is turned off. Only the practice account can trade until you set TRADING_MODE (setup step 13).");
  if (mode === "paper" && !acct.paper) throw new HttpError(403, "TRADING_MODE is paper, so only paper (fake-money) accounts can trade.");
  if (!env.TRADE_PIN) throw new HttpError(403, "Set a TRADE_PIN secret before trading with a brokerage account (setup step 13).");
  return { pin: true, practice: false };
}
async function checkPin(env, pin) {
  const st = (await kvGet(env, "pin_fail")) || { n: 0, until: 0 };
  if (st.until > now()) throw new HttpError(429, `Too many wrong PINs. Trading is locked for ${Math.ceil((st.until - now()) / 60000)} more minute(s).`);
  const key = await serverSecret(env);
  const ok = safeEqual(await hmac(key, String(pin || "")), await hmac(key, String(env.TRADE_PIN)));
  if (!ok) { st.n++; if (st.n >= 5) { st.until = now() + 15 * 60e3; st.n = 0; } await kvSet(env, "pin_fail", st); await audit(env, "pin_wrong", "Wrong trading PIN", "refused"); throw new HttpError(403, st.until > now() ? "Wrong PIN. Trading is locked for 15 minutes." : "Wrong PIN."); }
  if (st.n) await kvSet(env, "pin_fail", { n: 0, until: 0 });
}
async function quoteOne(env, sym) { const q = await quotes(env, [sym]); const p = q[sym]?.px; if (!p) throw new HttpError(400, `Couldn't get a price for ${sym}.`); return p; }
function validateOrder(b) {
  const sym = String(b.sym || "").toUpperCase().trim(); if (!SYM_RE.test(sym)) throw new HttpError(400, "That ticker doesn't look right.");
  const side = b.side === "SELL" ? "SELL" : b.side === "BUY" ? "BUY" : null; if (!side) throw new HttpError(400, "Choose buy or sell.");
  const qty = +b.qty; if (!(qty > 0) || qty > 1e6) throw new HttpError(400, "Enter a share quantity greater than zero.");
  const type = b.type === "MARKET" ? "MARKET" : "LIMIT"; const limit = type === "LIMIT" ? +b.limit : null;
  if (type === "LIMIT" && !(limit > 0)) throw new HttpError(400, "Enter a limit price.");
  const tif = b.tif === "GTC" ? "GTC" : "DAY";
  return { sym, side, qty, type, limit, tif, account: String(b.account || "") };
}
async function previewOrder(env, user, body) {
  const o = validateOrder(body);
  const { accounts } = await allAccounts(env, true);
  const acct = accounts.find(a => a.id === o.account);
  const rules = tradeRules(env, acct);
  if (!rules.practice && (await kvGet(env, "trading_paused"))) throw new HttpError(423, "Trading is paused. Resume it in ORD.");
  const price = await quoteOne(env, o.sym);
  const est = o.qty * (o.type === "LIMIT" ? o.limit : price);
  const warnings = [];
  if (!rules.practice) {
    if (est > maxOrder(env)) throw new HttpError(403, `That order is about $${est.toFixed(2)}, over your $${maxOrder(env)} per-order limit (MAX_ORDER_USD).`);
    if ((await ordersToday(env)) >= maxDaily(env)) throw new HttpError(429, `You've reached your limit of ${maxDaily(env)} orders today (MAX_ORDERS_PER_DAY).`);
  }
  const held = (acct.positions || []).filter(p => p.sym === o.sym).reduce((s, p) => s + p.qty, 0);
  if (o.side === "SELL" && o.qty > held + 1e-9) { if (rules.practice) throw new HttpError(400, `You only hold ${held} shares here.`); warnings.push(`You appear to hold ${held} shares in this account. Selling more could open a short position, which most brokerages will reject.`); }
  const bp = acct.buyingPower ?? acct.cash;
  if (o.side === "BUY" && bp != null && est > bp) { if (rules.practice) throw new HttpError(400, "Not enough practice cash for that order."); warnings.push(`This is more than the account's buying power (${bp.toFixed(2)}).`); }
  if (o.type === "LIMIT" && o.side === "BUY" && o.limit > price * 1.05) warnings.push(`Your limit is over 5% above the current price (${price.toFixed(2)}). It will likely fill right away near the market price.`);
  if (o.type === "LIMIT" && o.side === "SELL" && o.limit < price * 0.95) warnings.push(`Your limit is over 5% below the current price (${price.toFixed(2)}). It will likely fill right away near the market price.`);
  if (o.type === "MARKET" && !marketOpen() && !/-USD$/.test(o.sym)) warnings.push("The US market is closed. A market order will fill at the next open, which can be far from today's price.");
  if (o.type === "MARKET") warnings.push("Market orders fill at whatever price is available. A limit order is safer.");
  const pv = { sym: o.sym, side: o.side, qty: o.qty, type: o.type, limit: o.limit, tif: o.tif, price, estimate: est, accountLabel: `${acct.broker} · ${acct.name} ${acct.mask || ""}`.trim(), commission: null, remainingCash: null };
  let tradeId = null;
  if (acct.id.startsWith("snap:")) {
    try {
      const syms = await snap(env, "POST", `/accounts/${acct.raw}/symbols`, { body: { substring: o.sym } });
      const hit = (syms || []).find(s => (s.symbol || "").toUpperCase() === o.sym || (s.raw_symbol || "").toUpperCase() === o.sym);
      if (hit) {
        const imp = await snap(env, "POST", "/trade/impact", { body: { account_id: acct.raw, action: o.side, universal_symbol_id: hit.id, order_type: o.type === "LIMIT" ? "Limit" : "Market", time_in_force: o.tif === "GTC" ? "GTC" : "Day", price: o.type === "LIMIT" ? o.limit : null, units: o.qty } });
        tradeId = imp?.trade?.id || null; const ti = (imp?.trade_impacts || [])[0]; if (ti) { pv.commission = ti.estimated_commission ?? null; pv.remainingCash = ti.remaining_cash ?? null; }
      }
    } catch (e) { warnings.push("The brokerage couldn't pre-check this order (" + e.message.slice(0, 120) + "). It will be sent directly if you confirm."); }
  }
  const payload = { ...o, est, email: user.email || "", exp: now() + 90e3, nonce: rid(9), tradeId };
  const p64 = b64url(enc.encode(JSON.stringify(payload)));
  const token = p64 + "." + await hmac(await serverSecret(env), p64);
  await audit(env, "order_reviewed", `${o.side} ${o.qty} ${o.sym} ${o.type}${o.limit ? " @" + o.limit : ""} · ${pv.accountLabel}`, "ok");
  return { preview: pv, token, needsPin: rules.pin, warnings };
}
async function submitOrder(env, user, body) {
  const [p64, sig] = String(body.token || "").split(".");
  if (!p64 || !sig || !safeEqual(sig, await hmac(await serverSecret(env), p64))) throw new HttpError(400, "This review is not valid. Start a new order.");
  const o = JSON.parse(new TextDecoder().decode(b64urlToBytes(p64)));
  if (o.exp < now()) throw new HttpError(400, "This review expired. Review the order again.");
  if ((o.email || "") !== (user.email || "")) throw new HttpError(403, "This review belongs to another session.");
  if (await kvGet(env, "nonce:" + o.nonce)) throw new HttpError(400, "This order was already submitted.");
  const { accounts } = await allAccounts(env, true); const acct = accounts.find(a => a.id === o.account);
  const rules = tradeRules(env, acct);
  const label = `${o.side} ${o.qty} ${o.sym} ${o.type}${o.limit ? " @" + o.limit : ""} · ${acct.broker} ${acct.name}`;
  if (rules.pin) await checkPin(env, body.pin);
  if (await kvGet(env, "nonce:" + o.nonce)) throw new HttpError(400, "This order was already submitted.");
  await kvSet(env, "nonce:" + o.nonce, now());
  if (!rules.practice) {
    if (await kvGet(env, "trading_paused")) throw new HttpError(423, "Trading is paused.");
    if (o.est > maxOrder(env)) throw new HttpError(403, "Over your per-order limit.");
    if ((await ordersToday(env)) >= maxDaily(env)) throw new HttpError(429, "Daily order limit reached.");
  }
  try {
    let msg, ref;
    if (rules.practice) {
      const price = await quoteOne(env, o.sym); const id = rid(8);
      const marketable = o.type === "MARKET" || (o.side === "BUY" ? price <= o.limit : price >= o.limit);
      if (marketable) { const fill = await practiceFill(env, o, o.type === "MARKET" ? price : (o.side === "BUY" ? Math.min(price, o.limit) : Math.max(price, o.limit)));
        await env.DB.prepare("INSERT INTO porders (id,t,sym,side,qty,type,limit_px,tif,status,fill_px,filled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id, now(), o.sym, o.side, o.qty, o.type, o.limit, o.tif, "filled", fill, now()).run();
        msg = `Practice order filled: ${o.side} ${o.qty} ${o.sym} at $${fill.toFixed(2)}.`; }
      else { await env.DB.prepare("INSERT INTO porders (id,t,sym,side,qty,type,limit_px,tif,status) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, now(), o.sym, o.side, o.qty, o.type, o.limit, o.tif, "open").run();
        msg = `Practice limit order placed. It fills if ${o.sym} reaches $${o.limit}.`; }
      ref = id;
    } else if (acct.id === "alpaca") {
      const r = await alpaca(env, "POST", "/v2/orders", { symbol: o.sym.replace(/-USD$/, "/USD"), qty: String(o.qty), side: o.side.toLowerCase(), type: o.type.toLowerCase(), time_in_force: o.tif.toLowerCase(), ...(o.type === "LIMIT" ? { limit_price: String(o.limit) } : {}), client_order_id: "ofl-" + o.nonce });
      ref = r.id; msg = `Order sent to Alpaca (${r.status}).`;
    } else if (acct.id.startsWith("snap:")) {
      let r;
      if (o.tradeId) r = await snap(env, "POST", `/trade/${o.tradeId}`, { body: { wait_to_confirm: true } });
      else r = await snap(env, "POST", "/trade/place", { body: { account_id: acct.raw, action: o.side, symbol: o.sym, universal_symbol_id: null, order_type: o.type === "LIMIT" ? "Limit" : "Market", time_in_force: o.tif === "GTC" ? "GTC" : "Day", price: o.type === "LIMIT" ? o.limit : null, units: o.qty, client_order_id: "ofl-" + o.nonce } });
      ref = r?.brokerage_order_id || r?.id; msg = `Order sent to ${acct.broker}${r?.status ? " (" + r.status + ")" : ""}.`;
    } else throw new HttpError(400, "This account can't trade.");
    await audit(env, "order_sent", label, "sent", JSON.stringify({ ref }));
    ACCT_CACHE.at = 0; return { ok: true, message: msg, ref };
  } catch (e) { await audit(env, "order_failed", label, "failed", e.message); if (e instanceof HttpError) throw e; throw new HttpError(502, e.message.slice(0, 220)); }
}
async function listOrders(env) {
  const out = []; const { accounts } = await allAccounts(env);
  const po = await env.DB.prepare("SELECT * FROM porders ORDER BY t DESC LIMIT 25").all();
  (po.results || []).forEach(r => out.push({ id: r.id, account: "practice", accountLabel: "Practice", sym: r.sym, side: r.side, qty: r.qty, filled: r.status === "filled" ? r.qty : 0, avg: r.fill_px, type: r.type, limit: r.limit_px, status: r.status, time: r.t, open: r.status === "open" }));
  const jobs = [];
  if (hasAlpaca(env)) jobs.push(alpaca(env, "GET", "/v2/orders?status=all&limit=25&direction=desc").then(l => l.forEach(r => out.push({ id: r.id, account: "alpaca", accountLabel: "Alpaca", sym: r.symbol, side: String(r.side).toUpperCase(), qty: +r.qty, filled: +r.filled_qty, avg: r.filled_avg_price ? +r.filled_avg_price : null, type: String(r.type).toUpperCase(), limit: r.limit_price ? +r.limit_price : null, status: r.status, time: Date.parse(r.submitted_at), open: ["new", "accepted", "partially_filled", "pending_new"].includes(r.status) }))).catch(() => {}));
  accounts.filter(a => a.id.startsWith("snap:") && a.canTrade).forEach(a => jobs.push(snap(env, "GET", `/accounts/${a.raw}/recentOrders`).then(r => (r.orders || []).forEach(x => out.push({ id: x.brokerage_order_id, account: a.id, accountLabel: a.broker, sym: x.universal_symbol?.symbol || x.symbol, side: x.action, qty: +x.total_quantity, filled: +x.filled_quantity, avg: x.execution_price, type: String(x.order_type || "").toUpperCase(), limit: x.limit_price, status: x.status, time: Date.parse(x.time_placed), open: /OPEN|PENDING|PARTIAL|ACCEPTED/i.test(x.status || "") }))).catch(() => {})));
  await Promise.all(jobs); return out.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 60);
}
async function cancelOrder(env, body) {
  const acctId = String(body.account || ""), id = String(body.orderId || "");
  if (acctId !== "practice") await checkPin(env, body.pin);
  if (acctId === "practice") { await env.DB.prepare("UPDATE porders SET status='cancelled' WHERE id=? AND status='open'").bind(id).run(); }
  else if (acctId === "alpaca") { await alpaca(env, "DELETE", "/v2/orders/" + encodeURIComponent(id)); }
  else if (acctId.startsWith("snap:")) { await snap(env, "POST", `/accounts/${acctId.slice(5)}/trading/cancel`, { body: { brokerage_order_id: id } }); }
  else throw new HttpError(400, "Unknown account.");
  await audit(env, "order_cancel", `Cancel ${id} · ${acctId}`, "sent"); return { ok: true };
}
async function fillPracticeOrders(env) {
  const r = await env.DB.prepare("SELECT * FROM porders WHERE status='open'").all(); const open = r.results || []; if (!open.length) return;
  const q = await quotes(env, open.map(o => o.sym));
  for (const o of open) { const p = q[o.sym]?.px; if (!p) continue;
    const day = o.tif === "DAY" && now() - o.t > 20 * 3600e3; if (day) { await env.DB.prepare("UPDATE porders SET status='expired' WHERE id=?").bind(o.id).run(); continue; }
    if ((o.side === "BUY" && p <= o.limit_px) || (o.side === "SELL" && p >= o.limit_px)) {
      try { const fill = await practiceFill(env, { sym: o.sym, side: o.side, qty: o.qty, type: "LIMIT" }, o.limit_px); await env.DB.prepare("UPDATE porders SET status='filled', fill_px=?, filled_at=? WHERE id=?").bind(fill, now(), o.id).run(); await audit(env, "practice_fill", `${o.side} ${o.qty} ${o.sym} @ ${fill.toFixed(2)}`, "filled"); }
      catch (e) { await env.DB.prepare("UPDATE porders SET status='rejected' WHERE id=?").bind(o.id).run(); }
    } }
}

/* ---------------- notifications (ntfy) ---------------- */
async function notify(env, title, text, opts = {}) {
  if (!env.NTFY_TOPIC) return false;
  const server = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, "");
  const h = { Title: title.replace(/[^\x20-\x7E]/g, ""), Tags: opts.tags || "chart_with_upwards_trend", Priority: String(opts.priority || 3) };
  if (opts.click) h.Click = opts.click;
  if (env.NTFY_TOKEN) h.Authorization = "Bearer " + env.NTFY_TOKEN;
  const r = await fetch(`${server}/${encodeURIComponent(env.NTFY_TOPIC)}`, { method: "POST", headers: h, body: text.slice(0, 3900) });
  return r.ok;
}
const briefSettings = async env => ({ morning: true, evening: true, alerts: true, scan: true, portfolio: false, ...((await kvGet(env, "brief_settings")) || {}) });

/* ---------------- signals (server copy, for the bot) ---------------- */
const smaLast = (a, n) => a.length >= n ? a.slice(-n).reduce((s, x) => s + x, 0) / n : null;
async function cryptoSignals(env) {
  const coins = ["BTC", "ETH", "SOL", "XRP", "BNB"]; const hist = {};
  await Promise.all(coins.map(async c => { try { const j = await getJSON(env, `https://query1.finance.yahoo.com/v8/finance/chart/${c}-USD?range=1y&interval=1d`); hist[c] = (j.chart.result[0].indicators.quote[0].close || []).filter(x => x != null); } catch (e) {} }));
  let funding = {}, fg = null;
  try { const [meta, ctx] = await getJSON(env, "https://api.hyperliquid.xyz/info", { method: "POST", body: JSON.stringify({ type: "metaAndAssetCtxs" }), headers: { "Content-Type": "application/json" } });
    meta.universe.forEach((u, i) => { if (coins.includes(u.name)) funding[u.name] = +ctx[i].funding; }); } catch (e) {}
  try { const j = await getJSON(env, "https://api.alternative.me/fng/?limit=1"); fg = +j.data[0].value; } catch (e) {}
  const btc = hist.BTC || [];
  const out = coins.map(c => { const a = hist[c] || []; if (a.length < 60) return null; const last = a[a.length - 1], s50 = smaLast(a, 50), s200 = smaLast(a, 200); const parts = [];
    parts.push({ name: "Trend", score: s200 != null ? (last > s50 && last > s200 ? 2 : last > s200 ? 1 : last > s50 ? -1 : -2) : (last > s50 ? 1 : -1), w: 1.5 });
    if (c !== "BTC" && btc.length > 31) { const r = last / a[a.length - 31] - 1, rb = btc[btc.length - 1] / btc[btc.length - 31] - 1; parts.push({ name: "vs Bitcoin", score: r - rb > 0.05 ? 1 : r - rb < -0.05 ? -1 : 0, w: 0.8 }); }
    if (funding[c] != null) { const apr = funding[c] * 24 * 365 * 100; parts.push({ name: "Funding", score: apr > 30 ? -1 : apr < 0 ? 1 : 0, w: 0.8, apr }); }
    if (fg != null) parts.push({ name: "Fear & greed", score: fg < 25 ? 1 : fg > 75 ? -1 : 0, w: 0.7 });
    const ws = parts.reduce((s, p) => s + p.w * 2, 0) || 1; const score = Math.round(parts.reduce((s, p) => s + p.score * p.w, 0) / ws * 100);
    return { sym: c, score, label: score >= 40 ? "Strong" : score >= 15 ? "Positive" : score <= -40 ? "Weak" : score <= -15 ? "Negative" : "Neutral", price: last, parts }; }).filter(Boolean);
  return { out, funding, fg };
}

/* ---------------- scheduled jobs ---------------- */
async function jobAlerts(env, settings) {
  const r = await env.DB.prepare("SELECT * FROM alerts WHERE hit=0 LIMIT 60").all(); const list = r.results || []; if (!list.length) return;
  const q = await quotes(env, list.map(a => a.sym));
  for (const a of list) { const p = q[a.sym]?.px; if (p == null) continue;
    if ((a.op === ">" && p > a.px) || (a.op === "<" && p < a.px)) {
      await env.DB.prepare("UPDATE alerts SET hit=1, hit_at=? WHERE id=?").bind(now(), a.id).run();
      if (settings.alerts) await notify(env, `${a.sym} ${a.op === ">" ? "above" : "below"} ${a.px}`, `${a.sym} is now ${p.toFixed(2)} — your alert at ${a.px} triggered.`, { tags: "bell", priority: 4 });
    } }
}
async function addEvent(env, e, settings) {
  const id = e.id || (await sha256hex(e.kind + e.text)).slice(0, 24);
  const ex = await env.DB.prepare("SELECT id FROM events WHERE id=?").bind(id).first(); if (ex) return;
  await env.DB.prepare("INSERT INTO events (id,t,kind,sym,text,level,run) VALUES (?,?,?,?,?,?,?)").bind(id, now(), e.kind, e.sym || null, e.text, e.level || 1, e.run || null).run();
  if (settings.scan && e.push) await notify(env, e.kind + (e.sym ? " · " + e.sym : ""), e.text, { tags: "mag", priority: e.level >= 2 ? 4 : 3 });
}
async function jobOdds(env, settings) {
  const j = await getJSON(env, "https://gamma-api.polymarket.com/markets?limit=80&active=true&closed=false&order=volume24hr&ascending=false");
  const bad = /^(nba|nfl|mlb|nhl|ucl|epl|uel|lal|sea|bun|fl1|cfb|cbb|atp|wta|ufc|mls|ipl|cs2|lol|dota|val|kbo|npb|f1)-/;
  const names = (await kvGet(env, "pm_names")) || {}; let n = 0; const t = now();
  for (const m of j) { if (bad.test(m.slug || "") || / vs\.? |win on 20|Up or Down/i.test(m.question)) continue;
    let p; try { p = +JSON.parse(m.outcomePrices)[0]; } catch { continue; }
    await histAdd(env, "pm:" + m.id, p, t); names[m.id] = m.question.slice(0, 140);
    if (Math.abs(+m.oneDayPriceChange || 0) >= 0.15) await addEvent(env, { kind: "ODDS", text: `Odds moved ${(m.oneDayPriceChange * 100).toFixed(0)} pts in a day: ${m.question}`, level: 2, run: "PRED", push: true, id: "odds:" + m.id + ":" + nyNow().date }, settings);
    if (++n >= 16) break; }
  await kvSet(env, "pm_names", names);
}
async function jobCrypto(env) {
  const { out, funding, fg } = await cryptoSignals(env); const t = now();
  await kvSet(env, "signals_crypto", { at: t, coins: out });
  for (const s of out) await histAdd(env, "sig:" + s.sym, s.score, t);
  for (const [c, f] of Object.entries(funding)) await histAdd(env, "funding:" + c, f * 24 * 365 * 100, t);
  if (fg != null) await histAdd(env, "cfng", fg, Math.floor(t / 864e5) * 864e5);
}
async function jobScan(env, settings) {
  const watch = (await kvGet(env, "user:watch")) || []; const ciks = (await kvGet(env, "user:ciks")) || {};
  const want = new Map(Object.entries(ciks).filter(([s]) => watch.includes(s)).map(([s, c]) => [String(c).padStart(10, "0"), s]));
  if (want.size) for (const type of ["8-K", "4"]) {
    try { const r = await upstream(env, `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${type}&company=&dateb=&owner=include&start=0&count=100&output=atom`); const t = await r.text();
      for (const m of t.matchAll(/<entry>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<link[^>]*href="([^"]+)"/g)) {
        const cik = (m[1].match(/\((\d{10})\)/) || [])[1]; const sym = cik && want.get(cik); if (!sym) continue;
        if (type === "4" && !/\(Issuer\)/.test(m[1])) continue;
        await addEvent(env, { kind: type === "4" ? "INSIDER" : "8-K", sym, text: type === "4" ? `New insider trade report (Form 4) filed for ${sym}` : `${sym} filed a major-event report (8-K)`, level: type === "8-K" ? 2 : 1, run: sym + (type === "4" ? " INS" : " CF"), push: type === "8-K", id: "sec:" + m[2].slice(-40) }, settings);
      } } catch (e) {}
  }
  if (marketOpen() && watch.length) { const q = await quotes(env, watch.slice(0, 40));
    for (const [s, v] of Object.entries(q)) { if (!v.prev) continue; const ch = (v.px / v.prev - 1) * 100;
      if (Math.abs(ch) >= 5) await addEvent(env, { kind: "MOVE", sym: s, text: `${s} ${ch > 0 ? "up" : "down"} ${Math.abs(ch).toFixed(1)}% today at ${v.px.toFixed(2)}`, level: Math.abs(ch) >= 9 ? 2 : 1, run: s + " WHY", push: Math.abs(ch) >= 7, id: "move:" + s + ":" + nyNow().date + ":" + (ch > 0 ? "u" : "d") }, settings); } }
}
async function composeBrief(env, kind, settings) {
  const watch = (await kvGet(env, "user:watch")) || ["AAPL", "MSFT", "NVDA"];
  const core = ["^GSPC", "^IXIC", "^RUT", "^VIX", "CL=F", "GC=F", "BTC-USD", "^TNX"];
  const q = await quotes(env, [...core, ...watch.slice(0, 32)]);
  const f = (s, label) => { const v = q[s]; if (!v || v.px == null) return null; const ch = v.prev ? (v.px / v.prev - 1) * 100 : null; return `${label || s.replace("^", "")} ${s === "^TNX" ? (v.px).toFixed(2) + "%" : v.px.toLocaleString("en-US", { maximumFractionDigits: 2 })}${ch != null && s !== "^TNX" ? ` (${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%)` : ""}`; };
  const L = [];
  L.push([f("^GSPC", "S&P"), f("^IXIC", "Nasdaq"), f("^RUT", "Russell"), f("^VIX", "VIX")].filter(Boolean).join(" · "));
  L.push([f("^TNX", "10Y"), f("CL=F", "Oil"), f("GC=F", "Gold"), f("BTC-USD", "BTC")].filter(Boolean).join(" · "));
  const mv = watch.map(s => [s, q[s]]).filter(([, v]) => v && v.prev).map(([s, v]) => [s, (v.px / v.prev - 1) * 100]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
  if (mv.length) L.push("Your movers: " + mv.map(([s, c]) => `${s} ${c >= 0 ? "+" : ""}${c.toFixed(1)}%`).join(", "));
  try { const d = nyNow().date; const j = await getJSON(env, `https://api.nasdaq.com/api/calendar/earnings?date=${d}`); const er = (j.data?.rows || []).filter(r => watch.includes(r.symbol)).map(r => r.symbol + (r.time === "time-pre-market" ? " (am)" : r.time === "time-after-hours" ? " (pm)" : "")); if (er.length) L.push("Earnings today: " + er.join(", ")); } catch (e) {}
  const fomc = (await kvGet(env, "fomc")) || []; const nxt = fomc.find(d => d >= nyNow().date); if (nxt) { const days = Math.round((Date.parse(nxt) - Date.parse(nyNow().date)) / 864e5); if (days <= 7) L.push(days === 0 ? "Fed decision today (2 pm ET)." : `Fed decision in ${days} day(s) (${nxt}).`); }
  const last = async s => (await env.DB.prepare("SELECT v FROM hist WHERE series=? ORDER BY t DESC LIMIT 1").bind(s).first())?.v;
  const mood = await last("mood:stocks"), rec = await last("rec:score"); if (mood != null || rec != null) L.push(`Mood ${mood != null ? Math.round(mood) : "—"}/100 · Recession score ${rec != null ? Math.round(rec) : "—"}/100`);
  const sig = await kvGet(env, "signals_crypto"); if (sig?.coins?.length) L.push("Crypto signals: " + sig.coins.map(c => `${c.sym} ${c.score > 0 ? "+" : ""}${c.score}`).join(", "));
  const hits = await env.DB.prepare("SELECT sym, op, px FROM alerts WHERE hit=1 AND hit_at>?").bind(now() - 864e5).all(); if (hits.results?.length) L.push("Alerts hit: " + hits.results.map(a => `${a.sym} ${a.op} ${a.px}`).join(", "));
  const ev = await env.DB.prepare("SELECT text FROM events WHERE t>? ORDER BY level DESC, t DESC LIMIT 3").bind(now() - 864e5).all(); if (ev.results?.length) L.push("Unusual: " + ev.results.map(e => e.text).join("; "));
  if (settings.portfolio) { try { const v = await portfolioValue(env); if (v) L.push(`Portfolio $${Math.round(v.total).toLocaleString("en-US")}${v.day != null ? ` (${v.day >= 0 ? "+" : "-"}$${Math.abs(Math.round(v.day)).toLocaleString("en-US")} today)` : ""}`); } catch (e) {} }
  return { title: kind === "evening" ? "Market wrap" : "Morning brief", text: L.filter(Boolean).join("\n") };
}
async function portfolioValue(env) {
  const { accounts } = await allAccounts(env, true); const pos = accounts.flatMap(a => a.positions || []);
  const q = await quotes(env, pos.map(p => p.sym)); let total = accounts.reduce((s, a) => s + (a.cash || 0), 0), day = 0;
  pos.forEach(p => { const v = q[p.sym]; const price = v?.px ?? p.price; if (price != null) total += price * p.qty; if (v && v.prev) day += (v.px - v.prev) * p.qty; });
  return { total, day };
}
async function jobFomc(env) {
  try { const t = await (await upstream(env, "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm")).text(); const out = [];
    for (const y of t.matchAll(/(\d{4}) FOMC Meetings<\/a><\/h4>([\s\S]*?)(?=FOMC Meetings<\/a><\/h4>|$)/g)) {
      for (const m of y[2].matchAll(/fomc-meeting__month[^>]*>\s*<strong>([A-Za-z\/]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([0-9\-]+)/g)) {
        const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[1].split("/").pop().slice(0, 3)); const dd = +m[2].split("-").pop();
        if (mon >= 0) out.push(new Date(Date.UTC(+y[1], mon, dd)).toISOString().slice(0, 10)); } }
    if (out.length) await kvSet(env, "fomc", [...new Set(out)].sort()); } catch (e) {}
}
async function runCron(env, scheduledTime) {
  await initDb(env); if (!env.DB) return;
  const t = new Date(scheduledTime || now()), m = t.getUTCMinutes(), ny = nyNow();
  await kvSet(env, "cron_at", now());
  const settings = await briefSettings(env);
  const jobs = [jobAlerts(env, settings).catch(() => {})];
  if (ny.weekday && ny.mins >= 570 && ny.mins <= 965) jobs.push(fillPracticeOrders(env).catch(() => {}));
  if (m % 15 === 0) jobs.push(jobOdds(env, settings).catch(() => {}));
  if (m % 15 === 3) jobs.push(jobCrypto(env).catch(() => {}));
  if (m % 15 === 7) jobs.push(jobScan(env, settings).catch(() => {}));
  if (m % 30 === 11) jobs.push(jobHealth(env).catch(() => {}));
  const once = async (key, fn) => { const k = key + ":" + ny.date; if (await kvGet(env, k)) return; await kvSet(env, k, 1); await fn(); };
  if (ny.weekday && ny.h === 8 && ny.m >= 45 && ny.m < 50 && settings.morning) jobs.push(once("brief_m", async () => { const b = await composeBrief(env, "morning", settings); await notify(env, b.title, b.text, { tags: "sunrise" }); }).catch(() => {}));
  if (ny.weekday && ny.h === 16 && ny.m >= 20 && ny.m < 25 && settings.evening) jobs.push(once("brief_e", async () => { const b = await composeBrief(env, "evening", settings); await notify(env, b.title, b.text, { tags: "city_sunset" }); }).catch(() => {}));
  if (ny.h === 16 && ny.m >= 35 && ny.m < 40) jobs.push(once("portsnap", async () => { const v = await portfolioValue(env); if (v && v.total) await histAdd(env, "port:value", v.total, Math.floor(now() / 864e5) * 864e5); }).catch(() => {}));
  if (ny.h === 3 && ny.m < 5) jobs.push(once("daily", async () => { await jobFomc(env);
    await env.DB.prepare("DELETE FROM events WHERE t<?").bind(now() - 30 * 864e5).run();
    await env.DB.prepare("DELETE FROM kv WHERE (k LIKE 'nonce:%' OR k LIKE 'brief_%:%' OR k LIKE 'portsnap:%' OR k LIKE 'daily:%' OR k LIKE 'ai:%') AND t<?").bind(now() - 7 * 864e5).run();
    await env.DB.prepare("DELETE FROM hist WHERE series LIKE 'pm:%' AND t<?").bind(now() - 400 * 864e5).run(); }).catch(() => {}));
  await Promise.all(jobs);
}

/* ---------------- AI (Workers AI free allowance) ---------------- */
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
async function aiRun(env, task, text, form) {
  if (!env.AI) throw new HttpError(501, "AI isn't enabled on this Worker.");
  text = String(text || "").slice(0, 16000); if (text.length < 40) throw new HttpError(400, "Not enough text to summarize.");
  const key = "ai:" + (await sha256hex(task + "|" + text)).slice(0, 40);
  const cached = await kvGet(env, key); if (cached) return cached;
  const day = "aiday:" + new Date().toISOString().slice(0, 10); const used = (await kvGet(env, day)) || 0; const limit = +(env.AI_DAILY_LIMIT || 150);
  if (used >= limit) throw new HttpError(429, "Today's free AI allowance is used up. It resets at midnight UTC.");
  const sys = task === "why"
    ? "You explain stock moves to everyday investors. Using ONLY the facts given, write 2-3 short plain-English sentences on the most likely reason for today's move. If the facts don't explain it, say so plainly. Never invent news or numbers. No investment advice."
    : `You summarize SEC filings for everyday investors. Summarize this ${form || "filing"} excerpt in 4-6 short bullet points in plain English: what happened or was reported, the key numbers, and any notable risks or changes. Never invent facts. No investment advice.`;
  const r = await env.AI.run(AI_MODEL, { messages: [{ role: "system", content: sys }, { role: "user", content: text }], max_tokens: 420 });
  const out = String(r?.response || "").trim(); await kvSet(env, day, used + 1); await kvSet(env, key, out); return out;
}

/* ---------------- health checks (HEALTH screen + automatic key watch) ---------------- */
const withTimeout = (p, ms = 8000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("No answer within " + ms / 1000 + " seconds."), { timeout: true })), ms))]);
async function httpProbe(env, url, { init = {}, keyFix = null, test = null } = {}) {
  let r;
  try { r = await withTimeout(upstream(env, url, init), 7000); }
  catch (e) { return { state: "fail", msg: e.timeout ? "No answer within 7 seconds." : "Could not reach the site.", fix: "The site looks down or slow. This is not a problem with your keys. It usually clears on its own; check again in a few minutes." }; }
  const s = r.status;
  if (r.ok) {
    if (test) { let t = ""; try { t = await r.text(); } catch {}
      if (/<title>[^<]*maintenance/i.test(t)) return { state: "fail", msg: "The site says it's down for maintenance.", fix: "Not your key. Nothing to fix on your side; check again later." };
      if (!test(t)) return { state: "warn", msg: "Answered, but the data looked wrong.", fix: "The site may have changed its format. The rest of the terminal keeps working." }; }
    else { try { await r.body?.cancel(); } catch {} }
    return { state: "ok", msg: "Working" };
  }
  try { await r.body?.cancel(); } catch {}
  if (keyFix && (s === 400 || s === 401 || s === 403)) return { state: "fail", msg: `The site rejected the key (${s}).`, fix: keyFix };
  if (s === 429) return { state: "warn", msg: "Rate limited right now (429).", fix: "Temporary. It clears within a minute or two." };
  if (s >= 500) return { state: "fail", msg: `The site is having problems (${s}).`, fix: "Not your key. The site is down on their end; check again later." };
  return { state: "warn", msg: `Unexpected answer (${s}).`, fix: "The site may have moved or changed. Other parts keep working." };
}
async function healthChecks(env) {
  const FRED_FIX = "Log in at fredaccount.stlouisfed.org → API Keys, copy the key, then in Cloudflare replace the FRED_KEY secret and tap Deploy.";
  const FINN_FIX = "Log in at finnhub.io, copy your API key, then in Cloudflare replace the FINNHUB_KEY secret and tap Deploy.";
  const ALP_FIX = "In Alpaca switch to the right account (Paper or Live), open API Keys, generate new keys, then in Cloudflare replace BOTH ALPACA_KEY_ID and ALPACA_SECRET and tap Deploy. Paper keys start with PK, live keys with AK.";
  const SNAP_FIX = "In the SnapTrade dashboard copy your client ID and consumer key again, then replace SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in Cloudflare and tap Deploy.";
  const list = [];
  const add = (group, name, fn) => list.push((async () => {
    const t0 = now();
    try { const r = await fn(); return { group, name, state: r.state, msg: r.msg, fix: r.fix || null, ms: now() - t0 }; }
    catch (e) { return { group, name, state: "fail", msg: String(e.publicMessage || e.message || e).slice(0, 220), fix: e.fix || null, ms: now() - t0 }; }
  })());
  const off = (why, fix) => ({ state: "off", msg: why, fix: fix || null });
  const cronAt = await kvGet(env, "cron_at"), contactSet = !!env.CONTACT_EMAIL;

  // Your keys
  add("Your keys", "FRED key (economic calendar)", async () => !env.FRED_KEY ? off("Not set. Optional.", "Only needed for CAL release dates and STUDY. The economy charts work without it.")
    : httpProbe(env, "https://api.stlouisfed.org/fred/series?series_id=GDP", { keyFix: FRED_FIX, test: t => /"seriess"/.test(t) }));
  add("Your keys", "Finnhub key (live stocks)", async () => !env.FINNHUB_KEY ? off("Not set. Optional.", "Adds tick-by-tick stock prices and earnings history.")
    : httpProbe(env, "https://finnhub.io/api/v1/quote?symbol=AAPL", { keyFix: FINN_FIX }));
  add("Your keys", "Alpaca key (" + (alpacaPaper(env) ? "paper" : "live") + ")", async () => {
    if (!hasAlpaca(env)) return off("Not set. Optional.", "Free practice-trading broker.");
    try { const a = await withTimeout(alpaca(env, "GET", "/v2/account"), 8000); const eq = Number(a.equity);
      const okAcct = !a.status || a.status === "ACTIVE";
      return { state: okAcct ? "ok" : "warn", msg: `${alpacaPaper(env) ? "Paper" : "Live"} account ${a.status || "connected"}${isFinite(eq) ? ", equity $" + Math.round(eq).toLocaleString("en-US") : ""}`, fix: okAcct ? null : "Alpaca says the account isn't active. Check your Alpaca dashboard." }; }
    catch (e) { if (e.timeout) return { state: "fail", msg: "Alpaca didn't answer in time.", fix: "Probably Alpaca being slow. Check again shortly." };
      const bad = /didn't accept the key/.test(e.message); return { state: "fail", msg: String(e.message).slice(0, 220), fix: bad ? ALP_FIX : "Alpaca had a problem on their end. Check again later." }; }
  });
  add("Your keys", "SnapTrade keys (brokerages)", async () => {
    if (!hasSnap(env)) return off("Not set. Optional.", "Connects most brokerages.");
    try { const r = await withTimeout(snap(env, "GET", "/snapTrade/listUsers"), 8000); return { state: "ok", msg: `Working${Array.isArray(r) ? " · " + r.length + " user" + (r.length === 1 ? "" : "s") : ""}` }; }
    catch (e) { const bad = /SnapTrade 40[0-3]/.test(e.message); return { state: "fail", msg: String(e.message).slice(0, 220), fix: bad ? SNAP_FIX : "SnapTrade had a problem or timed out. Check again later." }; }
  });
  add("Your keys", "Phone notifications (ntfy)", async () => env.NTFY_TOPIC ? { state: "ok", msg: "Topic is set.", fix: "To confirm delivery, open BRIEF and tap SEND A TEST NOTIFICATION." } : off("Not set. Optional.", "Setup step 10."));
  add("Your keys", "Contact email (SEC requires it)", async () => contactSet ? { state: "ok", msg: "Set" } : { state: "warn", msg: "CONTACT_EMAIL is missing.", fix: "Add a Text variable CONTACT_EMAIL with your email (setup step 5). SEC can block requests without it." });

  // Free data sources
  const yh = "https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=1d&interval=1d";
  add("Free data", "Yahoo Finance (prices, news, options)", () => httpProbe(env, yh, { test: t => /"regularMarketPrice"/.test(t) }));
  add("Free data", "CoinGecko (crypto)", () => httpProbe(env, "https://api.coingecko.com/api/v3/ping"));
  add("Free data", "Coinbase (crypto stream source)", () => httpProbe(env, "https://api.exchange.coinbase.com/time"));
  add("Free data", "FRED website (economy charts)", () => httpProbe(env, "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10", { test: t => /DATE|observation_date/i.test(t) }));
  add("Free data", "SEC EDGAR (filings, insiders, 13F)", () => httpProbe(env, "https://data.sec.gov/submissions/CIK0000320193.json", { keyFix: contactSet ? null : "Set CONTACT_EMAIL (setup step 5); SEC rejects requests that don't say who is asking." }));
  add("Free data", "Nasdaq (screener, earnings)", () => httpProbe(env, "https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks"));
  add("Free data", "CBOE (options)", () => httpProbe(env, "https://cdn.cboe.com/api/global/delayed_quotes/options/SPY.json"));
  add("Free data", "Polymarket (prediction markets)", () => httpProbe(env, "https://gamma-api.polymarket.com/markets?limit=1"));
  add("Free data", "Hyperliquid (crypto funding)", () => httpProbe(env, "https://api.hyperliquid.xyz/info", { init: { method: "POST", body: JSON.stringify({ type: "meta" }), headers: { "Content-Type": "application/json" } } }));
  add("Free data", "ApeWisdom (Reddit chatter)", () => httpProbe(env, "https://apewisdom.io/api/v1.0/filter/all-stocks/page/1"));
  add("Free data", "Fear & Greed (alternative.me)", () => httpProbe(env, "https://api.alternative.me/fng/"));
  add("Free data", "Currency rates (Frankfurter)", () => httpProbe(env, "https://api.frankfurter.dev/v1/latest"));

  // Your server
  add("Your server", "Login wall (Cloudflare Access)", async () => (env.TEAM_DOMAIN && env.POLICY_AUD) ? { state: "ok", msg: "On and verified (you're signed in)." } : { state: "fail", msg: "Not fully set up.", fix: "Set TEAM_DOMAIN, POLICY_AUD and ALLOWED_EMAIL (setup step 7)." });
  add("Your server", "Private database (D1)", async () => { if (!env.DB) return { state: "fail", msg: "Not connected.", fix: "Check the D1 database ID in wrangler.jsonc (setup step 3)." }; await withTimeout(env.DB.prepare("SELECT 1").first(), 5000); return { state: "ok", msg: "Working" }; });
  add("Your server", "Scheduled jobs (every minute)", async () => { if (!cronAt) return { state: "warn", msg: "Hasn't run yet.", fix: "The first run happens within a minute or two of a deploy." }; const age = (now() - cronAt) / 1000;
    return age < 180 ? { state: "ok", msg: `Last ran ${Math.round(age)} seconds ago` } : { state: "fail", msg: `Last ran ${Math.round(age / 60)} minutes ago`, fix: "Alerts and briefs aren't running. In Cloudflare open the Worker → Settings → Triggers and check the cron schedule is there, then Deploy again." }; });
  add("Your server", "AI summaries (Workers AI)", async () => env.AI ? { state: "ok", msg: "Connected" } : off("Not connected.", "Optional. Add the AI binding in wrangler.jsonc."));
  add("Your server", "Trading bot link", async () => {
    if (!env.BOT_STATE_URL) return off("Not set. Optional.", "Setup step 12.");
    let u; try { u = new URL(env.BOT_STATE_URL); } catch { return { state: "fail", msg: "BOT_STATE_URL isn't a valid address.", fix: "Paste the full https:// link to your bot's status file." }; }
    const r = await withTimeout(fetch(u.toString(), { headers: { "User-Agent": "OpenfloorTerminal" } }), 7000).catch(() => null);
    if (!r) return { state: "fail", msg: "Could not reach it.", fix: "Check the link opens in your browser." };
    return r.ok ? { state: "ok", msg: "Working" } : { state: "fail", msg: `The link answered ${r.status}.`, fix: "Check BOT_STATE_URL points to the raw status file on GitHub." };
  });
  return Promise.all(list);
}
// Every 30 minutes: re-test your keys and send ONE phone alert when a key stops working (and when it recovers).
async function jobHealth(env) {
  const res = await healthChecks(env); await kvSet(env, "health_last", { at: now(), results: res });
  const prev = (await kvGet(env, "health_keys")) || {}, cur = {}; const msgs = [];
  for (const r of res) { if (r.group !== "Your keys") continue; cur[r.name] = r.state;
    if (r.state === "fail" && prev[r.name] !== "fail") msgs.push(`${r.name}: ${r.msg}`);
    if (r.state === "ok" && prev[r.name] === "fail") msgs.push(`${r.name}: working again`); }
  await kvSet(env, "health_keys", cur);
  if (msgs.length) await notify(env, "Openfloor key check", msgs.join("\n") + "\nOpen HEALTH in the terminal for the fix.", { tags: "warning", priority: 4 });
}

/* ---------------- API router ---------------- */
async function api(req, env, ctx, url) {
  await initDb(env);
  const path = url.pathname.replace(/^\/api\//, "");
  const auth = await verifyAccess(req, env);
  const method = req.method;
  const sameOrigin = () => { const o = req.headers.get("Origin"); if (o && o !== url.origin) throw new HttpError(403, "Requests must come from this site."); if (req.headers.get("X-Openfloor") !== "1") throw new HttpError(403, "Missing request header."); };
  const priv = (opts = {}) => {
    if (!auth.configured) throw new HttpError(403, "Turn on Cloudflare Access and set TEAM_DOMAIN and POLICY_AUD first (setup steps 6–7).");
    if (!auth.ok) throw new HttpError(401, "You're not signed in through Cloudflare Access.");
    if (auth.service && !opts.service) throw new HttpError(403, "Service tokens can only read bot signals.");
    sameOrigin();
  };
  const body = async () => { if (method === "GET") return {}; const t = await req.text(); if (t.length > 300000) throw new HttpError(413, "Too large"); try { return t ? JSON.parse(t) : {}; } catch { throw new HttpError(400, "Bad JSON"); } };

  if (path === "ping") {
    const open = auth.ok && !auth.service;
    const f = { access: auth.configured };
    if (open || !auth.configured) Object.assign(f, { db: !!env.DB, ai: !!env.AI, finnhub: !!env.FINNHUB_KEY, fred: !!env.FRED_KEY });
    if (open) Object.assign(f, { user: auth.email, snaptrade: hasSnap(env), alpaca: hasAlpaca(env), alpacaPaper: alpacaPaper(env), ntfy: !!env.NTFY_TOPIC, bot: !!env.BOT_STATE_URL,
      trading: tradingMode(env), pin: !!env.TRADE_PIN, maxOrder: maxOrder(env), maxDaily: maxDaily(env), cronAt: await kvGet(env, "cron_at"),
      aiLeft: env.AI ? Math.max(0, +(env.AI_DAILY_LIMIT || 150) - ((await kvGet(env, "aiday:" + new Date().toISOString().slice(0, 10))) || 0)) : null });
    // Setup helper: until the login check passes, read your own Access login token (without trusting it)
    // and show the team domain and AUD tag it carries, so you can copy them into the Worker settings.
    if (!auth.ok) { const tok = req.headers.get("Cf-Access-Jwt-Assertion");
      if (tok) { try { const pl = JSON.parse(new TextDecoder().decode(b64urlToBytes(tok.split(".")[1])));
        const iss = String(pl.iss || ""); const host = iss.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        const aud = Array.isArray(pl.aud) ? pl.aud[0] : pl.aud;
        if (/\.cloudflareaccess\.com$/.test(host) && /^[a-f0-9]{20,128}$/i.test(String(aud || ""))) f.setupHint = { teamDomain: host, aud: String(aud), email: pl.email || null, why: auth.why || null }; } catch (e) {} } }
    return json({ ok: true, private: open, features: f });
  }
  if (path === "p") {
    if (auth.configured && !auth.ok) throw new HttpError(401, "Not signed in.");
    // Your own keys (Finnhub, FRED) are only ever used for you: before the login wall is on, those sites are blocked.
    if (!auth.ok && /^https:\/\/(finnhub\.io|api\.stlouisfed\.org)\//.test(url.searchParams.get("u") || "")) throw new HttpError(403, "Turn on Cloudflare Access first; your keys are only used behind your login.");
    if (auth.service) throw new HttpError(403, "Service tokens can only read bot signals.");
    if (method === "POST") sameOrigin(); return proxy(req, env, url);
  }

  if (path === "bot/signals") { priv({ service: true }); return json({ at: now(), crypto: await kvGet(env, "signals_crypto"), stocks: await kvGet(env, "signals_stocks"), note: "Research scores from −100 to +100. Not financial advice." }); }

  priv(); needDb(env);
  const user = { email: auth.email };
  switch (path) {
    case "health": { const results = await healthChecks(env); await kvSet(env, "health_last", { at: now(), results }); return json({ at: now(), results }); }
    case "ws-token": return json({ token: env.FINNHUB_KEY ? String(env.FINNHUB_KEY).trim() : null });
    case "store": {
      const b = method === "GET" ? {} : await body();
      const k = method === "GET" ? url.searchParams.get("k") : b.k;
      if (!["watch", "ciks", "layout"].includes(k)) throw new HttpError(400, "Unknown setting");
      if (method === "GET") return json({ v: await kvGet(env, "user:" + k) });
      const v = b.v;
      if (k === "ciks" && (typeof v !== "object" || Array.isArray(v) || Object.keys(v).length > 300)) throw new HttpError(400, "Bad list");
      if (k === "watch") { if (!Array.isArray(v) || v.length > 200 || !v.every(s => typeof s === "string" && s.length < 16)) throw new HttpError(400, "Bad watchlist"); }
      await kvSet(env, "user:" + k, v); return json({ ok: true });
    }
    case "accounts": return json(await allAccounts(env, url.searchParams.get("fresh") === "1"));
    case "brokers/connect": {
      if (!hasSnap(env)) throw new HttpError(501, "Add your SnapTrade keys first (setup step 11).");
      const b = await body(); const r = await snap(env, "POST", "/snapTrade/login", { body: { connectionType: b.mode === "trade" ? "trade" : "read", customRedirect: url.origin + "/#CONN", immediateRedirect: true, darkMode: true } });
      await audit(env, "connect_started", "SnapTrade connection (" + (b.mode === "trade" ? "trading" : "view only") + ")", "ok");
      return json({ url: r.redirectURI || r.loginRedirectURI || r.url });
    }
    case "orders": return json({ orders: await listOrders(env) });
    case "trade/preview": { if (method !== "POST") break; return json(await previewOrder(env, user, await body())); }
    case "trade/submit": { if (method !== "POST") break; return json(await submitOrder(env, user, await body())); }
    case "trade/cancel": { if (method !== "POST") break; return json(await cancelOrder(env, await body())); }
    case "trade/pause": {
      const b = await body(); if (b.paused) { await kvSet(env, "trading_paused", true); await audit(env, "trading_paused", "All trading paused", "ok"); }
      else { if (env.TRADE_PIN) await checkPin(env, b.pin); await kvSet(env, "trading_paused", false); await audit(env, "trading_resumed", "Trading resumed", "ok"); }
      return json({ ok: true });
    }
    case "trade/log": { const r = await env.DB.prepare("SELECT t,event,summary,status FROM audit ORDER BY id DESC LIMIT 150").all(); return json({ log: r.results || [], paused: !!(await kvGet(env, "trading_paused")) }); }
    case "practice/reset": { await kvSet(env, "practice", { cash: 100000, positions: {}, created: now() }); await env.DB.prepare("UPDATE porders SET status='cancelled' WHERE status='open'").run(); await audit(env, "practice_reset", "Practice account reset to $100,000", "ok"); ACCT_CACHE.at = 0; return json({ ok: true }); }
    case "holdings": {
      if (method === "GET") { const r = await env.DB.prepare("SELECT * FROM holdings").all(); return json({ rows: r.results || [] }); }
      if (method === "DELETE") { await env.DB.prepare("DELETE FROM holdings WHERE id=?").bind(url.searchParams.get("id")).run(); ACCT_CACHE.at = 0; return json({ ok: true }); }
      const b = await body(); const clean = rows => (rows || []).slice(0, 500).map(r => ({ account: String(r.account || "Manual").slice(0, 40), sym: String(r.sym || "").toUpperCase().slice(0, 14), qty: +r.qty, cost: r.cost == null || r.cost === "" ? null : +r.cost })).filter(r => SYM_RE.test(r.sym) && isFinite(r.qty) && r.qty !== 0);
      const st = []; if (b.replace) st.push(env.DB.prepare("DELETE FROM holdings"));
      clean(b.replace || b.add).forEach(r => st.push(env.DB.prepare("INSERT INTO holdings (id,account,sym,qty,cost,created) VALUES (?,?,?,?,?,?)").bind(rid(8), r.account, r.sym, r.qty, r.cost, now())));
      if (st.length) await env.DB.batch(st); ACCT_CACHE.at = 0; return json({ ok: true });
    }
    case "alerts": {
      if (method === "GET") { const r = await env.DB.prepare("SELECT * FROM alerts ORDER BY created DESC LIMIT 100").all(); return json({ alerts: (r.results || []).map(a => ({ id: a.id, sym: a.sym, op: a.op, px: a.px, hit: !!a.hit, hitAt: a.hit_at })) }); }
      if (method === "DELETE") { await env.DB.prepare("DELETE FROM alerts WHERE id=?").bind(url.searchParams.get("id")).run(); return json({ ok: true }); }
      const b = await body(); const sym = String(b.sym || "").toUpperCase(); if (!/^[A-Z0-9.^=\-]{1,14}$/.test(sym) || !(+b.px > 0)) throw new HttpError(400, "Enter a ticker and a price.");
      const c = await env.DB.prepare("SELECT COUNT(*) n FROM alerts").first(); if ((c?.n || 0) >= 100) throw new HttpError(400, "You have 100 alerts. Delete some first.");
      await env.DB.prepare("INSERT INTO alerts (id,sym,op,px,created) VALUES (?,?,?,?,?)").bind(rid(8), sym, b.op === "<" ? "<" : ">", +b.px, now()).run(); return json({ ok: true });
    }
    case "hist": { const s = url.searchParams.get("series") || ""; const days = Math.min(3650, +(url.searchParams.get("days") || 365));
      const r = await env.DB.prepare("SELECT t,v FROM hist WHERE series=? AND t>? ORDER BY t LIMIT 6000").bind(s, now() - days * 864e5).all(); return json({ points: (r.results || []).map(x => [x.t, x.v]) }); }
    case "series": { const r = await env.DB.prepare("SELECT series, COUNT(*) n, MAX(t) last FROM hist GROUP BY series ORDER BY last DESC LIMIT 120").all(); return json({ series: r.results || [], names: await kvGet(env, "pm_names") }); }
    case "record": { const b = await body(); if (!/^(mood|rec):[a-z]+$/.test(b.series || "") || !isFinite(+b.v)) throw new HttpError(400, "Not recordable"); await histAdd(env, b.series, +b.v, Math.floor(now() / 864e5) * 864e5); return json({ ok: true }); }
    case "signals": { const b = await body(); const stocks = (b.stocks || []).slice(0, 100).filter(s => SYM_RE.test(s.sym)).map(s => ({ sym: s.sym, score: Math.max(-100, Math.min(100, +s.score || 0)), label: String(s.label || "").slice(0, 12) }));
      await kvSet(env, "signals_stocks", { at: now(), stocks }); const d = Math.floor(now() / 864e5) * 864e5; for (const s of stocks.slice(0, 40)) await histAdd(env, "sig:" + s.sym, s.score, d); return json({ ok: true }); }
    case "scan": { const r = await env.DB.prepare("SELECT t,kind,sym,text,level,run FROM events WHERE t>? ORDER BY t DESC LIMIT 60").bind(now() - 3 * 864e5).all(); return json({ events: r.results || [] }); }
    case "ai": { const b = await body(); return json({ text: await aiRun(env, b.task === "why" ? "why" : "filing", b.text, String(b.form || "").slice(0, 10)) }); }
    case "brief": {
      if (method === "PUT") { const b = await body(); const s = {}; ["morning", "evening", "alerts", "scan", "portfolio"].forEach(k => { if (k in (b.settings || {})) s[k] = !!b.settings[k]; }); await kvSet(env, "brief_settings", { ...(await briefSettings(env)), ...s }); return json({ ok: true }); }
      const settings = await briefSettings(env); const b = await composeBrief(env, "morning", settings); return json({ settings, text: b.text });
    }
    case "notify/test": { if (!env.NTFY_TOPIC) throw new HttpError(501, "Set NTFY_TOPIC first (setup step 10)."); const ok = await notify(env, "Openfloor test", "Notifications are working. Your briefs and alerts will arrive here.", { tags: "white_check_mark" }); if (!ok) throw new HttpError(502, "ntfy didn't accept the message. Check NTFY_TOPIC."); return json({ ok: true }); }
    case "bot/state": {
      if (!env.BOT_STATE_URL) throw new HttpError(501, "Set BOT_STATE_URL to your bot's status file (setup step 12).");
      let u; try { u = new URL(env.BOT_STATE_URL); } catch { throw new HttpError(400, "BOT_STATE_URL isn't a valid address."); }
      if (u.protocol !== "https:" || !BOT_HOSTS.test(u.hostname)) throw new HttpError(400, "BOT_STATE_URL must be a GitHub address (raw.githubusercontent.com or yourname.github.io).");
      const r = await fetch(u.toString(), { headers: { "User-Agent": "OpenfloorTerminal" } }); const t = (await r.text()).slice(0, 300000);
      let state; try { state = JSON.parse(t); } catch { state = { text: t.slice(0, 4000) }; }
      return json({ state, url: u.toString() });
    }
  }
  throw new HttpError(404, "Unknown route");
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try { return await api(req, env, ctx, url); }
    catch (e) { const status = e.status || 500; return json({ error: e.publicMessage || "Something went wrong on the server." }, status); }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env, event.scheduledTime)); },
};
// exported for the local test harness only
export const _test = { verifyAccess, canon, runCron, composeBrief, cryptoSignals };
