/* Openfloor — router, command bar, event handling, live refresh loop. */
"use strict";
function go(route, push=true){
  if(push && JSON.stringify(route)!==JSON.stringify(S.route)){ S.hist.push(S.route); if(S.hist.length>40) S.hist.shift(); }
  S.route=route; if(route.fn && !route.sym){ const c=SCREENS.find(s=>s[0]===route.fn); if(c){ S.cat=c[2]; store.set("cat",S.cat); } }
  TICKET_PREVIEW = route.fn==="TRADE" ? TICKET_PREVIEW : null;
  render(); window.scrollTo({top:0});
  if(WS.fh) syncFinnhub();
}
function typing(){ const a=document.activeElement; return a && a.id!=="cmd" && a.closest && a.closest("#main") && a.matches("input,select,textarea"); }
let lastRender=0, rTimer=null;
function rerender(force){
  if(force){ render(); return; }
  if(typing()){ S.dirty=true; return; }
  const wait=Math.max(0, 400-(Date.now()-lastRender)); clearTimeout(rTimer); rTimer=setTimeout(render, wait);
}
function markDirty(){ S.dirty=true; }
function render(){
  lastRender=Date.now(); S.dirty=false; CH.length=0;
  const r=S.route, m=$("#main");
  let html=alertBanner();
  try{ html += r.sym ? secView(r.sym, r.fn) : (V[r.fn]||V.MON)(); }
  catch(e){ console.error(e); html += `<div class="note bad">This screen hit a problem: ${esc(e.message)}. Try BACK or MON.</div>`; }
  m.innerHTML=html;
  document.body.classList.toggle("noex", !S.explain);
  renderKeys(); hydrateCharts(); if($("#fxconv")) fxCalc();
}
function renderKeys(){
  const r=S.route, on=r.sym?"":r.fn;
  $("#cats").innerHTML = CATS.map(([c])=>`<button class="cat ${c===S.cat?"on":""}" data-cat="${c}">${c}</button>`).join("");
  const list=(CATS.find(c=>c[0]===S.cat)||CATS[0])[1];
  $("#keys").innerHTML = (S.hist.length?`<button class="k back" data-run="BACK"><b>◀ BACK</b></button>`:"") + list.map(([c,l])=>`<button class="k ${c===on?"on":""}" data-run="${c}"><b>${c}</b><span>${l}</span></button>`).join("");
}
const NOISE=new Set(["US","EQUITY","INDEX","CURNCY","COMDTY","GO","<GO>"]);
function run(cmd){
  let t=String(cmd).trim().toUpperCase().split(/\s+/).filter(x=>x&&!NOISE.has(x)); if(!t.length) return;
  t=t.map((x,i)=>i===0||SECFN[FN_ALIAS[x]]||V[FN_ALIAS[x]]?(FN_ALIAS[x]||x):x);
  const head=t[0];
  if(head==="BACK"){ const p=S.hist.pop(); if(p) go(p,false); return; }
  if(head==="EXPLAIN"){ S.explain=!S.explain; store.set("explain",S.explain); render(); toast(S.explain?"Plain-English notes on":"Plain-English notes off"); return; }
  if(head==="COMP"){ const syms=t.slice(1).map(resolve).filter(Boolean); return go({fn:"COMP",syms}); }
  if(head==="TRADE"){ const s=t[1]?(resolve(t[1])||t[1]):null; if(s){ S.ticket.sym=short(s); TICKET_PREVIEW=null; } return go({fn:"TRADE"}); }
  if(head==="ALRT"&&t[1]) return go({fn:"ALRT",filter:t[1]});
  if(head==="HIST"&&t[1]) return go({fn:"HIST",filter:cmd.trim().split(/\s+/)[1]});
  if(head==="STUDY"&&t[1]){ const s=resolve(t[1]); return go({fn:"STUDY",sym2:s||"^GSPC"}); }
  if(t.length===1 && V[head]) return go({fn:head});
  if(t.length===1 && SECFN[head]){ const cur=S.route.sym || (head==="OMON"?"AAPL":S.watch.find(isStock)||"AAPL"); return go({sym:cur,fn:head}); }
  const sym=resolve(head), fn=SECFN[t[1]]?t[1]:"GP";
  if(!sym){ toast(`"${head}" isn't a known command or ticker here. Type HELP for the list.`); return; }
  if(S.live && !D.q[sym]){ S.busy[sym]=1; Promise.all([loadSpark([sym]),loadHistory(sym,true)]).then(()=>{ delete S.busy[sym]; rerender(true); }); }
  go({sym, fn, cmp: fn==="GP"&&S.route.sym===sym ? S.route.cmp : undefined});
}
/* ---------- command bar ---------- */
function suggestions(v){
  v=v.trim().toUpperCase(); if(!v) return [];
  const out=[], parts=v.split(/\s+/);
  if(parts.length>=2){ const sym=resolve(parts[0]); if(sym) Object.entries(SECFN).forEach(([k,d])=>{ if(k.startsWith(parts[1])) out.push([parts[0]+" "+k, longName(sym)+" · "+d]); }); return out.slice(0,10); }
  SCREENS.forEach(([c,l,g])=>{ if(c.startsWith(v)||l.toUpperCase().includes(v)) out.push([c,l+" · "+g.toLowerCase()]); });
  const seen=new Set(out.map(x=>x[0])); const add=(c,d)=>{ if(!seen.has(c)&&out.length<12){ seen.add(c); out.push([c,d]); } };
  Object.entries(LABEL).forEach(([y,[a,n]])=>{ if(a.startsWith(v)||n.toUpperCase().includes(v)) add(a,n); });
  (D.crypto||[]).forEach(c=>{ if(c.sym.startsWith(v)||c.name.toUpperCase().includes(v)) add(c.sym,c.name+" (crypto)"); });
  Object.keys(D.q).forEach(y=>{ if(!LABEL[y]&&(y.startsWith(v)||(D.q[y].name||"").toUpperCase().includes(v))) add(y,D.q[y].name); });
  if(out.length<12){ const rows=Object.values(uniIndex().map); rows.filter(r=>r.sym.startsWith(v)).sort((a,b)=>b.mcap-a.mcap).slice(0,6).forEach(r=>add(r.sym,r.name));
    if(v.length>=3) rows.filter(r=>r.name.toUpperCase().includes(v)).sort((a,b)=>b.mcap-a.mcap).slice(0,6).forEach(r=>add(r.sym,r.name)); }
  return out.slice(0,12);
}
let sIdx=-1;
function showSugg(){ const box=$("#sugg"), list=suggestions($("#cmd").value); sIdx=-1;
  if(!list.length){ box.hidden=true; return; }
  box.innerHTML=list.map(([c,d])=>`<button type="button" data-run="${esc(c)}"><b>${esc(c)}</b><span>${esc(d)}</span></button>`).join(""); box.hidden=false; }
$("#cmd").addEventListener("input", showSugg);
$("#cmd").addEventListener("keydown", e=>{ const bs=$$("#sugg button");
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){ if(!bs.length) return; e.preventDefault(); sIdx=(sIdx+(e.key==="ArrowDown"?1:-1)+bs.length)%bs.length; bs.forEach((b,i)=>b.classList.toggle("on",i===sIdx)); }
  if(e.key==="Escape"){ $("#sugg").hidden=true; $("#cmd").blur(); } });
$("#cmdform").addEventListener("submit", e=>{ e.preventDefault(); const bs=$$("#sugg button"); const v=sIdx>=0&&bs[sIdx]?bs[sIdx].dataset.run:$("#cmd").value; $("#cmd").value=""; $("#sugg").hidden=true; run(v); });

/* ---------- clicks ---------- */
const syncWatch = () => { store.set("watch",S.watch); if(!S.priv) return; api("store",{method:"PUT",body:{k:"watch",v:S.watch}}).catch(()=>{});
  secTickers().then(T=>{ const m={}; S.watch.forEach(s=>{ const c=T[s.replace(".","-")]||T[s]; if(c) m[s]=c; }); return api("store",{method:"PUT",body:{k:"ciks",v:m}}); }).catch(()=>{}); };
document.addEventListener("click", e=>{
  const T=e.target; const at=a=>T.closest("["+a+"]");
  let el;
  if((el=at("data-run"))){ e.preventDefault(); $("#sugg").hidden=true; $("#cmd").value=""; run(el.dataset.run); return; }
  if((el=at("data-copy"))){ const v=el.dataset.copy; const done=()=>{ el.textContent="COPIED"; setTimeout(()=>el.textContent="COPY",1800); };
    const sel=()=>{ const c=$("#"+el.dataset.copyfor); if(c){ const r=document.createRange(); r.selectNodeContents(c); const s=getSelection(); s.removeAllRanges(); s.addRange(r); } toast("Selected — tap Copy."); };
    try{ navigator.clipboard.writeText(v).then(done, sel); }catch(x){ sel(); } return; }
  if((el=at("data-cat"))){ S.cat=el.dataset.cat; store.set("cat",S.cat); renderKeys(); return; }
  if((el=at("data-range"))){ S.range=el.dataset.range; store.set("range",S.range); render(); return; }
  if((el=at("data-study"))){ const k=el.dataset.study; S.studies[k]=!S.studies[k]; store.set("studies",S.studies); render(); return; }
  if((el=at("data-cmpclear"))){ S.route={...S.route,cmp:[]}; render(); return; }
  if((el=at("data-newsf"))){ S.route={...S.route,filter:el.dataset.newsf}; render(); return; }
  if((el=at("data-days"))){ S.route={...S.route,days:+el.dataset.days}; render(); return; }
  if((el=at("data-exp"))){ S.route={...S.route,exp:el.dataset.exp}; render(); return; }
  if((el=at("data-unwatch"))){ S.watch=S.watch.filter(x=>x!==el.dataset.unwatch); syncWatch(); render(); return; }
  if((el=at("data-watchtoggle"))){ const s=el.dataset.watchtoggle; S.watch=S.watch.includes(s)?S.watch.filter(x=>x!==s):[...S.watch,s]; syncWatch(); render(); toast(S.watch.includes(s)?"Added to watchlist":"Removed from watchlist"); return; }
  if((el=at("data-eqsort"))){ const k=el.dataset.eqsort; S.eqs.dir = S.eqs.sort===k ? -S.eqs.dir : -1; S.eqs.sort=k; store.set("eqs",S.eqs); render(); return; }
  if((el=at("data-eqpreset"))){ const p=EQS_PRESETS[el.dataset.eqpreset]; S.eqs={preset:el.dataset.eqpreset,f:{...p.f},sort:p.sort,dir:p.dir||-1}; store.set("eqs",S.eqs); render(); return; }
  if((el=at("data-side"))){ S.ticket.side=el.dataset.side; TICKET_PREVIEW=null; render(); return; }
  if((el=at("data-cancelpreview"))){ TICKET_PREVIEW=null; render(); return; }
  if((el=at("data-summarize"))){ summarizeFiling(el.dataset.summarize, el.dataset.form); return; }
  if((el=at("data-why"))){ explainWhy(el.dataset.why); return; }
  if((el=at("data-portrefresh"))){ loadPortfolio(true); return; }
  if((el=at("data-unalert"))){ const id=el.dataset.unalert; if(S.priv){ api("alerts?id="+encodeURIComponent(id),{method:"DELETE"}).then(loadAlerts).catch(x=>toast(x.message)); } else { S.alerts.splice(+id,1); store.set("alerts",S.alerts); render(); } return; }
  if((el=at("data-connect"))){ api("brokers/connect",{method:"POST",body:{mode:el.dataset.connect}}).then(r=>{ if(r.url) location.href=r.url; }).catch(x=>toast(x.message,6000)); return; }
  if((el=at("data-practicereset"))){ api("practice/reset",{method:"POST",body:{}}).then(()=>{ toast("Practice account reset to $100,000."); loadPortfolio(true); }).catch(x=>toast(x.message)); return; }
  if((el=at("data-notifytest"))){ api("notify/test",{method:"POST",body:{}}).then(()=>toast("Test sent. Check the ntfy app on your phone.")).catch(x=>toast(x.message,6000)); return; }
  if((el=at("data-pause"))){ const resume=el.dataset.pause==="0"; const pin=resume?($("#pausepin")?.value||""):"";
    if(resume && S.server.pin && !pin){ const host=el.closest(".meta")||el.parentNode; if(!$("#pausepin")){ host.insertAdjacentHTML("beforeend",` <input id="pausepin" type="password" inputmode="numeric" placeholder="PIN" style="width:80px;background:#000;border:1px solid var(--line2);color:var(--fg);padding:4px"> <button class="btn small" data-pause="0">OK</button>`); $("#pausepin").focus(); } return; }
    api("trade/pause",{method:"POST",body:{paused:!resume,pin}}).then(()=>{ toast(resume?"Trading resumed.":"All trading paused."); loadOrders(); }).catch(x=>toast(x.message)); return; }
  if((el=at("data-cancelorder"))){ const id=el.dataset.cancelorder, acct=el.dataset.acct;
    const holder=el.parentNode; if(S.server.pin && !holder.querySelector("input")){ holder.innerHTML=`<input type="password" inputmode="numeric" placeholder="PIN" style="width:70px;background:#000;border:1px solid var(--line2);color:var(--fg);padding:3px"> <button class="lnk" data-cancelorder="${esc(id)}" data-acct="${esc(acct)}">CONFIRM</button>`; holder.querySelector("input").focus(); return; }
    const pin=holder.querySelector("input")?.value||"";
    api("trade/cancel",{method:"POST",body:{account:acct,orderId:id,pin}}).then(()=>{ toast("Cancel request sent."); loadOrders(); }).catch(x=>toast(x.message,6000)); return; }
  if((el=at("data-delholding"))){ api("holdings?id="+encodeURIComponent(el.dataset.delholding),{method:"DELETE"}).then(()=>loadPortfolio(true)).catch(x=>toast(x.message)); return; }
  if(!T.closest(".cmdwrap")) $("#sugg").hidden=true;
});
document.addEventListener("change", e=>{
  const T=e.target;
  if(T.dataset.briefset){ BRIEF.settings={...(BRIEF.settings||{}),[T.dataset.briefset]:T.checked}; api("brief",{method:"PUT",body:{settings:BRIEF.settings}}).then(()=>toast("Saved.")).catch(x=>toast(x.message)); return; }
  if(T.dataset.peco){ S.peco[T.dataset.peco]=+T.value||0; store.set("peco",S.peco); render(); return; }
  if(T.closest("#mortform")){ S.mort={price:+$("#mo_price").value||0,down:+$("#mo_down").value||0,years:+$("#mo_years").value||30}; store.set("mort",S.mort); render(); return; }
  if(T.closest("#ticket")){ readTicket(); if(T.id==="tk_type"||T.id==="tk_acct"){ TICKET_PREVIEW=null; render(); } return; }
  if(T.id==="bt_strat"){ S.bt.strat=T.value; store.set("bt",S.bt); render(); return; }
  if(T.id==="mh_file"&&T.files[0]){ T.files[0].text().then(t=>{ $("#mh_csv").value=t; }); return; }
});
document.addEventListener("input", e=>{ if(e.target.closest("#ticket")) readTicket(); if(e.target.closest("#fxconv")) fxCalc(); });
function readTicket(){ const tk=S.ticket; const g=id=>$("#"+id)?.value; tk.account=g("tk_acct")??tk.account; tk.sym=(g("tk_sym")||"").toUpperCase(); tk.qty=g("tk_qty")||""; tk.type=g("tk_type")||tk.type; tk.limit=g("tk_lim")??tk.limit; tk.tif=g("tk_tif")||tk.tif; }
function fxCalc(){ const r=D.ecb?.rates||{}; const rt=c=>c==="USD"?1:r[c]; const a=parseFloat($("#fxamt")?.value)||0; const f=$("#fxfrom")?.value, t=$("#fxto")?.value; if(!f||!t) return; $("#fxout").textContent=nf(a,2)+" "+f+" = "+nf(a*rt(t)/rt(f),2)+" "+t; }
document.addEventListener("submit", e=>{
  const f=e.target; if(f.id==="cmdform") return; e.preventDefault();
  const v=id=>$("#"+id)?.value;
  switch(f.id){
    case "addwatch": { const raw=(v("wsym")||"").trim().toUpperCase(); if(!raw) return; const sym=resolve(raw); if(!sym) return toast(`"${raw}" isn't in this preview.`);
      if(!S.watch.includes(sym)) S.watch.push(sym); syncWatch(); if(S.live&&!D.q[sym]) Promise.all([loadSpark([sym]),loadHistory(sym)]).then(()=>rerender(true)); render(); break; }
    case "addalert": { const sym=resolve(v("asym")||""); const p=parseFloat(v("apx")); if(!sym||isNaN(p)) return toast("Enter a ticker and a price.");
      const a={sym,op:v("aop"),px:p}; if(S.priv) api("alerts",{method:"POST",body:a}).then(loadAlerts).then(()=>toast("Alert saved on your server.")).catch(x=>toast(x.message)); else { S.alerts.push({...a,hit:false}); store.set("alerts",S.alerts); checkAlertsLocal(); render(); } break; }
    case "cmpform": { const syms=(v("cmpin")||"").split(/[\s,]+/).map(resolve).filter(Boolean).slice(0,5); S.route={...S.route,cmp:syms}; if(S.live) ensureHistory(syms).then(rerender); render(); break; }
    case "eqsform": { const n=id=>{ const x=v(id); return x===""||x==null?null:+x; }; S.eqs={...S.eqs,preset:null,f:{q:v("eq_q"),sector:v("eq_sector"),minCap:n("eq_cap"),maxPE:n("eq_pe"),minGrowth:n("eq_g"),minMargin:n("eq_m"),us:$("#eq_us")?.checked}}; store.set("eqs",S.eqs); render(); break; }
    case "fundform": { const c=parseInt(v("fundcik")); if(!c) return; if(!S.live) return toast("Loading other funds needs your hosted copy."); S.route={fn:"FUND",filter:String(c)}; loadFund(c); render(); break; }
    case "congform": S.route={fn:"CONG",filter:v("congq")}; render(); break;
    case "ticket": readTicket(); submitTicket(); break;
    case "confirmform": confirmTicket(); break;
    case "manualform": { const b={account:v("mh_acct")||"Manual",sym:(v("mh_sym")||"").toUpperCase(),qty:+v("mh_qty"),cost:v("mh_cost")?+v("mh_cost"):null}; if(!b.sym||!b.qty) return toast("Enter a ticker and shares.");
      api("holdings",{method:"POST",body:{add:[b]}}).then(()=>{ toast("Holding saved."); loadPortfolio(true); }).catch(x=>toast(x.message)); break; }
    case "csvform": { const rows=(v("mh_csv")||"").split(/\r?\n/).map(l=>l.split(",").map(x=>x.trim())).filter(r=>r.length>=3&&r[1]&&!isNaN(+r[2])&&!/ticker|symbol/i.test(r[1])).map(r=>({account:r[0]||"Manual",sym:r[1].toUpperCase(),qty:+r[2],cost:r[3]?+r[3]:null}));
      if(!rows.length) return toast("No rows found. Use: account, ticker, shares, avg cost");
      api("holdings",{method:"POST",body:{replace:rows}}).then(()=>{ toast(rows.length+" holdings imported."); loadPortfolio(true); }).catch(x=>toast(x.message)); break; }
    case "studyform": S.route={fn:"STUDY",sym2:resolve(v("st_sym")||"SPX")||"^GSPC",thr:+v("st_thr")||2}; render(); break;
    case "btform": { const p=S.bt; ["sym","fast","slow","lo","hi","n","m","fee","cap"].forEach(k=>{ const x=v("bt_"+k); if(x!=null) p[k]= k==="sym"?x.toUpperCase():+x; }); p.strat=v("bt_strat")||p.strat; store.set("bt",p);
      const s=resolve(p.sym); if(S.live&&s&&!D.q[s]) Promise.all([loadSpark([s]),loadHistory(s,true)]).then(()=>rerender(true)); render(); break; }
  }
});
document.addEventListener("keydown", e=>{ if(e.target.matches("input,select,textarea")) return; if(e.key==="/"){ e.preventDefault(); $("#cmd").focus(); } if(e.key==="Escape") run("BACK"); });
document.addEventListener("focusout", ()=>{ setTimeout(()=>{ if(S.dirty && !typing()) render(); }, 50); });

/* ---------- tape, clocks, footer ---------- */
function renderTape(){
  const items=[...GROUPS.indices.slice(0,9),"CL=F","GC=F","EURUSD=X","JPY=X"].map(s=>{ const q=Q(s); if(!q) return ""; const p=pch(q);
    return `<span class="ti" data-run="${esc(short(s))} GP"><b>${esc(short(s))}</b>${px(q.px,s)}<span class="${cls(p)}">${pctS(p)}</span></span>`; });
  const t10=lastV(D.fred.DGS10?.s); if(t10) items.push(`<span class="ti" data-run="GC"><b>UST10Y</b>${nf(t10,2)}%</span>`);
  D.crypto.slice(0,3).forEach(c=>items.push(`<span class="ti" data-run="${esc(c.sym)} GP"><b>${esc(c.sym)}</b>${px(c.px)}<span class="${cls(c.ch24)}">${pctS(c.ch24)}</span></span>`));
  const h=items.join(""); const el=$("#tape"); if(el.dataset.h===h) return; el.dataset.h=h;
  el.innerHTML=`<div class="run">${h}<span aria-hidden="true" style="display:inline-flex;gap:28px">${h}</span></div>`;
}
const MKTS=[["New York","America/New_York",[9,30],[16,0]],["London","Europe/London",[8,0],[16,30]],["Frankfurt","Europe/Berlin",[9,0],[17,30]],["Tokyo","Asia/Tokyo",[9,0],[15,30]],["Hong Kong","Asia/Hong_Kong",[9,30],[16,0]]];
function renderClocks(){
  const now=new Date();
  $("#clocks").innerHTML = MKTS.map(([n,tz,o,c])=>{ const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:tz,hour:"2-digit",minute:"2-digit",weekday:"short",hour12:false}).formatToParts(now).map(x=>[x.type,x.value]));
    const h=(+p.hour)%24, m=+p.minute, mins=h*60+m, open=!["Sat","Sun"].includes(p.weekday) && mins>=o[0]*60+o[1] && mins<c[0]*60+c[1];
    return `<span>${n}<b>${String(h).padStart(2,"0")}:${p.minute}</b><span class="st ${open?"open":"closed"}">${open?"OPEN":"CLOSED"}</span></span>`; }).join("") + `<span style="margin-left:auto">Regular hours; holidays not shown</span>`;
}
function nyOpen(){ const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",weekday:"short",hour12:false}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  const mins=(+p.hour%24)*60+ +p.minute; return !["Sat","Sun"].includes(p.weekday) && mins>=4*60 && mins<20*60; }
function renderMode(){
  const m=$("#mode"); m.classList.toggle("live",S.live);
  $("#modetxt").innerHTML = S.live ? `<b>LIVE</b>${S.priv?" · secured":S.server.setupHint?' · <button class="lnk" data-run="SET">finish setup</button>':""} · ${D.at.quotes?new Date(D.at.quotes).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",second:"2-digit"}):"connecting"}` : `<b>SNAPSHOT</b> · ${dstr(Date.parse(D.asof))} ${new Date(D.asof).toISOString().slice(11,16)} UTC`;
  $("#foot").innerHTML = `<p>${S.live?"Live: prices refresh every 15 seconds"+(WS.cb?", crypto streams tick by tick":"")+(WS.fh?", your stocks stream from Finnhub":"")+".":"Preview: this copy shows real market data captured "+esc(new Date(D.asof).toUTCString())+". Prices do not move here, and portfolio and trading screens show samples. Put the project on Cloudflare (free) to make everything live."}</p>
   <p>Data: Yahoo Finance (quotes and history; some exchanges delayed 15–20 min), Coinbase and CoinGecko (crypto), FRED (economy), SEC EDGAR (filings, financials, 13F, Form 4), Nasdaq (listings, earnings dates, insiders, holders), CBOE (options, delayed), ECB (FX reference), Polymarket (odds), Hyperliquid (funding), alternative.me and ApeWisdom (sentiment), House Clerk (congressional reports). For personal research. Not investment advice.</p>
   <p><button class="lnk" data-run="EXPLAIN">${S.explain?"Hide":"Show"} plain-English notes</button> · <button class="lnk" data-run="SET">Setup and security</button></p>`;
}

/* ---------- live mode (your hosted copy) ---------- */
const allQuoteSyms = () => [...new Set([...Object.values(GROUPS).flat(), ...S.watch, ...PORT.positions.map(p=>p.sym)])];
async function goLive(){
  let j; try{ const r=await fetch("/api/ping",{cache:"no-store",headers:{"X-Openfloor":"1"}}); if(!r.ok) return; j=await r.json(); if(!j.ok) return; }catch(e){ return; }
  S.live=true; S.server=j.features||{}; S.priv=!!j.private;
  if(S.server.setupHint && !S.priv){ go({fn:"SET"},false); }
  if(S.priv){ try{ const w=await api("store?k=watch"); if(Array.isArray(w.v)&&w.v.length){ S.watch=w.v; store.set("watch",S.watch); } syncWatch(); }catch(e){} PORT.accounts=[]; PORT.positions=[]; }
  renderMode(); toast(S.priv?"Live and secured":"Live data connected");
  const syms=allQuoteSyms();
  await loadSpark(syms).catch(()=>{}); renderMode(); renderTape(); rerender();
  ensureHistory(syms).then(rerender);
  loadCrypto().catch(()=>{}); loadMacro().catch(()=>{}).then(rerender); loadPM().catch(()=>{});
  loadNews(["MKT",...S.watch.filter(s=>isStock(s)).slice(0,9)]);
  loadEarnings(); loadFomc(); loadReleaseCalendar().then(rerender); loadSentiment().then(rerender);
  setTimeout(()=>loadUniverse(), 2500);
  if(S.priv){ loadPortfolio(true); loadAlerts(); loadServerEvents(); }
  startCoinbase(); startFinnhub();
  let n=0;
  setInterval(async()=>{ if(document.hidden) return; n++;
    const open=nyOpen();
    if(open || n%4===0) await loadSpark(allQuoteSyms()).catch(()=>{});
    if(n%4===0) loadCrypto().catch(()=>{});
    if(n%8===0) loadPM().catch(()=>{});
    if(n%4===0 && S.priv) { loadPortfolio(); loadServerEvents(); if(S.route.fn==="ALRT") loadAlerts(); }
    if(n%20===0) loadNews(["MKT",...S.watch.filter(isStock).slice(0,9)]);
    if(n%60===0) loadSentiment();
    if(n%120===0 && open) loadUniverse(true);
    if(n%240===0) loadMacro();
    checkAlertsLocal(); renderMode(); renderTape(); rerender();
  }, 15000);
  setInterval(()=>{ if(S.dirty && !typing() && !document.hidden) render(); }, 2000);
}

/* ---------- boot ---------- */
renderTape(); renderClocks(); renderMode(); loadPortfolio(); checkAlertsLocal(); render();
setInterval(renderClocks, 30000);
let rz; window.addEventListener("resize", ()=>{ clearTimeout(rz); rz=setTimeout(hydrateCharts,120); });
goLive();
