/* Openfloor — backtester, alerts, phone brief, setup + security, help. */
"use strict";
/* ---------- backtester ---------- */
S.bt = store.get("bt",{sym:"SPY",strat:"sma",fast:50,slow:200,lo:30,hi:70,n:55,m:20,fee:5,cap:10000});
const STRATS = {sma:"Moving-average crossover",rsi:"Buy dips (RSI)",brk:"Breakout",hold:"Buy and hold"};
function backtest(ser, p){
  const c=ser.map(x=>x[1]), n=c.length; const want=new Array(n).fill(0);
  if(p.strat==="sma"){ const f=sma(c,+p.fast), s=sma(c,+p.slow); for(let i=0;i<n;i++) want[i]= f[i]!=null&&s[i]!=null&&f[i]>s[i] ? 1 : 0; }
  else if(p.strat==="rsi"){ const r=rsi(c,14); let pos=0; for(let i=0;i<n;i++){ if(r[i]!=null){ if(!pos&&r[i]<+p.lo) pos=1; else if(pos&&r[i]>+p.hi) pos=0; } want[i]=pos; } }
  else if(p.strat==="brk"){ let pos=0; for(let i=0;i<n;i++){ if(i>=+p.n){ const hh=Math.max(...c.slice(i-+p.n,i)), ll=Math.min(...c.slice(i-+p.m,i)); if(!pos&&c[i]>hh) pos=1; else if(pos&&c[i]<ll) pos=0; } want[i]=pos; } }
  else want.fill(1);
  const cost=(+p.fee||0)/1e4; let cash=+p.cap, sh=0, pos=0; const eq=[], trades=[], marks=[]; let entry=null, inMkt=0;
  for(let i=0;i<n;i++){
    // act on yesterday's signal at today's close (no peeking ahead)
    const w = i>0 ? want[i-1] : 0;
    if(w!==pos){ if(w===1){ sh=cash*(1-cost)/c[i]; cash=0; entry={i,px:c[i]}; marks.push({i,side:"buy"}); } else { cash=sh*c[i]*(1-cost); trades.push({in:entry,out:{i,px:c[i]},ret:(c[i]/entry.px*(1-cost)**2-1)*100}); sh=0; marks.push({i,side:"sell"}); entry=null; } pos=w; }
    if(pos) inMkt++; eq.push(cash+sh*c[i]);
  }
  if(pos&&entry) trades.push({in:entry,out:{i:n-1,px:c[n-1]},ret:(c[n-1]/entry.px*(1-cost)-1)*100,open:true});
  const yrs=(ser[n-1][0]-ser[0][0])/(365.25*86400);
  const st=a=>({ret:(a[a.length-1]/a[0]-1)*100, cagr:(Math.pow(a[a.length-1]/a[0],1/Math.max(yrs,0.01))-1)*100, dd:maxDrawdown(a), vol:stdev(rets(a))*Math.sqrt(252)*100});
  const bh=c.map(v=>+p.cap*v/c[0]);
  return {eq, bh, trades, marks, s:st(eq), b:st(bh), wins:trades.filter(t=>t.ret>0).length, time:inMkt/n*100, yrs};
}
V.BT = () => {
  const p=S.bt; const sym=resolve(p.sym)||p.sym;
  if(S.live) loadDaily10(sym);
  const q=Q(sym); const ser=(q&&(q.d10||q.s))||[];
  const form=`<form class="form" id="btform"><label for="bt_sym">Ticker<input id="bt_sym" value="${esc(p.sym)}" autocapitalize="characters"></label>
    <label for="bt_strat">Strategy<select id="bt_strat">${Object.entries(STRATS).map(([k,v])=>`<option value="${k}"${k===p.strat?" selected":""}>${v}</option>`).join("")}</select></label>
    ${p.strat==="sma"?`<label for="bt_fast">Fast average (days)<input id="bt_fast" type="number" value="${p.fast}"></label><label for="bt_slow">Slow average (days)<input id="bt_slow" type="number" value="${p.slow}"></label>`:""}
    ${p.strat==="rsi"?`<label for="bt_lo">Buy when RSI below<input id="bt_lo" type="number" value="${p.lo}"></label><label for="bt_hi">Sell when RSI above<input id="bt_hi" type="number" value="${p.hi}"></label>`:""}
    ${p.strat==="brk"?`<label for="bt_n">Buy at a new high of (days)<input id="bt_n" type="number" value="${p.n}"></label><label for="bt_m">Sell at a new low of (days)<input id="bt_m" type="number" value="${p.m}"></label>`:""}
    <label for="bt_fee">Cost per trade (bps)<input id="bt_fee" type="number" step="any" value="${p.fee}"></label><label for="bt_cap">Starting money $<input id="bt_cap" type="number" value="${p.cap}"></label>
    <button class="btn" type="submit">RUN BACKTEST</button></form>`;
  const explain={sma:"Own the stock while the fast moving average is above the slow one; sit in cash otherwise.",rsi:"Buy after a sharp dip (low RSI) and sell after a strong run (high RSI).",brk:"Buy when the price breaks above its recent high; sell when it falls below its recent low.",hold:"Buy on day one and never sell. Every other strategy should be judged against this."}[p.strat];
  if(ser.length<60) return panel("BT","Backtester","Test a simple trading rule on past prices.", form+empty(S.live?"Loading 10 years of daily prices…":"No price history for this ticker in the preview."));
  const r=backtest(ser,p);
  const stat=(k,f)=>`<td>${f(r.s[k])}</td><td>${f(r.b[k])}</td>`;
  const t=table(`<tr><th></th><th>Strategy</th><th>Buy and hold</th></tr>`,
    `<tr><td>Total return</td>${stat("ret",v=>`<span class="${cls(v)}">${pctS(v,1)}</span>`)}</tr><tr><td>Per year</td>${stat("cagr",v=>pctS(v,1))}</tr><tr><td>Worst drop from a peak</td>${stat("dd",v=>`<span class="dn">${nf(v,1)}%</span>`)}</tr><tr><td>Volatility</td>${stat("vol",v=>nf(v,1)+"%")}</tr>
     <tr><td>Ending value</td><td>${usd(r.eq[r.eq.length-1])}</td><td>${usd(r.bh[r.bh.length-1])}</td></tr><tr><td>Trades</td><td>${r.trades.length} (${r.trades.length?nf(r.wins/r.trades.length*100,0):0}% winners)</td><td>1</td></tr><tr><td>Time invested</td><td>${nf(r.time,0)}%</td><td>100%</td></tr>`);
  const pts=ser.map((x,i)=>[x[0],r.eq[i]]);
  const trades=table(`<tr><th>Bought</th><th>Price</th><th>Sold</th><th>Price</th><th>Return</th></tr>`, r.trades.slice(-15).reverse().map(tr=>`<tr><td>${dstr(ser[tr.in.i][0]*1000)}</td><td>${px(tr.in.px)}</td><td>${tr.open?"still open":dstr(ser[tr.out.i][0]*1000)}</td><td>${px(tr.out.px)}</td><td class="${cls(tr.ret)}">${pctS(tr.ret,1)}</td></tr>`).join(""));
  return `<div class="grid">${panel("BT","Backtest: "+STRATS[p.strat]+" on "+short(sym), explain+` Tested on ${nf(r.yrs,1)} years of daily closes. Trades happen at the next day's close, with your cost per trade taken off. Past results do not predict future ones.`,
      form+chartSlot(pts,{h:300,lines:[{vals:r.bh,color:"#7f8c96",name:"Buy & hold",dash:[4,3]}],marks:r.marks.length<120?r.marks:[],fmt:v=>"$"+big(v),noPct:1,color:getCss("--amber"),label:"Backtest equity"}),{cls:"wide"})}
    ${panel("BT","Results","", t)}${panel("BT","Recent trades","", r.trades.length?trades:empty("No trades — the rule never triggered."))}</div>`;
};
SECV.BT = (sym) => { S.bt.sym=short(sym); return V.BT(); };

/* ---------- alerts (server-side when available, so they push to your phone) ---------- */
let SRV_ALERTS=null;
async function loadAlerts(){ if(!S.priv) return; try{ SRV_ALERTS=(await api("alerts")).alerts||[]; }catch(e){ SRV_ALERTS=[]; } rerender(); }
function allAlerts(){ return S.priv ? (SRV_ALERTS||[]) : S.alerts; }
V.ALRT = () => {
  if(S.priv && SRV_ALERTS==null) loadAlerts();
  const pre=S.route.filter||"";
  const rows = allAlerts().map((a,i)=>{ const q=Q(a.sym); return `<tr><td><span class="tk">${esc(short(a.sym))}</span></td><td>${a.op===">"?"rises above":"falls below"} ${px(a.px,a.sym)}</td><td>${q?px(q.px,a.sym):"—"}</td><td>${a.hit?`<span class="up">TRIGGERED ${a.hitAt?new Date(a.hitAt).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):""}</span>`:`<span class="fl">Watching</span>`}</td><td><button class="x" data-unalert="${S.priv?esc(a.id):i}" aria-label="Delete alert">✕</button></td></tr>`; }).join("");
  return panel("ALRT","Price alerts", S.priv ? "Alerts are saved on your server, which checks prices every minute — even when this page is closed — and sends a notification to your phone." : "Set a price and the terminal flags it when the market crosses it. On your hosted copy, alerts are checked every minute on the server and pushed to your phone.",
   `<form class="form" id="addalert"><label for="asym">Ticker<input id="asym" placeholder="AAPL" value="${esc(pre)}" autocapitalize="characters"></label>
    <label for="aop">When it<select id="aop"><option value=">">rises above</option><option value="<">falls below</option></select></label>
    <label for="apx">Price<input id="apx" type="number" step="any" placeholder="350"></label><button class="btn" type="submit">SET ALERT</button></form>`
   + (rows?table(`<tr><th>Ticker</th><th>Condition</th><th>Now</th><th>Status</th><th></th></tr>`,rows):empty("No alerts yet. Example: AAPL, rises above, 350.")));
};
function checkAlertsLocal(){
  if(S.priv) return; let fired=false; S.alerts.forEach(a=>{ if(a.hit) return; const q=Q(a.sym); if(!q||q.px==null) return;
    if((a.op===">"&&q.px>a.px)||(a.op==="<"&&q.px<a.px)){ a.hit=true; a.hitAt=Date.now(); fired=true; } });
  if(fired){ store.set("alerts",S.alerts); toast("A price alert just triggered. Open ALRT to see it."); }
}
function alertBanner(){ const h=allAlerts().filter(a=>a.hit&&(!a.hitAt||Date.now()-a.hitAt<864e5)); if(!h.length) return "";
  return `<div class="alertbar"><b>ALERT</b>${h.slice(0,4).map(a=>`<span>${esc(short(a.sym))} ${a.op===">"?"above":"below"} ${px(a.px,a.sym)}</span>`).join(" · ")}<button class="lnk" data-run="ALRT">Manage →</button></div>`; }

/* ---------- phone brief ---------- */
function composeBriefLocal(){
  const L=[]; const f=s=>{ const q=Q(s); return q?`${short(s)} ${px(q.px,s)} (${pctS(pch(q),1)})`:null; };
  L.push("Markets: "+["^GSPC","^IXIC","^RUT","^VIX"].map(f).filter(Boolean).join(" · "));
  L.push("Rates & oil: "+[`10Y ${nf(lastV(D.fred.DGS10?.s),2)}%`, f("CL=F"), f("GC=F"), f("BTC-USD")||(D.crypto[0]?`BTC ${px(D.crypto[0].px)}`:null)].filter(Boolean).join(" · "));
  const mv=S.watch.map(s=>[s,pch(Q(s))]).filter(x=>x[1]!=null).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,4);
  if(mv.length) L.push("Your movers: "+mv.map(([s,p])=>`${short(s)} ${pctS(p,1)}`).join(", "));
  const today=new Date().toISOString().slice(0,10); const er=D.earnings.filter(e=>e.date===today&&S.watch.includes(e.sym)); if(er.length) L.push("Earnings today: "+er.map(e=>e.sym).join(", "));
  const ev=calEvents().filter(e=>e.kind!=="ERN").slice(0,2); if(ev.length) L.push("Coming up: "+ev.map(e=>`${e.title} ${e.date.slice(5)}`).join("; "));
  const m=moodScore(), r=recScore(); L.push(`Mood ${m??"—"} (${m!=null?moodWord(m):""}) · Recession score ${r??"—"}/100`);
  const sc=scanEvents().slice(0,3); if(sc.length) L.push("Unusual: "+sc.map(e=>e.text).join("; "));
  return L.join("\n");
}
let BRIEF={text:null,settings:null};
V.BRIEF = () => {
  if(S.priv && !BRIEF.settings){ BRIEF.settings={}; api("brief").then(r=>{ BRIEF=r; rerender(); }).catch(e=>{ BRIEF={err:e.message,settings:{}}; rerender(); }); }
  const st=BRIEF.settings||{};
  const opt=(k,label,def)=>`<label class="cb" for="bf_${k}"><input id="bf_${k}" type="checkbox" data-briefset="${k}"${(st[k]??def)?" checked":""}${S.priv?"":" disabled"}> ${label}</label>`;
  return `<div class="grid">${panel("BRIEF","Phone notifications","Your server sends these through ntfy, a free notification app for iPhone and Android, using a private topic name only you know. Nothing personal is included unless you turn on the portfolio line.",
      `<div class="form" style="flex-direction:column;align-items:flex-start;gap:10px">${opt("morning","Morning brief at 8:45 am Eastern (weekdays)",true)}${opt("evening","Market wrap at 4:20 pm Eastern (weekdays)",true)}${opt("alerts","Price alerts the moment they trigger",true)}${opt("scan","Important unusual activity in your stocks (checked every 15 min)",true)}${opt("portfolio","Include my portfolio's value and daily change",false)}
       <div><button class="btn" data-notifytest="1"${S.priv&&S.server.ntfy?"":" disabled"}>SEND A TEST NOTIFICATION</button> ${S.server.ntfy?"":`<span class="fl">Needs the NTFY_TOPIC setting (setup step 10).</span>`}</div></div>`)}
    ${panel("BRIEF","Preview","What the next brief would say right now.", `<pre class="brief">${esc(BRIEF.text||composeBriefLocal())}</pre>`)}</div>`;
};

/* ---------- setup + security ---------- */
V.SET = () => {
  const sv=S.server; const yes=t=>chip(t||"ON","good"), no=t=>chip(t||"OFF",""), bad=t=>chip(t,"bad");
  const row=(k,v,d)=>`<tr><td>${k}</td><td>${v}</td><td style="white-space:normal" class="fl tl">${d}</td></tr>`;
  const status = !S.live ? `<div class="note">This is the preview inside Claude. Everything below turns on when you put the project on your Cloudflare account. Follow the numbered steps in the README.</div>` : "";
  const rows = [
    row("Login wall (Cloudflare Access)", sv.access?yes("ON"):bad("OFF"), sv.access?`Signed in as ${esc(sv.user||"you")}. Only your email can open this site.`:"Required before any account, trading or saved data features work. Setup step 6–7."),
    row("Private database (D1)", sv.db?yes():no(), "Stores alerts, history, manual holdings and the audit log on your own Cloudflare account. Step 3."),
    row("Scheduled jobs", sv.cronAt?yes("LAST RUN "+agoText(sv.cronAt).toUpperCase()):no("NOT YET"), "Alerts every minute; odds, signals and scans every 15 minutes; briefs on weekdays."),
    row("SnapTrade", sv.snaptrade?yes("KEY SET"):no("NOT SET"), "Connect most brokerages. Step 11."),
    row("Alpaca", sv.alpaca?yes(sv.alpacaPaper?"PAPER":"LIVE"):no("NOT SET"), "Free broker with a practice account. Step 11."),
    row("Trading mode", sv.trading==="live"?bad("LIVE"):sv.trading==="paper"?chip("PAPER","warn"):no("OFF"), "OFF = practice account only. PAPER = fake-money accounts. LIVE = real money, PIN required. Set TRADING_MODE."),
    row("Trading PIN", sv.pin?yes("SET"):no("NOT SET"), "Asked for on every real or paper order. Five wrong tries locks trading for 15 minutes."),
    row("Order limits", `${usd(sv.maxOrder||1000)} / ${sv.maxDaily||10} a day`, "Hard caps checked on the server. Change MAX_ORDER_USD and MAX_ORDERS_PER_DAY."),
    row("Finnhub (real-time stocks, earnings history)", sv.finnhub?yes("KEY SET"):no("OPTIONAL"), "Free key. Step 9."),
    row("FRED (economic calendar)", sv.fred?yes("KEY SET"):no("OPTIONAL"), "Free key. Step 9."),
    row("Phone notifications (ntfy)", sv.ntfy?yes("SET"):no("OPTIONAL"), "Free. Step 10."),
    row("AI summaries (Workers AI)", sv.ai?yes():no(), `Free daily allowance on Cloudflare${sv.aiLeft!=null?` · ${sv.aiLeft} summaries left today`:""}.`),
    row("Trading bot link", sv.bot?yes("SET"):no("OPTIONAL"), "Step 12."),
  ].join("");
  return `${status}<div class="grid">${panel("SET","Setup and security status","What is switched on for your copy of the terminal.", table(`<tr><th>Part</th><th>Status</th><th class="tl">Notes</th></tr>`, rows),{cls:"wide"})}
    ${panel("SET","How your money stays safe",null, `<ul class="facts">
      <li>The whole site sits behind Cloudflare Access: nobody can load it, or reach its server, without the one-time code sent to your email.</li>
      <li>The server double-checks Cloudflare's signed login token on every private request, and rejects requests that come from other websites.</li>
      <li>Brokerage keys live only as encrypted Cloudflare secrets. The page never receives them, so a stolen screenshot or browser can't leak them.</li>
      <li>Trading is off until you turn it on. Every order shows a full review first, needs your PIN, and must fit your dollar and daily limits.</li>
      <li>Every order attempt — sent, refused or a wrong PIN — is written to an audit log you can read in ORD.</li>
      <li>PAUSE ALL TRADING in ORD stops orders instantly. Resuming needs your PIN.</li>
      <li>SnapTrade and Alpaca keys can't move money out of your accounts. When you create brokerage keys anywhere, never turn on withdrawal or transfer permissions.</li></ul>`)}</div>`;
};
V.HELP = () => {
  const blocks = CATS.map(([c,l])=>`<div class="helpcat"><h3>${c}</h3>${l.map(([k,n])=>`<button data-run="${k}"><b>${k}</b><span>${n}</span></button>`).join("")}</div>`).join("");
  const sec = Object.entries(SECFN).map(([k,v])=>`<button data-run="AAPL ${k}"><b>AAPL ${k}</b><span>${v}</span></button>`).join("");
  return panel("HELP","Commands","Type a command in the bar and press GO (or Enter). Press / on a keyboard to jump to the bar and Esc to go back. Tap any line to run it.",
    `<div class="help">${blocks}<div class="helpcat"><h3>ANY TICKER</h3>${sec}<button data-run="COMP AAPL MSFT NVDA"><b>COMP A B C</b><span>Compare several tickers</span></button><button data-run="TRADE AAPL"><b>TRADE AAPL</b><span>Open the trade ticket</span></button><button data-run="SPX GP"><b>SPX, CL, EURUSD, BTC</b><span>Bloomberg-style codes</span></button><button data-run="EXPLAIN"><b>EXPLAIN</b><span>Plain-English notes on/off</span></button></div></div>`);
};
