/* Openfloor — research screens: screener, peers, earnings, insiders, holders, funds, compare, options, congress. */
"use strict";
function uniDerived(){
  return Object.values(uniIndex().map).map(r=>({...r,
    pe: r.ni>0 ? r.mcap/r.ni : null, ps: r.rev>0 ? r.mcap/r.rev : null,
    growth: r.rev&&r.revPrev ? (r.rev/r.revPrev-1)*100 : null, margin: r.rev>0&&r.ni!=null ? r.ni/r.rev*100 : null }));
}
const EQS_PRESETS = {
  largest:{label:"Largest companies",f:{},sort:"mcap"},
  growers:{label:"Profitable fast growers",f:{minGrowth:15,minMargin:10,minCap:2},sort:"growth"},
  value:{label:"Cheap and profitable",f:{maxPE:15,minMargin:5,minCap:2},sort:"pe",dir:1},
  gainers:{label:"Today's biggest gainers",f:{minCap:2},sort:"chg"},
  losers:{label:"Today's biggest losers",f:{minCap:2},sort:"chg",dir:1},
  margins:{label:"Highest margins",f:{minCap:5},sort:"margin"},
};
S.eqs = store.get("eqs",{preset:"largest",f:{},sort:"mcap",dir:-1});
V.EQS = () => {
  if(S.live && !D.at.universe && !S.busy.uni) loadUniverse();
  const st=S.eqs, f=st.f||{};
  const sectors=[...new Set(D.universe.rows.map(r=>r[2]).filter(Boolean))].sort();
  let rows=uniDerived().filter(r=>
    (!f.sector||r.sector===f.sector) && (!f.minCap||r.mcap>=f.minCap*1e9) && (f.maxPE==null||f.maxPE===""||(r.pe!=null&&r.pe<=f.maxPE)) &&
    (f.minGrowth==null||f.minGrowth===""||(r.growth!=null&&r.growth>=f.minGrowth)) && (f.minMargin==null||f.minMargin===""||(r.margin!=null&&r.margin>=f.minMargin)) &&
    (!f.q || (r.sym+" "+r.name+" "+r.industry).toUpperCase().includes(String(f.q).toUpperCase())) && (!f.us || r.country==="United States"));
  const k=st.sort||"mcap", dir=st.dir||-1;
  rows.sort((a,b)=>{ const x=a[k], y=b[k]; if(x==null&&y==null) return 0; if(x==null) return 1; if(y==null) return -1; return (x>y?1:x<y?-1:0)*dir; });
  const total=rows.length; rows=rows.slice(0,150);
  const th=(key,label)=>`<th><button class="sortb ${k===key?"on":""}" data-eqsort="${key}">${label}${k===key?(dir<0?" ▼":" ▲"):""}</button></th>`;
  const form=`<form class="form" id="eqsform">
    <label for="eq_q">Search<input id="eq_q" value="${esc(f.q||"")}" placeholder="name or industry"></label>
    <label for="eq_sector">Sector<select id="eq_sector"><option value="">All</option>${sectors.map(s=>`<option${s===f.sector?" selected":""}>${esc(s)}</option>`).join("")}</select></label>
    <label for="eq_cap">Min mkt cap $B<input id="eq_cap" type="number" step="any" value="${f.minCap??""}"></label>
    <label for="eq_pe">Max P/E<input id="eq_pe" type="number" step="any" value="${f.maxPE??""}"></label>
    <label for="eq_g">Min sales growth %<input id="eq_g" type="number" step="any" value="${f.minGrowth??""}"></label>
    <label for="eq_m">Min net margin %<input id="eq_m" type="number" step="any" value="${f.minMargin??""}"></label>
    <label class="cb" for="eq_us"><input id="eq_us" type="checkbox"${f.us?" checked":""}> US only</label>
    <button class="btn" type="submit">APPLY</button></form>
    <div class="ranges" style="flex-wrap:wrap;padding-bottom:8px">${Object.entries(EQS_PRESETS).map(([id,p])=>`<button class="${st.preset===id?"on":""}" data-eqpreset="${id}">${p.label}</button>`).join("")}</div>`;
  const body = rows.map(r=>`<tr class="r" data-run="${esc(r.sym)} DES"><td><span class="tk">${esc(r.sym)}</span><span class="sub">${esc(r.name)}</span></td><td class="tl"><span class="sub" style="max-width:170px">${esc(r.industry)}</span></td>
    <td>${px(r.px)}</td><td class="${cls(r.chg)}">${pctS(r.chg)}</td><td>${big(r.mcap)}</td><td>${r.pe!=null?nf(r.pe,1):"—"}</td><td>${r.ps!=null?nf(r.ps,1):"—"}</td>
    <td class="${cls(r.growth)}">${r.growth!=null?pctS(r.growth,1):"—"}</td><td>${r.margin!=null?nf(r.margin,1)+"%":"—"}</td><td>${r.rev?big(r.rev):"—"}</td></tr>`).join("");
  return panel("EQS","Stock screener",`Every US-listed stock worth $300M or more (${nf(D.universe.rows.length,0)} companies). Prices come from the exchange listing; sales and profit come from each company's ${D.universe.year||""} annual SEC filings. P/E is price ÷ earnings; P/S is price ÷ sales. Tap a company for its profile.`,
    form + (D.universe.rows.length? table(`<tr><th>Ticker</th><th class="tl">Industry</th>${th("px","Price")}${th("chg","Today")}${th("mcap","Mkt cap")}${th("pe","P/E")}${th("ps","P/S")}${th("growth","Sales gr.")}${th("margin","Margin")}${th("rev","Sales")}</tr>`, body)
      + `<div class="ex" style="border:0">Showing ${Math.min(150,total)} of ${nf(total,0)} matches.</div>` : empty(S.busy.uni?"Loading every US stock and its SEC figures… (about 10 MB, cached for 6 hours)":"No screener data yet.")),
    {meta:D.at.universe?`updated ${agoText(D.at.universe)}`:""});
};
SECV.RV = (sym,q) => {
  if(S.live && !D.at.universe && !S.busy.uni) loadUniverse();
  const u=uniRow(sym); if(!u) return panel(short(sym)+" RV","Peer comparison","Companies in the same industry, side by side.",empty(S.busy.uni?"Loading…":"No industry data for this ticker."));
  const all=uniDerived(); const me=all.find(r=>r.sym===sym);
  let peers=all.filter(r=>r.industry===u.industry).sort((a,b)=>b.mcap-a.mcap).slice(0,10); if(!peers.includes(me)) peers.push(me);
  if(peers.length<4) peers=[...new Set([...peers, ...all.filter(r=>r.sector===u.sector).sort((a,b)=>b.mcap-a.mcap).slice(0,8)])];
  const med = k => { const v=peers.map(r=>r[k]).filter(x=>x!=null).sort((a,b)=>a-b); return v.length?v[Math.floor(v.length/2)]:null; };
  const cols=[["mcap","Mkt cap",big],["pe","P/E",v=>nf(v,1)],["ps","P/S",v=>nf(v,1)],["growth","Sales growth",v=>pctS(v,1)],["margin","Net margin",v=>nf(v,1)+"%"],["chg","Today",v=>pctS(v)]];
  const rows=peers.map(r=>`<tr class="r ${r.sym===sym?"me":""}" data-run="${esc(r.sym)} RV"><td><span class="tk">${esc(r.sym)}</span><span class="sub">${esc(r.name)}</span></td>${cols.map(([k,,f])=>`<td class="${k==="chg"||k==="growth"?cls(r[k]):""}">${r[k]!=null?f(r[k]):"—"}</td>`).join("")}</tr>`).join("");
  const medRow=`<tr class="grp"><td>Industry median</td>${cols.map(([k,,f])=>`<td>${med(k)!=null?f(med(k)):"—"}</td>`).join("")}</tr>`;
  const withHist=peers.filter(r=>Q(r.sym)?.s?.length>100).slice(0,6);
  if(S.live) ensureHistory(peers.slice(0,6).map(r=>r.sym)).then(rerender);
  const base=Q(sym); const lines=withHist.filter(r=>r.sym!==sym).map((r,k)=>{ const m=new Map(Q(r.sym).s.map(([t,v])=>[Math.floor(t/86400),v])); return {vals:(base?.s||[]).slice(-252).map(([t])=>m.get(Math.floor(t/86400))??null),color:PALETTE[(k+1)%PALETTE.length],name:r.sym,w:1.4}; });
  return `<div class="grid">${panel(short(sym)+" RV","Peers: "+u.industry,"The largest companies in the same industry, compared on size, valuation, growth and profitability. The highlighted row is this company.", table(`<tr><th>Company</th>${cols.map(c=>`<th>${c[1]}</th>`).join("")}</tr>`, rows+medRow),{cls:"wide"})}
    ${base?.s?.length>100?panel(short(sym)+" COMP","One-year performance vs peers","All lines start at 0% a year ago, so you can see who did best.", chartSlot(base.s.slice(-252),{h:280,pct:true,lines,noArea:true,label:"Peer performance"}),{cls:"wide"}):""}</div>`;
};

/* Earnings calendar */
V.ERN = () => {
  if(S.live && !D.at.earnings && !S.busy.ern) loadEarnings();
  const mine=new Set([...S.watch, ...(PORT.positions||[]).map(p=>p.sym)]);
  const scope=S.route.filter||"mine";
  let list=D.earnings.filter(e=> scope==="all" ? (e.mcap||0)>=1e10 : mine.has(e.sym)); if(scope==="mine"&&!list.length) list=D.earnings.filter(e=>(e.mcap||0)>=5e10);
  const by={}; list.forEach(e=>(by[e.date]=by[e.date]||[]).push(e));
  const tm=t=>t==="time-pre-market"?"Before open":t==="time-after-hours"?"After close":"Time TBA";
  const body=Object.entries(by).sort().map(([d,l])=>`<tr class="grp"><td colspan="6">${new Date(d+"T12:00:00Z").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}</td></tr>`+
    l.sort((a,b)=>(b.mcap||0)-(a.mcap||0)).map(e=>`<tr class="r" data-run="${esc(e.sym)} ERN"><td><span class="tk">${esc(e.sym)}</span><span class="sub">${esc(e.name)}</span></td><td>${tm(e.time)}</td><td>${esc(e.eps||"—")}</td><td>${esc(e.lastEps||"—")}</td><td>${esc(e.ests||"—")}</td><td>${big(e.mcap)}</td></tr>`).join("")).join("");
  return panel("ERN","Earnings calendar","When companies report quarterly results over the next two weeks. The forecast is the average analyst estimate of earnings per share (EPS). Stocks often move sharply on report day.",
    `<div class="ranges"><button class="${scope==="mine"?"on":""}" data-newsf="mine">MY STOCKS</button><button class="${scope==="all"?"on":""}" data-newsf="all">ALL OVER $10B</button></div>`+
    (body?table(`<tr><th>Company</th><th>When</th><th>EPS forecast</th><th>EPS a year ago</th><th>Analysts</th><th>Mkt cap</th></tr>`, body):empty(S.busy.ern?"Loading the calendar…":"None of your stocks report in the next two weeks.")));
};
SECV.ERN = (sym) => {
  const e=D.earnings.find(x=>x.sym===sym); const s=(D.surprise||{})[sym];
  if(S.live && S.server.finnhub && !s) loadSurprises(sym);
  const next = e ? `<div class="kv pad" style="grid-template-columns:max-content 1fr;gap:6px 18px"><span>Next report</span><b>${new Date(e.date+"T12:00:00Z").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})} · ${e.time==="time-pre-market"?"before the open":e.time==="time-after-hours"?"after the close":"time not set"}</b><span>Quarter</span><b>${esc(e.q||"—")}</b><span>EPS forecast</span><b>${esc(e.eps||"—")} (${esc(e.ests||"?")} analysts)</b><span>EPS a year ago</span><b>${esc(e.lastEps||"—")}</b></div>` : empty("No report scheduled in the next two weeks.");
  const hist = s&&s.length ? table(`<tr><th>Quarter</th><th>Actual EPS</th><th>Estimate</th><th>Surprise</th></tr>`, s.slice(0,8).map(r=>`<tr><td>${esc(r.period)}</td><td>${nf(r.actual,2)}</td><td>${nf(r.estimate,2)}</td><td class="${cls(r.surprisePercent)}">${pctS(r.surprisePercent,1)}</td></tr>`).join(""))
    : (S.server.finnhub ? empty("Loading past results…") : `<div class="note">Past beats and misses need a free Finnhub key (setup step 9).</div>`);
  return `<div class="grid">${panel(short(sym)+" ERN","Next earnings","The next quarterly report and what analysts expect.", next)}${panel(short(sym)+" ERN","Past results vs estimates","A positive surprise means the company earned more than analysts expected.", hist)}</div>`;
};

/* Insider trades */
function clusterBuys(rows){ const buys=(rows||[]).filter(r=>/Buy/i.test(r.transactionType||"") && !/Automatic/i.test(r.transactionType||"") && Date.now()-Date.parse(r.lastDate)<45*864e5); return new Set(buys.map(r=>r.insider)).size; }
V.INS = () => {
  const list=[...new Set([...S.watch.filter(isStock), ...(PORT.positions||[]).map(p=>p.sym).filter(isStock)])].slice(0,14);
  if(S.live) list.filter(s=>!D.insiders[s]).slice(0,6).forEach(loadInsiders);
  if(S.live && !D.form4 && !S.busy.f4) loadForm4();
  const rows=list.map(s=>{ const d=D.insiders[s]; if(!d||!d.summary) return `<tr><td><span class="tk">${esc(s)}</span></td><td colspan="4" class="fl">${S.live?"loading…":"—"}</td></tr>`;
    const g=lbl=>d.summary.find(r=>r.insiderTrade===lbl)||{}; const buys=num(g("Number of Open Market Buys").months3), sells=num(g("Number of Sells").months3), net=g("Net Activity").months3; const cb=clusterBuys(d.rows);
    return `<tr class="r" data-run="${esc(s)} INS"><td><span class="tk">${esc(s)}</span></td><td class="${buys?"up":""}">${buys??"—"}</td><td class="${sells?"dn":""}">${sells??"—"}</td><td class="${cls(num(net))}">${esc(net||"—")}</td><td>${cb>=2?chip(cb+" insiders buying","good"):cb===1?"1 buyer":""}</td></tr>`; }).join("");
  const feed=(D.form4||[]).slice(0,25).map(f=>`<li><span class="tm">${ago(Date.parse(f.date))}</span><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.company)}</a><span class="s">Form 4 filed</span></li>`).join("");
  return `<div class="grid">${panel("INS","Insider trades: your stocks","Company officers and directors must report when they buy or sell their own company's shares. Buying with their own money is often read as confidence; sales are common and usually planned. Last 3 months shown. Two or more insiders buying at once is flagged.",
      table(`<tr><th>Ticker</th><th>Buys</th><th>Sells</th><th>Net shares</th><th>Signal</th></tr>`, rows))}
    ${panel("INS","Latest insider filings (all companies)","New Form 4 reports as they reach the SEC.", feed?`<ul class="news">${feed}</ul>`:empty(S.live?"Loading…":"Shown on your hosted copy, live from SEC EDGAR."))}</div>`;
};
async function loadForm4(){
  S.busy.f4=1;
  try{ const t=await (await P("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&start=0&count=80&output=atom")).text();
    const x=new DOMParser().parseFromString(t,"text/xml"); const out=[];
    x.querySelectorAll("entry").forEach(e=>{ const ti=e.querySelector("title")?.textContent||""; if(!/\(Issuer\)/.test(ti)) return; out.push({company:ti.replace(/^4\s*-\s*/,"").replace(/\s*\(\d+\)\s*\(Issuer\)/,""),date:e.querySelector("updated")?.textContent,url:e.querySelector("link")?.getAttribute("href")}); });
    D.form4=out; }catch(e){ D.form4=[]; }
  delete S.busy.f4; rerender();
}
SECV.INS = (sym) => {
  const d=D.insiders[sym]; if(S.live && !d) loadInsiders(sym);
  if(!d) return panel(short(sym)+" INS","Insider trades","Trades by the company's officers and directors.", empty(S.live?"Loading…":"Insider data in this preview covers your watchlist stocks."));
  const sum=table(`<tr><th></th><th>3 months</th><th>12 months</th></tr>`, (d.summary||[]).map(r=>`<tr><td>${esc(r.insiderTrade)}</td><td>${esc(r.months3)}</td><td>${esc(r.months12)}</td></tr>`).join(""));
  const tx=table(`<tr><th>Insider</th><th>Role</th><th>Date</th><th>Type</th><th>Shares</th><th>Price</th><th>Held after</th></tr>`, (d.rows||[]).slice(0,40).map(r=>`<tr><td>${esc(r.insider)}</td><td>${esc(r.relation)}</td><td>${esc(r.lastDate)}</td><td class="${/Buy/i.test(r.transactionType)?"up":/Sell/i.test(r.transactionType)?"dn":""}">${esc(r.transactionType)}</td><td>${esc(r.sharesTraded)}</td><td>${esc(r.lastPrice)}</td><td>${esc(r.sharesHeld)}</td></tr>`).join(""),{max:520});
  return `<div class="grid">${panel(short(sym)+" INS","Insider activity summary","Open-market buys are the meaningful ones. “Automatic” sales are scheduled in advance under a trading plan.", sum)}${panel(short(sym)+" INS","Every recent insider trade","Newest first, from Form 4 filings.", tx,{cls:"wide"})}</div>`;
};
SECV.HDS = (sym) => {
  const d=D.holders[sym]; if(S.live && !d) loadHolders(sym);
  if(!d||!d.rows) return panel(short(sym)+" HDS","Institutional holders","Funds that own the stock.", empty(S.live?"Loading…":"Holder data in this preview covers your watchlist stocks."));
  const s=d.summary||{};
  const top=`<div class="kv pad" style="grid-template-columns:max-content 1fr;gap:6px 18px">${Object.values(s).map(v=>`<span>${esc(v.label)}</span><b>${esc(v.value)}</b>`).join("")}</div>`;
  const act=table(`<tr><th></th><th>Funds</th><th>Shares</th></tr>`, [...(d.active||[]),...(d.newsold||[])].map(r=>`<tr><td>${esc(r.positions)}</td><td>${esc(r.holders)}</td><td>${esc(r.shares)}</td></tr>`).join(""));
  const rows=table(`<tr><th>Holder</th><th>As of</th><th>Shares</th><th>Change</th><th>Value ($000s)</th></tr>`, d.rows.map(r=>`<tr><td>${esc(r.ownerName)}</td><td>${esc(r.date)}</td><td>${esc(r.sharesHeld)}</td><td class="${cls(num(r.sharesChange))}">${esc(r.sharesChangePCT||r.sharesChange)}</td><td>${esc(r.marketValue)}</td></tr>`).join(""));
  return `<div class="grid">${panel(short(sym)+" HDS","Ownership","How much of the company big investment firms own, from their quarterly 13F reports to the SEC.", top+act)}${panel(short(sym)+" HDS","Largest holders","The biggest funds holding the stock and whether they added or trimmed last quarter.", rows,{cls:"wide"})}</div>`;
};
V.FUND = () => {
  const sel=S.route.filter ? +S.route.filter : FUNDS[0][0];
  const f=D.funds.find(x=>x.cik===sel);
  if(S.live && !f && !S.busy["fund:"+sel]) loadFund(sel, (FUNDS.find(x=>x[0]===sel)||[])[1]);
  const pick=`<div class="ranges" style="flex-wrap:wrap">${FUNDS.map(([c,n])=>`<button class="${c===sel?"on":""}" data-newsf="${c}">${esc(n)}</button>`).join("")}</div>
    <form class="form tight" id="fundform"><label for="fundcik">Or any fund's SEC CIK number<input id="fundcik" inputmode="numeric" placeholder="1067983"></label><button class="btn ghost" type="submit">LOAD</button></form>`;
  if(!f) return panel("FUND","Big funds (13F)","Every investment manager with over $100M must report its US stock holdings to the SEC each quarter, 45 days after the quarter ends.", pick+empty(S.busy["fund:"+sel]?"Reading the latest 13F report…":S.live?"Loading…":"This fund loads on your hosted copy."));
  const max=f.rows[0]?.pct||1;
  const rows=f.rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${hbar(r.pct,max)} ${nf(r.pct,1)}%</td><td>$${big(r.value)}</td><td>${r.new?chip("NEW","good"):r.chg==null?"—":`<span class="${cls(r.chg)}">${pctS(r.chg,1)}</span>`}</td></tr>`).join("");
  const sold=f.sold.length?`<div class="ex">Sold out completely: ${f.sold.map(s=>esc(s.name)).join(", ")}</div>`:"";
  return panel("FUND",f.name+" — holdings","Top positions from the latest 13F report (quarter ending "+esc(f.date)+", filed "+esc(f.filed)+"). Change compares share counts with the quarter before. Values are in US dollars as reported.",
    pick+table(`<tr><th>Company</th><th>Share of portfolio</th><th>Value</th><th>Change in shares</th></tr>`, rows)+sold,{meta:`${f.count} positions · $${big(f.total)}`});
};
V.COMP = () => {
  const syms=(S.route.syms&&S.route.syms.length?S.route.syms:["SPY","QQQ","IWM","TLT","GC=F"]).slice(0,8);
  if(S.live) ensureHistory(syms).then(rerender);
  const base=syms.find(s=>Q(s)?.s?.length>100); const n=252;
  if(!base) return panel("COMP","Compare","Type COMP followed by tickers, for example COMP AAPL MSFT NVDA.", empty(S.live?"Loading prices…":"These tickers have no history in this preview."));
  const b=Q(base).s.slice(-n);
  const lines=syms.filter(s=>s!==base).map((s,k)=>{ const m=new Map((Q(s)?.s||[]).map(([t,v])=>[Math.floor(t/86400),v])); return {vals:b.map(([t])=>m.get(Math.floor(t/86400))??null),color:PALETTE[(k+1)%PALETTE.length],name:short(s),w:1.5}; });
  const R=alignReturns(syms,n);
  const stats=syms.map((s,i)=>{ const c=closes(Q(s)); const r=R[i]||[];
    const ret=(k)=>c.length>k?(c[c.length-1]/c[c.length-1-k]-1)*100:null;
    return `<tr class="r" data-run="${esc(short(s))} GP"><td><span class="tk" style="color:${PALETTE[i%PALETTE.length]}">${esc(short(s))}</span><span class="sub">${esc(longName(s))}</span></td><td class="${cls(ret(21))}">${pctS(ret(21),1)}</td><td class="${cls(ret(63))}">${pctS(ret(63),1)}</td><td class="${cls(ret(252))}">${pctS(ret(252),1)}</td><td>${r.length>20?nf(stdev(r)*Math.sqrt(252)*100,1)+"%":"—"}</td><td class="dn">${nf(maxDrawdown(c.slice(-252)),1)}%</td><td>${i&&R[0].length>20?nf(corr(R[0],r),2):"—"}</td></tr>`; }).join("");
  return `<div class="grid">${panel("COMP","Compare: "+syms.map(short).join(" · "),"Every line starts at 0% one year ago. Volatility is how much the price swings in a typical year; max drawdown is the worst fall from a peak; correlation shows how closely each one moves with the first (1 = in lockstep).",
      chartSlot(b,{h:320,pct:true,lines,noArea:true,color:PALETTE[0],label:"Comparison"})+table(`<tr><th>Ticker</th><th>1 month</th><th>3 months</th><th>1 year</th><th>Volatility</th><th>Max drawdown</th><th>Corr. to ${esc(short(syms[0]))}</th></tr>`, stats),{cls:"wide"})}</div>`;
};

/* Options chain */
function drawXY(cv, series, opt, hx){
  const c=setupCanvas(cv); if(!c) return; const {g,W,H}=c; const L=46,R=12,T=22,B=24, iw=W-L-R, ih=H-T-B;
  const xs=series.flatMap(s=>s.pts.map(p=>p[0])), ys=series.flatMap(s=>s.pts.map(p=>p[1])); if(!xs.length) return;
  let x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys); const py=(y1-y0)*.1||1; y0-=py; y1+=py;
  const X=v=>L+(v-x0)/((x1-x0)||1)*iw, Y=v=>T+(1-(v-y0)/((y1-y0)||1))*ih;
  g.font="11px "+getCss("--mono"); g.textBaseline="middle";
  niceTicks(y0,y1,5).forEach(v=>{ g.strokeStyle=getCss("--line"); g.beginPath(); g.moveTo(L,Y(v)); g.lineTo(L+iw,Y(v)); g.stroke(); g.fillStyle=getCss("--dim"); g.fillText((opt.fy||(v=>nf(v,0)))(v),4,Y(v)); });
  g.textBaseline="alphabetic"; niceTicks(x0,x1,6).forEach(v=>{ g.fillStyle=getCss("--faint"); g.fillText((opt.fx||(v=>nf(v,0)))(v),X(v)-12,H-6); });
  if(opt.vline!=null){ g.setLineDash([3,3]); g.strokeStyle=getCss("--key"); g.beginPath(); g.moveTo(X(opt.vline),T); g.lineTo(X(opt.vline),T+ih); g.stroke(); g.setLineDash([]); }
  series.forEach((s,k)=>{ g.strokeStyle=s.color||PALETTE[k]; g.lineWidth=1.6; g.beginPath(); s.pts.forEach((p,i)=>i?g.lineTo(X(p[0]),Y(p[1])):g.moveTo(X(p[0]),Y(p[1]))); g.stroke(); });
  let lx=L; series.forEach((s,k)=>{ g.fillStyle=s.color||PALETTE[k]; g.fillRect(lx,8,10,3); g.fillStyle=getCss("--dim"); g.textBaseline="middle"; g.fillText(s.name,lx+14,10); lx+=g.measureText(s.name).width+30; });
}
SECV.OMON = (sym) => {
  const d=D.options[sym]; if(S.live && !d) loadOptions(sym);
  if(!d||d.error||!d.rows) return panel(short(sym)+" OMON","Options","Calls and puts on this stock.", empty(S.busy["opt:"+sym]?"Loading the options chain (delayed 15 min)…":d&&d.error?"No listed options found for this ticker.":"The preview includes options for AAPL. Your hosted copy loads any optionable US stock or fund."));
  const exps=[...new Set(d.rows.map(r=>r[0]))].sort(); const ex=S.route.exp&&exps.includes(S.route.exp)?S.route.exp:exps[Math.min(1,exps.length-1)];
  const spot=d.spot, rs=d.rows.filter(r=>r[0]===ex); const strikes=[...new Set(rs.map(r=>r[2]))].sort((a,b)=>a-b);
  const by={}; rs.forEach(r=>{ (by[r[2]]=by[r[2]]||{})[r[1]]=r; });
  const atm=strikes.reduce((b,k)=>Math.abs(k-spot)<Math.abs(b-spot)?k:b, strikes[0]);
  const mid=r=>r&&r[3]!=null&&r[4]!=null?(r[3]+r[4])/2:null; const straddle=(mid(by[atm]?.C)||0)+(mid(by[atm]?.P)||0);
  const sum=(t,i)=>rs.filter(r=>r[1]===t).reduce((s,r)=>s+(r[i]||0),0);
  const pcOI=sum("P",8)/(sum("C",8)||1), pcV=sum("P",9)/(sum("C",9)||1);
  const expDate=e=>new Date(Date.UTC(2000+ +e.slice(0,2), +e.slice(2,4)-1, +e.slice(4,6)));
  const days=Math.max(0,Math.round((expDate(ex)-Date.now())/864e5));
  const near=strikes.filter(k=>Math.abs(k/spot-1)<0.12);
  const cell=r=>r?`<td>${nf(r[3],2)}</td><td>${nf(r[4],2)}</td><td>${nf(r[6]*100,1)}%</td><td>${nf(r[7],2)}</td><td>${big(r[8])}</td>`:`<td colspan="5" class="fl">—</td>`;
  const rows=near.map(k=>`<tr class="${k===atm?"me":""}">${cell(by[k]?.C)}<td class="strike">${nf(k,k%1?1:0)}</td>${cell(by[k]?.P)}</tr>`).join("");
  const smile=[{name:"Call IV",color:"#2fd47a",pts:rs.filter(r=>r[1]==="C"&&r[6]>0).map(r=>[r[2],r[6]*100])},{name:"Put IV",color:"#ff5263",pts:rs.filter(r=>r[1]==="P"&&r[6]>0).map(r=>[r[2],r[6]*100])}];
  return `<div class="grid">${panel(short(sym)+" OMON","Options chain · expires "+expDate(ex).toUTCString().slice(5,16),"A call pays off if the price rises above the strike; a put pays off if it falls below. IV (implied volatility) is how big a move the market is pricing in. Delta is roughly the chance the option ends in the money. Quotes are delayed 15 minutes (CBOE).",
     `<div class="ranges" style="flex-wrap:wrap">${exps.map(e=>`<button class="${e===ex?"on":""}" data-exp="${e}">${expDate(e).toUTCString().slice(5,11)}</button>`).join("")}</div>`+
     table(`<tr><th colspan="5" style="text-align:center;color:var(--up)">CALLS</th><th></th><th colspan="5" style="text-align:center;color:var(--down)">PUTS</th></tr><tr><th>Bid</th><th>Ask</th><th>IV</th><th>Delta</th><th>Open int.</th><th>Strike</th><th>Bid</th><th>Ask</th><th>IV</th><th>Delta</th><th>Open int.</th></tr>`, rows,{cls:"chain"}),{cls:"wide",meta:`spot ${px(spot)}`})}
   ${panel(short(sym)+" OMON","What options are pricing in",`Expected move uses the at-the-money straddle (buying both the call and the put at the ${nf(atm,0)} strike).`,
     `<div class="kv pad" style="grid-template-columns:max-content 1fr;gap:6px 18px"><span>Days to expiry</span><b>${days}</b><span>Expected move by expiry</span><b>±$${nf(straddle,2)} (±${nf(straddle/spot*100,1)}%)</b><span>Range implied</span><b>${px(spot-straddle)} – ${px(spot+straddle)}</b><span>Put/call open interest</span><b>${nf(pcOI,2)} ${pcOI>1.2?"(defensive)":pcOI<0.7?"(bullish tilt)":""}</b><span>Put/call volume today</span><b>${nf(pcV,2)}</b></div>`)}
   ${panel(short(sym)+" OMON","Volatility smile","Implied volatility at each strike. Higher IV on low strikes means traders are paying up for crash protection.", chartSlot(smile,{h:220,custom:drawXY,vline:spot,fx:v=>nf(v,0),fy:v=>nf(v,0)+"%"}))}</div>`;
};

/* Congress */
V.CONG = () => {
  if(S.live && !D.at.house){ D.at.house=Date.now(); loadHouse(); }
  const q=(S.route.filter||"").toUpperCase(); const list=D.house.filter(h=>!q||(h.name+" "+h.state).toUpperCase().includes(q));
  const rows=list.slice(0,80).map(h=>`<tr><td>${esc(h.name)}</td><td>${esc(h.state)}</td><td>${esc(h.date)}</td><td><a href="https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${esc(h.year)}/${esc(h.doc)}.pdf" target="_blank" rel="noopener">Open report (PDF) →</a></td></tr>`).join("");
  return `<div class="grid">${panel("CONG","Congress stock trades (House)","Members of Congress must report stock trades within 45 days. These are the official periodic transaction reports from the House Clerk, newest first. Each report lists the stocks, dates and dollar ranges.",
    `<form class="form tight" id="congform"><label for="congq">Find a member or state<input id="congq" value="${esc(S.route.filter||"")}" placeholder="e.g. Pelosi or CA"></label><button class="btn ghost" type="submit">FILTER</button></form>`+
    (rows?table(`<tr><th>Member</th><th>District</th><th>Filed</th><th>Report</th></tr>`, rows):empty(S.live?"Loading the House index…":"No reports match.")),{cls:"wide"})}
    ${panel("CONG","Senate","The Senate publishes its reports on a separate site that has no free data feed.", `<div class="pad"><a href="https://efdsearch.senate.gov/search/" target="_blank" rel="noopener">Search Senate financial disclosures →</a></div>`)}
    ${panel("MOOD","Reddit chatter","Most-mentioned stocks across Reddit investing forums in the last 24 hours (ApeWisdom). A jump in mentions often comes before or with big moves.", redditTable(15))}</div>`;
};
function redditTable(n){
  if(!D.reddit.length) return empty(S.live?"Loading…":"No data.");
  return table(`<tr><th>#</th><th>Ticker</th><th>Mentions</th><th>vs yesterday</th><th>Rank move</th></tr>`, D.reddit.slice(0,n).map(r=>{ const ch=r.prev?(r.mentions/r.prev-1)*100:null; const rm=r.prevRank?r.prevRank-r.rank:null;
    return `<tr class="r" data-run="${esc(r.sym)} GP"><td>${r.rank}</td><td><span class="tk">${esc(r.sym)}</span><span class="sub">${esc(r.name)}</span></td><td>${nf(r.mentions,0)}</td><td class="${cls(ch)}">${ch!=null?pctS(ch,0):"new"}</td><td class="${cls(rm)}">${rm?sgn(rm,0):"—"}</td></tr>`; }).join(""));
}
