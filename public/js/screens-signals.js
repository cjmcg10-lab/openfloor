/* Openfloor — signals, unusual activity, mood, event studies, stored history. */
"use strict";
const HISTC = {};
const SIGNALS_CACHE = {stocks:[], crypto:[], at:0};
async function loadHist(series, days=365){
  if(!S.priv || S.busy["hist:"+series]) return; S.busy["hist:"+series]=1;
  try{ const r=await api(`hist?series=${encodeURIComponent(series)}&days=${days}`); HISTC[series]=r.points||[]; }catch(e){ HISTC[series]=[]; }
  delete S.busy["hist:"+series]; rerender();
}
function recordClient(series, v){
  if(!S.priv || v==null || isNaN(v)) return; const k="rec:"+series+":"+new Date().toISOString().slice(0,10);
  if(store.get(k)) return; store.set(k,1); api("record",{method:"POST",body:{series,v}}).catch(()=>{});
}

/* ---------- signal scores ---------- */
const POS_WORDS=/\b(beat|beats|surge|surges|soar|soars|jump|jumps|rall(y|ies)|record|upgrade[ds]?|raise[ds]?|strong|tops|boost|wins?|approval|growth)\b/i;
const NEG_WORDS=/\b(miss|misses|plunge[ds]?|tumble[ds]?|slump|downgrade[ds]?|cuts?|lawsuit|probe|investigation|falls?|drops?|weak|recall|layoffs?|warns?|fraud|delay|halt)\b/i;
function newsTone(sym){ const n=D.news.filter(x=>x.sym===sym && Date.now()-Date.parse(x.date)<4*864e5); let s=0; n.forEach(x=>{ if(POS_WORDS.test(x.title)) s++; if(NEG_WORDS.test(x.title)) s--; }); return {n:n.length, s}; }
function stockSignal(sym){
  const q=Q(sym); if(!q||!q.s||q.s.length<60) return null;
  const c=closes(q), last=c[c.length-1]; const s50=sma(c,50).pop(), s200=c.length>=200?sma(c,200).pop():null;
  const parts=[];
  const add=(name,score,why,w=1)=>parts.push({name,score,why,w});
  if(s200!=null) add("Trend", last>s50&&last>s200?2:last>s200?1:last>s50?-1:-2, `Price ${last>s200?"above":"below"} its 200-day average and ${last>s50?"above":"below"} its 50-day average.`, 1.5);
  else add("Trend", last>s50?1:-1, `Price ${last>s50?"above":"below"} its 50-day average.`, 1.5);
  const spy=closes(Q("SPY")); if(spy.length>63&&c.length>63){ const r=(last/c[c.length-64]-1)*100, rs=(spy[spy.length-1]/spy[spy.length-64]-1)*100, d=r-rs; add("Momentum", d>5?2:d>0?1:d<-5?-2:-1, `3-month return ${pctS(r,1)} vs the S&P 500's ${pctS(rs,1)}.`, 1.2); }
  const R=rsi(c,14).pop(); if(R!=null) add("RSI", R<30?1:R>70?-1:0, `RSI is ${nf(R,0)} (under 30 = oversold, over 70 = overbought).`, 0.6);
  const u=uniDerived().find(r=>r.sym===sym);
  if(u&&u.rev){ add("Business", u.growth>15&&u.margin>10?2:u.growth>0&&u.margin>0?1:(u.margin<0||u.growth<-5)?-1:0, `Sales growth ${u.growth!=null?pctS(u.growth,1):"n/a"}, net margin ${u.margin!=null?nf(u.margin,1)+"%":"n/a"}.`, 1);
    if(u.pe!=null) add("Valuation", u.pe<15?1:u.pe>45?-1:0, `P/E of ${nf(u.pe,1)}.`, 0.7); }
  const ins=D.insiders[sym]; if(ins&&ins.rows){ const cb=clusterBuys(ins.rows); add("Insiders", cb>=2?2:cb===1?1:0, cb?`${cb} insider(s) bought shares in the last 45 days.`:"No open-market insider buying lately.", 1); }
  const t=newsTone(sym); if(t.n) add("News tone", t.s>1?1:t.s<-1?-1:0, `${t.n} recent headline(s), tone ${t.s>0?"positive":t.s<0?"negative":"mixed"}.`, 0.6);
  const wsum=parts.reduce((s,p)=>s+p.w*2,0)||1; const score=Math.round(parts.reduce((s,p)=>s+p.score*p.w,0)/wsum*100);
  return {sym, score, parts, label: score>=40?"Strong":score>=15?"Positive":score<=-40?"Weak":score<=-15?"Negative":"Neutral"};
}
function cryptoSignal(sym){
  const q=Q(sym+"-USD"); const c=closes(q); if(c.length<60) return null; const last=c[c.length-1]; const s50=sma(c,50).pop(), s200=c.length>=200?sma(c,200).pop():null;
  const parts=[]; const add=(name,score,why,w=1)=>parts.push({name,score,why,w});
  add("Trend", s200!=null?(last>s50&&last>s200?2:last>s200?1:last>s50?-1:-2):(last>s50?1:-1), `Price ${s200!=null?(last>s200?"above":"below")+" its 200-day and ":""}${last>s50?"above":"below"} its 50-day average.`, 1.5);
  const btc=closes(Q("BTC-USD")); if(sym!=="BTC"&&btc.length>30){ const r=(last/c[c.length-31]-1)*100, rb=(btc[btc.length-1]/btc[btc.length-31]-1)*100; add("vs Bitcoin", r-rb>5?1:r-rb<-5?-1:0, `30-day return ${pctS(r,1)} vs Bitcoin's ${pctS(rb,1)}.`, 0.8); }
  const f=D.funding.find(x=>x.sym===sym); if(f){ const apr=f.funding*24*365*100; add("Funding", apr>30?-1:apr<0?1:0, `Funding ${nf(apr,1)}% a year — ${apr>30?"crowded with leveraged buyers":apr<0?"more traders betting on a fall":"normal"}.`, 0.8); }
  const fg=D.cfng[D.cfng.length-1]; if(fg) add("Fear & greed", fg[1]<25?1:fg[1]>75?-1:0, `Crypto fear & greed index at ${fg[1]} (${fg[2]}).`, 0.7);
  const wsum=parts.reduce((s,p)=>s+p.w*2,0)||1; const score=Math.round(parts.reduce((s,p)=>s+p.score*p.w,0)/wsum*100);
  return {sym, score, parts, label: score>=40?"Strong":score>=15?"Positive":score<=-40?"Weak":score<=-15?"Negative":"Neutral"};
}
const sigChip = s => chip(s.label+" "+(s.score>0?"+":"")+s.score, s.score>=15?"good":s.score<=-15?"bad":"");
function cryptoSignalTable(list){
  list = list&&list.length?list:["BTC","ETH","SOL","XRP","BNB"].map(cryptoSignal).filter(Boolean);
  if(!list.length) return empty("Needs crypto price history.");
  return table(`<tr><th>Coin</th><th>Score</th><th class="tl">Why</th></tr>`, list.map(s=>`<tr class="r" data-run="${esc(s.sym)} SIG"><td><span class="tk">${esc(s.sym)}</span></td><td>${sigChip(s)}</td><td style="white-space:normal" class="fl tl">${esc(s.parts.map(p=>p.name+" "+(p.score>0?"+":"")+p.score).join(" · "))}</td></tr>`).join(""));
}
function computeSignals(){
  const syms=[...new Set([...S.watch,...PORT.positions.map(p=>p.sym)])].filter(s=>isStock(s));
  SIGNALS_CACHE.stocks=syms.map(stockSignal).filter(Boolean);
  SIGNALS_CACHE.crypto=["BTC","ETH","SOL","XRP","BNB"].map(cryptoSignal).filter(Boolean);
  SIGNALS_CACHE.at=Date.now();
  if(S.priv && Date.now()-(store.get("sigpush",0))>15*60e3){ store.set("sigpush",Date.now()); api("signals",{method:"POST",body:{stocks:SIGNALS_CACHE.stocks.map(s=>({sym:s.sym,score:s.score,label:s.label})),crypto:SIGNALS_CACHE.crypto.map(s=>({sym:s.sym,score:s.score,label:s.label}))}}).catch(()=>{}); }
}
V.SIG = () => {
  if(S.live){ const need=[...S.watch,...PORT.positions.map(p=>p.sym),...GROUPS.crypto].filter(s=>!Q(s)?.s||Q(s).s.length<60); if(need.length) ensureHistory(need.slice(0,14)).then(rerender);
    S.watch.filter(isStock).filter(s=>!D.insiders[s]).slice(0,4).forEach(loadInsiders); if(!D.funding.length&&!S.busy.sent){ S.busy.sent=1; loadSentiment().then(()=>{delete S.busy.sent; rerender();}); } }
  computeSignals();
  const rows=SIGNALS_CACHE.stocks.sort((a,b)=>b.score-a.score).map(s=>`<tr class="r" data-run="${esc(s.sym)} SIG"><td><span class="tk">${esc(s.sym)}</span><span class="sub">${esc(longName(s.sym))}</span></td><td>${sigChip(s)}</td><td style="white-space:normal" class="fl tl">${s.parts.map(p=>`<span class="${p.score>0?"up":p.score<0?"dn":""}">${esc(p.name)} ${p.score>0?"+":""}${p.score}</span>`).join(" · ")}</td></tr>`).join("");
  return `<div class="grid">${panel("SIG","Signal scores: your stocks","One number from −100 to +100 that sums up trend, momentum versus the market, RSI, business growth and margins, valuation, insider buying and news tone. Each piece follows a simple, fixed rule you can see. This is a research summary, not advice to buy or sell.", rows?table(`<tr><th>Ticker</th><th>Score</th><th class="tl">Pieces</th></tr>`,rows):empty("Add stocks to your watchlist."),{cls:"wide"})}
    ${panel("SIG","Crypto signals","The same idea for the five largest coins, using trend, strength against Bitcoin, funding rates and the crypto fear & greed index. Your trading bot can read these.", cryptoSignalTable(SIGNALS_CACHE.crypto))}</div>`;
};
SECV.SIG = (sym) => {
  const base=sym.replace(/-USD$/,""); const s = /-USD$/.test(sym)||GROUPS.crypto.includes(base+"-USD") ? cryptoSignal(base) : stockSignal(sym);
  if(S.live && isStock(sym) && !D.insiders[sym]) loadInsiders(sym);
  if(!s) return panel(short(sym)+" SIG","Signal score","", empty("Needs at least three months of price history."));
  return panel(short(sym)+" SIG","Signal score: "+s.label,"Each row is one rule. Scores run from −2 to +2 and are weighted into the total. Research summary only.",
    `<div class="gauge"><div class="gv ${s.score>=15?"up":s.score<=-15?"dn":""}">${s.score>0?"+":""}${s.score}</div><div><b>${s.label}</b><div class="fl">−100 = every rule negative · +100 = every rule positive</div></div></div>`+
    table(`<tr><th>Rule</th><th>Score</th><th class="tl">Reason</th></tr>`, s.parts.map(p=>`<tr><td>${esc(p.name)}</td><td class="${cls(p.score)}">${p.score>0?"+":""}${p.score}</td><td style="white-space:normal" class="tl">${esc(p.why)}</td></tr>`).join("")));
};

/* ---------- unusual activity scanner ---------- */
let SERVER_EVENTS=[]; let SE_AT=0;
async function loadServerEvents(){ if(!S.priv||Date.now()-SE_AT<60e3) return; SE_AT=Date.now(); try{ SERVER_EVENTS=(await api("scan")).events||[]; rerender(); }catch(e){} }
function scanEvents(){
  const ev=[]; const now=Date.now();
  Object.values(uniIndex().map).filter(r=>r.mcap>2e9&&r.chg!=null&&Math.abs(r.chg)>=7).sort((a,b)=>Math.abs(b.chg)-Math.abs(a.chg)).slice(0,10)
    .forEach(r=>ev.push({kind:"MOVE",sym:r.sym,level:Math.abs(r.chg)>=12?2:1,text:`${r.sym} ${r.chg>0?"up":"down"} ${nf(Math.abs(r.chg),1)}% (${r.name}, $${big(r.mcap)} company)`,run:r.sym+" WHY"}));
  const mine=[...new Set([...S.watch,...PORT.positions.map(p=>p.sym)])];
  mine.forEach(s=>{ const q=Q(s); if(!q) return;
    if(q.ohlv&&q.ohlv.length>21){ const v=q.vol||0, avg=q.ohlv.slice(-21,-1).reduce((a,o)=>a+o[2],0)/20; if(avg&&v/avg>=2) ev.push({kind:"VOLUME",sym:s,level:1,text:`${short(s)} trading ${nf(v/avg,1)}× its normal volume`,run:short(s)+" WHY"}); }
    if(q.hi52&&q.px>=q.hi52*0.995) ev.push({kind:"HIGH",sym:s,level:1,text:`${short(s)} at a 52-week high (${px(q.px,s)})`,run:short(s)+" GP"});
    if(q.lo52&&q.px<=q.lo52*1.005) ev.push({kind:"LOW",sym:s,level:1,text:`${short(s)} at a 52-week low (${px(q.px,s)})`,run:short(s)+" GP"});
    const ins=D.insiders[s]; if(ins&&ins.rows){ const cb=clusterBuys(ins.rows); if(cb>=2) ev.push({kind:"INSIDER",sym:s,level:2,text:`${cb} ${short(s)} insiders bought shares in the last 45 days`,run:short(s)+" INS"}); }
    const sec=D.sec[s]; if(sec) sec.filings.filter(f=>f.form==="8-K"&&now-Date.parse(f.date)<3*864e5).slice(0,1).forEach(f=>ev.push({kind:"8-K",sym:s,level:1,text:`${short(s)} filed a major-event report: ${f.desc||"8-K"}`,run:short(s)+" CF",url:f.url}));
  });
  D.pm.filter(m=>m.ch1d&&Math.abs(m.ch1d)>=0.08).forEach(m=>ev.push({kind:"ODDS",level:Math.abs(m.ch1d)>=0.15?2:1,text:`Odds moved ${sgn(m.ch1d*100,0)} pts in a day: ${m.q}`,run:"PRED"}));
  D.reddit.filter(r=>r.prev&&r.mentions>=50&&r.mentions/r.prev>=3).slice(0,5).forEach(r=>ev.push({kind:"REDDIT",sym:r.sym,level:1,text:`${r.sym} Reddit mentions up ${nf(r.mentions/r.prev,1)}× in a day (${r.mentions})`,run:r.sym+" GP"}));
  D.funding.filter(f=>Math.abs(f.funding*24*365*100)>40).forEach(f=>ev.push({kind:"FUNDING",sym:f.sym,level:1,text:`${f.sym} perpetual funding at ${nf(f.funding*24*365*100,0)}% a year — ${f.funding>0?"crowded longs":"crowded shorts"}`,run:"MOOD"}));
  SERVER_EVENTS.forEach(e=>ev.push({...e, srv:true}));
  return ev.sort((a,b)=>(b.level||0)-(a.level||0));
}
function scanList(ev){
  if(!ev.length) return empty("Nothing unusual right now.");
  return `<ul class="news">${ev.map(e=>`<li><span class="tm">${chip(e.kind,e.level>=2?"bad":"warn")}</span><button class="lnk left" data-run="${esc(e.run||"")}">${esc(e.text)}</button><span class="s">${e.t?ago(e.t)+" ago · ":""}${e.srv?"found by your server":S.live?"live":"in this snapshot"}</span></li>`).join("")}</ul>`;
}
V.SCAN = () => {
  loadServerEvents();
  if(S.live){ if(!D.at.universe&&!S.busy.uni) loadUniverse(); if(!D.at.sent&&!S.busy.sent){ S.busy.sent=1; loadSentiment().then(()=>{delete S.busy.sent; rerender();}); } }
  return panel("SCAN","Unusual activity","One feed of everything out of the ordinary: big moves in companies worth $2B+, heavy volume in your stocks, 52-week highs and lows, clustered insider buying, fresh major-event filings, big swings in prediction-market odds, Reddit spikes and crowded crypto bets."+(S.priv?" Your server also scans every 15 minutes while you're away and can push the important ones to your phone.":""), scanList(scanEvents()));
};

/* ---------- market mood ---------- */
const clamp01 = v => Math.max(0,Math.min(1,v));
function moodParts(){
  const parts=[];
  const spx=closes(Q("^GSPC")); if(spx.length>125){ const d=(spx[spx.length-1]/sma(spx,125).pop()-1)*100; parts.push({name:"Momentum",v:clamp01((d+8)/16)*100,why:`S&P 500 is ${pctS(d,1)} vs its 125-day average.`}); }
  const vix=closes(Q("^VIX")); if(vix.length>50){ const r=vix[vix.length-1]/sma(vix,50).pop(); parts.push({name:"Volatility",v:clamp01((1.5-r)/0.75)*100,why:`VIX is ${nf(vix[vix.length-1],1)}, ${nf((r-1)*100,0)}% vs its 50-day average.`}); }
  const hy=D.fred.BAMLH0A0HYM2?.s||[]; if(hy.length>52){ const now=hy[hy.length-1][1], avg=hy.slice(-52).reduce((s,x)=>s+x[1],0)/52, d=now-avg; parts.push({name:"Credit",v:clamp01((1.5-d)/2.5)*100,why:`High-yield spread ${nf(now,2)}% vs ${nf(avg,2)}% one-year average.`}); }
  const spy=closes(Q("SPY")), tlt=closes(Q("TLT")); if(spy.length>21&&tlt.length>21){ const d=((spy[spy.length-1]/spy[spy.length-21])-(tlt[tlt.length-1]/tlt[tlt.length-21]))*100; parts.push({name:"Safe havens",v:clamp01((d+8)/16)*100,why:`Stocks ${d>=0?"beat":"trail"} Treasury bonds by ${nf(Math.abs(d),1)} pts over 20 days.`}); }
  const u=Object.values(uniIndex().map).filter(r=>r.chg!=null); if(u.length>200){ const up=u.filter(r=>r.chg>0).length/u.length*100; parts.push({name:"Breadth",v:clamp01((up-20)/60)*100,why:`${nf(up,0)}% of US stocks are up today.`}); }
  return parts;
}
const moodWord = v => v<25?"Extreme fear":v<45?"Fear":v<55?"Neutral":v<75?"Greed":"Extreme greed";
function moodScore(){ const p=moodParts(); return p.length? Math.round(p.reduce((s,x)=>s+x.v,0)/p.length) : null; }
function moodMini(){ const m=moodScore(), fg=D.cfng[D.cfng.length-1];
  return `<div class="tiles"><div><span>Stock market mood</span><b class="${m>=55?"up":m<45?"dn":""}">${m??"—"} <small>${m!=null?moodWord(m):""}</small></b></div><div><span>Crypto fear & greed</span><b class="${fg&&fg[1]>=55?"up":fg&&fg[1]<45?"dn":""}">${fg?fg[1]:"—"} <small>${fg?esc(fg[2]):""}</small></b></div></div>`; }
function fundingTable(){
  if(!D.funding.length) return empty(S.live?"Loading…":"No funding data.");
  return table(`<tr><th>Coin</th><th>Funding (yearly)</th><th>Open bets</th><th>24h volume</th></tr>`, D.funding.map(f=>{ const apr=f.funding*24*365*100; return `<tr><td><span class="tk">${esc(f.sym)}</span></td><td class="${apr>30?"dn":apr<0?"up":""}">${nf(apr,1)}%</td><td>$${big(f.oi)}</td><td>$${big(f.vol)}</td></tr>`; }).join(""))+`<div class="ex" style="border:0">From Hyperliquid perpetual futures. Very high funding means many traders are betting on a rise with borrowed money, which can unwind fast.</div>`;
}
V.MOOD = () => {
  if(S.live && !D.at.sent && !S.busy.sent){ S.busy.sent=1; loadSentiment().then(()=>{delete S.busy.sent; rerender();}); }
  if(S.live && !D.at.universe && !S.busy.uni) loadUniverse();
  const parts=moodParts(), m=moodScore(); recordClient("mood:stocks", m);
  const h=HISTC["mood:stocks"]; if(S.priv&&!h) loadHist("mood:stocks",365);
  return `<div class="grid">${panel("MOOD","Stock market mood","Our own fear-and-greed gauge from five free measures, each scaled 0–100: price momentum, volatility, credit spreads, stocks versus safe-haven bonds, and how many stocks are rising.",
      `<div class="gauge"><div class="gv ${m>=55?"up":m<45?"dn":""}">${m??"—"}</div><div><b>${m!=null?moodWord(m):""}</b><div class="fl">0 = extreme fear · 100 = extreme greed</div></div></div>`+
      table(`<tr><th>Measure</th><th>Reading</th><th class="tl">What it shows</th></tr>`, parts.map(p=>`<tr><td>${esc(p.name)}</td><td>${hbar(p.v,100,p.v>=55?"var(--up)":p.v<45?"var(--down)":"var(--amber)")} ${nf(p.v,0)}</td><td style="white-space:normal" class="fl tl">${esc(p.why)}</td></tr>`).join(""))
      +(h&&h.length>1?chartSlot(h.map(([t,v])=>[t/1000,v]),{h:160,noPct:1,fmt:v=>nf(v,0),color:getCss("--amber")}):""),{cls:"wide"})}
    ${panel("MOOD","Crypto fear & greed","A widely followed daily gauge for crypto (alternative.me), last 90 days.", D.cfng.length?chartSlot(D.cfng.map(x=>[x[0],x[1]]),{h:180,noPct:1,fmt:v=>nf(v,0),color:getCss("--amber")}):empty("No data."))}
    ${panel("MOOD","Crypto funding rates","", fundingTable())}
    ${panel("MOOD","Reddit chatter","Most-mentioned tickers on Reddit investing forums today.", redditTable(12))}</div>`;
};

/* ---------- event studies ---------- */
async function loadDaily10(sym){
  const key="d10:"+sym; if(S.busy[key]||D.q[sym]?.d10) return; S.busy[key]=1;
  try{ const j=await PJ(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1d`); const p=parseChart(sym,j,grpOf(sym)); D.q[sym]=D.q[sym]||p; D.q[sym].d10=p.s; }catch(e){}
  delete S.busy[key]; rerender();
}
function fwdStats(series, idxs, hz){
  const c=series.map(x=>x[1]); const res={}; hz.forEach(h=>{ const v=idxs.filter(i=>i+h<c.length).map(i=>(c[i+h]/c[i]-1)*100); res[h]={avg:v.length?v.reduce((a,b)=>a+b,0)/v.length:null,pos:v.length?v.filter(x=>x>0).length/v.length*100:null,n:v.length}; }); return res;
}
V.STUDY = () => {
  const sym = S.route.sym2 || "^GSPC"; const thr = +(S.route.thr||2);
  if(S.live) loadDaily10(sym==="^GSPC"?"^GSPC":sym);
  const q=Q(sym); const ser=(q&&(q.d10||q.s))||[];
  const c=ser.map(x=>x[1]); const dn=[], all=[];
  for(let i=1;i<c.length;i++){ all.push(i); if((c[i]/c[i-1]-1)*100<=-thr) dn.push(i); }
  const H=[1,5,20,60]; const A=fwdStats(ser,dn,H), B=fwdStats(ser,all,H);
  const t1 = table(`<tr><th>Hold for</th><th>Avg after a −${thr}% day</th><th>% of times higher</th><th>Avg on any day</th><th>% higher (any day)</th></tr>`,
    H.map(h=>`<tr><td>${h===1?"1 day":h+" days"}</td><td class="${cls(A[h].avg)}">${pctS(A[h].avg)}</td><td>${A[h].pos!=null?nf(A[h].pos,0)+"%":"—"}</td><td class="${cls(B[h].avg)}">${pctS(B[h].avg)}</td><td>${B[h].pos!=null?nf(B[h].pos,0)+"%":"—"}</td></tr>`).join(""));
  // seasonality
  const byM=Array.from({length:12},()=>[]); const mm=new Map();
  ser.forEach(([t,v])=>{ const d=new Date(t*1000); mm.set(d.getUTCFullYear()*12+d.getUTCMonth(), v); });
  const keys=[...mm.keys()].sort((a,b)=>a-b); for(let i=1;i<keys.length;i++) if(keys[i]-keys[i-1]===1) byM[keys[i]%12].push((mm.get(keys[i])/mm.get(keys[i-1])-1)*100);
  const mavg=byM.map(a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null); const mx=Math.max(...mavg.map(v=>Math.abs(v||0)),0.5);
  const t2 = table(`<tr><th>Month</th><th>Average return</th><th>Years</th><th>% up</th></tr>`, byM.map((a,i)=>`<tr><td>${MON3[i]}</td><td>${hbar(mavg[i]||0,mx,(mavg[i]||0)>=0?"var(--up)":"var(--down)")} <span class="${cls(mavg[i])}">${pctS(mavg[i])}</span></td><td>${a.length}</td><td>${a.length?nf(a.filter(x=>x>0).length/a.length*100,0)+"%":"—"}</td></tr>`).join(""));
  // release days
  let t3 = S.server.fred ? empty("Loading report dates…") : `<div class="note">Add a free FRED key (setup step 9) to compare stock moves on CPI and jobs-report days.</div>`;
  if(S.server.fred){ const rel=(D.pastRel||{}); if(!rel[10]){ loadPastReleases(10).then(rerender); loadPastReleases(50).then(rerender); }
    else { const dayMap=new Map(ser.map(([t,v],i)=>[new Date(t*1000).toISOString().slice(0,10),i])); const absAvg=ids=>{ const v=ids.filter(i=>i>0).map(i=>Math.abs(c[i]/c[i-1]-1)*100); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; };
      const rows=[[10,"CPI inflation report"],[50,"Jobs report"]].map(([id,n])=>{ const ids=(rel[id]||[]).map(d=>dayMap.get(d)).filter(i=>i!=null); return `<tr><td>${n}</td><td>${ids.length}</td><td>${nf(absAvg(ids),2)}%</td></tr>`; }).join("");
      t3=table(`<tr><th>Day type</th><th>Days found</th><th>Average size of move</th></tr>`, rows+`<tr><td>Any trading day</td><td>${all.length}</td><td>${nf(absAvg(all),2)}%</td></tr>`); } }
  return `<div class="grid">${panel("STUDY","What happens after a big drop?",`Every day ${short(sym)} fell ${thr}% or more in the data loaded (${ser.length?dstr(ser[0][0]*1000)+" to "+dstr(ser[ser.length-1][0]*1000):"none"}), and what it did next, compared with an ordinary day. Past patterns may not repeat.`,
      `<form class="form tight" id="studyform"><label for="st_sym">Ticker<input id="st_sym" value="${esc(short(sym))}" autocapitalize="characters"></label><label for="st_thr">Drop of at least %<input id="st_thr" type="number" step="0.5" value="${thr}"></label><button class="btn ghost" type="submit">RUN</button></form>`+
      `<div class="ex" style="border:0">${dn.length} drop days found.</div>`+t1,{cls:"wide"})}
    ${panel("STUDY","Month-by-month pattern","Average return in each calendar month.", t2)}
    ${panel("STUDY","Moves on economic report days","How much the market moves on report days versus ordinary days.", t3)}</div>`;
};

/* ---------- stored history ---------- */
let SERIES_LIST=null;
V.HIST = () => {
  const want=S.route.filter;
  if(!S.priv) return panel("HIST","Stored history","Your hosted copy saves numbers no free site keeps for you: prediction-market odds every 15 minutes, crypto funding, the mood and recession scores, your portfolio's value each evening and your signal scores. Pick any series to chart it.",
    needLive("History is kept in your free Cloudflare database (5 GB).")+(D.cfng.length?chartSlot(D.cfng.map(x=>[x[0],x[1]]),{h:180,noPct:1,fmt:v=>nf(v,0),color:getCss("--amber")}):""));
  if(!SERIES_LIST){ SERIES_LIST=[]; api("series").then(r=>{ SERIES_LIST=r.series||[]; rerender(); }).catch(()=>{}); }
  const sel=want||(SERIES_LIST[0]&&SERIES_LIST[0].series);
  if(sel && !HISTC[sel]) loadHist(sel, 365);
  const pts=HISTC[sel]||[];
  const nameOf=s=>{ if(s.startsWith("pm:")){ const m=D.pm.find(x=>String(x.id)===s.slice(3)); return "Odds: "+(m?m.q:s.slice(3)); } return ({"mood:stocks":"Stock market mood","rec:score":"Recession score","port:value":"Portfolio value","cfng":"Crypto fear & greed"}[s]) || s.replace(/^funding:/,"Funding: ").replace(/^sig:/,"Signal: "); };
  return panel("HIST","Stored history","Numbers your server records on its own schedule.",
    `<div class="ranges" style="flex-wrap:wrap">${(SERIES_LIST||[]).slice(0,40).map(s=>`<button class="${s.series===sel?"on":""}" data-newsf="${esc(s.series)}">${esc(nameOf(s.series).slice(0,40))}</button>`).join("")}</div>`+
    (pts.length>1?chartSlot(pts.map(([t,v])=>[t/1000, sel.startsWith("pm:")?v*100:v]),{h:300,noPct:1,daily:false,fmt:v=>sel.startsWith("pm:")?nf(v,1)+"%":nf(v,2),color:getCss("--amber")}):empty(sel?"Not enough points yet — check back after a few runs.":"Nothing recorded yet. Your server starts recording within 15 minutes of setup.")));
};
