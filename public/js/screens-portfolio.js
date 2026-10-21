/* Openfloor — portfolio, trading, orders, correlation, bot and account connections. */
"use strict";
const PORT = {accounts:[], positions:[], at:0, sample:false, errors:[], loading:false};
const SAMPLE_PORT = () => ({accounts:[
  {id:"practice",broker:"Openfloor",name:"Practice account",mask:"",kind:"practice",paper:true,canTrade:true,cash:100000,buyingPower:100000,currency:"USD",positions:[]},
  {id:"sample-1",broker:"Sample brokerage",name:"Individual (sample)",mask:"••1234",kind:"stocks",paper:true,canTrade:false,cash:4210.55,buyingPower:4210.55,currency:"USD",
   positions:[["AAPL",25,211.4],["MSFT",12,402.1],["NVDA",40,121.9],["SPY",15,560.2],["JPM",10,240.5],["XOM",18,111.3]].map(([s,q,c])=>({sym:s,qty:q,cost:c,type:"equity"}))},
  {id:"sample-2",broker:"Sample crypto",name:"Crypto (sample)",mask:"••9876",kind:"crypto",paper:true,canTrade:false,cash:500,buyingPower:500,currency:"USD",
   positions:[["BTC-USD",0.15,61000],["ETH-USD",2.5,2600]].map(([s,q,c])=>({sym:s,qty:q,cost:c,type:"crypto"}))}],sample:true});
function portPrice(p){ const q=Q(p.sym); return q?.px ?? p.price ?? null; }
function buildPositions(){
  PORT.positions = PORT.accounts.flatMap(a=>(a.positions||[]).map(p=>{ const q=Q(p.sym); const price=portPrice(p);
    const value=price!=null?price*p.qty:(p.value??null); const prev=q?.prev; return {...p, account:a.id, broker:a.broker, acctName:a.name, price, value,
      day: price!=null&&prev ? (price-prev)*p.qty : null, pnl: p.cost!=null&&price!=null ? (price-p.cost)*p.qty : null}; }));
}
async function loadPortfolio(force){
  if(!S.priv){ if(!PORT.accounts.length){ Object.assign(PORT, SAMPLE_PORT()); buildPositions(); } return; }
  if(PORT.loading || (!force && Date.now()-PORT.at<20e3)) return; PORT.loading=true;
  try{ const j=await api("accounts"); PORT.accounts=j.accounts||[]; PORT.errors=j.errors||[]; PORT.sample=false; PORT.at=Date.now();
    const syms=[...new Set(PORT.accounts.flatMap(a=>(a.positions||[]).map(p=>p.sym)))].filter(s=>!Q(s)||Q(s).uni);
    if(syms.length) await loadSpark(syms);
  }catch(e){ PORT.errors=[e.message]; }
  PORT.loading=false; buildPositions(); syncFinnhub && WS.fh && syncFinnhub(); rerender();
}
function portTotals(){
  const pos=PORT.positions; const cash=PORT.accounts.reduce((s,a)=>s+(a.cash||0),0);
  const inv=pos.reduce((s,p)=>s+(p.value||0),0), day=pos.reduce((s,p)=>s+(p.day||0),0), pnl=pos.reduce((s,p)=>s+(p.pnl||0),0), cost=pos.reduce((s,p)=>s+(p.cost!=null?p.cost*p.qty:0),0);
  return {cash, inv, total:cash+inv, day, dayPct: inv? day/(inv-day)*100 : null, pnl, pnlPct: cost? pnl/cost*100 : null};
}
function monPortfolio(){
  if(!PORT.accounts.length) return "";
  const t=portTotals();
  return panel("PORT", PORT.sample?"Portfolio (sample)":"Your portfolio", PORT.sample?"This preview shows a made-up sample portfolio. Your hosted copy shows your real accounts once you connect them.":"All your connected accounts added together.",
    `<div class="tiles"><div><span>Total value</span><b>${usd(t.total)}</b></div><div><span>Today</span><b class="${cls(t.day)}">${usd(t.day)} (${pctS(t.dayPct)})</b></div><div><span>Unrealized gain</span><b class="${cls(t.pnl)}">${usd(t.pnl)}</b></div></div>`+
    table(`<tr><th>Holding</th><th>Value</th><th>Today</th></tr>`, PORT.positions.slice().sort((a,b)=>(b.value||0)-(a.value||0)).slice(0,6).map(p=>`<tr class="r" data-run="${esc(short(p.sym))} GP"><td><span class="tk">${esc(short(p.sym))}</span></td><td>${usd(p.value)}</td><td class="${cls(p.day)}">${usd(p.day)}</td></tr>`).join("")),
    {meta:PORT.sample?SAMPLE(""):""});
}
function portRisk(){
  const pos=PORT.positions.filter(p=>p.value>0 && Q(p.sym)?.s?.length>60); if(!pos.length) return null;
  const syms=[...new Set(pos.map(p=>p.sym))]; const w=syms.map(s=>pos.filter(p=>p.sym===s).reduce((a,p)=>a+p.value,0)); const W=w.reduce((a,b)=>a+b,0)||1;
  const R=alignReturns([...syms,"SPY"],252); const n=R[0].length; if(n<30) return null;
  const pr=[]; for(let i=0;i<n;i++) pr.push(syms.reduce((s,_,k)=>s+R[k][i]*w[k]/W,0));
  const spy=R[syms.length]; const mp=pr.reduce((a,b)=>a+b,0)/n, ms=spy.reduce((a,b)=>a+b,0)/n;
  let cov=0,vs=0; for(let i=0;i<n;i++){ cov+=(pr[i]-mp)*(spy[i]-ms); vs+=(spy[i]-ms)**2; }
  const eq=[1]; pr.forEach(r=>eq.push(eq[eq.length-1]*(1+r)));
  const vol=stdev(pr)*Math.sqrt(252)*100, ret=(eq[eq.length-1]-1)*100, rf=(lastV(D.fred.DGS3MO?.s)||4);
  return {beta:cov/(vs||1), vol, ret, dd:maxDrawdown(eq), sharpe: vol? (ret-rf)/vol : null, n};
}
V.PORT = () => {
  loadPortfolio();
  if(!PORT.accounts.length) return panel("PORT","Portfolio","All your brokerage and crypto accounts in one view.", PORT.loading?empty("Loading your accounts…"):empty("No accounts connected yet. Open CONN to connect one, or add holdings by hand."));
  const t=portTotals(), risk=portRisk();
  const tiles=`<div class="tiles"><div><span>Total value</span><b>${usd(t.total)}</b></div><div><span>Invested</span><b>${usd(t.inv)}</b></div><div><span>Cash</span><b>${usd(t.cash)}</b></div>
    <div><span>Today</span><b class="${cls(t.day)}">${usd(t.day)} <small>${pctS(t.dayPct)}</small></b></div><div><span>Unrealized gain</span><b class="${cls(t.pnl)}">${usd(t.pnl)} <small>${pctS(t.pnlPct)}</small></b></div></div>`;
  const rows=PORT.positions.slice().sort((a,b)=>(b.value||0)-(a.value||0)).map(p=>`<tr class="r" data-run="${esc(short(p.sym))} GP"><td><span class="tk">${esc(short(p.sym))}</span><span class="sub">${esc(p.acctName)}</span></td>
    <td>${nf(p.qty, p.qty%1?4:0)}</td><td>${p.price!=null?px(p.price,p.sym):"—"}</td><td>${usd(p.value)}</td><td>${p.value&&t.inv?nf(p.value/t.inv*100,1)+"%":"—"}</td>
    <td class="${cls(p.day)}">${usd(p.day)}</td><td>${p.cost!=null?px(p.cost):"—"}</td><td class="${cls(p.pnl)}">${usd(p.pnl)}</td><td class="${cls(p.pnl)}">${p.cost?pctS((p.price/p.cost-1)*100,1):"—"}</td></tr>`).join("");
  // allocation
  const sector=p=>p.type==="crypto"||/-USD$/.test(p.sym)?"Crypto":(uniRow(p.sym)?.sector || (["SPY","QQQ","IWM","VTI","VOO"].includes(p.sym)?"Index funds":"Other"));
  const alloc=k=>{ const m={}; PORT.positions.forEach(p=>{ const key=k(p); m[key]=(m[key]||0)+(p.value||0); }); if(k===sector) m["Cash"]=t.cash; return Object.entries(m).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]); };
  const allocT=(list)=>{ const mx=list[0]?.[1]||1, tot=list.reduce((s,x)=>s+x[1],0)||1; return table(`<tr><th>Group</th><th>Share</th><th>Value</th></tr>`, list.map(([k,v],i)=>`<tr><td>${esc(k)}</td><td>${hbar(v,mx,PALETTE[i%PALETTE.length])} ${nf(v/tot*100,1)}%</td><td>${usd(v)}</td></tr>`).join("")); };
  const accts=table(`<tr><th>Account</th><th>Type</th><th>Value</th><th>Cash</th><th>Trading</th></tr>`, PORT.accounts.map(a=>{ const v=(a.positions||[]).reduce((s,p)=>s+(portPrice(p)!=null?portPrice(p)*p.qty:(p.value||0)),0)+(a.cash||0);
    return `<tr><td>${esc(a.broker)}<span class="sub">${esc(a.name)} ${esc(a.mask||"")}</span></td><td>${a.paper?chip("PAPER","warn"):chip("REAL","")}</td><td>${usd(v)}</td><td>${usd(a.cash)}</td><td>${a.canTrade?chip("ON","good"):"view only"}</td></tr>`; }).join(""));
  const riskBody = risk ? `<div class="kv pad" style="grid-template-columns:max-content 1fr;gap:6px 18px"><span>Past-year return (today's mix)</span><b class="${cls(risk.ret)}">${pctS(risk.ret,1)}</b><span>Volatility (yearly)</span><b>${nf(risk.vol,1)}%</b><span>Beta vs S&P 500</span><b>${nf(risk.beta,2)} ${risk.beta>1.2?"(swings more than the market)":risk.beta<0.8?"(swings less than the market)":"(moves about like the market)"}</b><span>Worst drop from a peak</span><b class="dn">${nf(risk.dd,1)}%</b><span>Sharpe ratio</span><b>${risk.sharpe!=null?nf(risk.sharpe,2):"—"}</b></div><div class="ex" style="border:0">Uses your current holdings replayed over the last ${risk.n} trading days.</div>` : empty("Needs price history for your holdings.");
  const eq = HISTC["port:value"];
  if(S.priv && !eq) loadHist("port:value",365);
  return `${PORT.sample?`<div class="note">${SAMPLE("Made-up holdings so you can see how this works. Your hosted copy shows your real accounts.")}</div>`:""}${PORT.errors.length?`<div class="note bad">${PORT.errors.map(esc).join("<br>")}</div>`:""}
   <div class="grid">${panel("PORT","Portfolio","Every connected account added together. Prices update live while markets are open.", tiles+table(`<tr><th>Holding</th><th>Qty</th><th>Price</th><th>Value</th><th>Weight</th><th>Today</th><th>Avg cost</th><th>Gain $</th><th>Gain %</th></tr>`, rows),{cls:"wide",meta:PORT.at?`synced ${agoText(PORT.at)} <button class="lnk" data-portrefresh="1">refresh</button>`:""})}
   ${panel("PORT","By sector","Where your money sits.", allocT(alloc(sector)))}
   ${panel("PORT","Risk check","How bumpy your current mix has been over the last year.", riskBody)}
   ${panel("PORT","Accounts","Paper accounts use pretend money. Real accounts only trade when you turn trading on (see SET).", accts+`<div class="more"><button class="lnk" data-run="CONN">Connect or manage accounts →</button></div>`)}
   ${eq&&eq.length>1?panel("HIST","Portfolio value history","Recorded every evening by your hosted copy.", chartSlot(eq.map(([t,v])=>[t/1000,v]),{h:220,fmt:v=>"$"+big(v)}),{cls:"wide"}):""}
   ${panel("CORR","How your holdings move together","See CORR for the full matrix.", corrMatrix([...new Set(PORT.positions.map(p=>p.sym))].slice(0,8), 120, true))}</div>`;
};

/* ---------- trade ticket ---------- */
S.ticket = {sym:"", side:"BUY", qty:"", notional:"", type:"LIMIT", limit:"", tif:"DAY", account:""};
let TICKET_PREVIEW=null;
V.TRADE = () => {
  loadPortfolio();
  const tk=S.ticket; if(S.route.filter) { tk.sym=S.route.filter; S.route.filter=null; TICKET_PREVIEW=null; }
  const q=tk.sym?Q(resolve(tk.sym)||tk.sym):null;
  const accts=PORT.accounts.filter(a=>a.canTrade);
  if(!tk.account && accts[0]) tk.account=accts[0].id;
  const a=PORT.accounts.find(x=>x.id===tk.account);
  const mode=S.server.trading||"off";
  const est = q && (tk.qty||tk.notional) ? (tk.notional? +tk.notional : +tk.qty*(tk.type==="LIMIT"&&tk.limit?+tk.limit:q.px)) : null;
  const pos=PORT.positions.find(p=>p.sym===resolve(tk.sym)&&p.account===tk.account);
  const disabled = !S.priv;
  const form=`<form class="form ticket" id="ticket">
    <label for="tk_acct">Account<select id="tk_acct">${accts.length?accts.map(x=>`<option value="${esc(x.id)}"${x.id===tk.account?" selected":""}>${esc(x.broker+" · "+x.name+" "+(x.mask||""))}${x.paper?" (paper)":""}</option>`).join(""):`<option value="">No trading accounts yet</option>`}</select></label>
    <label for="tk_sym">Ticker<input id="tk_sym" value="${esc(tk.sym)}" placeholder="AAPL" autocapitalize="characters"></label>
    <div class="seg" role="group" aria-label="Side"><button type="button" class="${tk.side==="BUY"?"on buy":""}" data-side="BUY">BUY</button><button type="button" class="${tk.side==="SELL"?"on sell":""}" data-side="SELL">SELL</button></div>
    <label for="tk_qty">Shares<input id="tk_qty" type="number" step="any" min="0" value="${esc(tk.qty)}" placeholder="10"></label>
    <label for="tk_type">Order type<select id="tk_type"><option value="LIMIT"${tk.type==="LIMIT"?" selected":""}>Limit (set your price)</option><option value="MARKET"${tk.type==="MARKET"?" selected":""}>Market (best price now)</option></select></label>
    ${tk.type==="LIMIT"?`<label for="tk_lim">Limit price<input id="tk_lim" type="number" step="any" min="0" value="${esc(tk.limit)}" placeholder="${q?px(q.px):""}"></label>`:""}
    <label for="tk_tif">Good for<select id="tk_tif"><option value="DAY"${tk.tif==="DAY"?" selected":""}>Today only</option><option value="GTC"${tk.tif==="GTC"?" selected":""}>Until cancelled</option></select></label>
    <button class="btn" type="submit"${disabled?" disabled":""}>REVIEW ORDER</button></form>`;
  const info=`<div class="kv pad" style="grid-template-columns:max-content 1fr;gap:6px 18px">
    <span>Last price</span><b>${q?px(q.px)+` <span class="${cls(pch(q))}">${pctS(pch(q))}</span>`:"—"}</b>
    <span>Estimated value</span><b>${est?usd(est):"—"}</b>
    <span>Buying power</span><b>${a?usd(a.buyingPower??a.cash):"—"}</b>
    <span>You hold here</span><b>${pos?nf(pos.qty,4).replace(/\.?0+$/,"")+" sh":"none"}</b>
    <span>Trading mode</span><b>${mode==="live"?chip("LIVE — real money","bad"):mode==="paper"?chip("PAPER ONLY","warn"):chip("OFF — practice account only","")}</b>
    <span>Safety limits</span><b>Max ${usd(S.server.maxOrder||1000)} per order · ${S.server.maxDaily||10} orders a day${S.server.pin?" · PIN required":""}</b></div>`;
  const pv=TICKET_PREVIEW;
  const preview = pv ? panel("TRADE","Confirm your order","Check every detail. Nothing is sent until you confirm"+(pv.needsPin?" with your trading PIN":"")+". This confirmation expires in 90 seconds.",
    `<div class="confirm ${pv.side==="BUY"?"buy":"sell"}"><div class="big">${esc(pv.side)} ${nf(pv.qty,4).replace(/\.?0+$/,"")} ${esc(pv.sym)}</div>
     <div>${pv.type==="LIMIT"?"Limit "+usd(pv.limit):"Market order"} · ${pv.tif==="GTC"?"good until cancelled":"today only"} · ${esc(pv.accountLabel)}</div>
     <div>Estimated ${pv.side==="BUY"?"cost":"proceeds"}: <b>${usd(pv.estimate)}</b>${pv.commission!=null?` · commission ${usd(pv.commission)}`:""}${pv.remainingCash!=null?` · cash after ${usd(pv.remainingCash)}`:""}</div>
     ${(pv.warnings||[]).map(w=>`<div class="warnline">${esc(w)}</div>`).join("")}
     <form class="form" id="confirmform">${pv.needsPin?`<label for="tk_pin">Trading PIN<input id="tk_pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12"></label>`:""}
     <button class="btn ${pv.side==="SELL"?"sellbtn":""}" type="submit">CONFIRM ${esc(pv.side)}</button><button class="btn ghost" type="button" data-cancelpreview="1">CANCEL</button></form></div>`) : "";
  return `<div class="grid">${panel("TRADE","Trade ticket",(disabled?"In this preview the ticket is for show. ":"")+"Pick an account, a ticker and how many shares. Limit orders only fill at your price or better, which protects you from sudden jumps. You will see a full review before anything is sent.",
      form+info+(disabled?needLive("Trading runs through your secured Cloudflare copy, which keeps your brokerage keys locked on the server and asks for your PIN on every order."):""),{cls:"wide"})}${preview}
    ${q?panel(short(resolve(tk.sym)||tk.sym)+" GP","Today","Intraday price.", chartSlot((D.intraday[resolve(tk.sym)]||[]).length>3?D.intraday[resolve(tk.sym)]:(q.s||[]).slice(-21),{h:180,fmt:v=>px(v)})):""}</div>`;
};
async function submitTicket(){
  const tk=S.ticket; const sym=(resolve(tk.sym)||tk.sym||"").toUpperCase();
  if(!tk.account) return toast("Connect an account that can trade first (CONN).");
  if(!sym||!(+tk.qty>0)) return toast("Enter a ticker and a number of shares.");
  if(tk.type==="LIMIT"&&!(+tk.limit>0)) return toast("Enter a limit price, or switch to a market order.");
  try{ const r=await api("trade/preview",{method:"POST",body:{account:tk.account,sym,side:tk.side,qty:+tk.qty,type:tk.type,limit:tk.type==="LIMIT"?+tk.limit:null,tif:tk.tif}});
    TICKET_PREVIEW={...r.preview, token:r.token, needsPin:r.needsPin, warnings:r.warnings}; render(); }
  catch(e){ toast(e.message, 6000); }
}
async function confirmTicket(){
  const pv=TICKET_PREVIEW; if(!pv) return; const pin=$("#tk_pin")?.value||"";
  try{ const r=await api("trade/submit",{method:"POST",body:{token:pv.token,pin}}); TICKET_PREVIEW=null; S.ticket.qty=""; toast(r.message||"Order sent.", 6000); loadPortfolio(true); go({fn:"ORD"}); }
  catch(e){ toast(e.message, 7000); if(/expired/i.test(e.message)){ TICKET_PREVIEW=null; render(); } }
}

/* ---------- orders + audit log ---------- */
let ORDERS={list:[],log:[],at:0};
async function loadOrders(){ if(!S.priv) return; try{ const [o,l]=await Promise.all([api("orders"),api("trade/log")]); ORDERS={list:o.orders||[],log:l.log||[],paused:l.paused,at:Date.now()}; }catch(e){ ORDERS.err=e.message; } rerender(); }
V.ORD = () => {
  if(!S.priv) return panel("ORD","Orders and audit log","Every order you place is listed here, plus a permanent record of every attempt, approval and refusal.", needLive("Orders come from your brokerages through the secured server."));
  if(Date.now()-ORDERS.at>15e3) loadOrders();
  const st=s=>/fill|executed/i.test(s)?"good":/cancel|reject|fail|expired/i.test(s)?"bad":"warn";
  const rows=ORDERS.list.map(o=>`<tr><td>${esc(o.time?new Date(o.time).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"")}</td><td><span class="tk">${esc(o.sym)}</span><span class="sub">${esc(o.accountLabel||"")}</span></td><td class="${o.side==="BUY"?"up":"dn"}">${esc(o.side)}</td><td>${nf(o.qty,4).replace(/\.?0+$/,"")}</td><td>${esc(o.type)}${o.limit?" "+usd(o.limit):""}</td><td>${o.filled?nf(o.filled,4).replace(/\.?0+$/,"")+(o.avg?" @ "+usd(o.avg):""):"—"}</td><td>${chip(o.status,st(o.status))}</td>
    <td>${o.open?`<button class="lnk" data-cancelorder="${esc(o.id)}" data-acct="${esc(o.account)}">CANCEL</button>`:""}</td></tr>`).join("");
  const log=ORDERS.log.map(l=>`<tr><td>${new Date(l.t).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit"})}</td><td class="tl">${esc(l.event.replace(/_/g," "))}</td><td class="tl">${esc(l.summary)}</td><td>${chip(l.status,st(l.status))}</td></tr>`).join("");
  return `<div class="grid">${panel("ORD","Recent orders","Orders across your trading accounts from the last day or two. Open orders can be cancelled.", rows?table(`<tr><th>Time</th><th>Ticker</th><th>Side</th><th>Qty</th><th>Type</th><th>Filled</th><th>Status</th><th></th></tr>`,rows):empty("No recent orders."),{cls:"wide",meta:`<button class="btn ghost small" data-pause="${ORDERS.paused?"0":"1"}">${ORDERS.paused?"RESUME TRADING":"PAUSE ALL TRADING"}</button>`})}
    ${panel("ORD","Audit log","A permanent record kept in your own Cloudflare database. It includes refused orders and wrong PIN attempts.", log?table(`<tr><th>Time</th><th class="tl">Event</th><th class="tl">Details</th><th>Result</th></tr>`,log,{max:480}):empty("Nothing logged yet."),{cls:"wide"})}</div>`;
};

/* ---------- correlation ---------- */
function corrMatrix(syms, days, compact){
  syms=syms.filter(s=>Q(s)?.s?.length>days/2); if(syms.length<2) return empty("Needs at least two holdings with price history.");
  const R=alignReturns(syms, days);
  const cell=v=>{ const a=Math.abs(v); const c=v>=0?`rgba(255,166,48,${(a*0.75).toFixed(2)})`:`rgba(92,184,255,${(a*0.75).toFixed(2)})`; return `<td style="background:${c};text-align:center">${nf(v,2)}</td>`; };
  return table(`<tr><th></th>${syms.map(s=>`<th style="text-align:center">${esc(short(s))}</th>`).join("")}</tr>`, syms.map((a,i)=>`<tr><td><span class="tk">${esc(short(a))}</span></td>${syms.map((b,j)=>i===j?`<td class="diag" style="text-align:center">1</td>`:cell(corr(R[i],R[j]))).join("")}</tr>`).join(""),{cls:"corr"})
    + (compact?"":`<div class="ex" style="border:0">Based on ${R[0].length} days of daily returns. 1 = move in lockstep, 0 = unrelated, −1 = opposite.</div>`);
}
V.CORR = () => {
  const src=S.route.filter||"watch"; const days=+(S.route.days||252);
  const syms = src==="port" ? [...new Set(PORT.positions.map(p=>p.sym))] : src==="assets" ? ["SPY","QQQ","IWM","TLT","HYG","GC=F","CL=F","BTC-USD","EURUSD=X","XLE"] : S.watch;
  if(S.live) ensureHistory(syms.slice(0,12)).then(rerender);
  return panel("CORR","Correlation matrix","How closely pairs of investments move together, from daily price changes. Orange = move together, blue = move opposite. Holding things that are not highly correlated spreads your risk.",
    `<div class="ranges" style="flex-wrap:wrap"><button class="${src==="watch"?"on":""}" data-newsf="watch">WATCHLIST</button><button class="${src==="port"?"on":""}" data-newsf="port">MY HOLDINGS</button><button class="${src==="assets"?"on":""}" data-newsf="assets">ASSET CLASSES</button>
     <span style="width:14px"></span>${[63,126,252].map(d=>`<button class="${d===days?"on":""}" data-days="${d}">${d===63?"3M":d===126?"6M":"1Y"}</button>`).join("")}</div>`+corrMatrix(syms.slice(0,12), days));
};

/* ---------- bot ---------- */
let BOT={state:null,at:0,err:null};
async function loadBot(){ try{ const r=await api("bot/state"); BOT={state:r.state,url:r.url,at:Date.now()}; }catch(e){ BOT={err:e.message,at:Date.now()}; } rerender(); }
function renderAny(v, depth=0){
  if(v==null) return "—"; if(typeof v!=="object") return esc(typeof v==="number"?nf(v,Math.abs(v)<10?4:2):String(v).slice(0,200));
  if(Array.isArray(v)){ if(!v.length) return "—"; if(typeof v[0]==="object"&&v[0]){ const keys=[...new Set(v.slice(0,20).flatMap(o=>Object.keys(o||{})))].slice(0,8);
      return table(`<tr>${keys.map(k=>`<th>${esc(k)}</th>`).join("")}</tr>`, v.slice(0,25).map(o=>`<tr>${keys.map(k=>`<td>${typeof o[k]==="object"?esc(JSON.stringify(o[k]).slice(0,60)):renderAny(o[k],depth+1)}</td>`).join("")}</tr>`).join("")); }
    return esc(v.slice(0,20).join(", ")); }
  if(depth>1) return esc(JSON.stringify(v).slice(0,200));
  return `<div class="kv pad" style="grid-template-columns:max-content 1fr;gap:4px 14px">${Object.entries(v).slice(0,30).map(([k,x])=>`<span>${esc(k)}</span><div>${renderAny(x,depth+1)}</div>`).join("")}</div>`;
}
V.BOT = () => {
  if(S.priv && !BOT.at) loadBot();
  const sig=SIGNALS_CACHE.crypto||[];
  const state = !S.priv ? needLive("Your paper-trading bot's dashboard file is read by the server and shown here.") : BOT.err ? `<div class="note bad">${esc(BOT.err)}</div>` : BOT.state ? renderAny(BOT.state) : empty("Loading…");
  return `<div class="grid">${panel("BOT","Your paper-trading bot","Shows what your crypto paper-trading bot is holding and why. Point the terminal at the status file your bot already publishes (setup step 12).", state,{cls:"wide",meta:BOT.url?`<a href="${esc(BOT.url)}" target="_blank" rel="noopener">source</a>`:""})}
    ${panel("SIG","Signals your bot can read","The terminal works out a score for each of the five largest coins every 15 minutes and publishes it at /api/bot/signals for your bot (behind a Cloudflare service token).", cryptoSignalTable(sig))}</div>`;
};

/* ---------- connect accounts ---------- */
V.CONN = () => {
  const sv=S.server;
  const row=(name,state,desc,act)=>`<tr><td><b>${name}</b><span class="sub" style="max-width:380px;white-space:normal">${desc}</span></td><td>${state}</td><td>${act||""}</td></tr>`;
  const ok=t=>chip(t,"good"), off=t=>chip(t,"");
  const accounts = row("SnapTrade (many brokerages)", sv.snaptrade?ok("KEY SET"):off("NOT SET"), "One free connection for Robinhood, Schwab, Fidelity, Webull, E*TRADE, Vanguard, Interactive Brokers, Coinbase, Kraken and more. View holdings, and trade where the brokerage allows it.",
      sv.snaptrade&&S.priv?`<button class="btn small" data-connect="read">CONNECT (VIEW ONLY)</button> <button class="btn ghost small" data-connect="trade">CONNECT WITH TRADING</button>`:"")
    + row("Alpaca", sv.alpaca?ok(sv.alpacaPaper?"PAPER KEY SET":"LIVE KEY SET"):off("NOT SET"), "Free US stock and ETF broker with a full practice (paper) account. Best way to test trading safely with fake money.", "")
    + row("Openfloor practice account", ok("ALWAYS ON"), "Built in. Starts with $100,000 of pretend cash. Orders fill at the current market price. No keys needed.", S.priv?`<button class="btn ghost small" data-practicereset="1">RESET TO $100K</button>`:"")
    + row("Holdings typed in or pasted", ok("ALWAYS ON"), "For any account without a connection (401k, pension, a bank brokerage). View only.", "");
  const manual = `<form class="form" id="manualform"><label for="mh_acct">Account name<input id="mh_acct" placeholder="401k"></label><label for="mh_sym">Ticker<input id="mh_sym" placeholder="VTI" autocapitalize="characters"></label><label for="mh_qty">Shares<input id="mh_qty" type="number" step="any"></label><label for="mh_cost">Avg cost (optional)<input id="mh_cost" type="number" step="any"></label><button class="btn" type="submit"${S.priv?"":" disabled"}>ADD HOLDING</button></form>
    <form class="form" id="csvform"><label for="mh_csv" style="flex:1 1 100%">Or paste a CSV (account, ticker, shares, avg cost — one per line)<textarea id="mh_csv" rows="4" placeholder="401k,VTI,120,198.40&#10;401k,BND,80,72.10"></textarea></label><label for="mh_file">…or pick a CSV file<input id="mh_file" type="file" accept=".csv,text/csv"></label><button class="btn ghost" type="submit"${S.priv?"":" disabled"}>IMPORT (REPLACES TYPED-IN HOLDINGS)</button></form>`;
  return `<div class="grid">${panel("CONN","Connect your accounts","Your keys are stored as encrypted secrets on your own Cloudflare account. The terminal page never sees them; it only talks to your server, which sits behind your Cloudflare login.",
      table(`<tr><th>Connection</th><th>Status</th><th></th></tr>`, accounts)+(S.priv?"":needLive("Connecting accounts needs your secured hosted copy.")),{cls:"wide"})}
    ${panel("CONN","Add holdings by hand","For accounts you can't connect. Saved in your private Cloudflare database.", manual,{cls:"wide"})}</div>`;
};
