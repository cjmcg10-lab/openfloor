/* Openfloor — live data loaders. They run only on your hosted copy, through its private proxy. */
"use strict";
D.at = D.at || {};
const P = (u, opt={}) => fetch("/api/p?u="+encodeURIComponent(u), opt.body ? {method:"POST", headers:{"Content-Type":"application/json","X-Openfloor":"1"}, body:opt.body} : {});
const PJ = async (u, opt) => { const r=await P(u, opt); if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); };
async function pool(items, n, fn){ const out=[]; let i=0; await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{ while(i<items.length){ const k=i++; try{ out[k]=await fn(items[k]); }catch(e){ out[k]=null; } } })); return out; }
const grpOf = s => Object.keys(GROUPS).find(g=>GROUPS[g].includes(s)) || (/-USD$/.test(s)?"crypto":"eq");

/* Small browser cache for big, slow-changing downloads (screener universe, funds). */
const IDB = {
  db:null,
  async open(){ if(this.db) return this.db; return this.db = await new Promise((res,rej)=>{ try{ const r=indexedDB.open("openfloor",1); r.onupgradeneeded=()=>r.result.createObjectStore("c"); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }catch(e){ rej(e); } }); },
  async get(k, maxAgeMs){ try{ const db=await this.open(); const v=await new Promise(res=>{ const t=db.transaction("c").objectStore("c").get(k); t.onsuccess=()=>res(t.result); t.onerror=()=>res(null); }); return v && Date.now()-v.t < maxAgeMs ? v.v : null; }catch(e){ return null; } },
  async set(k, v){ try{ const db=await this.open(); db.transaction("c","readwrite").objectStore("c").put({t:Date.now(),v},k); }catch(e){} }
};

/* ---------- prices ---------- */
async function loadSpark(list){
  list=[...new Set(list)].filter(Boolean);
  const chunks=[]; for(let i=0;i<list.length;i+=20) chunks.push(list.slice(i,i+20));
  await pool(chunks, 3, async ch=>{
    const j=await PJ(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(ch.join(","))}&range=1d&interval=5m`);
    (j.spark?.result||[]).forEach(r=>{ const x=r.response&&r.response[0]; if(!x) return; const m=x.meta||{}, sym=r.symbol;
      const q = D.q[sym] || (D.q[sym]={name:m.shortName||sym,grp:grpOf(sym),s:[],needHist:true});
      q.px=m.regularMarketPrice; q.prev=m.previousClose ?? m.chartPreviousClose ?? q.prev; q.dayhi=m.regularMarketDayHigh; q.daylo=m.regularMarketDayLow;
      q.vol=m.regularMarketVolume; q.hi52=m.fiftyTwoWeekHigh ?? q.hi52; q.lo52=m.fiftyTwoWeekLow ?? q.lo52; q.t=m.regularMarketTime; q.ex=q.ex||m.fullExchangeName; q.cur=m.currency;
      if(!q.name || q.name===sym) q.name=m.longName||m.shortName||sym;
      const cl=x.indicators?.quote?.[0]?.close||[]; D.intraday[sym]=(x.timestamp||[]).map((t,i)=>[t,cl[i]]).filter(p=>p[1]!=null);
      // keep the last daily point in step with the live price
      if(q.s && q.s.length && q.px!=null){ const lastDay=Math.floor(q.s[q.s.length-1][0]/86400), today=Math.floor((q.t||Date.now()/1000)/86400); if(lastDay===today) q.s[q.s.length-1][1]=q.px; }
    });
  });
  D.at.quotes=Date.now();
}
function parseChart(sym, j, grp){
  const r=j.chart.result[0], m=r.meta, q=r.indicators.quote[0]; const s=[], o=[];
  (r.timestamp||[]).forEach((t,i)=>{ const c=q.close[i]; if(c==null) return; s.push([t,+c.toFixed(4)]); o.push([q.high[i]??c, q.low[i]??c, q.volume[i]||0]); });
  return {name:m.longName||m.shortName||sym,px:m.regularMarketPrice,prev:s.length>1?s[s.length-2][1]:m.chartPreviousClose,cur:m.currency,ex:m.fullExchangeName,
    hi52:m.fiftyTwoWeekHigh,lo52:m.fiftyTwoWeekLow,vol:m.regularMarketVolume,dayhi:m.regularMarketDayHigh,daylo:m.regularMarketDayLow,t:m.regularMarketTime,grp,s,ohlv:o};
}
async function loadHistory(sym, force){
  const q=D.q[sym]; if(q && q.histAt && !force && Date.now()-q.histAt<30*60e3) return;
  const key="h:"+sym; if(S.busy[key]) return; S.busy[key]=1;
  try{ const g=grpOf(sym); const j=await PJ(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`);
    const nq=parseChart(sym,j,g); const old=D.q[sym]; if(old){ nq.long=old.long; if(old.px!=null&&old.t>nq.t){ nq.px=old.px; nq.prev=old.prev; } } nq.histAt=Date.now(); D.q[sym]=nq; }
  catch(e){} delete S.busy[key];
}
async function ensureHistory(list){ await pool(list.filter(s=>!D.q[s]||!D.q[s].s||D.q[s].s.length<30||D.q[s].needHist), 4, s=>loadHistory(s,true)); }
async function loadLong(sym, r){
  const key="long:"+sym+r; if(S.busy[key]) return; S.busy[key]=1;
  try{ const j=await PJ(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${r==="5Y"?"5y":"max"}&interval=${r==="5Y"?"1wk":"1mo"}`);
    const q=D.q[sym]; if(q){ q.long=q.long||{}; const p=parseChart(sym,j,q.grp); q.long[r]=p.s; q.longO=q.longO||{}; q.longO[r]=p.ohlv; } }catch(e){}
  delete S.busy[key]; rerender();
}
async function loadCrypto(){
  const j=await PJ("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=16&page=1&sparkline=true&price_change_percentage=24h,7d");
  const ws={}; (D.crypto||[]).forEach(c=>ws[c.sym]=c.wsAt?c:null);
  D.crypto=j.filter(c=>!["usdt","usdc","dai","usde","usds","figr_heloc","usd1","pyusd"].includes(c.symbol)).slice(0,10).map(c=>{ const sym=c.symbol.toUpperCase(), live=ws[sym];
    return {id:c.id,sym,name:c.name,px:live&&Date.now()-live.wsAt<60e3?live.px:c.current_price,mc:c.market_cap,vol:c.total_volume,ch24:c.price_change_percentage_24h_in_currency,ch7:c.price_change_percentage_7d_in_currency,spark:(c.sparkline_in_7d?.price||[]).filter((_,i)=>i%4===0),wsAt:live?.wsAt}; });
  D.at.crypto=Date.now();
}
/* ---------- macro ---------- */
const FRED_DAILY = new Set(["DGS3MO","DGS2","DGS5","DGS10","DGS30","T10Y2Y","T10Y3M","BAMLH0A0HYM2"]);
async function loadFred(ids){
  await pool(ids, 4, async id=>{ const r=await P(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=2019-01-01`); if(!r.ok) return;
    const rows=(await r.text()).trim().split("\n").slice(1).map(l=>l.split(",")).filter(x=>x[1]&&x[1]!=="."&&x[1]!=="").map(x=>[x[0],+x[1]]);
    let pts=rows; if(FRED_DAILY.has(id)) pts=rows.slice(-780).reverse().filter((_,i)=>i%5===0).reverse();
    D.fred[id]={...(D.fred[id]||{name:id}), s:pts}; });
  D.at.fred=Date.now();
}
async function loadMacro(){
  Object.entries(FRED_NAMES).forEach(([k,n])=>{ if(!D.fred[k]) D.fred[k]={name:n,s:[]}; });
  await loadFred(Object.keys(FRED_NAMES));
  try{ D.ecb=await PJ("https://api.frankfurter.dev/v1/latest?base=USD"); }catch(e){}
}
/* ---------- news, prediction markets ---------- */
async function loadNews(syms){
  syms.forEach(s=>S.busy["n:"+s]=1);
  const got=await pool(syms, 4, async s=>{ const r=await P(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(s==="MKT"?"^GSPC":s)}&region=US&lang=en-US`); if(!r.ok) return [];
    const x=new DOMParser().parseFromString(await r.text(),"text/xml");
    return [...x.querySelectorAll("item")].map(it=>({sym:s,title:it.querySelector("title")?.textContent,url:it.querySelector("link")?.textContent,date:it.querySelector("pubDate")?.textContent,src:"Yahoo Finance"})); });
  const fresh=got.flat().filter(n=>n&&n.title);
  const keep=D.news.filter(n=>!syms.includes(n.sym)); const seen=new Set();
  D.news=[...fresh,...keep].filter(n=>!seen.has(n.title)&&seen.add(n.title)).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,200);
  syms.forEach(s=>delete S.busy["n:"+s]); D.at.news=Date.now(); rerender();
}
async function loadPM(){
  const j=await PJ("https://gamma-api.polymarket.com/markets?limit=200&active=true&closed=false&order=volume24hr&ascending=false");
  const bad=/^(nba|nfl|mlb|nhl|ucl|epl|uel|lal|sea|bun|fl1|cfb|cbb|atp|wta|ufc|mls|ipl|cs2|lol|dota|val|kbo|npb|f1)-/;
  const out=[]; for(const m of j){ const s=m.slug||""; if(bad.test(s)||/ vs\.? |win on 20|Up or Down|Champions League|Ballon/i.test(m.question)) continue;
    try{ out.push({id:m.id,q:m.question,out:JSON.parse(m.outcomes),p:JSON.parse(m.outcomePrices).map(Number),vol24:m.volume24hr,end:m.endDate,slug:s,ch1d:m.oneDayPriceChange}); }catch(e){} if(out.length>=16) break; }
  if(out.length) D.pm=out; D.at.pm=Date.now();
}
/* ---------- SEC company data ---------- */
let TICK=null;
async function secTickers(){ if(TICK) return TICK; const cached=await IDB.get("tickers", 7*864e5); if(cached) return TICK=cached;
  const j=await PJ("https://www.sec.gov/files/company_tickers.json"); TICK={}; Object.values(j).forEach(v=>TICK[v.ticker]=v.cik_str); IDB.set("tickers",TICK); return TICK; }
async function loadSec(sym){
  const key="sec:"+sym; if(S.busy[key]) return; S.busy[key]=1; rerender();
  try{
    const T=await secTickers(); const cik=T[sym.replace(".","-")]||T[sym]; if(!cik) throw 0; const pad=String(cik).padStart(10,"0");
    const sub=await PJ(`https://data.sec.gov/submissions/CIK${pad}.json`);
    const concept=async(tags,unit="USD",inst=false)=>{ const by={};
      for(const tg of tags){ try{ const r=await P(`https://data.sec.gov/api/xbrl/companyconcept/CIK${pad}/us-gaap/${tg}.json`); if(!r.ok) continue;
        const j=await r.json(); (j.units[unit]||[]).filter(a=>a.form==="10-K"&&a.fp==="FY").forEach(a=>{
          if(!a.end) return; if(a.start){ const days=(Date.parse(a.end)-Date.parse(a.start))/864e5; if(days<350||days>380) return; } else if(!inst) return;
          const y=a.end.slice(0,4); if(!(y in by)) by[y]=a.val; }); }catch(e){} }
      return Object.keys(by).sort().slice(-5).map(k=>[k,by[k]]); };
    const [rev,ni,eps,cash,debt,shs]=await Promise.all([concept(["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","SalesRevenueNet","RevenuesNetOfInterestExpense"]),concept(["NetIncomeLoss"]),
      concept(["EarningsPerShareDiluted"],"USD/shares"),concept(["CashAndCashEquivalentsAtCarryingValue"],"USD",true),concept(["LongTermDebtNoncurrent","LongTermDebt"],"USD",true),concept(["WeightedAverageNumberOfDilutedSharesOutstanding"],"shares")]);
    const rc=sub.filings.recent, major=new Set(["10-K","10-Q","8-K","DEF 14A","S-1","SC 13G","SC 13G/A","SCHEDULE 13G","SCHEDULE 13G/A","20-F","6-K","40-F"]), fl=[]; let n4=0, nm=0;
    for(let i=0;i<rc.form.length&&(nm<14||n4<8);i++){ const f=rc.form[i]; const isM=major.has(f), is4=f==="4"; if((isM&&nm<14)||(is4&&n4<8)){ isM?nm++:n4++;
      fl.push({form:f,date:rc.filingDate[i],desc:rc.primaryDocDescription[i],url:`https://www.sec.gov/Archives/edgar/data/${cik}/${rc.accessionNumber[i].replace(/-/g,"")}/${rc.primaryDocument[i]}`}); } }
    D.sec[sym]={cik,name:sub.name,sic:sub.sicDescription,state:sub.stateOfIncorporation,fye:sub.fiscalYearEnd,addr:sub.addresses?.business?.city,filings:fl,rev,ni,eps,cash,debt,shares:shs.length?shs[shs.length-1][1]:null};
  }catch(e){ D.sec[sym]=D.sec[sym]||null; }
  delete S.busy[key]; rerender();
}
/* Whole-market screener universe: Nasdaq listings + SEC XBRL "frames" (one figure for every company per call). */
async function loadUniverse(force){
  if(S.busy.uni) return; S.busy.uni=1;
  try{
    const cached = !force && await IDB.get("universe", 6*3600e3);
    if(cached){ D.universe=cached; UNI=null; }
    else {
      const [scr,T] = await Promise.all([PJ("https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true"), secTickers()]);
      const yr = new Date().getUTCFullYear()-1;
      const frame = async (tag,y)=>{ try{ const j=await PJ(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/CY${y}.json`); const m={}; j.data.forEach(r=>m[r.cik]=r.val); return m; }catch(e){ return {}; } };
      const [r1,r2,p1,p2,ni]=await Promise.all([frame("Revenues",yr),frame("RevenueFromContractWithCustomerExcludingAssessedTax",yr),frame("Revenues",yr-1),frame("RevenueFromContractWithCustomerExcludingAssessedTax",yr-1),frame("NetIncomeLoss",yr)]);
      const rev={...r1,...r2}, revp={...p1,...p2}; const rows=[];
      (scr.data?.rows||[]).forEach(r=>{ const mc=num(r.marketCap), pxv=num(r.lastsale); if(!mc||mc<3e8||!pxv) return;
        const sym=r.symbol.trim().replace("/","."); const cik=T[sym.replace(".","-")]||T[sym];
        const name=r.name.trim().replace(/\s+(Common Stock|Class [A-C] Common Stock|Ordinary Shares|American Depositary Shares.*|Common Shares).*$/,"");
        rows.push([sym,name.slice(0,48),r.sector||"",r.industry||"",pxv,num(r.pctchange),Math.round(mc),Math.round(num(r.volume)||0),rev[cik]??null,revp[cik]??null,ni[cik]??null,r.country||""]); });
      D.universe={year:yr,cols:["sym","name","sector","industry","px","chg","mcap","vol","rev","revPrev","ni","country"],rows}; UNI=null; IDB.set("universe",D.universe);
    }
    D.at.universe=Date.now();
  }catch(e){ toast("Could not load the screener data right now."); }
  delete S.busy.uni; rerender();
}
/* ---------- research feeds ---------- */
async function loadOptions(sym){
  const key="opt:"+sym; if(S.busy[key]) return; S.busy[key]=1; rerender();
  try{ const j=await PJ(`https://cdn-api.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(sym.replace("^","_"))}.json`);
    const d=j.data, spot=d.current_price||Q(sym)?.px; const rows=[];
    d.options.forEach(o=>{ const m=o.option.match(/^([A-Z._]+)(\d{6})([CP])(\d{8})$/); if(!m) return; const k=+m[4]/1000; if(spot&&Math.abs(k/spot-1)>0.3) return;
      rows.push([m[2],m[3],k,o.bid,o.ask,o.last_trade_price,+(o.iv||0).toFixed(4),+(o.delta||0).toFixed(3),Math.round(o.open_interest||0),Math.round(o.volume||0)]); });
    const exps=[...new Set(rows.map(r=>r[0]))].sort().slice(0,10);
    D.options[sym]={spot,time:j.timestamp,rows:rows.filter(r=>exps.includes(r[0]))};
  }catch(e){ D.options[sym]={error:true}; }
  delete S.busy[key]; rerender();
}
const NAS = p => PJ("https://api.nasdaq.com/api/"+p);
async function loadInsiders(sym){
  const key="ins:"+sym; if(S.busy[key]) return; S.busy[key]=1;
  try{ const d=(await NAS(`company/${sym}/insider-trades?limit=40&type=ALL&sortColumn=lastDate&sortOrder=DESC`)).data;
    D.insiders[sym]={summary:[...d.numberOfTrades.rows,...d.numberOfSharesTraded.rows],rows:d.transactionTable.table.rows}; }catch(e){ D.insiders[sym]={rows:[],summary:[],error:true}; }
  delete S.busy[key]; rerender();
}
async function loadHolders(sym){
  const key="hds:"+sym; if(S.busy[key]) return; S.busy[key]=1;
  try{ const d=(await NAS(`company/${sym}/institutional-holdings?limit=15&type=TOTAL&sortColumn=marketValue&sortOrder=DESC`)).data;
    D.holders[sym]={summary:d.ownershipSummary,active:d.activePositions.rows,newsold:d.newSoldOutPositions.rows,rows:d.holdingsTransactions.table.rows}; }catch(e){ D.holders[sym]={rows:[],error:true}; }
  delete S.busy[key]; rerender();
}
async function loadEarnings(){
  if(S.busy.ern) return; S.busy.ern=1;
  const dates=[]; let d=new Date(); while(dates.length<10){ if(d.getDay()%6) dates.push(d.toISOString().slice(0,10)); d=new Date(d.getTime()+864e5); }
  const got=await pool(dates,3,async dt=>{ const j=await NAS(`calendar/earnings?date=${dt}`); return (j.data?.rows||[]).map(r=>({date:dt,sym:r.symbol,name:r.name.trim(),time:r.time,mcap:num(r.marketCap),eps:r.epsForecast,ests:r.noOfEsts,lastEps:r.lastYearEPS,q:r.fiscalQuarterEnding})).filter(r=>(r.mcap||0)>2e9); });
  D.earnings=got.flat().filter(Boolean); D.at.earnings=Date.now(); delete S.busy.ern; rerender();
}
async function loadSurprises(sym){
  if(!S.server.finnhub || S.busy["sur:"+sym]) return; S.busy["sur:"+sym]=1;
  try{ D.surprise=D.surprise||{}; D.surprise[sym]=await PJ(`https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(sym)}`); }catch(e){}
  delete S.busy["sur:"+sym]; rerender();
}
async function loadFomc(){
  try{ const r=await P("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"); const t=await r.text(); const out=[];
    const re=/(\d{4}) FOMC Meetings<\/a><\/h4>([\s\S]*?)(?=FOMC Meetings<\/a><\/h4>|$)/g; let y;
    while((y=re.exec(t))){ const yr=+y[1]; const mr=/fomc-meeting__month[^>]*>\s*<strong>([A-Za-z\/]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([0-9\-]+)\*?/g; let m;
      while((m=mr.exec(y[2]))){ const mon=MON3.indexOf(m[1].split("/").pop().slice(0,3)); const dd=+m[2].split("-").pop(); if(mon>=0) out.push(new Date(Date.UTC(yr,mon,dd)).toISOString().slice(0,10)); } }
    if(out.length) D.fomc=[...new Set(out)].sort(); }catch(e){}
}
const FRED_RELEASES = {10:"CPI inflation",50:"Jobs report",53:"GDP",54:"PCE inflation + spending",46:"PPI (producer prices)",9:"Retail sales",192:"Job openings (JOLTS)",180:"Weekly jobless claims"};
async function loadReleaseCalendar(){
  if(!S.server.fred) return;
  const start=new Date().toISOString().slice(0,10), end=new Date(Date.now()+60*864e5).toISOString().slice(0,10);
  try{ const j=await PJ(`https://api.stlouisfed.org/fred/releases/dates?realtime_start=${start}&realtime_end=${end}&include_release_dates_with_no_data=true&limit=1000&sort_order=asc`);
    D.releases=(j.release_dates||[]).filter(r=>FRED_RELEASES[r.release_id]).map(r=>({date:r.date,id:r.release_id,name:FRED_RELEASES[r.release_id],fred:r.release_name})); }catch(e){}
}
async function loadPastReleases(id){
  if(!S.server.fred) return null; D.pastRel=D.pastRel||{}; if(D.pastRel[id]) return D.pastRel[id];
  try{ const j=await PJ(`https://api.stlouisfed.org/fred/release/dates?release_id=${id}&sort_order=desc&limit=80&include_release_dates_with_no_data=false`);
    return D.pastRel[id]=(j.release_dates||[]).map(r=>r.date).filter(d=>d<=new Date().toISOString().slice(0,10)); }catch(e){ return null; }
}
async function loadSentiment(){
  await Promise.all([
    PJ("https://apewisdom.io/api/v1.0/filter/all-stocks/page/1").then(j=>D.reddit=(j.results||[]).slice(0,40).map(r=>({sym:r.ticker,name:String(r.name).replace(/&amp;/g,"&"),mentions:r.mentions,prev:r.mentions_24h_ago,rank:r.rank,prevRank:r.rank_24h_ago,upvotes:r.upvotes}))).catch(()=>{}),
    PJ("https://api.alternative.me/fng/?limit=90").then(j=>D.cfng=(j.data||[]).map(x=>[+x.timestamp,+x.value,x.value_classification]).reverse()).catch(()=>{}),
    PJ("https://api.hyperliquid.xyz/info",{body:JSON.stringify({type:"metaAndAssetCtxs"})}).then(([meta,ctx])=>{ const keep=new Set(["BTC","ETH","SOL","XRP","BNB","DOGE","HYPE","AVAX","LINK","SUI"]);
      D.funding=meta.universe.map((u,i)=>[u,ctx[i]]).filter(([u])=>keep.has(u.name)).map(([u,c])=>({sym:u.name,funding:+c.funding,oi:+c.openInterest*+c.markPx,px:+c.markPx,prev:+c.prevDayPx,vol:+c.dayNtlVlm})); }).catch(()=>{})
  ]); D.at.sent=Date.now();
}
/* House of Representatives periodic transaction reports (official Clerk index, a small zip file) */
async function unzipFirstXml(buf){
  const dv=new DataView(buf); let e=buf.byteLength-22; while(e>0 && dv.getUint32(e,true)!==0x06054b50) e--;
  let off=dv.getUint32(e+16,true); const n=dv.getUint16(e+10,true);
  for(let i=0;i<n;i++){ const method=dv.getUint16(off+10,true), csize=dv.getUint32(off+20,true), nl=dv.getUint16(off+28,true), xl=dv.getUint16(off+30,true), cl=dv.getUint16(off+32,true), lho=dv.getUint32(off+42,true);
    const name=new TextDecoder().decode(new Uint8Array(buf,off+46,nl));
    if(/\.xml$/i.test(name)){ const lnl=dv.getUint16(lho+26,true), lxl=dv.getUint16(lho+28,true); const data=new Uint8Array(buf, lho+30+lnl+lxl, csize);
      if(method===0) return new TextDecoder().decode(data);
      const ds=new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")); return await new Response(ds).text(); }
    off+=46+nl+xl+cl; }
  return null;
}
async function loadHouse(){
  try{ const r=await P(`https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${new Date().getUTCFullYear()}FD.zip`); const xml=await unzipFirstXml(await r.arrayBuffer());
    const x=new DOMParser().parseFromString(xml,"text/xml"); const out=[];
    x.querySelectorAll("Member").forEach(m=>{ const g=t=>m.querySelector(t)?.textContent||""; if(g("FilingType")!=="P") return;
      out.push({name:[g("Prefix"),g("First"),g("Last"),g("Suffix")].filter(Boolean).join(" "),state:g("StateDst"),date:g("FilingDate"),doc:g("DocID"),year:g("Year")}); });
    out.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)); D.house=out.slice(0,80); }catch(e){}
  rerender();
}
/* Big funds' 13F reports straight from SEC */
const FUNDS = [[1067983,"Berkshire Hathaway"],[1336528,"Pershing Square"],[1350694,"Bridgewater"],[1037389,"Renaissance Technologies"],[1536411,"Duquesne Family Office"],[1656456,"Appaloosa"]];
async function infoTable(cik, acc){
  const base=`https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g,"")}/`;
  const idx=await PJ(base+"index.json"); const f=idx.directory.item.map(i=>i.name).find(n=>/\.xml$/i.test(n)&&!/primary_doc/i.test(n)); if(!f) return null;
  const t=await (await P(base+f)).text(); const x=new DOMParser().parseFromString(t,"text/xml"); const agg={};
  [...x.getElementsByTagNameNS("*","infoTable")].forEach(it=>{ const g=n=>it.getElementsByTagNameNS("*",n)[0]?.textContent||""; if(g("putCall").trim()) return;
    const cu=g("cusip"); const a=agg[cu]=agg[cu]||{name:g("nameOfIssuer"),value:0,shares:0}; a.value+=+g("value")||0; a.shares+=+g("sshPrnamt")||0; });
  return agg;
}
async function loadFund(cik, name){
  const key="fund:"+cik; if(S.busy[key]) return; S.busy[key]=1; rerender();
  try{ const sub=await PJ(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10,"0")}.json`); const r=sub.filings.recent;
    const idx=r.form.map((f,i)=>f==="13F-HR"?i:-1).filter(i=>i>=0).slice(0,2);
    const cur=await infoTable(cik, r.accessionNumber[idx[0]]), prev=idx[1]!=null?await infoTable(cik, r.accessionNumber[idx[1]]):{};
    const tot=Object.values(cur).reduce((s,a)=>s+a.value,0)||1;
    const rows=Object.entries(cur).map(([c,a])=>{ const p=prev[c]; return {name:a.name,value:a.value,pct:a.value/tot*100,shares:a.shares,chg:p&&p.shares?(a.shares/p.shares-1)*100:null,new:!p}; }).sort((a,b)=>b.value-a.value);
    const sold=Object.entries(prev).filter(([c])=>!cur[c]).map(([c,a])=>({name:a.name,value:a.value})).sort((a,b)=>b.value-a.value).slice(0,10);
    const f={cik,name:name||sub.name,date:r.reportDate[idx[0]],filed:r.filingDate[idx[0]],total:tot,rows:rows.slice(0,25),sold,count:rows.length};
    D.funds=[...D.funds.filter(x=>x.cik!==cik), f];
  }catch(e){ toast("Could not read that fund's 13F report."); }
  delete S.busy[key]; rerender();
}

/* ---------- real-time streams (free) ---------- */
const WS = {cb:null, fh:null, fhSyms:new Set()};
function startCoinbase(){
  try{ const syms=["BTC-USD","ETH-USD","SOL-USD","XRP-USD","DOGE-USD","ADA-USD","AVAX-USD","LINK-USD"];
    const w=new WebSocket("wss://ws-feed.exchange.coinbase.com"); WS.cb=w;
    w.onopen=()=>w.send(JSON.stringify({type:"subscribe",product_ids:syms,channels:["ticker"]}));
    w.onmessage=e=>{ let m; try{ m=JSON.parse(e.data); }catch(x){ return; } if(m.type!=="ticker") return; const p=+m.price, base=m.product_id.split("-")[0];
      const c=D.crypto.find(c=>c.sym===base); if(c){ c.px=p; c.wsAt=Date.now(); }
      const q=D.q[m.product_id]; if(q){ q.px=p; q.t=Date.now()/1000; }
      S.ticks[m.product_id]=Date.now(); markDirty(); };
    w.onclose=()=>{ WS.cb=null; setTimeout(startCoinbase, 5000); };
  }catch(e){}
}
async function startFinnhub(){
  if(!S.server.finnhub) return;
  try{ const {token}=await api("ws-token"); if(!token) return;
    const w=new WebSocket("wss://ws.finnhub.io?token="+encodeURIComponent(token)); WS.fh=w;
    w.onopen=()=>syncFinnhub();
    w.onmessage=e=>{ let m; try{ m=JSON.parse(e.data); }catch(x){ return; } if(m.type!=="trade") return;
      (m.data||[]).forEach(t=>{ const q=D.q[t.s]; if(q){ q.px=t.p; q.t=t.t/1000; S.ticks[t.s]=Date.now(); } }); markDirty(); };
    w.onclose=()=>{ WS.fh=null; WS.fhSyms=new Set(); setTimeout(startFinnhub, 8000); };
  }catch(e){}
}
function syncFinnhub(){
  const w=WS.fh; if(!w||w.readyState!==1) return;
  const want=new Set([...S.watch, ...(PORT.positions||[]).map(p=>p.sym), S.route.sym].filter(s=>s && /^[A-Z.]{1,6}$/.test(s)).slice(0,48));
  WS.fhSyms.forEach(s=>{ if(!want.has(s)){ w.send(JSON.stringify({type:"unsubscribe",symbol:s})); WS.fhSyms.delete(s); } });
  want.forEach(s=>{ if(!WS.fhSyms.has(s)){ w.send(JSON.stringify({type:"subscribe",symbol:s})); WS.fhSyms.add(s); } });
}
