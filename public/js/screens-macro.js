/* Openfloor — economy, calendar, yield curve, recession watch, personal economy. */
"use strict";
const fredPts = id => (D.fred[id]?.s||[]).map(([d,v])=>[Date.parse(d)/1000,v]);
function yoy(id, step=12){ const s=D.fred[id]?.s||[]; const out=[]; for(let i=step;i<s.length;i++) out.push([Date.parse(s[i][0])/1000,(s[i][1]/s[i-step][1]-1)*100]); return out; }
const lastP = pts => pts[pts.length-1];
function ecoCard(code,title,ex,pts,unit,dp=2,sub){
  const l=lastP(pts), p=pts[Math.max(0,pts.length-2)]; if(!l) return "";
  const d=l[1]-p[1];
  return panel(code,title,ex,`<div class="ec"><div class="big">${nf(l[1],dp)}${unit}</div><div class="d"><span class="${cls(d)}">${sgn(d,dp)}</span> vs prior reading · ${dstr(l[0]*1000)}${sub?" · "+sub:""}</div></div>`+chartSlot(pts.slice(-160),{h:150,fmt:v=>nf(v,1),noPct:1,color:getCss("--amber")}));
}
V.ECO = () => `<div class="cards">
   ${ecoCard("ECO","Inflation (CPI, yearly)","How much consumer prices rose over the past 12 months. The Fed aims for about 2%.",yoy("CPIAUCSL"),"%",1)}
   ${ecoCard("ECO","Core inflation","Inflation without food and energy, which jump around. The Fed watches this closely.",yoy("CPILFESL"),"%",1)}
   ${ecoCard("ECO","Unemployment rate","Share of people who want a job but do not have one.",fredPts("UNRATE"),"%",1)}
   ${ecoCard("ECO","Fed funds rate","The Federal Reserve's main interest rate. It sets the base cost of borrowing across the economy.",fredPts("FEDFUNDS"),"%",2)}
   ${ecoCard("GC","10-year Treasury yield","The benchmark long-term US interest rate. Mortgages follow it closely.",fredPts("DGS10"),"%",2)}
   ${ecoCard("PECO","30-year mortgage rate","Average US 30-year fixed mortgage rate from Freddie Mac's weekly survey.",fredPts("MORTGAGE30US"),"%",2)}
   ${ecoCard("REC","High-yield credit spread","Extra yield investors demand to lend to riskier companies. Rising spreads signal stress.",fredPts("BAMLH0A0HYM2"),"%",2)}
   ${ecoCard("REC","Weekly jobless claims (4-week average)","New unemployment claims. A steady rise often comes before layoffs spread.",fredPts("IC4WSA"),"",0)}
   ${ecoCard("REC","Consumer sentiment","University of Michigan survey of how people feel about the economy.",fredPts("UMCSENT"),"",1)}
   ${ecoCard("REC","Real GDP growth","Economic growth after inflation, at a yearly pace, by quarter.",fredPts("A191RL1Q225SBEA"),"%",1)}
  </div>`;

/* ---------- calendar ---------- */
function calEvents(){
  const today=new Date().toISOString().slice(0,10); const ev=[];
  (D.fomc||[]).filter(d=>d>=today).slice(0,3).forEach(d=>ev.push({date:d,kind:"FED",title:"Fed interest-rate decision (FOMC)",run:"PRED"}));
  (D.releases||[]).filter(r=>r.date>=today).forEach(r=>ev.push({date:r.date,kind:"ECO",title:r.name,run:"ECO"}));
  const mine=new Set([...S.watch,...(PORT.positions||[]).map(p=>p.sym)]);
  D.earnings.filter(e=>e.date>=today && (mine.has(e.sym) || (e.mcap||0)>3e11)).forEach(e=>ev.push({date:e.date,kind:"ERN",title:`${e.sym} earnings${e.time==="time-pre-market"?" (before open)":e.time==="time-after-hours"?" (after close)":""}`,run:e.sym+" ERN",mine:mine.has(e.sym)}));
  return ev.sort((a,b)=>a.date.localeCompare(b.date) || (a.kind==="FED"?-1:1));
}
function calList(ev){
  if(!ev.length) return empty("Nothing scheduled.");
  return `<ul class="news">${ev.map(e=>`<li><span class="tm">${new Date(e.date+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span><button class="lnk left" data-run="${esc(e.run)}">${chip(e.kind,e.kind==="FED"?"warn":e.kind==="ERN"&&e.mine?"good":"")} ${esc(e.title)}</button><span class="s">${new Date(e.date+"T12:00:00Z").toLocaleDateString("en-US",{weekday:"long"})}</span></li>`).join("")}</ul>`;
}
V.CAL = () => {
  if(S.live){ if(!D.at.earnings&&!S.busy.ern) loadEarnings(); if(S.server.fred&&!D.releases&&!S.busy.rel){ S.busy.rel=1; loadReleaseCalendar().then(()=>{ delete S.busy.rel; rerender(); }); } }
  return `<div class="grid">${panel("CAL","Market calendar","Fed meetings, major US economic reports and earnings for your stocks (plus the very largest companies) over the coming weeks.", calList(calEvents().slice(0,60)),{cls:"wide"})}
    ${panel("CAL","About the dates",null, `<div class="pad fl">Fed meeting dates come from the Federal Reserve's own calendar. ${S.server.fred?"Economic report dates come from the St. Louis Fed (FRED).":"Add a free FRED key (setup step 9) to also see CPI, jobs, GDP, retail sales and other report dates."} Earnings dates come from Nasdaq and can shift.</div>`)}</div>`;
};

/* ---------- yield curve ---------- */
const TENORS = [["DGS3MO","3M",0.25],["DGS2","2Y",2],["DGS5","5Y",5],["DGS10","10Y",10],["DGS30","30Y",30]];
function curveAt(back){ return TENORS.map(([id,l,m])=>{ const s=D.fred[id]?.s||[]; const p=s[Math.max(0,s.length-1-back)]; return p?[m,p[1],l,p[0]]:null; }).filter(Boolean); }
function curveBody(compact){
  const now=curveAt(0), m1=curveAt(4), y1=curveAt(52); if(!now.length) return empty("No yield data.");
  const rows = TENORS.map(([id,l],i)=>{ const a=now[i],b=m1[i],c=y1[i]; if(!a) return ""; const d1=a[1]-b[1], dy=a[1]-c[1];
    return `<tr class="r" data-run="GC"><td><span class="tk">${l}</span></td><td>${nf(a[1],2)}%</td><td class="${cls(d1)}">${sgn(d1*100,0)} bp</td><td class="${cls(dy)}">${sgn(dy*100,0)} bp</td></tr>`; }).join("");
  return (compact?"":chartSlot([now,m1,y1],{h:260,custom:drawCurve,label:"Yield curve"})) + table(`<tr><th>Maturity</th><th>Yield</th><th>1 mo chg</th><th>1 yr chg</th></tr>`, rows) + `<div class="ex" style="border:0">Source: FRED, as of ${esc(now[0][3])}. 1 bp (basis point) = 0.01%.</div>`;
}
V.GC = () => { const l=lastP(D.fred.T10Y2Y?.s||[]);
  return `<div class="grid">${panel("GC","US Treasury yield curve","Each point is the yield on US government debt of a given length. Normally longer loans pay more, so the line slopes up. A downward slope (inverted curve) has often come before recessions.", curveBody(false),{cls:"wide",meta:l?`10Y–2Y: <span class="${cls(l[1])}">${sgn(l[1],2)}%</span>`:""})}
    ${panel("REC","10Y – 3M spread history","The gap between 10-year and 3-month yields, the version of the curve most tied to past recessions. Below the dashed line means inverted.", chartSlot(fredPts("T10Y3M"),{h:220,base:0,fmt:v=>nf(v,2),noPct:1,color:getCss("--amber")}))}</div>`; };

/* ---------- recession watch ---------- */
function recIndicators(){
  const L=id=>lastP(D.fred[id]?.s||[])?.[1]; const S_=id=>D.fred[id]?.s||[];
  const out=[];
  const add=(id,name,val,fmt,level,why)=>{ if(val==null||isNaN(val)) return; out.push({id,name,val,fmt,level,why}); };
  const yc=L("T10Y3M"); add("T10Y3M","Yield curve (10Y − 3M)",yc,v=>sgn(v,2)+"%", yc<0?2:yc<0.5?1:0, "Inverted (below 0) has come before most US recessions.");
  const sahm=L("SAHMREALTIME"); add("SAHMREALTIME","Sahm rule (jobs)",sahm,v=>nf(v,2), sahm>=0.5?2:sahm>=0.3?1:0, "0.50 or more has marked the start of every recession since 1970.");
  const hy=L("BAMLH0A0HYM2"), hy3=(S_("BAMLH0A0HYM2").slice(-14)[0]||[])[1]; add("BAMLH0A0HYM2","High-yield credit spread",hy,v=>nf(v,2)+"%", hy>6?2:(hy>4.5||(hy3&&hy-hy3>1))?1:0, "Above 6% shows serious credit stress; a fast rise is a warning.");
  const cl=S_("IC4WSA"); if(cl.length>60){ const lo=Math.min(...cl.slice(-52).map(x=>x[1])), v=cl[cl.length-1][1], r=(v/lo-1)*100; add("IC4WSA","Jobless claims vs. 1-year low",r,v=>pctS(v,0), r>20?2:r>10?1:0, "Claims rising 20%+ off their low has preceded past downturns."); }
  const cs=L("UMCSENT"); add("UMCSENT","Consumer sentiment",cs,v=>nf(v,1), cs<60?2:cs<70?1:0, "Readings in the 50s have been typical of recessions.");
  const cf=L("CFNAIMA3"); add("CFNAIMA3","Chicago Fed activity (3-mo avg)",cf,v=>nf(v,2), cf<-0.7?2:cf<-0.35?1:0, "Below −0.70 has signalled a likely recession.");
  const pm=S_("PERMIT"); if(pm.length>13){ const r=(pm[pm.length-1][1]/pm[pm.length-13][1]-1)*100; add("PERMIT","Building permits (yearly change)",r,v=>pctS(v,1), r<-15?2:r<-5?1:0, "Housing usually turns down well before the wider economy."); }
  const gdp=L("A191RL1Q225SBEA"); add("A191RL1Q225SBEA","Real GDP growth (latest quarter)",gdp,v=>pctS(v,1), gdp<0?2:gdp<1?1:0, "A negative quarter means the economy shrank.");
  return out;
}
function recScore(){ const ind=recIndicators(); if(!ind.length) return null; return Math.round(ind.reduce((s,i)=>s+i.level,0)/(ind.length*2)*100); }
V.REC = () => {
  const ind=recIndicators(), score=recScore();
  const lv=["good","warn","bad"], word=["Normal","Watch","Warning"];
  recordClient("rec:score", score);
  const hist=HISTC["rec:score"];
  if(S.priv && !hist) loadHist("rec:score",365);
  return `<div class="grid">${panel("REC","Recession watch","Eight indicators economists use to spot a coming recession, each rated normal, watch or warning by fixed rules. The score is the share of warning points out of the maximum. It is a dashboard, not a forecast.",
      `<div class="gauge"><div class="gv ${score>=50?"dn":score>=25?"warnc":"up"}">${score??"—"}</div><div><b>${score>=50?"Elevated risk":score>=25?"Some warning signs":"Low risk"}</b><div class="fl">0 = every indicator normal · 100 = every indicator flashing</div></div></div>`+
      table(`<tr><th>Indicator</th><th>Now</th><th>Status</th><th class="tl">Rule of thumb</th></tr>`, ind.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.fmt(i.val)}</td><td>${chip(word[i.level],lv[i.level])}</td><td style="white-space:normal;max-width:360px" class="fl tl">${esc(i.why)}</td></tr>`).join("")),{cls:"wide"})}
    ${hist&&hist.length>1?panel("HIST","Score history","Saved once a day by your hosted copy.", chartSlot(hist.map(([t,v])=>[t/1000,v]),{h:180,noPct:1,fmt:v=>nf(v,0),color:getCss("--amber")})):""}
    ${panel("ECO","Sahm rule","The Sahm rule compares the recent unemployment rate with its low over the past year.", chartSlot(fredPts("SAHMREALTIME"),{h:180,base:0.5,noPct:1,fmt:v=>nf(v,2),color:getCss("--amber")}))}</div>`;
};

/* ---------- personal economy ---------- */
const PECO_CATS = [["CUSR0000SAF11","Groceries",600],["CUSR0000SEHA","Rent",1600],["CUSR0000SEHF01","Electricity",160],["CUSR0000SETB01","Gasoline",220],["CUSR0000SAS4","Car insurance, repairs, fares",170],["CPIMEDSL","Medical care",220],["CUSR0000SEFV","Eating out",320],["CUSR0000SETA02","Used cars",0],["CUSR0000SETA01","New cars",0]];
S.peco = store.get("peco", Object.fromEntries(PECO_CATS.map(c=>[c[0],c[2]])));
S.mort = store.get("mort", {price:400000, down:20, years:30});
V.PECO = () => {
  const rows=PECO_CATS.map(([id,n])=>{ const y=lastP(yoy(id)); return {id,n,y:y?y[1]:null,amt:+S.peco[id]||0}; });
  const spend=rows.reduce((s,r)=>s+r.amt,0); const mine=spend?rows.reduce((s,r)=>s+(r.y||0)*r.amt,0)/spend:null; const head=lastP(yoy("CPIAUCSL"))?.[1];
  const mx=Math.max(...rows.map(r=>Math.abs(r.y||0)),1);
  const calc=`<form class="form" id="pecoform">${rows.map(r=>`<label for="pe_${r.id}">${esc(r.n)} $/mo<input id="pe_${r.id}" data-peco="${r.id}" type="number" step="any" min="0" value="${r.amt}"></label>`).join("")}</form>`;
  const gas=lastP(fredPts("GASREGW")), m30=lastP(fredPts("MORTGAGE30US")), m15=lastP(fredPts("MORTGAGE15US")), tb=lastP(fredPts("DGS3MO"));
  const M=S.mort, rate=(M.years==15?m15:m30)?.[1]||6.5, P0=M.price*(1-M.down/100), r=rate/100/12, n=M.years*12, pay=r? P0*r/(1-Math.pow(1+r,-n)) : P0/n;
  const yr1=fredPts(M.years==15?"MORTGAGE15US":"MORTGAGE30US").slice(-53)[0]?.[1]; const pay1=yr1?(P0*(yr1/1200)/(1-Math.pow(1+yr1/1200,-n))):null;
  return `<div class="grid">${panel("PECO","Your personal inflation rate","Prices don't rise evenly. Enter roughly what you spend each month and the terminal weights the official price changes for each category by your own spending.",
      `<div class="tiles"><div><span>Your inflation</span><b class="${mine>head?"dn":"up"}">${mine!=null?nf(mine,1)+"%":"—"}</b></div><div><span>Official CPI</span><b>${head!=null?nf(head,1)+"%":"—"}</b></div><div><span>Extra cost this year</span><b>${mine!=null?usd(spend*12*mine/100):"—"}</b></div></div>`+
      table(`<tr><th>Category</th><th>Price change (1 yr)</th><th>You spend</th></tr>`, rows.map(r=>`<tr><td>${esc(r.n)}</td><td>${hbar(r.y||0,mx,(r.y||0)>=0?"var(--down)":"var(--up)")} <span class="${(r.y||0)>0?"dn":"up"}">${r.y!=null?pctS(r.y,1):"—"}</span></td><td>${usd(r.amt)}/mo</td></tr>`).join(""))+calc,{cls:"wide"})}
    ${panel("PECO","Gas, mortgages and savings","The everyday rates that hit your wallet.",
      `<div class="kv pad" style="grid-template-columns:max-content 1fr;gap:6px 18px"><span>Regular gas (US avg)</span><b>${gas?"$"+nf(gas[1],2)+"/gal":"—"}</b><span>30-yr mortgage</span><b>${m30?nf(m30[1],2)+"%":"—"}</b><span>15-yr mortgage</span><b>${m15?nf(m15[1],2)+"%":"—"}</b><span>3-mo Treasury (cash rate)</span><b>${tb?nf(tb[1],2)+"%":"—"}</b><span>Cash after inflation</span><b class="${tb&&head!=null?cls(tb[1]-head):""}">${tb&&head!=null?sgn(tb[1]-head,1)+"% a year":"—"}</b></div>`+chartSlot(fredPts("GASREGW").slice(-160),{h:150,fmt:v=>"$"+nf(v,2),noPct:1,color:getCss("--amber")}))}
    ${panel("PECO","Mortgage payment","Monthly principal and interest at today's average rate. Taxes and insurance are extra.",
      `<form class="form" id="mortform"><label for="mo_price">Home price<input id="mo_price" type="number" step="1000" value="${M.price}"></label><label for="mo_down">Down payment %<input id="mo_down" type="number" step="1" value="${M.down}"></label><label for="mo_years">Term<select id="mo_years"><option value="30"${M.years==30?" selected":""}>30 years</option><option value="15"${M.years==15?" selected":""}>15 years</option></select></label></form>
       <div class="tiles"><div><span>Monthly payment</span><b>${usd(pay)}</b></div><div><span>Rate used</span><b>${nf(rate,2)}%</b></div><div><span>Same loan a year ago</span><b>${pay1?usd(pay1):"—"}</b></div></div>`)}</div>`;
};
