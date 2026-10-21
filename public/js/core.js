/* Openfloor Terminal — core: state, formatting, reference data, shared UI helpers.
   Plain scripts that share one global scope (no build step needed). */
"use strict";
let D = (typeof SNAP !== "undefined" && SNAP) ? SNAP : {asof:new Date().toISOString(),q:{},crypto:[],fred:{},ecb:null,sec:{},news:[],pm:[],universe:{rows:[],cols:[]},options:{},insiders:{},holders:{},earnings:[],fomc:[],reddit:[],cfng:[],funding:[],house:[],funds:[],intraday:{}};
["q","fred","sec","options","insiders","holders","intraday"].forEach(k=>{ if(!D[k]) D[k]={}; });
["crypto","news","pm","earnings","fomc","reddit","cfng","funding","house","funds"].forEach(k=>{ if(!D[k]) D[k]=[]; });
if(!D.universe) D.universe={rows:[],cols:[]};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = {
  get(k, d){ try{ const v = localStorage.getItem("ofl:"+k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem("ofl:"+k, JSON.stringify(v)); }catch(e){} }
};

/* ---------- reference data ---------- */
const GROUPS = {
  indices:["^GSPC","^DJI","^IXIC","^RUT","^VIX","^FTSE","^GDAXI","^STOXX50E","^N225","^HSI"],
  cmdty:["CL=F","BZ=F","NG=F","GC=F","SI=F","HG=F","ZC=F","ZW=F"],
  fx:["EURUSD=X","GBPUSD=X","JPY=X","CNY=X","CAD=X","MXN=X","DX-Y.NYB"],
  eq:["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","SPY","QQQ"],
  etf:["TLT","XLK","XLF","XLV","XLY","XLP","XLE","XLI","XLB","XLU","XLRE","XLC","IWM","HYG"],
  crypto:["BTC-USD","ETH-USD","SOL-USD","XRP-USD","BNB-USD"]
};
const FRED_NAMES = {DGS3MO:"3M T-Bill",DGS2:"2Y Treasury",DGS5:"5Y Treasury",DGS10:"10Y Treasury",DGS30:"30Y Treasury",FEDFUNDS:"Fed Funds Rate",CPIAUCSL:"CPI (index)",UNRATE:"Unemployment Rate",T10Y2Y:"10Y-2Y Spread",T10Y3M:"10Y-3M Spread",
  MORTGAGE30US:"30Y Mortgage",MORTGAGE15US:"15Y Mortgage",BAMLH0A0HYM2:"High-Yield Spread",SAHMREALTIME:"Sahm Rule",IC4WSA:"Jobless Claims (4wk avg)",UMCSENT:"Consumer Sentiment",CFNAIMA3:"Chicago Fed Activity (3mo)",PERMIT:"Building Permits",
  A191RL1Q225SBEA:"Real GDP Growth",GASREGW:"Regular Gas Price",CUSR0000SAF11:"CPI Food at Home",CUSR0000SEHA:"CPI Rent",CUSR0000SEHF01:"CPI Electricity",CUSR0000SETB01:"CPI Gasoline",CUSR0000SETA01:"CPI New Vehicles",
  CUSR0000SETA02:"CPI Used Cars",CPIMEDSL:"CPI Medical Care",CUSR0000SAS4:"CPI Transportation Services",CUSR0000SEFV:"CPI Restaurants",CPILFESL:"Core CPI (index)"};
const SECTOR_ETF = {XLK:"Technology",XLF:"Financials",XLV:"Health Care",XLY:"Consumer Discretionary",XLP:"Consumer Staples",XLE:"Energy",XLI:"Industrials",XLB:"Materials",XLU:"Utilities",XLRE:"Real Estate",XLC:"Communication"};
const LABEL = {
  "^GSPC":["SPX","S&P 500","Americas"],"^DJI":["INDU","Dow Jones Industrials","Americas"],"^IXIC":["CCMP","Nasdaq Composite","Americas"],
  "^RUT":["RTY","Russell 2000","Americas"],"^VIX":["VIX","CBOE Volatility Index","Americas"],"^FTSE":["UKX","FTSE 100","Europe"],
  "^GDAXI":["DAX","DAX","Europe"],"^STOXX50E":["SX5E","Euro Stoxx 50","Europe"],"^N225":["NKY","Nikkei 225","Asia/Pacific"],"^HSI":["HSI","Hang Seng","Asia/Pacific"],
  "CL=F":["CL","WTI Crude Oil","Energy"],"BZ=F":["CO","Brent Crude Oil","Energy"],"NG=F":["NG","Natural Gas","Energy"],
  "GC=F":["GC","Gold","Metals"],"SI=F":["SI","Silver","Metals"],"HG=F":["HG","Copper","Metals"],"ZC=F":["C","Corn","Agriculture"],"ZW=F":["W","Wheat","Agriculture"],
  "EURUSD=X":["EURUSD","Euro / US Dollar"],"GBPUSD=X":["GBPUSD","British Pound / US Dollar"],"JPY=X":["USDJPY","US Dollar / Japanese Yen"],
  "CNY=X":["USDCNY","US Dollar / Chinese Yuan"],"CAD=X":["USDCAD","US Dollar / Canadian Dollar"],"MXN=X":["USDMXN","US Dollar / Mexican Peso"],"DX-Y.NYB":["DXY","US Dollar Index"]
};
const UNITS = {"CL=F":"$/barrel","BZ=F":"$/barrel","NG=F":"$/MMBtu","GC=F":"$/troy oz","SI=F":"$/troy oz","HG=F":"$/lb","ZC=F":"¢/bushel","ZW=F":"¢/bushel"};
const ALIAS = {}; Object.entries(LABEL).forEach(([y,[a]])=>ALIAS[a]=y);
Object.assign(ALIAS,{SPX:"^GSPC",DOW:"^DJI",NASDAQ:"^IXIC",WTI:"CL=F",OIL:"CL=F",BRENT:"BZ=F",GOLD:"GC=F",SILVER:"SI=F",COPPER:"HG=F",CORN:"ZC=F",WHEAT:"ZW=F",FTSE:"^FTSE",NIKKEI:"^N225",DOLLAR:"DX-Y.NYB"});
const short = y => (LABEL[y]||[y.replace("^","")])[0];
const longName = y => (LABEL[y]&&LABEL[y][1]) || (D.q[y]&&D.q[y].name) || uniRow(y)?.name || y;

/* Screens, grouped the way the function-key bar shows them */
const CATS = [
  ["MARKETS",[["MON","Launchpad"],["WEI","World indices"],["IMAP","Heat map"],["W","Watchlist"],["N","News"],["FXC","Currencies"],["CMDTY","Commodities"],["CRYPTO","Crypto"]]],
  ["RESEARCH",[["EQS","Screener"],["ERN","Earnings"],["INS","Insider trades"],["FUND","Big funds (13F)"],["COMP","Compare"],["OMON","Options"],["CONG","Congress"]]],
  ["PORTFOLIO",[["PORT","Portfolio"],["TRADE","Trade ticket"],["ORD","Orders + audit log"],["CORR","Correlation"],["BOT","Trading bot"],["CONN","Connect accounts"]]],
  ["MACRO",[["ECO","Economy"],["CAL","Calendar"],["GC","Yield curve"],["REC","Recession watch"],["PECO","Your wallet"]]],
  ["SIGNALS",[["SIG","Signal scores"],["SCAN","Unusual activity"],["MOOD","Mood + sentiment"],["PRED","Prediction mkts"],["STUDY","Event studies"],["HIST","Stored history"]]],
  ["TOOLS",[["BT","Backtester"],["ALRT","Alerts"],["BRIEF","Phone brief"],["SET","Setup + security"],["HEALTH","Key + source health"],["HELP","All commands"]]]
];
const SCREENS = CATS.flatMap(([c,l])=>l.map(([k,n])=>[k,n,c]));
const SECFN = {GP:"Price chart",DES:"Description",FA:"Financials",CF:"SEC filings",N:"News",HP:"Price history",RV:"Peers",ERN:"Earnings",INS:"Insiders",HDS:"Holders",OMON:"Options",WHY:"Why it moved",SIG:"Signal score",BT:"Backtest"};
const FN_ALIAS = {WATCH:"W",TOP:"N",FX:"FXC",GLCO:"CMDTY",ECST:"ECO",LAUNCH:"MON",HOME:"MON",MENU:"BACK",SCREEN:"EQS",CALENDAR:"CAL",ECAL:"CAL",WALLET:"PECO",RISK:"REC",SENT:"MOOD",HEAT:"IMAP",PORTFOLIO:"PORT",ORDERS:"ORD",SETUP:"SET",SECURITY:"SET",STATUS:"HEALTH",KEYS:"HEALTH",CHECK:"HEALTH",HELPME:"HELP"};

/* ---------- state ---------- */
const S = {
  live:false, server:{}, priv:false,
  watch: store.get("watch", GROUPS.eq.slice()),
  alerts: store.get("alerts", []),
  explain: store.get("explain", true),
  cat: store.get("cat","MARKETS"),
  route:{fn:"MON"}, hist:[],
  range: store.get("range","6M"),
  studies: store.get("studies",{sma50:true,sma200:false,bb:false,vol:true,rsi:false,macd:false}),
  busy:{}, dirty:false, ticks:{}
};

/* ---------- formatting ---------- */
const nf = (v,dp)=> v==null||isNaN(v) ? "—" : Number(v).toLocaleString("en-US",{minimumFractionDigits:dp,maximumFractionDigits:dp});
function dpFor(v, sym){
  if(sym && /=X$/.test(sym)) return Math.abs(v)>=20?2:4;
  const a=Math.abs(v); return a>=1 ? 2 : a>=0.01 ? 4 : 6;
}
const px = (v,sym)=> nf(v, v==null?2:dpFor(v,sym));
function big(v){ if(v==null||isNaN(v)) return "—"; const a=Math.abs(v);
  if(a>=1e12) return (v/1e12).toFixed(2)+"T"; if(a>=1e9) return (v/1e9).toFixed(2)+"B"; if(a>=1e6) return (v/1e6).toFixed(2)+"M"; if(a>=1e3) return (v/1e3).toFixed(1)+"K"; return nf(v,0); }
const usd = v => v==null||isNaN(v) ? "—" : (v<0?"-$":"$")+nf(Math.abs(v),2);
const cls = v => v>0?"up":v<0?"dn":"fl";
const sgn = (v,dp=2)=> v==null||isNaN(v)?"—":(v>0?"+":"")+nf(v,dp);
const pctS = (v,dp=2) => v==null||isNaN(v)?"—":(v>0?"+":"")+nf(v,dp)+"%";
const agoText = t => { const a=ago(t); return a==="now"?"just now":a+" ago"; };
function ago(t){ const s=(Date.now()-t)/1000; if(s<60) return "now"; if(s<3600) return Math.floor(s/60)+"m"; if(s<86400) return Math.floor(s/3600)+"h"; return Math.floor(s/86400)+"d"; }
const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dstr = t => { const d=new Date(t); return d.getUTCDate()+" "+MON3[d.getUTCMonth()]+" "+d.getUTCFullYear(); };
const num = s => { if(s==null) return null; if(typeof s==="number") return s; const neg=/^\(.*\)$/.test(String(s).trim()); const v=parseFloat(String(s).replace(/[^0-9.\-]/g,"")); return isNaN(v)?null:(neg?-v:v); };
function getCss(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

/* ---------- quote helpers ---------- */
function Q(sym){
  const q = D.q[sym]; if(q) return q;
  const c = (D.crypto||[]).find(c=>c.sym+"-USD"===sym || c.sym===sym);
  if(c){ const n=c.spark.length, end=Date.parse(D.asof)/1000;
    return {name:c.name,px:c.px,prev:c.px/(1+(c.ch24||0)/100),cur:"USD",ex:"CoinGecko",grp:"crypto",
      s:c.spark.map((v,i)=>[end-(n-1-i)*4*3600,v]),vol:c.vol,crypto:true}; }
  const u = uniRow(sym);
  if(u) return {name:u.name,px:u.px,prev:u.chg!=null?u.px/(1+u.chg/100):null,grp:"eq",s:[],vol:u.vol,uni:true};
  return null;
}
const chg = q => q&&q.px!=null&&q.prev!=null ? q.px-q.prev : null;
const pch = q => q&&q.px!=null&&q.prev ? (q.px/q.prev-1)*100 : null;
let UNI = null;
function uniIndex(){
  if(UNI && UNI.n===D.universe.rows.length) return UNI;
  const c=D.universe.cols, map={};
  D.universe.rows.forEach(r=>{ const o={}; c.forEach((k,i)=>o[k]=r[i]); map[o.sym]=o; });
  UNI={n:D.universe.rows.length,map}; return UNI;
}
const uniRow = sym => uniIndex().map[sym] || null;
function resolve(tok){
  tok = String(tok).toUpperCase();
  if(ALIAS[tok]) return ALIAS[tok];
  if(D.q[tok]) return tok;
  if(D.q["^"+tok]) return "^"+tok;
  const c=(D.crypto||[]).find(c=>c.sym===tok); if(c) return (S.live||D.q[tok+"-USD"]) ? tok+"-USD" : c.sym;
  if(/^[A-Z]{6}$/.test(tok) && D.q[tok+"=X"]) return tok+"=X";
  if(uniRow(tok)) return tok;
  if(S.live && /^[A-Z0-9.\-=^]{1,12}$/.test(tok)) return tok;
  return null;
}
const isStock = sym => !!(D.sec[sym] || uniRow(sym) || (D.q[sym] && D.q[sym].grp==="eq" && !/[\^=]/.test(sym) && !/-USD$/.test(sym)));

/* ---------- math helpers used by many screens ---------- */
const closes = q => (q && q.s || []).map(x=>x[1]);
function sma(a,n){ const o=new Array(a.length).fill(null); let s=0; for(let i=0;i<a.length;i++){ s+=a[i]; if(i>=n) s-=a[i-n]; if(i>=n-1) o[i]=s/n; } return o; }
function ema(a,n){ const o=new Array(a.length).fill(null), k=2/(n+1); let e=null; for(let i=0;i<a.length;i++){ e = e==null ? a[i] : a[i]*k + e*(1-k); if(i>=n-1) o[i]=e; } return o; }
function rsi(a,n=14){ const o=new Array(a.length).fill(null); let g=0,l=0; for(let i=1;i<a.length;i++){ const d=a[i]-a[i-1]; const up=Math.max(d,0), dn=Math.max(-d,0);
    if(i<=n){ g+=up; l+=dn; if(i===n){ g/=n; l/=n; o[i]=l===0?100:100-100/(1+g/l); } } else { g=(g*(n-1)+up)/n; l=(l*(n-1)+dn)/n; o[i]=l===0?100:100-100/(1+g/l); } } return o; }
function stdev(a){ const m=a.reduce((x,y)=>x+y,0)/a.length; return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1)); }
function rets(a){ const o=[]; for(let i=1;i<a.length;i++) if(a[i-1]) o.push(a[i]/a[i-1]-1); return o; }
function corr(a,b){ const n=Math.min(a.length,b.length); if(n<5) return null; a=a.slice(-n); b=b.slice(-n); const ma=a.reduce((x,y)=>x+y,0)/n, mb=b.reduce((x,y)=>x+y,0)/n;
  let sab=0,sa=0,sb=0; for(let i=0;i<n;i++){ sab+=(a[i]-ma)*(b[i]-mb); sa+=(a[i]-ma)**2; sb+=(b[i]-mb)**2; } return sab/Math.sqrt(sa*sb||1); }
function alignReturns(syms, days){
  // daily returns on common dates for a set of symbols
  const maps = syms.map(s=>{ const m=new Map(); (Q(s)?.s||[]).forEach(([t,v])=>m.set(Math.floor(t/86400),v)); return m; });
  let keys=[...maps[0].keys()].filter(k=>maps.every(m=>m.has(k))).sort((a,b)=>a-b).slice(-(days+1));
  return syms.map((s,i)=>rets(keys.map(k=>maps[i].get(k))));
}
function maxDrawdown(a){ let pk=-Infinity, dd=0; a.forEach(v=>{ pk=Math.max(pk,v); dd=Math.min(dd, v/pk-1); }); return dd*100; }

/* ---------- small UI pieces ---------- */
function spark(vals, w=78, h=20){
  const v = vals.filter(x=>x!=null); if(v.length<2) return "";
  const mn=Math.min(...v), mx=Math.max(...v), r=mx-mn||1;
  const pts = v.map((y,i)=>(i/(v.length-1)*w).toFixed(1)+","+(h-2-(y-mn)/r*(h-4)).toFixed(1)).join(" ");
  const col = v[v.length-1]>=v[0] ? "var(--up)" : "var(--down)";
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${col}" stroke-width="1.3" points="${pts}"/></svg>`;
}
function panel(code, title, explain, body, o={}){
  return `<section class="pnl ${o.cls||""}"${o.id?` id="${o.id}"`:""}>
    <div class="ph">${code?`<button class="code" data-run="${esc(code)}">${esc(code)}</button>`:""}<h2>${esc(title)}</h2>${o.meta?`<span class="meta">${o.meta}</span>`:""}</div>
    ${explain?`<p class="ex">${explain}</p>`:""}<div class="bd">${body}</div></section>`;
}
function qrows(list, o={}){
  return list.map(sym=>{ const q=Q(sym); if(!q) return "";
    const c=chg(q), p=pch(q), ser=(q.s||[]).slice(-(o.sparkN||40)).map(x=>x[1]);
    const nm = o.longLabel ? longName(sym) : short(sym);
    const sub = o.sub ? `<span class="sub">${esc(o.sub==="unit"?(UNITS[sym]||""):longName(sym))}</span>`:"";
    return `<tr class="r" data-run="${esc(short(sym))} GP" data-sym="${esc(sym)}"><td><span class="${o.longLabel?"nm":"tk"}">${esc(nm)}</span>${sub}</td>
      <td class="pxc">${px(q.px,sym)}</td><td class="${cls(c)}">${sgn(c, dpFor(q.px||1,sym))}</td><td class="${cls(p)}">${pctS(p)}</td>${o.noSpark?"":`<td>${spark(ser)}</td>`}</tr>`; }).join("");
}
const qhead = (o={}) => `<tr><th>${o.first||"Security"}</th><th>Last</th><th>Net chg</th><th>% chg</th>${o.noSpark?"":"<th>Trend</th>"}</tr>`;
const table = (head, rows, o={}) => `<div class="scroll"${o.max?` style="max-height:${o.max}px;overflow-y:auto"`:""}><table${o.cls?` class="${o.cls}"`:""}>${head}${rows}</table></div>`;
const empty = t => `<div class="empty">${t}</div>`;
const chip = (t,k="") => `<span class="chip ${k}">${esc(t)}</span>`;
function toast(t, ms=3600){ const el=$("#toast"); el.textContent=t; el.hidden=false; clearTimeout(toast.h); toast.h=setTimeout(()=>el.hidden=true, ms); }
const needLive = what => `<div class="note"><b>Works on your hosted copy.</b> ${what} This preview has no server, so it shows how the screen works. Follow the setup steps to turn it on.</div>`;
const SAMPLE = t => `<span class="chip warn">SAMPLE</span>${t?` <span class="fl">${t}</span>`:""}`;

/* ---------- private server API (only on your secured hosted copy) ---------- */
async function api(path, opt={}){
  const o = {method:opt.method||"GET", headers:{"X-Openfloor":"1"}, cache:"no-store"};
  if(opt.body!==undefined){ o.headers["Content-Type"]="application/json"; o.body=JSON.stringify(opt.body); }
  const r = await fetch("/api/"+path, o);
  let j=null; try{ j=await r.json(); }catch(e){}
  if(!r.ok) throw new Error((j&&j.error)||("Request failed ("+r.status+")"));
  return j;
}
