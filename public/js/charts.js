/* Openfloor — canvas charts: price chart with studies, yield curve, treemap, multi-line. */
"use strict";
const CH = [];
function chartSlot(pts, opt={}){ CH.push({pts,opt}); return `<canvas class="ch" data-ch="${CH.length-1}" style="height:${opt.h||260}px" role="img" aria-label="${esc(opt.label||"Chart")}"></canvas>`; }
function niceTicks(mn,mx,n=5){
  const span = mx-mn || Math.abs(mx)||1, step0 = span/n, mag = Math.pow(10,Math.floor(Math.log10(step0)));
  const step = [1,2,2.5,5,10].map(m=>m*mag).find(s=>span/s<=n) || mag*10;
  const out=[]; for(let v=Math.ceil(mn/step)*step; v<=mx+1e-9; v+=step) out.push(+v.toFixed(10)); return out;
}
function setupCanvas(cv){
  const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight; if(!W) return null;
  cv.width=W*dpr; cv.height=H*dpr; const g=cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,W,H);
  return {g,W,H};
}
const PALETTE = ["#ffa630","#5cb8ff","#c792ea","#2fd47a","#ff7eb6","#e6ebef","#f2cf1d","#7fdbca"];

/* Main price chart.
   opt.lines: [{vals, color, name, dash}] overlays aligned to pts
   opt.panes: [{kind:"vol"|"rsi"|"macd", vals...}] lower panes
   opt.pct: show as % change from first point (used for compare) */
function drawChart(cv, pts, opt, hoverX){
  const c=setupCanvas(cv); if(!c) return; const {g,W,H}=c, col=getCss;
  if(!pts || pts.length<2){ g.fillStyle=col("--dim"); g.font="12px "+col("--mono"); g.fillText(opt.emptyText||"No chart data yet",10,20); return; }
  const panes = opt.panes||[], paneH = panes.length ? Math.min(90, H*0.2) : 0;
  const L=8, R=64, T=24, B=22, iw=W-L-R, mainH=H-T-B-panes.length*(paneH+8);
  const xs=pts.map(p=>p[0]);
  const tf = opt.pct ? (v,base)=> (v/base-1)*100 : v=>v;
  const base0 = pts[0][1];
  const ys = pts.map(p=>tf(p[1],base0));
  const lines = (opt.lines||[]).map(l=>({...l, vals: opt.pct ? l.vals.map((v,i)=>v==null?null:(v/(l.vals.find(x=>x!=null)||1)-1)*100) : l.vals}));
  let all=ys.slice(); lines.forEach(l=>l.vals.forEach(v=>{ if(v!=null) all.push(v); }));
  let mn=Math.min(...all), mx=Math.max(...all); if(opt.base!=null){mn=Math.min(mn,opt.base);mx=Math.max(mx,opt.base);}
  const pad=(mx-mn)*0.08||Math.abs(mx)*0.01||1; mn-=pad; mx+=pad;
  const x0=xs[0], x1=xs[xs.length-1];
  const X = t => L + (x1===x0?0:(t-x0)/(x1-x0))*iw, Y = v => T + (1-(v-mn)/(mx-mn))*mainH;
  const fmtY = opt.pct ? v=>(v>0?"+":"")+v.toFixed(1)+"%" : (opt.fmt||(v=>nf(v, Math.abs(mx-mn)<5?2:0)));
  g.font="11px "+col("--mono"); g.textBaseline="middle";
  niceTicks(mn,mx,5).forEach(v=>{ if(v<mn||v>mx) return; const y=Y(v); g.strokeStyle=col("--line"); g.lineWidth=1; g.beginPath(); g.moveTo(L,y+.5); g.lineTo(L+iw,y+.5); g.stroke();
    g.fillStyle=col("--dim"); g.fillText(fmtY(v), L+iw+6, y); });
  // time labels
  g.textBaseline="alphabetic"; g.fillStyle=col("--faint");
  const spanDays=(x1-x0)/86400, step = spanDays>1500?730:spanDays>900?365:spanDays>200?60:spanDays>60?30:spanDays>14?7:spanDays>2?1:0;
  let last=null, lastX=-1e9;
  for(let i=0;i<pts.length;i++){ const d=new Date(xs[i]*1000);
    const key = step===0 ? Math.floor(xs[i]/3600) : step>=365?Math.floor(d.getUTCFullYear()/(step/365)):step>=30?d.getUTCFullYear()*12+d.getUTCMonth():Math.floor(xs[i]/86400/step);
    if(key!==last){ const first = last===null; last=key; if(first) continue; const x=X(xs[i]); if(x>L+iw-30) continue;
      const lab = step===0 ? new Date(xs[i]*1000).toLocaleTimeString("en-US",{hour:"numeric",timeZone:"America/New_York"}) : step>=365? String(d.getUTCFullYear()) : step>=30? MON3[d.getUTCMonth()]+(d.getUTCMonth()===0?" "+String(d.getUTCFullYear()).slice(2):"") : d.getUTCDate()+" "+MON3[d.getUTCMonth()];
      if(x-lastX<g.measureText(lab).width+14) continue; lastX=x;
      g.fillText(lab, x-12, H-6); g.strokeStyle=col("--line"); g.beginPath(); g.moveTo(x+.5,T); g.lineTo(x+.5,T+mainH); g.stroke(); } }
  const upc = ys[ys.length-1] >= (opt.base!=null?opt.base:ys[0]);
  const lc = opt.color || (upc?col("--up"):col("--down"));
  if(!opt.noArea){ const grd=g.createLinearGradient(0,T,0,T+mainH); grd.addColorStop(0, lc+"44"); grd.addColorStop(1, lc+"00");
    g.beginPath(); pts.forEach((p,i)=>{ const x=X(p[0]),y=Y(ys[i]); i?g.lineTo(x,y):g.moveTo(x,y); }); g.lineTo(X(x1),T+mainH); g.lineTo(X(x0),T+mainH); g.closePath(); g.fillStyle=grd; g.fill(); }
  lines.forEach((l,k)=>{ g.strokeStyle=l.color||PALETTE[k%PALETTE.length]; g.lineWidth=l.w||1.2; if(l.dash) g.setLineDash(l.dash); g.beginPath(); let started=false;
    l.vals.forEach((v,i)=>{ if(v==null||i>=pts.length) return; const x=X(xs[i]),y=Y(v); if(started) g.lineTo(x,y); else { g.moveTo(x,y); started=true; } }); g.stroke(); g.setLineDash([]); });
  g.beginPath(); pts.forEach((p,i)=>{ const x=X(p[0]),y=Y(ys[i]); i?g.lineTo(x,y):g.moveTo(x,y); }); g.strokeStyle=lc; g.lineWidth=1.6; g.stroke();
  if(opt.base!=null){ g.setLineDash([3,4]); g.strokeStyle=col("--faint"); g.beginPath(); g.moveTo(L,Y(opt.base)); g.lineTo(L+iw,Y(opt.base)); g.stroke(); g.setLineDash([]); }
  (opt.marks||[]).forEach(m=>{ const i=m.i; if(i==null||i>=pts.length) return; const x=X(xs[i]), y=Y(ys[i]); g.fillStyle=m.side==="buy"?col("--up"):col("--down"); g.beginPath();
    if(m.side==="buy"){ g.moveTo(x,y+4); g.lineTo(x-4,y+11); g.lineTo(x+4,y+11); } else { g.moveTo(x,y-4); g.lineTo(x-4,y-11); g.lineTo(x+4,y-11); } g.fill(); });
  const ex=X(x1), ey=Y(ys[ys.length-1]); g.fillStyle=lc; g.beginPath(); g.arc(ex,ey,3,0,7); g.fill();
  g.fillRect(L+iw+2, ey-9, R-4, 18); g.fillStyle="#000"; g.textBaseline="middle"; g.font="600 11px "+col("--mono");
  g.fillText(fmtY(ys[ys.length-1]), L+iw+6, ey);
  // lower panes
  let py = T+mainH+8;
  panes.forEach(p=>{
    const top=py, h=paneH; g.strokeStyle=col("--line"); g.strokeRect(L+.5, top+.5, iw, h);
    g.fillStyle=col("--faint"); g.font="10px "+col("--mono"); g.textBaseline="top"; g.fillText(p.label, L+4, top+3);
    if(p.kind==="vol"){ const mxv=Math.max(...p.vals.map(v=>v||0))||1; const bw=Math.max(1, iw/pts.length-1);
      p.vals.forEach((v,i)=>{ if(!v) return; const x=X(xs[i]); const hh=v/mxv*(h-14); const up= i===0 || pts[i][1]>=pts[i-1][1]; g.fillStyle=(up?col("--up"):col("--down"))+"88"; g.fillRect(x-bw/2, top+h-hh, bw, hh); }); }
    else { const vs=p.vals.filter(v=>v!=null); let a=Math.min(...vs, ...(p.lines||[]).flat()), b=Math.max(...vs, ...(p.lines||[]).flat()); if(p.kind==="rsi"){a=0;b=100;}
      const PY=v=>top+h-4-(v-a)/((b-a)||1)*(h-14);
      (p.guides||[]).forEach(gv=>{ g.setLineDash([2,3]); g.strokeStyle=col("--faint"); g.beginPath(); g.moveTo(L,PY(gv)); g.lineTo(L+iw,PY(gv)); g.stroke(); g.setLineDash([]); g.fillStyle=col("--faint"); g.textBaseline="middle"; g.fillText(String(gv), L+iw+6, PY(gv)); });
      if(p.hist){ const bw=Math.max(1, iw/pts.length-1); p.hist.forEach((v,i)=>{ if(v==null) return; g.fillStyle=(v>=0?col("--up"):col("--down"))+"88"; const y0=PY(0), y1=PY(v); g.fillRect(X(xs[i])-bw/2, Math.min(y0,y1), bw, Math.abs(y1-y0)); }); }
      [[p.vals,col("--amber")],...(p.extra||[]).map(e=>[e,col("--link")])].forEach(([arr,cc])=>{ g.strokeStyle=cc; g.lineWidth=1.2; g.beginPath(); let st=false; arr.forEach((v,i)=>{ if(v==null) return; const x=X(xs[i]), y=PY(v); st?g.lineTo(x,y):(g.moveTo(x,y),st=true); }); g.stroke(); });
    }
    py += h+8;
  });
  // header + crosshair
  g.textBaseline="alphabetic"; g.font="11px "+col("--mono");
  let idx = pts.length-1;
  if(hoverX!=null){ let best=1e9; pts.forEach((p,i)=>{ const d=Math.abs(X(p[0])-hoverX); if(d<best){best=d;idx=i;} });
    const hx=X(xs[idx]), hy=Y(ys[idx]); g.strokeStyle=col("--dim"); g.setLineDash([2,3]); g.beginPath(); g.moveTo(hx+.5,T); g.lineTo(hx+.5,H-B); g.moveTo(L,hy+.5); g.lineTo(L+iw,hy+.5); g.stroke(); g.setLineDash([]);
    g.fillStyle=col("--key"); g.beginPath(); g.arc(hx,hy,3.5,0,7); g.fill(); }
  const v=ys[idx], chgP=opt.pct? v : (v/ys[0]-1)*100;
  const intraday = spanDays<=2;
  const dlab = intraday || opt.daily===false ? new Date(xs[idx]*1000).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET" : dstr(xs[idx]*1000);
  let x=L; const put=(t,cc)=>{ g.fillStyle=cc; g.fillText(t,x,14); x+=g.measureText(t).width+12; };
  put(dlab, col("--dim")); put(fmtY(v), col("--fg"));
  if(!opt.noPct && !opt.pct) put((chgP>=0?"+":"")+chgP.toFixed(2)+"% over period", chgP>=0?col("--up"):col("--down"));
  lines.forEach((l,k)=>{ if(!l.name) return; const lv=l.vals[idx]; put(l.name+(lv!=null?" "+fmtY(lv):""), l.color||PALETTE[k%PALETTE.length]); });
}

function drawCurve(cv, sets, opt){
  const c=setupCanvas(cv); if(!c) return; const {g,W,H}=c;
  const L=46,R=16,T=26,B=26, iw=W-L-R, ih=H-T-B; const all=sets.flat().map(p=>p[1]); let mn=Math.min(...all), mx=Math.max(...all); const pad=(mx-mn)*.15||.2; mn-=pad; mx+=pad;
  const n=sets[0].length, X=i=>L+i/(n-1)*iw, Y=v=>T+(1-(v-mn)/(mx-mn))*ih;
  g.font="11px "+getCss("--mono");
  niceTicks(mn,mx,5).forEach(v=>{ const y=Y(v); g.strokeStyle=getCss("--line"); g.beginPath(); g.moveTo(L,y+.5); g.lineTo(L+iw,y+.5); g.stroke(); g.fillStyle=getCss("--dim"); g.textBaseline="middle"; g.fillText(nf(v,2)+"%",4,y); });
  sets[0].forEach((p,i)=>{ g.fillStyle=getCss("--dim"); g.textBaseline="alphabetic"; g.fillText(p[2],X(i)-10,H-7); });
  const cols=[getCss("--amber"),getCss("--link"),getCss("--faint")], names=["Today","1 month ago","1 year ago"];
  [2,1,0].forEach(k=>{ const s=sets[k]; if(!s) return; g.strokeStyle=cols[k]; g.lineWidth=k?1.3:2.2; if(k===2) g.setLineDash([4,4]); g.beginPath(); s.forEach((p,i)=>{ i?g.lineTo(X(i),Y(p[1])):g.moveTo(X(i),Y(p[1])); }); g.stroke(); g.setLineDash([]);
    s.forEach((p,i)=>{ g.fillStyle=cols[k]; g.beginPath(); g.arc(X(i),Y(p[1]),k?2:3.2,0,7); g.fill(); }); });
  let lx=L; names.forEach((n,k)=>{ g.fillStyle=cols[k]; g.fillRect(lx,10,10,3); g.fillStyle=getCss("--dim"); g.textBaseline="middle"; g.fillText(n,lx+14,12); lx+=g.measureText(n).width+34; });
  sets[0].forEach((p,i)=>{ g.fillStyle=getCss("--fg"); g.textBaseline="alphabetic"; g.fillText(nf(p[1],2),X(i)-14,Y(p[1])-8); });
}

/* Squarified treemap, grouped by sector. items: [{label, value, chg, group, run, sub}] */
function squarify(items, x, y, w, h){
  const out=[]; let rest=items.slice().sort((a,b)=>b.value-a.value); const total=rest.reduce((s,i)=>s+i.value,0); if(!total) return out;
  const scale=w*h/total; rest=rest.map(i=>({...i,a:i.value*scale}));
  while(rest.length){ const short=Math.min(w,h); let row=[rest[0]], worst=Infinity, i=1;
    const ratio = r => { const s=r.reduce((a,b)=>a+b.a,0), mx=Math.max(...r.map(z=>z.a)), mn=Math.min(...r.map(z=>z.a)); return Math.max(short*short*mx/(s*s), s*s/(short*short*mn)); };
    worst=ratio(row);
    while(i<rest.length){ const nr=[...row,rest[i]], nw=ratio(nr); if(nw>worst) break; row=nr; worst=nw; i++; }
    const s=row.reduce((a,b)=>a+b.a,0), thick=s/short; let off=0;
    row.forEach(r=>{ const len=r.a/thick; if(w>=h) out.push({...r,x:x,y:y+off,w:thick,h:len}); else out.push({...r,x:x+off,y:y,w:len,h:thick}); off+=len; });
    if(w>=h){ x+=thick; w-=thick; } else { y+=thick; h-=thick; }
    rest=rest.slice(row.length);
  }
  return out;
}
function heatColor(p, lim=3){
  const t=Math.max(-1,Math.min(1,(p||0)/lim));
  const a=Math.abs(t);
  return t>=0 ? `rgb(${Math.round(20+a*10)},${Math.round(40+a*130)},${Math.round(34+a*50)})` : `rgb(${Math.round(50+a*150)},${Math.round(30+a*10)},${Math.round(36+a*14)})`;
}
function drawTreemap(cv, items, opt, hx, hy){
  const c=setupCanvas(cv); if(!c) return; const {g,W,H}=c;
  const groups={}; items.forEach(i=>{ (groups[i.group]=groups[i.group]||[]).push(i); });
  const gitems=Object.entries(groups).map(([k,l])=>({label:k,value:l.reduce((s,i)=>s+i.value,0),kids:l}));
  const outer=squarify(gitems,0,0,W,H); const rects=[];
  g.font="600 11px "+getCss("--cond");
  outer.forEach(o=>{ const inner=squarify(o.kids,o.x+1,o.y+14,Math.max(0,o.w-2),Math.max(0,o.h-15));
    g.fillStyle="#0a0d10"; g.fillRect(o.x,o.y,o.w,o.h);
    g.fillStyle=getCss("--amber"); g.textBaseline="top"; if(o.w>50) g.fillText(o.label.toUpperCase().slice(0,Math.floor(o.w/7)), o.x+3, o.y+2);
    inner.forEach(r=>{ g.fillStyle=heatColor(r.chg); g.fillRect(r.x+.5,r.y+.5,Math.max(0,r.w-1),Math.max(0,r.h-1)); rects.push(r);
      if(r.w>34 && r.h>18){ g.fillStyle="#fff"; g.textBaseline="middle"; g.textAlign="center"; const fs=Math.max(9,Math.min(16,Math.sqrt(r.w*r.h)/5)); g.font="600 "+fs+"px "+getCss("--mono");
        g.fillText(r.label, r.x+r.w/2, r.y+r.h/2-(r.h>34?fs*0.55:0)); if(r.h>34){ g.font=(fs*0.75)+"px "+getCss("--mono"); g.fillText(pctS(r.chg,1), r.x+r.w/2, r.y+r.h/2+fs*0.6); } g.textAlign="left"; } });
  });
  cv._rects=rects;
  if(hx!=null){ const r=rects.find(r=>hx>=r.x&&hx<=r.x+r.w&&hy>=r.y&&hy<=r.y+r.h); if(r){ g.strokeStyle=getCss("--key"); g.lineWidth=2; g.strokeRect(r.x+1,r.y+1,r.w-2,r.h-2);
      const t=`${r.label}  ${pctS(r.chg)}  ${r.sub||""}`; g.font="12px "+getCss("--mono"); const tw=g.measureText(t).width+12; let tx=Math.min(W-tw-4, Math.max(4,hx+10)), ty=Math.min(H-24, hy+12);
      g.fillStyle="rgba(0,0,0,.85)"; g.fillRect(tx,ty,tw,22); g.fillStyle="#fff"; g.textBaseline="middle"; g.fillText(t,tx+6,ty+11); } }
}

function hydrateCharts(){
  $$("canvas[data-ch]").forEach(cv=>{
    const c = CH[+cv.dataset.ch]; if(!c) return;
    const kind = c.opt.custom||drawChart;
    const draw = (hx,hy) => kind(cv, c.pts, c.opt, hx, hy);
    draw();
    if(cv.dataset.wired) return; cv.dataset.wired="1";
    const mv = e => { const r=cv.getBoundingClientRect(); draw(e.clientX-r.left, e.clientY-r.top); };
    cv.addEventListener("pointermove", mv); cv.addEventListener("pointerdown", mv);
    cv.addEventListener("pointerleave", ()=>draw());
    if(c.opt.custom===drawTreemap) cv.addEventListener("click", e=>{ const r=cv.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top; const hit=(cv._rects||[]).find(q=>x>=q.x&&x<=q.x+q.w&&y>=q.y&&y<=q.y+q.h); if(hit&&hit.run) run(hit.run); });
  });
}
const hbar = (v, max, c="var(--amber)") => `<span class="hb"><i style="width:${Math.max(0,Math.min(100,Math.abs(v)/(max||1)*100)).toFixed(1)}%;background:${c}"></i></span>`;
