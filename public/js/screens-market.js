/* Openfloor — market screens and the single-security screens. */
"use strict";
const V = {};

V.MON = () => {
  const spx = Q("^GSPC");
  return `<div class="grid">
   ${panel("SPX GP","S&P 500 — 6 months","The S&P 500 tracks 500 large US companies. It is the most watched gauge of the US stock market. Drag across the chart to read any day.",
       spx?chartSlot(spx.s.slice(-126),{h:330,label:"S&P 500 six month chart"}):"",{cls:"wide",meta:spx?`${px(spx.px)} <span class="${cls(pch(spx))}">${pctS(pch(spx))}</span>`:""})}
   ${panel("WEI","World indices","Each row is a basket of stocks for one market. Green means it rose since the last close.",
       table(qhead({first:"Index",noSpark:1}), qrows(GROUPS.indices.slice(0,8),{sub:1,noSpark:1})))}
   ${panel("W","Watchlist","Your own list of tickers. Tap any row to open its chart, company facts and filings.",
       table(qhead({first:"Ticker"}), qrows(S.watch.slice(0,9),{sub:1})) + `<div class="more"><button class="lnk" data-run="W">Edit watchlist →</button></div>`)}
   ${monPortfolio()}
   ${panel("N","Top headlines","Newest market and company headlines from free news feeds. Tap one to read it at the source.", newsList(D.news.slice(0,8)))}
   ${panel("IMAP","Sector heat map","Each box is a large US company, sized by market value and colored by today's move.", heatmapSlot(200))}
   ${panel("SCAN","Unusual activity","Things that stand out right now: big moves, volume spikes, insider buying, new filings and big swings in event odds.", scanList(scanEvents().slice(0,6)))}
   ${panel("GC","US Treasury yields","What the US government pays to borrow for different lengths of time. Higher yields mean costlier mortgages and loans.", curveBody(true))}
   ${panel("CRYPTO","Crypto","The largest cryptocurrencies by total value, priced in US dollars. These trade 24/7.", cryptoTable(D.crypto.slice(0,6), true))}
   ${panel("MOOD","Market mood","A 0–100 gauge built from five free market measures. Low means fear, high means greed.", moodMini())}
   ${panel("CAL","Coming up","The next earnings reports, Fed meetings and economic releases.", calList(calEvents().slice(0,7)))}
   ${panel("PRED","Prediction markets","Real-money crowd odds on future events. 65% means traders see roughly a 65 in 100 chance.", pmList(D.pm.slice(0,3)))}
  </div>`;
};
V.WEI = () => {
  const regions = {}; GROUPS.indices.forEach(s=>{ const r=(LABEL[s]||[])[2]||"Other"; (regions[r]=regions[r]||[]).push(s); });
  const rows = Object.entries(regions).map(([r,l])=>`<tr class="grp"><td colspan="5">${esc(r)}</td></tr>`+qrows(l,{sub:1,sparkN:60})).join("");
  return `<div class="grid">${panel("WEI","World equity indices","Stock market indices for the major regions, with the last three months of daily closes as a trend line. Tap a row for its full chart.", table(qhead({first:"Index"}), rows),{cls:"wide"})}
   ${panel("VIX GP","Volatility (VIX)","The VIX measures how much movement options traders expect in the S&P 500 over the next month. Under 15 is calm; over 30 is fear.", Q("^VIX")?chartSlot(Q("^VIX").s.slice(-180),{h:220,color:getCss("--amber")}):"")}</div>`;
};
V.W = () => {
  const rows = S.watch.map(sym=>{ const q=Q(sym); const c=chg(q),p=pch(q);
    return `<tr class="r" data-run="${esc(short(sym))} GP"><td><span class="tk">${esc(short(sym))}</span><span class="sub">${esc(q?longName(sym):"Loads on your hosted copy")}</span></td>
      <td class="pxc">${q?px(q.px,sym):"—"}</td><td class="${cls(c)}">${sgn(c)}</td><td class="${cls(p)}">${pctS(p)}</td>
      <td>${q?spark((q.s||[]).slice(-60).map(x=>x[1])):""}</td><td>${q&&q.hi52?rangeMini(q):""}</td>
      <td><button class="x" data-unwatch="${esc(sym)}" aria-label="Remove ${esc(sym)}">✕</button></td></tr>`; }).join("");
  const form = `<form class="form" id="addwatch"><label for="wsym">Add ticker<input id="wsym" placeholder="e.g. NVDA" autocapitalize="characters"></label><button class="btn" type="submit">ADD</button>
    <span class="fl" style="font-size:11px">${S.live?"Any US or global Yahoo ticker works. Your list syncs to all your devices.":"This preview holds data for the tickers shown plus every US stock in the screener."}</span></form>`;
  return panel("W","Watchlist","Tap a row for its chart; the bar shows where today's price sits between its one-year low and high.",
    form + table(`<tr><th>Ticker</th><th>Last</th><th>Net chg</th><th>% chg</th><th>3 months</th><th>52-week range</th><th></th></tr>`, rows));
};
function rangeMini(q){ const lo=q.lo52,hi=q.hi52; if(lo==null||hi==null) return ""; const p=Math.max(0,Math.min(1,(q.px-lo)/(hi-lo||1)));
  return `<div class="rng" style="width:110px;margin-left:auto"><div class="bar2"><i style="left:${(p*100).toFixed(1)}%"></i></div><div class="lbl"><span>${px(lo)}</span><span>${px(hi)}</span></div></div>`; }
function newsList(list){
  if(!list || !list.length) return empty("No headlines loaded yet.");
  return `<ul class="news">${list.map(n=>{ const t=Date.parse(n.date);
    return `<li><span class="tm">${isNaN(t)?"":ago(t)}</span><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a><span class="s">${esc(n.sym==="MKT"?"Markets":n.sym)} · ${esc(n.src||"")}</span></li>`; }).join("")}</ul>`;
}
V.N = () => {
  const syms = ["ALL","MKT",...new Set(D.news.map(n=>n.sym).filter(s=>s!=="MKT"))];
  const f = S.route.filter||"ALL"; const list = f==="ALL"?D.news:D.news.filter(n=>n.sym===f);
  return panel("N","News","Headlines pulled from free financial news feeds, newest first. Filter by company with the buttons. Articles open at the publisher's site.",
    `<div class="ranges" style="flex-wrap:wrap;padding-bottom:6px">${syms.map(s=>`<button class="${s===f?"on":""}" data-newsf="${esc(s)}">${esc(s==="MKT"?"MARKETS":s)}</button>`).join("")}</div>`+newsList(list.slice(0,60)));
};

/* ---------- FX / commodities / crypto / prediction markets ---------- */
V.FXC = () => {
  const r = D.ecb?.rates||{}; const cur=["USD","EUR","GBP","JPY","CAD","CNY","MXN","CHF"].filter(c=>c==="USD"||r[c]);
  const rate = c => c==="USD"?1:r[c];
  const m = `<div class="scroll"><table class="fxm"><tr><th>1 unit of ↓ in →</th>${cur.map(c=>`<th>${c}</th>`).join("")}</tr>${cur.map(a=>`<tr><td><span class="tk">${a}</span></td>${cur.map(b=>`<td class="${a===b?"diag":""}">${a===b?"—":nf(rate(b)/rate(a), rate(b)/rate(a)>=20?2:4)}</td>`).join("")}</tr>`).join("")}</table></div>`;
  const conv = `<form class="form" id="fxconv"><label for="fxamt">Amount<input id="fxamt" type="number" value="100" step="any"></label>
    <label for="fxfrom">From<select id="fxfrom">${cur.map(c=>`<option${c==="USD"?" selected":""}>${c}</option>`).join("")}</select></label>
    <label for="fxto">To<select id="fxto">${cur.map(c=>`<option${c==="EUR"?" selected":""}>${c}</option>`).join("")}</select></label>
    <div id="fxout" style="font:600 18px var(--mono);padding-bottom:4px"></div></form>`;
  return `<div class="grid">${panel("FXC","Spot currencies","Market quotes for major pairs. Tap a row for its chart.", table(qhead({first:"Pair"}), qrows(GROUPS.fx,{sub:1,sparkN:60})))}
    ${panel("FXC","Cross-rate matrix","Read across: how much of the top currency one unit of the left currency buys. Uses the European Central Bank's daily reference rates.", m + `<div class="ex" style="border:0">ECB reference date ${esc(D.ecb?.date||"—")}</div>`)}
    ${panel("FXC","Converter","Quick conversion using the ECB daily rates above.", conv)}</div>`;
};
V.CMDTY = () => {
  const by={}; GROUPS.cmdty.forEach(s=>{ const g=(LABEL[s]||[])[2]; (by[g]=by[g]||[]).push(s); });
  const rows = Object.entries(by).map(([g,l])=>`<tr class="grp"><td colspan="5">${esc(g)}</td></tr>`+qrows(l,{longLabel:1,sub:"unit",sparkN:60})).join("");
  return `<div class="grid">${panel("CMDTY","Commodity futures","Prices for the nearest-to-expire futures contract on each commodity.", table(qhead({first:"Contract"}), rows))}
    ${panel("CL GP","WTI crude oil","US benchmark oil price, dollars per barrel.", Q("CL=F")?chartSlot(Q("CL=F").s.slice(-180),{h:200}):"")}
    ${panel("GC GP","Gold","Price per troy ounce. Often bought as a safe haven when markets are nervous.", Q("GC=F")?chartSlot(Q("GC=F").s.slice(-180),{h:200}):"")}</div>`;
};
function cryptoTable(list, compact){
  const rows = list.map(c=>`<tr class="r" data-run="${esc(c.sym)} GP"><td><span class="tk">${esc(c.sym)}</span><span class="sub">${esc(c.name)}</span></td>
    <td class="pxc ${S.ticks[c.sym+"-USD"]&&Date.now()-S.ticks[c.sym+"-USD"]<1500?"flash":""}">${px(c.px)}</td><td class="${cls(c.ch24)}">${pctS(c.ch24)}</td>${compact?"":`<td class="${cls(c.ch7)}">${pctS(c.ch7)}</td><td>${big(c.mc)}</td><td>${big(c.vol)}</td>`}<td>${spark(c.spark)}</td></tr>`).join("");
  return table(`<tr><th>Coin</th><th>Price $</th><th>24h</th>${compact?"":"<th>7d</th><th>Mkt cap</th><th>24h vol</th>"}<th>7 days</th></tr>`, rows);
}
V.CRYPTO = () => {
  const tot = D.crypto.reduce((a,c)=>a+(c.mc||0),0), btc = D.crypto.find(c=>c.sym==="BTC");
  return `<div class="grid">${panel("CRYPTO","Cryptocurrencies","The largest coins by market cap (price × coins in circulation). Stablecoins pegged to $1 are left out."+(S.live?" Prices stream live from Coinbase.":""), cryptoTable(D.crypto,false),
    {cls:"wide",meta: btc?`BTC share of listed: ${nf(btc.mc/tot*100,1)}%`:""})}
    ${panel("MOOD","Funding and crowd mood","Funding is what traders holding bets with borrowed money pay each other every hour. Positive means most are betting on prices rising.", fundingTable(), {})}</div>`;
};
function pmList(list){
  if(!list||!list.length) return empty("No markets loaded.");
  return list.map(m=>{ const pairs=m.out.map((o,i)=>[o,m.p[i]]).sort((a,b)=>b[1]-a[1]).slice(0,2);
    return `<div class="pm"><div class="q"><a href="https://polymarket.com/market/${esc(m.slug)}" target="_blank" rel="noopener">${esc(m.q)}</a></div>
    ${pairs.map(([o,p])=>`<div class="o"><span>${esc(o)}</span><div class="tr"><i style="width:${(p*100).toFixed(1)}%"></i></div><span>${nf(p*100,1)}%</span></div>`).join("")}
    <div class="m">24h volume $${big(m.vol24)} · resolves ${m.end?dstr(Date.parse(m.end)):"—"}${m.ch1d?` · 1-day move <span class="${cls(m.ch1d)}">${sgn(m.ch1d*100,1)} pts</span>`:""}</div>
    <div class="more" style="padding:2px 0 0"><button class="lnk" data-run="HIST PM:${esc(m.id||"")}">Odds history →</button></div></div>`; }).join("");
}
V.PRED = () => panel("PRED","Prediction markets","Prices on Polymarket, where people bet real money on outcomes. A price of 72¢ for Yes means the crowd puts the chance near 72%. Crowds can be wrong; treat these as one signal, not a forecast. Your hosted copy records these odds every 15 minutes so you can chart how they change.", pmList(D.pm));

/* ---------- heat map ---------- */
function heatItems(n){
  const rows=Object.values(uniIndex().map).filter(r=>r.sector&&r.mcap&&r.chg!=null&&r.country==="United States").sort((a,b)=>b.mcap-a.mcap).slice(0,n);
  return rows.map(r=>({label:r.sym,value:r.mcap,chg:r.chg,group:r.sector,run:r.sym+" GP",sub:r.name}));
}
const heatmapSlot = (h, n=120) => { const it=heatItems(n); return it.length ? chartSlot(it,{h,custom:drawTreemap,label:"Sector heat map"}) : empty(S.live?"Loading market data…":"No screener data in this copy."); };
V.IMAP = () => {
  const by={}; Object.values(uniIndex().map).forEach(r=>{ if(!r.sector||!r.mcap||r.chg==null) return; const g=by[r.sector]=by[r.sector]||{m:0,w:0,n:0,up:0}; g.m+=r.mcap; g.w+=r.mcap*r.chg; g.n++; if(r.chg>0) g.up++; });
  const sec = Object.entries(by).map(([k,g])=>[k,g.w/g.m,g.n,g.up/g.n*100,g.m]).sort((a,b)=>b[1]-a[1]);
  const etfRows = Object.keys(SECTOR_ETF).filter(s=>Q(s)).map(s=>`<tr class="r" data-run="${s} GP"><td><span class="tk">${s}</span><span class="sub">${SECTOR_ETF[s]}</span></td><td class="pxc">${px(Q(s).px)}</td><td class="${cls(pch(Q(s)))}">${pctS(pch(Q(s)))}</td><td>${spark(closes(Q(s)).slice(-60))}</td></tr>`).join("");
  return `<div class="grid">${panel("IMAP","US market heat map","The 200 largest US companies. Box size is market value; color is today's move (green up, red down). Tap a box for that stock.", heatmapSlot(520,200),{cls:"wide",meta:`data ${D.at.universe?agoText(D.at.universe):"from snapshot"}`})}
    ${panel("IMAP","Sectors today","Average move for every listed US stock in each sector, weighted by size, and the share of stocks that rose.",
      table(`<tr><th>Sector</th><th>Move</th><th>Stocks</th><th>% rising</th></tr>`, sec.map(s=>`<tr><td>${esc(s[0])}</td><td class="${cls(s[1])}">${pctS(s[1])}</td><td>${s[2]}</td><td>${hbar(s[3],100,s[3]>=50?"var(--up)":"var(--down)")} ${nf(s[3],0)}%</td></tr>`).join("")))}
    ${panel("IMAP","Sector funds","The SPDR sector funds track each sector of the S&P 500.", table(`<tr><th>Fund</th><th>Last</th><th>% chg</th><th>3 months</th></tr>`, etfRows))}</div>`;
};

/* ---------- single security ---------- */
const RANGES = {"1D":-1,"1M":21,"3M":63,"6M":126,"1Y":252,"2Y":504,"5Y":0,"MAX":0};
function secTabs(sym, fn, q){
  const st=isStock(sym), list=Object.keys(SECFN).filter(k=> st || ["GP","HP","N","WHY","SIG","BT"].includes(k) || (k==="OMON"&&(sym==="SPY"||sym==="QQQ"||sym==="IWM")));
  return `<div class="tabs">${list.map(k=>`<button class="k ${k===fn?"on":""}" data-run="${esc(short(sym))} ${k}"><b>${k}</b><span>${SECFN[k]}</span></button>`).join("")}</div>`;
}
function secHead(sym, fn){
  const q=Q(sym); const c=chg(q), p=pch(q); const ticker=short(sym);
  const inPort=(PORT.positions||[]).filter(x=>x.sym===sym);
  return `<div class="sh"><div class="id"><div class="t">${esc(ticker)}</div><div class="n">${esc(longName(sym))}${q.ex?" · "+esc(q.ex):""}${UNITS[sym]?" · "+UNITS[sym]:""}</div></div>
    <div><div class="px ${S.ticks[sym]&&Date.now()-S.ticks[sym]<1500?"flash":""}">${px(q.px,sym)}</div><div class="chg ${cls(c)}">${sgn(c,dpFor(q.px||1,sym))}  ${pctS(p)}</div></div>
    ${q.hi52?`<div class="rng"><div class="lbl"><span>52-week range</span></div><div class="bar2"><i style="left:${(Math.max(0,Math.min(1,(q.px-q.lo52)/((q.hi52-q.lo52)||1)))*100).toFixed(1)}%"></i></div><div class="lbl"><span>${px(q.lo52,sym)}</span><span>${px(q.hi52,sym)}</span></div></div>`:""}
    <div class="kv">${q.dayhi?`<span>Day range</span><b>${px(q.daylo,sym)} – ${px(q.dayhi,sym)}</b>`:""}${q.vol?`<span>Volume</span><b>${big(q.vol)}</b>`:""}${q.t?`<span>Last trade</span><b>${new Date(q.t*1000).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"})}</b>`:""}${inPort.length?`<span>You hold</span><b>${nf(inPort.reduce((s,x)=>s+x.qty,0),4).replace(/\.?0+$/,"")} sh</b>`:""}</div>
    <div class="acts"><button class="btn" data-run="TRADE ${esc(ticker)}">TRADE</button><button class="btn ghost" data-watchtoggle="${esc(sym)}">${S.watch.includes(sym)?"− Watchlist":"+ Watchlist"}</button><button class="btn ghost" data-run="ALRT ${esc(ticker)}">ALERT</button></div>
    ${secTabs(sym, fn, q)}</div>`;
}
function secView(sym, fn){
  const q = Q(sym);
  if(!q) return empty(S.busy[sym]||S.busy["h:"+sym]?"Loading "+esc(sym)+"…":"No data for "+esc(sym)+".");
  if(S.live && (!q.s || q.s.length<30) && !q.crypto) ensureHistory([sym]).then(rerender);
  const sec = D.sec[sym]; const ticker=short(sym);
  let body="";
  const R = SECV[fn]; body = R ? R(sym,q,sec,ticker) : "";
  return `<div class="sec">${secHead(sym, fn)}${body}</div>`;
}
const SECV = {};
const STUDY_LIST = [["sma20","SMA 20"],["sma50","SMA 50"],["sma200","SMA 200"],["bb","Bollinger"],["vol","Volume"],["rsi","RSI"],["macd","MACD"]];
SECV.GP = (sym,q,sec,ticker) => {
  const avail = Object.keys(RANGES).filter(r=> r==="1D" ? (D.intraday[sym]||[]).length>3 : S.live || (RANGES[r]>0 && RANGES[r] <= (q.s||[]).length+5) || (q.crypto&&r==="1M"));
  let r = avail.includes(S.range)?S.range:(avail.includes("6M")?"6M":avail[avail.length-1]);
  let pts, ohlv;
  if(q.crypto){ pts=q.s; ohlv=null; }
  else if(r==="1D"){ pts=D.intraday[sym]; ohlv=null; }
  else if(RANGES[r]>0){ pts=q.s.slice(-RANGES[r]); ohlv=q.ohlv?q.ohlv.slice(-RANGES[r]):null; }
  else { pts=(q.long&&q.long[r])||null; ohlv=(q.longO&&q.longO[r])||null; if(!pts){ if(S.live) loadLong(sym,r); pts=q.s; ohlv=q.ohlv; } }
  // studies are computed on the full daily history then cut to the visible window
  const full = r==="1D"||q.crypto ? (pts||[]).map(x=>x[1]) : (RANGES[r]>0 ? closes(q) : (pts||[]).map(x=>x[1]));
  const cut = a => a.slice(-(pts||[]).length);
  const lines=[], panes=[];
  const st=S.studies;
  if(st.sma20) lines.push({vals:cut(sma(full,20)),color:"#c792ea",name:"SMA20"});
  if(st.sma50) lines.push({vals:cut(sma(full,50)),color:"#5cb8ff",name:"SMA50"});
  if(st.sma200) lines.push({vals:cut(sma(full,200)),color:"#ffa630",name:"SMA200"});
  if(st.bb){ const m=sma(full,20); const up=[],dn=[]; full.forEach((v,i)=>{ if(i<19){up.push(null);dn.push(null);return;} const s=stdev(full.slice(i-19,i+1)); up.push(m[i]+2*s); dn.push(m[i]-2*s); });
    lines.push({vals:cut(up),color:"#7f8c96",dash:[3,3],name:"BB+"}); lines.push({vals:cut(dn),color:"#7f8c96",dash:[3,3],name:"BB−"}); }
  // compare overlay
  const cmp=(S.route.cmp||[]).filter(s=>s!==sym);
  const pct = cmp.length>0;
  cmp.forEach((c,k)=>{ const cq=Q(c); if(!cq||!cq.s) return; const m=new Map(cq.s.map(([t,v])=>[Math.floor(t/86400),v]));
    lines.push({vals:(pts||[]).map(([t])=>m.get(Math.floor(t/86400))??null),color:["#ff7eb6","#7fdbca","#e6ebef","#f2cf1d","#c792ea"][k%5],name:short(c),w:1.5}); });
  if(st.vol && ohlv) panes.push({kind:"vol",label:"VOLUME",vals:ohlv.map(o=>o[2])});
  if(st.rsi) panes.push({kind:"rsi",label:"RSI 14",vals:cut(rsi(full,14)),guides:[30,70]});
  if(st.macd){ const e12=ema(full,12), e26=ema(full,26); const mac=full.map((_,i)=>e12[i]!=null&&e26[i]!=null?e12[i]-e26[i]:null); const sig=ema(mac.map(v=>v??0),9).map((v,i)=>mac[i]==null?null:v);
    panes.push({kind:"macd",label:"MACD 12/26/9",vals:cut(mac),extra:[cut(sig)],hist:cut(mac.map((v,i)=>v==null||sig[i]==null?null:v-sig[i])),guides:[0]}); }
  const h = 340 + panes.length*98;
  const studyBtns = STUDY_LIST.map(([k,n])=>`<button class="${st[k]?"on":""}" data-study="${k}">${n}</button>`).join("");
  return panel(ticker+" GP", (q.crypto?"7-day":r)+" price chart", "Drag or hover to read any day. Turn on moving averages (SMA), Bollinger bands, volume, RSI or MACD below. Add tickers to compare and the chart switches to % change."+(S.live?"":" This preview holds two years of history; your hosted copy adds 5-year and full history."),
    `<div class="ranges">${q.crypto?`<button class="on">7D</button>`:avail.map(x=>`<button class="${x===r?"on":""}" data-range="${x}">${x}</button>`).join("")}</div>
     <div class="ranges studies">${studyBtns}</div>
     <form class="form tight" id="cmpform"><label for="cmpin">Compare with<input id="cmpin" placeholder="MSFT, SPY" value="${esc(cmp.map(short).join(", "))}" autocapitalize="characters"></label><button class="btn ghost" type="submit">COMPARE</button>${cmp.length?`<button class="btn ghost" type="button" data-cmpclear="1">CLEAR</button>`:""}</form>`
    + chartSlot(pts,{h,daily:!q.crypto&&r!=="1D",fmt:v=>px(v,sym),label:ticker+" chart",lines,panes,pct,noArea:pct}));
};
SECV.HP = (sym,q) => {
  const s=q.s.slice(-30).reverse(), o=(q.ohlv||[]).slice(-30).reverse();
  return panel(short(sym)+" HP","Price history","The last 30 closing prices, newest first, with each day's high, low and volume.",
    table(`<tr><th>Date</th><th>Close</th><th>Chg</th><th>% chg</th>${o.length?"<th>High</th><th>Low</th><th>Volume</th>":""}</tr>`, s.map((x,i)=>{ const pv=s[i+1]; const d=pv?x[1]-pv[1]:null; const pp=pv?(x[1]/pv[1]-1)*100:null; const oo=o[i];
      return `<tr><td>${q.crypto?new Date(x[0]*1000).toUTCString().slice(5,22):dstr(x[0]*1000)}</td><td>${px(x[1],sym)}</td><td class="${cls(d)}">${sgn(d)}</td><td class="${cls(pp)}">${pctS(pp)}</td>${oo?`<td>${px(oo[0],sym)}</td><td>${px(oo[1],sym)}</td><td>${big(oo[2])}</td>`:""}</tr>`; }).join("")));
};
SECV.N = (sym) => {
  const list=D.news.filter(n=>n.sym===sym);
  if(S.live && !list.length && !S.busy["n:"+sym] && !S.busy["n0:"+sym]){ S.busy["n0:"+sym]=1; loadNews([sym]); }
  return panel(short(sym)+" N", short(sym)+" news","Recent headlines that mention this company, from free feeds.", newsList(list));
};
function needSec(sym){
  if(D.sec[sym]) return null;
  if(S.live){ if(!S.busy["sec:"+sym] && D.sec[sym]!==null) loadSec(sym); return `<div class="pnl">${empty(S.busy["sec:"+sym]?"Loading SEC data…":"SEC data is only available for US-listed companies.")}</div>`; }
  return `<div class="pnl">${empty("Company filings in this preview cover "+Object.keys(D.sec).join(", ")+". Your hosted copy loads any US-listed company from SEC EDGAR.")}</div>`;
}
const lastV = a => a&&a.length?a[a.length-1][1]:null;
SECV.DES = (sym,q) => {
  const miss=needSec(sym); if(miss) return miss; const sec=D.sec[sym];
  const eps=lastV(sec.eps), sh=sec.shares, mc= sh? q.px*sh : (uniRow(sym)?.mcap||null), pe = eps>0? q.px/eps : null;
  const revs=sec.rev, ni=lastV(sec.ni), rv=lastV(revs); const u=uniRow(sym);
  const kv = [["Legal name",sec.name],["Sector",u?.sector||"—"],["Industry",u?.industry||sec.sic||"—"],["Headquarters",sec.addr||"—"],["Incorporated in",sec.state||"—"],["Fiscal year ends",sec.fye?MON3[+sec.fye.slice(0,2)-1]+" "+(+sec.fye.slice(2)):"—"],["SEC CIK",sec.cik]];
  const st = [["Market cap ≈",mc?"$"+big(mc):"—"],["P/E (last fiscal yr)",pe?nf(pe,1)+"×":"—"],["Revenue (FY"+(revs.length?revs[revs.length-1][0]:"")+")",rv?"$"+big(rv):"—"],["Net income",ni!=null?"$"+big(ni):"—"],["Net margin",rv&&ni!=null?nf(ni/rv*100,1)+"%":"—"],["Diluted EPS",eps!=null?"$"+nf(eps,2):"—"]];
  const grid = a => `<div class="kv pad" style="grid-template-columns:minmax(0,max-content) 1fr;gap:6px 18px">${a.map(([k,v])=>`<span>${esc(k)}</span><b style="font-weight:500">${esc(v)}</b>`).join("")}</div>`;
  return `<div class="grid">${panel(short(sym)+" DES","Company profile","Basic facts from the company's own SEC registration and the exchange listing.", grid(kv)+`<div class="more"><a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sec.cik}" target="_blank" rel="noopener">Open on SEC EDGAR →</a></div>`)}
    ${panel(short(sym)+" FA","Key numbers","From the latest annual report (10-K). Market cap and P/E use today's price with last year's share count and earnings, so treat them as close estimates.", grid(st))}</div>`;
};
SECV.FA = (sym,q) => {
  const miss=needSec(sym); if(miss) return miss; const sec=D.sec[sym];
  const yrs=[...new Set([...sec.rev,...sec.ni,...sec.eps].map(x=>x[0]))].sort().slice(-5);
  const $b=v=>v==null?"—":"$"+big(v);
  if(!yrs.length) return panel(short(sym)+" FA","Annual financials","Figures from the company's 10-K filings.",empty("The SEC has no standard XBRL financials on file for this filer yet. Use CF to open its filings directly."));
  const get=(a,y)=>{ const f=a.find(x=>x[0]===y); return f?f[1]:null; };
  const row=(label,a,fmt,barMax)=>`<tr><td>${label}</td>${yrs.map(y=>{ const v=get(a,y); return `<td>${barMax&&v>0?`<div class="bars"><i style="width:${(v/barMax*46).toFixed(0)}px"></i>${fmt(v)}</div>`:fmt(v)}</td>`; }).join("")}</tr>`;
  const maxR=Math.max(...sec.rev.map(x=>x[1]),1), maxN=Math.max(...sec.ni.map(x=>x[1]),1);
  const margin=yrs.map(y=>{ const r=get(sec.rev,y), n=get(sec.ni,y); return [y, r&&n!=null?n/r*100:null]; });
  const growth=yrs.map((y,i)=>{ const r=get(sec.rev,y), p=i?get(sec.rev,yrs[i-1]):null; return [y, r&&p?(r/p-1)*100:null]; });
  return panel(short(sym)+" FA","Annual financials","Five fiscal years taken straight from the company's audited 10-K filings through the SEC's free XBRL data. B = billions, M = millions.",
    table(`<tr><th>Fiscal year</th>${yrs.map(y=>`<th>FY${y}</th>`).join("")}</tr>`,
      row("Revenue",sec.rev,$b,maxR)+row("Revenue growth",growth,v=>v==null?"—":`<span class="${cls(v)}">${pctS(v)}</span>`)+row("Net income",sec.ni,$b,maxN)+row("Net margin",margin,v=>v==null?"—":nf(v,1)+"%")+row("Diluted EPS",sec.eps,v=>v==null?"—":"$"+nf(v,2))+row("Cash",sec.cash||[],$b)+row("Long-term debt",sec.debt||[],$b)));
};
const FORMS={"10-K":"Annual report","10-Q":"Quarterly report","8-K":"Major event","4":"Insider trade","DEF 14A":"Proxy / shareholder vote","S-1":"New share offering","SC 13G":"Big holder (5%+)","SC 13G/A":"Big holder update","SCHEDULE 13G":"Big holder (5%+)","SCHEDULE 13G/A":"Big holder update","13F-HR":"Fund holdings","20-F":"Annual report (foreign)","6-K":"Report (foreign)","40-F":"Annual report (Canada)"};
const AIC = {};
SECV.CF = (sym) => {
  const miss=needSec(sym); if(miss) return miss; const sec=D.sec[sym];
  const ai = S.server.ai;
  return panel(short(sym)+" CF","SEC filings","Official documents the company filed with the SEC, newest first. Form 4 means an insider bought or sold shares."+(ai?" Tap SUMMARIZE for a plain-English summary written by the free AI on your Cloudflare account.":""),
    `<ul class="news">${sec.filings.map(f=>{ const k=f.url; const s=AIC[k];
      return `<li><span class="tm">${chip(f.form)}</span><div><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(FORMS[f.form]||f.desc||f.form)}${f.desc&&FORMS[f.form]&&f.desc!==f.form?" — "+esc(f.desc):""}</a>
        ${["10-K","10-Q","8-K","S-1","DEF 14A","20-F","6-K"].includes(f.form)?(ai?` <button class="lnk" data-summarize="${esc(k)}" data-form="${esc(f.form)}">${s?"":"SUMMARIZE"}</button>`:""):""}
        ${s?`<div class="aiout">${s==="…"?"Reading the filing…":esc(s)}</div>`:""}</div><span class="s">Filed ${esc(f.date)}</span></li>`; }).join("")}</ul>`
    + (ai?"":`<div class="note">AI summaries turn on once your hosted copy is set up (the AI is free on Cloudflare).</div>`));
};
async function summarizeFiling(url, form){
  AIC[url]="…"; rerender(true);
  try{
    const html=await (await P(url)).text(); const doc=new DOMParser().parseFromString(html,"text/html");
    doc.querySelectorAll("script,style,ix\\:header,[style*='display:none']").forEach(e=>e.remove());
    let t=(doc.body?.innerText||doc.body?.textContent||"").replace(/\s+/g," ");
    if(form==="10-K"||form==="10-Q"){ const i=t.search(/Management['’]s Discussion and Analysis of Financial Condition/i); const j=t.search(/Item\s*1A\.?\s*Risk Factors/i); const k=i>2000?i:(j>0?j:0); t=t.slice(k); }
    const r=await api("ai",{method:"POST",body:{task:"filing",form,text:t.slice(0,16000)}});
    AIC[url]=r.text||"No summary came back.";
  }catch(e){ AIC[url]="Could not summarize: "+e.message; }
  rerender(true);
}

/* WHY: explain today's move from free facts, and optionally ask the free AI to put it in words */
function whyFacts(sym){
  const q=Q(sym), p=pch(q), spy=pch(Q("SPY")); const u=uniRow(sym);
  const facts=[]; if(!q) return facts;
  facts.push(`${short(sym)} is ${p>=0?"up":"down"} ${nf(Math.abs(p),2)}% today at ${px(q.px,sym)}.`);
  if(spy!=null) facts.push(`The S&P 500 fund (SPY) is ${spy>=0?"up":"down"} ${nf(Math.abs(spy),2)}%, so the stock is ${Math.abs(p-spy)<0.5?"moving with the market":p>spy?"beating the market by "+nf(p-spy,2)+" points":"lagging the market by "+nf(spy-p,2)+" points"}.`);
  if(u){ const peers=Object.values(uniIndex().map).filter(r=>r.industry===u.industry&&r.sym!==sym&&r.chg!=null).sort((a,b)=>b.mcap-a.mcap).slice(0,8);
    if(peers.length){ const avg=peers.reduce((s,r)=>s+r.chg,0)/peers.length; facts.push(`Its industry peers (${peers.slice(0,4).map(r=>r.sym).join(", ")}…) are ${avg>=0?"up":"down"} ${nf(Math.abs(avg),2)}% on average.`); } }
  if(q.ohlv&&q.ohlv.length>21){ const v=q.vol||q.ohlv[q.ohlv.length-1][2], avg=q.ohlv.slice(-21,-1).reduce((s,o)=>s+o[2],0)/20; if(avg) facts.push(`Volume is ${nf(v/avg,1)}× its 20-day average${v/avg>1.8?" — unusually heavy":v/avg<0.6?" — unusually light":""}.`); }
  const nws=D.news.filter(n=>n.sym===sym && Date.now()-Date.parse(n.date)<36*3600e3).slice(0,6);
  if(nws.length) facts.push("Recent headlines: "+nws.map(n=>"“"+n.title+"”").join("; ")+".");
  const sec=D.sec[sym]; if(sec){ const f8=sec.filings.filter(f=>f.form==="8-K"&&Date.now()-Date.parse(f.date)<7*864e5); if(f8.length) facts.push(`The company filed ${f8.length} major-event report(s) (8-K) in the past week${f8[0].desc?": "+f8[0].desc:""}.`); }
  const e=D.earnings.find(x=>x.sym===sym); if(e){ const dd=Math.round((Date.parse(e.date)-Date.now())/864e5); facts.push(`Earnings are due ${dd<=0?"today":"in "+dd+" day(s)"} (${e.date}).`); }
  const ins=D.insiders[sym]; if(ins&&ins.rows){ const buys=ins.rows.filter(r=>/Buy/i.test(r.transactionType)&&Date.now()-Date.parse(r.lastDate)<30*864e5); if(buys.length) facts.push(`${buys.length} insider purchase(s) in the last 30 days.`); }
  return facts;
}
SECV.WHY = (sym) => {
  const f=whyFacts(sym); const k="why:"+sym+":"+new Date().toISOString().slice(0,10);
  if(S.live && !D.news.some(n=>n.sym===sym) && !S.busy["n0:"+sym]){ S.busy["n0:"+sym]=1; loadNews([sym]); }
  return panel(short(sym)+" WHY","Why is it moving?","These are the facts the terminal can see right now: the move versus the market and its industry, trading volume, today's headlines and filings, and upcoming earnings."+(S.server.ai?" Tap EXPLAIN to have the free AI write it up in two or three sentences.":""),
    `<ul class="facts">${f.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`+
    (S.server.ai?`<div class="pad"><button class="btn" data-why="${esc(sym)}">EXPLAIN</button>${AIC[k]?`<div class="aiout">${AIC[k]==="…"?"Thinking…":esc(AIC[k])}</div>`:""}</div>`:`<div class="note">On your hosted copy, the free AI can turn these facts into a short explanation.</div>`));
};
async function explainWhy(sym){
  const k="why:"+sym+":"+new Date().toISOString().slice(0,10); AIC[k]="…"; rerender(true);
  try{ const r=await api("ai",{method:"POST",body:{task:"why",text:whyFacts(sym).join("\n")}}); AIC[k]=r.text; }catch(e){ AIC[k]="Could not explain: "+e.message; }
  rerender(true);
}
