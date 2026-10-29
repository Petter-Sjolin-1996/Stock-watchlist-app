(function(){
const $=id=>document.getElementById(id);
const APP_VERSION="0.22";
/* ---------- release guard: all files must come from the same release ----------
   While GitHub Pages deploys an update, the browser can briefly get files from two versions.
   If so, show a short notice, refresh the files from the server and reload. */
{
  const cssV=getComputedStyle(document.documentElement).getPropertyValue("--mm-version").replace(/["'\s]/g,"");
  const parts=[["models.js",window.MMModels&&window.MMModels.VERSION],["company.js",window.MMCompany&&window.MMCompany.VERSION],["styles.css",cssV]];
  const off=parts.filter(([,v])=>v!==APP_VERSION);
  let tries=0; const key="mm-guard-"+APP_VERSION;
  try{tries=+(sessionStorage.getItem(key)||0)}catch(e){}
  if(off.length){
    console.warn("Mixed release",APP_VERSION,parts);
    const bar=document.createElement("div"); bar.className="updating"; document.body.prepend(bar);
    if(tries<2){
      // probably a deployment in progress: refresh the files and reload (at most twice)
      try{sessionStorage.setItem(key,String(tries+1))}catch(e){}
      bar.textContent="Mr. Market is updating, reloading in a moment…";
      const refresh=async()=>{
        const files=["index.html","app.js","models.js","company.js","styles.css"];
        await Promise.all(files.flatMap(f=>[fetch(f,{cache:"reload"}),fetch(`${f}?v=${APP_VERSION}`,{cache:"reload"})]).map(p=>p.catch(()=>null)));
        location.reload();
      };
      setTimeout(refresh,15000);
    }else{
      // still mixed after two reloads: the repo itself has files from different releases
      bar.innerHTML=`<b>Some app files are from a different release.</b> Expected version ${APP_VERSION}, but `+
        off.map(([n,v])=>`${n} is ${v?"version "+v:"an older version"}`).join(", ")+
        `. Upload all files from release ${APP_VERSION} to the watchlist-app repo. <button id="guard-retry">Try again</button>`;
      document.getElementById("guard-retry").onclick=()=>{try{sessionStorage.removeItem(key)}catch(e){};location.reload()};
    }
    return;
  }
  try{sessionStorage.removeItem(key)}catch(e){}
}
const TODAY=new Date(); TODAY.setHours(0,0,0,0);

/* ---------- company data ----------
   [ticker, name, country, price, day change] */
const OMX=[
 ["ABB","ABB Ltd","SE",572.4,0.004],["ALFA","Alfa Laval","SE",452.1,-0.006],["ASSA B","Assa Abloy B","SE",336.8,0.009],["AZN","AstraZeneca","SE",1498.0,-0.003],
 ["ATCO A","Atlas Copco A","SE",171.2,0.005],["ATCO B","Atlas Copco B","SE",151.9,0.004],["BOL","Boliden","SE",388.5,-0.012],["EPI A","Epiroc A","SE",212.3,0.007],
 ["EQT","EQT","SE",297.9,-0.0106],["ERIC B","Ericsson B","SE",82.4,0.002],["ESSITY B","Essity B","SE",268.9,-0.004],["EVO","Evolution","SE",812.0,0.011],
 ["GETI B","Getinge B","SE",214.7,-0.008],["HM B","H&M B","SE",166.2,-0.0107],["SHB A","Handelsbanken A","SE",121.8,0.003],["HEXA B","Hexagon B","SE",118.4,0.006],
 ["INVE B","Investor B","SE",312.5,0.002],["NIBE B","Nibe Industrier B","SE",46.2,-0.015],["NDA SE","Nordea","SE",200.5,-0.0055],["SAAB B","Saab B","SE",489.0,-0.002],
 ["SAND","Sandvik","SE",242.6,0.008],["SCA B","SCA B","SE",141.3,-0.001],["SEB A","SEB A","SE",162.5,0.015],["SKA B","Skanska B","SE",234.1,0.004],
 ["SKF B","SKF B","SE",221.7,-0.003],["SWED A","Swedbank A","SE",268.2,0.006],["TEL2 B","Tele2 B","SE",158.4,0.001],["TELIA","Telia Company","SE",36.8,-0.002],
 ["VOLV B","Volvo B","SE",268.4,-0.006],["SINCH","Sinch","SE",29.6,0.021]
];
/* Real key figures and history from Avanza, 23 Sep 2026.
   kpi: [market cap MSEK, dividend yield, volatility, beta, P/E, P/S, P/B, ROE]
   hist: [1 day, 1 week, 1 month, 3 months, 6 months, YTD, 1 year, 3 years, 5 years] */
const REAL={
 "EQT":{kpi:[389344,.0168,.1855,1.74,30.73,10.88,4.07,.1324],hist:[-.0106,-.0155,-.1155,.1103,.1042,-.1811,-.1176,.3703,-.2111]},
 "HM B":{kpi:[265733,.0427,.2440,0.94,21.73,1.20,7.82,.36],hist:[-.0107,.0079,-.0898,-.0036,-.0157,-.1060,.0902,.0550,-.0751]},
 "NDA SE":{kpi:[682261,.0446,.1301,0.68,13.20,5.28,1.97,.1494],hist:[-.0055,.0075,.0489,.0853,.2107,.1526,.3213,.6280,.8405]}
};
const REPORTS=["2026-10-16","2026-10-21","2026-10-22","2026-10-23","2026-10-24","2026-10-28","2026-10-29"];
/* Hexatronic: price from transfer sheet; LTM figures from reports (Q3 2025–Q2 2026) */
const HX={price:41.00,shares:221.43,ltmSales:7674,ltmEps:0.20,ytdStart:23.04};
const MODELS={HTRO:{name:"Hexatronic Group",country:"SE",price:HX.price,day:0.012,value:31.29,report:"2026-10-22",
  model:"Updated after Q2 2026",wacc:"10.0%",terminal:"7.5x EV/EBITDA",vdate:"30 Jun 2026",
  sales:[7581,7519,8054,8755,9388,10017,10468,10874,11299,11745],
  kpi:[HX.price*HX.shares,null,null,null,HX.price/HX.ltmEps,HX.price*HX.shares/HX.ltmSales,null,null]}};

function hash(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return Math.abs(h)}
function rng(seed){let s=seed%2147483647||1;return()=>(s=s*16807%2147483647)/2147483647}
function placeholderKpi(t,price){const r=rng(hash(t)+7);
  return [Math.round(30000+r()*600000),Math.round(r()*55)/1000,.12+r()*.2,+(0.6+r()*1.1).toFixed(2),+(10+r()*25).toFixed(2),+(0.8+r()*6).toFixed(2),+(1.2+r()*6).toFixed(2),.05+r()*.3]}
function placeholderHist(t,day){const r=rng(hash(t)+11),g=s=>(r()-0.45)*s;
  return [day,g(.06),g(.12),g(.2),g(.3),g(.35),g(.45),g(.9),g(1.2)]}
function demoInfo(t){
  if(MODELS[t]){const m=MODELS[t],h=[m.day,null,null,null,null,m.price/HX.ytdStart-1,null,null,null];
    return Object.assign({ticker:t,hist:h},m)}
  const o=OMX.find(x=>x[0]===t); if(!o) return null;
  const real=REAL[t];
  return {ticker:t,name:o[1],country:o[2],price:o[3],day:o[4],value:null,model:null,report:REPORTS[hash(t)%REPORTS.length],
    kpi:real?real.kpi:placeholderKpi(t,o[3]),hist:real?real.hist:placeholderHist(t,o[4])};
}
const UNIVERSE=[["HTRO","Hexatronic Group"],...OMX.map(o=>[o[0],o[1]])];

/* ---------- live market data: written nightly by the workflow in the private data repo ---------- */
const GH_KEY="mm-github", MKT_KEY="mm-market";
let gh={owner:"Petter-Sjolin-1996",repo:"Stock-watchlist-data",token:""};
try{Object.assign(gh,JSON.parse(localStorage.getItem(GH_KEY)||"{}"))}catch(e){}
let MARKET=null;
try{MARKET=JSON.parse(localStorage.getItem(MKT_KEY)||"null")}catch(e){}
if(!gh.token) MARKET=null;
let marketError="";
const KPI_KEYS=["mcap","dy","vol","beta","pe","ps","pb","roe"], HIST_KEYS=["1d","1w","1m","3m","6m","ytd","1y","3y","5y"];
function info(t){
  const s=demoInfo(t); if(!s) return null;
  if(!MARKET) return withModel(withReports(s,null));
  const m=MARKET.stocks&&MARKET.stocks[t];
  Object.assign(s,{price:null,day:null,kpi:KPI_KEYS.map(()=>null),hist:HIST_KEYS.map(()=>null),report:s.value!=null?s.report:null});
  if(!m) return withModel(withReports(s,null));
  s.price=m.price??null; s.day=m.day??null; s.priceDate=m.date||MARKET.asOf||null;
  s.kpi=KPI_KEYS.map(k=>m.kpi&&m.kpi[k]!=null?m.kpi[k]:null);
  s.hist=HIST_KEYS.map(k=>m.hist&&m.hist[k]!=null?m.hist[k]:null);
  return withModel(withReports(s,m));
}
/* ---------- report dates ----------
   reports.json in the data repo (maintained from the companies' financial calendars) comes first;
   Yahoo's last/next earnings dates are the fallback. */
let REPORT_CAL={};
const isoDay=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const qIndex=lab=>{const m=/^Q([1-4])\s+(\d{4})$/.exec(String(lab||"").trim());return m?(+m[2])*4+(+m[1]):null};
function quarterBefore(iso){const d=dateOf(iso),q=Math.floor(d.getMonth()/3);return q===0?`Q4 ${d.getFullYear()-1}`:`Q${q} ${d.getFullYear()}`}
function withReports(s,m){
  const today=isoDay(TODAY), list=(REPORT_CAL[s.ticker]||[]).filter(e=>e&&e.date).slice().sort((a,b)=>a.date.localeCompare(b.date));
  let last=null,next=null;
  list.forEach(e=>{if(e.date<=today)last=e;else if(!next)next=e});
  if(!last&&m&&m.lastReport&&m.lastReport<=today) last={date:m.lastReport};
  if(!next&&m&&m.nextReport&&m.nextReport>today) next={date:m.nextReport};
  if(last&&!last.quarter) last=Object.assign({},last,{quarter:quarterBefore(last.date)});
  if(next&&!next.quarter) next=Object.assign({},next,{quarter:quarterBefore(next.date)});
  if(list.length||m){s.report=next?next.date:null}
  s.lastReport=last; s.nextReportInfo=next;
  return s;
}
const daysSince=iso=>Math.round((TODAY-dateOf(iso))/864e5);
function withModel(s){
  if(!gh.token) return s;
  if(DS.models!=="ok"){s.value=null;s.model=DS.models==="error"?"Not loaded":"Loading…";return s}
  const lm=latestModel(s.ticker);
  s.value=lm?lm.valuePerShare:null; s.model=lm?`Based on ${lm.basis}`:null;
  s.modelStatus=lm?modelStatus(lm,s):null;
  return s;
}
async function loadMarket(showToast){
  if(!gh.token){MARKET=null;marketError="";renderAll();return false}
  try{
    const r=await fetch(`https://api.github.com/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/contents/market.json`,
      {headers:{Authorization:`Bearer ${gh.token}`,Accept:"application/vnd.github.raw+json","X-GitHub-Api-Version":"2022-11-28"},cache:"no-store"});
    if(!r.ok) throw new Error(r.status===401?"GitHub did not accept the token. Check it in Settings.":
      r.status===404?"No market data yet. Run the 'Update market data' workflow in the data repo.":`GitHub returned error ${r.status}.`);
    const d=await r.json();
    if(!d||!d.stocks) throw new Error("market.json has an unexpected format.");
    MARKET=d; marketError="";
    try{localStorage.setItem(MKT_KEY,JSON.stringify(d))}catch(e){}
    renderAll(); if(showToast) toast(`Prices loaded (close ${fmtDate(d.asOf)})`);
    return true;
  }catch(e){
    marketError=e.message||"Could not load market data."; renderAll(); if(showToast) toast(marketError); return false;
  }
}
function renderStatus(){
  const el=$("data-status"); if(!el) return;
  const mErr=DS.models==="error"?` <b class="neg">Your models could not be loaded: ${esc(DS.modelsErr)}</b>`:"";
  if(MARKET) el.innerHTML=`Prices and key figures: end of day ${esc(fmtDate(MARKET.asOf))}, from Yahoo Finance (updated every weekday evening).${marketError?` <b class="neg">${esc(marketError)}</b>`:""}${mErr}`;
  else el.innerHTML=marketError?`<b class="neg">${esc(marketError)}</b> Showing demo data.`:"Showing demo data. Connect GitHub under Settings to load real prices.";
}

/* ---------- flags (round, like Avanza) ---------- */
const FLAGS={
 SE:'<rect width="20" height="20" fill="#006AA7"/><rect x="5.5" width="3" height="20" fill="#FECC00"/><rect y="8.5" width="20" height="3" fill="#FECC00"/>',
 FI:'<rect width="20" height="20" fill="#fff"/><rect x="5.5" width="3.4" height="20" fill="#002F6C"/><rect y="8.3" width="20" height="3.4" fill="#002F6C"/>',
 NO:'<rect width="20" height="20" fill="#BA0C2F"/><rect x="4.5" width="5" height="20" fill="#fff"/><rect y="7.5" width="20" height="5" fill="#fff"/><rect x="5.75" width="2.5" height="20" fill="#00205B"/><rect y="8.75" width="20" height="2.5" fill="#00205B"/>',
 DK:'<rect width="20" height="20" fill="#C8102E"/><rect x="5.5" width="3" height="20" fill="#fff"/><rect y="8.5" width="20" height="3" fill="#fff"/>',
 US:'<rect width="20" height="20" fill="#fff"/><g fill="#B22234"><rect width="20" height="1.54"/><rect y="3.08" width="20" height="1.54"/><rect y="6.16" width="20" height="1.54"/><rect y="9.24" width="20" height="1.54"/><rect y="12.32" width="20" height="1.54"/><rect y="15.4" width="20" height="1.54"/><rect y="18.46" width="20" height="1.54"/></g><rect width="9" height="10.8" fill="#3C3B6E"/>'
};
const flag=cc=>`<span class="flag" role="img" aria-label="${cc}"><svg viewBox="0 0 20 20" preserveAspectRatio="none">${FLAGS[cc]||'<rect width="20" height="20" fill="#ccc"/>'}</svg></span>`;

/* ---------- state ---------- */
const KEY="wl-state-v2";
let state=null;
try{state=JSON.parse(localStorage.getItem(KEY)||"null")}catch(e){}
if(!state||!Array.isArray(state.lists)||!state.lists.length){
  state={active:"l1",lists:[{id:"l1",name:"My watchlist",tickers:["HTRO","VOLV B","ATCO A","SEB A"]}]};
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
function active(){return state.lists.find(l=>l.id===state.active)||state.lists[0]}
let unit="pct", tab="price", sort={key:null,dir:1};

/* ---------- formatting ---------- */
const fmt=(n,d=2)=>n.toLocaleString("en-GB",{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=(x,d=1)=>{const v=+(x*100).toFixed(d);return (v>0?"+":"")+(v===0?0:v).toFixed(d)+"%"};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dateOf=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const fmtDate=s=>dateOf(s).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const daysTo=s=>Math.round((dateOf(s)-TODAY)/864e5);
const dash='<span class="dim">–</span>';
const signed=v=>v==null?dash:`<span class="${v>=0?'pos':'neg'}">${pct(v,2)}</span>`;

/* ---------- table columns per tab ---------- */
const nameCol={key:"name",label:"Company",sticky:true,val:s=>s.name.toLowerCase(),
  cell:s=>`<div class="name">${flag(s.country)}<div><a href="#" data-open="${esc(s.ticker)}">${esc(s.name)}</a><small>${esc(s.ticker)}</small></div></div>`};
const toolsCol={key:"tools",label:'<span class="vh">Remove</span>',cls:"col-tools",nosort:true,
  cell:s=>`<button class="icon-btn" data-remove="${esc(s.ticker)}" aria-label="Remove ${esc(s.name)} from list"><svg><use href="#i-trash"/></svg></button>`};
const up=s=>s.value!=null&&s.price?s.value/s.price-1:null;
const COLS={
 price:[nameCol,
  {key:"day",label:"Day change",val:s=>s.day==null||s.price==null?-Infinity:unit==="pct"?s.day:s.price-s.price/(1+s.day),
   cell:s=>{if(s.day==null||s.price==null)return dash;const a=s.price-s.price/(1+s.day);return `<span class="${s.day>=0?'pos':'neg'}">${unit==="pct"?pct(s.day,2):(a>0?"+":"")+fmt(a)}</span>`}},
  {key:"price",label:"Last price",val:s=>s.price??-Infinity,cell:s=>s.price==null?dash:`${fmt(s.price)}<br><small class="dim">${MARKET?(s.priceDate?"as of "+fmtDate(s.priceDate):""):"demo price"}</small>`},
  {key:"value",label:"Your value",cls:"col-val",val:s=>s.value??-Infinity,cell:s=>s.value!=null?fmt(s.value):dash},
  {key:"upside",label:"Upside",val:s=>up(s)??-Infinity,cell:s=>{const u=up(s);if(u==null)return dash;
    const w=Math.min(Math.abs(u),.5)/.5*50;
    return `<span class="up-cell"><b class="${u>=0?'pos':'neg'}" style="font-weight:600">${pct(u)}</b><span class="gap-bar" aria-hidden="true"><span style="${u>=0?`left:50%;width:${w}%`:`right:50%;width:${w}%`};background:${u>=0?'var(--up)':'var(--down)'}"></span></span></span>`}},
  {key:"report",label:"Next report",cls:"col-report",val:s=>s.report||"9999",asc:true,
   cell:s=>{const lr=s.lastReport;
     if(lr&&daysSince(lr.date)<=7) return `<span class="reported">Reported ${fmtDate(lr.date)}</span><br><small class="dim">${esc(lr.quarter)}</small>`;
     if(!s.report)return dash;const d=daysTo(s.report);if(d<0)return `<span class="dim">${fmtDate(s.report)}</span>`;return `<span class="${d<=30?'soon':''}">${fmtDate(s.report)}</span><br><small class="dim">in ${d} days</small>`}},
  {key:"model",label:"Model",cls:"col-model",left:true,nosort:true,cell:s=>s.modelStatus&&s.modelStatus.kind==="update"?`<span class="status upd" title="${esc(s.modelStatus.text)}">${esc(s.modelStatus.short)}</span>`:`<span class="status ${s.value!=null?'ok':'none'}">${s.model||'No model yet'}</span>`},
  toolsCol],
 kpi:[nameCol,
  ...[["mcap","Market cap",v=>fmt(v,0)+" MSEK",false],["dy","Dividend yield",v=>fmt(v*100)+"%",true],["vol","Volatility",v=>fmt(v*100)+"%",true],
      ["beta","Beta",v=>fmt(v),true],["pe","P/E",v=>fmt(v),true],["ps","P/S",v=>fmt(v),true],["pb","P/B",v=>fmt(v),true],["roe","ROE",v=>fmt(v*100)+"%",true]]
   .map(([key,label,f,avg],i)=>({key,label,avg,val:s=>s.kpi[i]??-Infinity,raw:s=>s.kpi[i],fmt:f,cell:s=>s.kpi[i]==null?dash:f(s.kpi[i])})),
  toolsCol],
 hist:[nameCol,
  ...["1 day","1 week","1 month","3 months","6 months","YTD","1 year","3 years","5 years"]
   .map((label,i)=>({key:"h"+i,label,avg:true,val:s=>s.hist[i]??-Infinity,raw:s=>s.hist[i],fmt:v=>pct(v,2),signed:true,cell:s=>signed(s.hist[i])})),
  toolsCol]
};

function renderTable(){
  const a=active(), cols=COLS[tab]; let cos=a.tickers.map(info).filter(Boolean);
  const col=cols.find(c=>c.key===sort.key);
  if(col) cos=[...cos].sort((p,q)=>{const x=col.val(p),y=col.val(q);return (x>y?1:x<y?-1:0)*sort.dir});
  const cls=c=>[c.cls||"",c.sticky?"sticky":""].join(" ").trim();
  $("thead").innerHTML="<tr>"+cols.map(c=>{
    const on=c.key===sort.key, ic=on?(sort.dir>0?"#i-asc":"#i-desc"):"#i-sort";
    const inner=c.nosort?c.label:`<button class="sort" data-sort="${c.key}" ${on?`aria-sort="${sort.dir>0?'ascending':'descending'}"`:''}>${c.label}<svg><use href="${ic}"/></svg></button>`;
    return `<th class="${cls(c)}" ${c.left?'style="text-align:left"':''}>${inner}</th>`}).join("")+"</tr>";
  if(!cos.length){$("rows").innerHTML=`<tr style="cursor:default"><td colspan="${cols.length}" class="empty-list">This list is empty. Use the search above or Add company below.</td></tr>`;$("tfoot").innerHTML="";return}
  $("rows").innerHTML=cos.map(s=>`<tr data-open="${esc(s.ticker)}">${cols.map(c=>`<td class="${cls(c)}" ${c.left?'style="text-align:left"':''}>${c.cell(s)}</td>`).join("")}</tr>`).join("");
  if(tab==="price"){$("tfoot").innerHTML="";return}
  $("tfoot").innerHTML="<tr>"+cols.map((c,i)=>{
    if(i===0) return `<td class="sticky">Average, all companies</td>`;
    if(!c.avg) return `<td class="${cls(c)}"></td>`;
    const v=cos.map(c.raw).filter(x=>x!=null); if(!v.length) return `<td>${dash}</td>`;
    const m=v.reduce((p,q)=>p+q,0)/v.length;
    return `<td class="${cls(c)}">${c.signed?signed(m):c.fmt(m)}</td>`}).join("")+"</tr>";
}
function setTab(t){tab=t;sort={key:null,dir:1};
  document.querySelectorAll("[data-tab]").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));
  $("unit-wrap").hidden=t!=="price"; renderTable()}

/* ---------- banner bar ---------- */
function renderBanner(){
  const a=active();
  $("list-name").textContent=a.name;
  $("list-menu").innerHTML=state.lists.map(l=>`<button role="menuitem" data-pick="${l.id}"><span class="${l.id===a.id?'sel':''}">${esc(l.name)}</span><span class="cnt">${l.tickers.length} ${l.tickers.length===1?'company':'companies'}</span></button>`).join("");
}
function toggleMenu(open){const m=$("list-menu");const o=open??!m.classList.contains("open");m.classList.toggle("open",o);$("list-btn").setAttribute("aria-expanded",o)}
function resRow(t,n){
  const s=info(t), inList=active().tickers.includes(t);
  return `<div class="res"><div style="display:flex;gap:10px;align-items:center">${flag(s.country)}<div><b style="font-weight:500">${esc(n)}</b><small>${esc(t)}${s.value!=null?' / your model':''}</small></div></div>
    <span>${s.price!=null?fmt(s.price):"–"}</span>${inList?'<span class="in">In list</span>':`<button class="add-sm" data-add="${esc(t)}">Add</button>`}</div>`;
}
function renderResults(){
  const q=$("search").value.trim(), r=$("results");
  if(!q){r.classList.remove("open");return}
  const hits=UNIVERSE.filter(([t,n])=>(n+" "+t).toLowerCase().includes(q.toLowerCase())).slice(0,12);
  r.innerHTML=hits.length?hits.map(h=>resRow(...h)).join(""):`<div class="res"><span class="dim">No company matches "${esc(q)}". This version covers OMX Stockholm 30 and your models.</span></div>`;
  r.classList.add("open");
}
function renderAddList(){
  const q=$("add-search").value.trim().toLowerCase();
  $("add-list").innerHTML=UNIVERSE.filter(([t,n])=>!q||(n+" "+t).toLowerCase().includes(q)).map(h=>resRow(...h)).join("");
}

/* ---------- dialogs ---------- */
function openDlg(id){closeAll();$(id).classList.add("open");$("scrim").classList.add("open")}
function closeAll(){["dlg-new","dlg-manage","dlg-add","dlg-settings","dlg-review","scrim"].forEach(i=>$(i).classList.remove("open"));toggleMenu(false)}
function manageView(step){
  const a=active(), n=a.tickers.length, b=$("manage-body");
  if(step===1){
    b.innerHTML=`<div class="warn">Delete <b>${esc(a.name)}</b>? It contains ${n} ${n===1?'company':'companies'}.</div>
      <div class="actions"><button class="pill" data-m="0">Cancel</button><button class="pill danger" data-m="2">Delete list</button></div>`;
  } else if(step===2){
    b.innerHTML=`<div class="warn"><b>This cannot be undone.</b> The list will be removed. Your company models are not affected.</div>
      <div class="actions"><button class="pill" data-m="0">Keep list</button><button class="pill danger-solid" id="del-final">Yes, delete permanently</button></div>`;
  } else {
    b.innerHTML=`<label for="ren">List name</label><input class="field" id="ren" maxlength="40" value="${esc(a.name)}">
      <div class="err" id="ren-err"></div>
      <div class="actions"><button class="pill" data-close>Cancel</button><button class="pill primary" id="ren-ok">Save name</button></div>
      <hr class="divider"><p style="margin:0 0 6px;font-weight:500">Delete list</p>
      <p class="dim" style="margin:0 0 12px;font-size:14px">Removes the list and the companies in it.</p>
      <button class="pill danger" data-m="1"><svg><use href="#i-trash"/></svg>Delete list</button>`;
  }
}
function nameError(name,exceptId){
  if(!name) return "Give the list a name.";
  if(state.lists.some(l=>l.id!==exceptId&&l.name.toLowerCase()===name.toLowerCase())) return "You already have a list with that name.";
  return "";
}

/* ---------- toast ---------- */
let undo=null, tt=null;
function toast(msg,undoFn,label){$("toast-msg").textContent=msg;undo=undoFn||null;$("toast-undo").hidden=!undoFn;$("toast-undo").textContent=label||"Undo";$("toast").classList.add("show");clearTimeout(tt);tt=setTimeout(()=>$("toast").classList.remove("show"),5000)}
$("toast-undo").onclick=()=>{if(undo)undo();undo=null;$("toast").classList.remove("show")};

/* ---------- actions ---------- */
function addTicker(t){const a=active();if(!a.tickers.includes(t)){a.tickers.push(t);save();renderAll();toast(`${info(t).name} added to ${a.name}`)}}
function removeTicker(t){const a=active(),i=a.tickers.indexOf(t);if(i<0)return;a.tickers.splice(i,1);save();renderAll();
  toast(`${info(t).name} removed`,()=>{a.tickers.splice(i,0,t);save();renderAll()})}

document.addEventListener("click",e=>{
  if(!e.target.closest(".dd")) toggleMenu(false);
  if(!e.target.closest(".search")) $("results").classList.remove("open");
  const t=e.target.closest("[data-open],[data-close],[data-add],[data-remove],[data-pick],[data-m],[data-sort],[data-soon],[data-tab]");
  if(!t) return;
  if(t.dataset.remove!==undefined){removeTicker(t.dataset.remove)}
  else if(t.dataset.add){addTicker(t.dataset.add);renderResults();renderAddList()}
  else if(t.dataset.tab){setTab(t.dataset.tab)}
  else if(t.dataset.open){e.preventDefault();location.hash="#/c/"+encodeURIComponent(t.dataset.open)}
  else if(t.hasAttribute("data-close")) closeAll();
  else if(t.dataset.pick){state.active=t.dataset.pick;save();toggleMenu(false);renderAll()}
  else if(t.dataset.m!==undefined) manageView(+t.dataset.m);
  else if(t.dataset.sort){const k=t.dataset.sort,c=COLS[tab].find(x=>x.key===k);
    sort=sort.key===k?(sort.dir>0?{key:k,dir:-1}:{key:null,dir:1}):{key:k,dir:(k==="name"||(c&&c.asc))?1:-1};renderTable()}
  else if(t.hasAttribute("data-soon")){e.preventDefault();toast("Coming in a later version")}
});
$("list-btn").onclick=e=>{e.stopPropagation();toggleMenu()};
$("new-btn").onclick=()=>{openDlg("dlg-new");$("new-name").value="";$("new-err").textContent="";$("new-name").focus()};
$("new-ok").onclick=()=>{const n=$("new-name").value.trim(),err=nameError(n);if(err){$("new-err").textContent=err;return}
  const id="l"+Date.now();state.lists.push({id,name:n,tickers:[]});state.active=id;save();closeAll();renderAll();toast(`Created ${n}`)};
$("new-name").onkeydown=e=>{if(e.key==="Enter")$("new-ok").click()};
$("manage-btn").onclick=()=>{manageView(0);openDlg("dlg-manage")};
$("manage-body").addEventListener("click",e=>{
  const a=active();
  if(e.target.id==="ren-ok"){const n=$("ren").value.trim(),err=nameError(n,a.id);if(err){$("ren-err").textContent=err;return}
    a.name=n;save();closeAll();renderAll();toast(`Renamed to ${n}`)}
  if(e.target.id==="del-final"){const name=a.name;state.lists=state.lists.filter(l=>l.id!==a.id);
    if(!state.lists.length) state.lists.push({id:"l"+Date.now(),name:"My watchlist",tickers:[]});
    state.active=state.lists[0].id;save();closeAll();renderAll();toast(`Deleted ${name}`)}
});
$("manage-body").addEventListener("keydown",e=>{if(e.target.id==="ren"&&e.key==="Enter")$("ren-ok").click()});
$("search").oninput=renderResults; $("search").onfocus=renderResults;
$("add-btn").onclick=()=>{openDlg("dlg-add");$("add-search").value="";renderAddList();$("add-search").focus()};
$("add-search").oninput=renderAddList;
$("scrim").onclick=closeAll;
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeAll();$("results").classList.remove("open")}});
const setUnit=u=>{unit=u;$("u-pct").setAttribute("aria-pressed",u==="pct");$("u-sek").setAttribute("aria-pressed",u==="sek");renderTable()};
$("u-pct").onclick=()=>setUnit("pct"); $("u-sek").onclick=()=>setUnit("sek");

/* ---------- refresh prices: starts the workflow in the data repo, waits, reloads ---------- */
const WORKFLOW="update-market-data.yml";
let refreshing=false;
const ghApi=(path,opt={})=>fetch(`https://api.github.com/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}${path}`,
  Object.assign({cache:"no-store"},opt,{headers:Object.assign({Authorization:`Bearer ${gh.token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},opt.headers||{})}));
function setRefresh(label,busy){const b=$("refresh-btn");b.disabled=busy;$("refresh-label").textContent=label;b.classList.toggle("busy",busy)}
async function refreshPrices(){
  if(refreshing) return;
  if(!gh.token){openSettings();return}
  refreshing=true; setRefresh("Updating…",true);
  const started=Date.now();
  try{
    const r=await ghApi(`/actions/workflows/${WORKFLOW}/dispatches`,{method:"POST",body:JSON.stringify({ref:"main"}),headers:{"Content-Type":"application/json"}});
    if(r.status===403||r.status===404) throw new Error("The token can't start the update. Give it 'Actions: Read and write' access in GitHub (see Settings).");
    if(!r.ok) throw new Error(`GitHub returned error ${r.status} when starting the update.`);
    toast("Update started. This takes about 1–2 minutes.");
    let run=null;
    for(let i=0;i<36;i++){ // poll up to ~6 minutes
      await new Promise(res=>setTimeout(res,10000));
      const rr=await ghApi(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`);
      if(!rr.ok) continue;
      const runs=(await rr.json()).workflow_runs||[];
      run=runs.find(x=>new Date(x.created_at).getTime()>=started-60000);
      if(run&&run.status==="completed") break;
      setRefresh(run?"Fetching prices…":"Starting…",true);
    }
    if(!run||run.status!=="completed") throw new Error("The update is taking longer than usual. Check the Actions tab in the data repo.");
    if(run.conclusion!=="success") throw new Error("The update failed. Open the Actions tab in the data repo to see why.");
    await loadMarket(true);
  }catch(e){toast(e.message)}
  finally{refreshing=false;setRefresh("Refresh prices",false)}
}
$("refresh-btn").onclick=refreshPrices;

/* ---------- settings: GitHub connection ---------- */
function openSettings(){
  $("gh-owner").value=gh.owner; $("gh-repo").value=gh.repo; $("gh-token").value="";
  $("gh-token").placeholder=gh.token?"Saved. Paste a new token to replace it":"github_pat_…";
  $("gh-remove").hidden=!gh.token; $("gh-err").textContent=""; openDlg("dlg-settings");
}
$("settings-btn").onclick=openSettings;
$("gh-save").onclick=async()=>{
  const owner=$("gh-owner").value.trim(), repo=$("gh-repo").value.trim(), token=$("gh-token").value.trim()||gh.token;
  if(!owner||!repo||!token){$("gh-err").textContent="Fill in owner, repository and token.";return}
  gh={owner,repo,token}; try{localStorage.setItem(GH_KEY,JSON.stringify(gh))}catch(e){}
  $("gh-save").disabled=true; const ok=await loadMarket(false); $("gh-save").disabled=false;
  if(ok){closeAll();toast(`Connected. Prices from ${fmtDate(MARKET.asOf)}`);loadModels()} else $("gh-err").textContent=marketError;
};
$("gh-remove").onclick=()=>{gh.token="";try{localStorage.setItem(GH_KEY,JSON.stringify(gh));localStorage.removeItem(MKT_KEY)}catch(e){}
  MARKET=null;marketError="";MODEL_INDEX=[];TEMPLATES=new Set();closeAll();renderAll();toast("Token removed. Showing demo data.")};

/* ---------- models in the data repo ----------
   models/index.json lists every upload (newest first); each upload has the original .xlsx and a .json
   with what Mr. Market read. Blank transfer sheets live in templates/<TICKER>_transfer_sheet.xlsx */
let MODEL_INDEX=[], TEMPLATES=new Set(); const MODEL_DATA={}, ACTUALS={};
// load status, so the page never shows "No model yet" when the data simply failed to load
const DS={models:"idle",modelsErr:"",templatesErr:""}, ACT_ERR={}, MODEL_ERR={}, RETRY_AT={};
const httpErr=st=>st===401?"GitHub did not accept the token (401). Check it under Settings.":
  st===403?"GitHub refused access (403). The token may lack access to the data repo, or the rate limit was reached.":
  st===404?"File not found (404).":`GitHub returned error ${st}.`;
const netErr=e=>e&&e.name==="TypeError"?"No connection to GitHub. Check your internet connection.":(e&&e.message)||String(e);
let chartMetric="sales"; const WACC_OVERRIDE={};
const safeT=t=>t.replace(/\s+/g,"-");
const encPath=p=>p.split("/").map(encodeURIComponent).join("/");
function latestModel(t){return MODEL_INDEX.find(m=>m.ticker===t&&!m.hidden)||null}
const LATEST_TEMPLATE="1.1";
async function loadModels(){
  if(!gh.token){MODEL_INDEX=[];TEMPLATES=new Set();DS.models="idle";renderAll();return}
  DS.models="loading"; DS.modelsErr=""; renderAll();
  try{
    const r=await ghApi("/contents/models/index.json",{headers:{Accept:"application/vnd.github.raw+json"}});
    if(r.status===404){MODEL_INDEX=[]}
    else if(!r.ok){throw new Error(httpErr(r.status))}
    else{
      let d; try{d=JSON.parse(await r.text())}catch(e){throw new Error("models/index.json is not valid JSON.")}
      const list=Array.isArray(d&&d.models)?d.models:[];
      MODEL_INDEX=list.filter(m=>m&&m.ticker&&m.json&&m.xlsx)
        .map(m=>Object.assign({uploadedAt:"",basis:"",fileName:"Model",valuePerShare:null},m))
        .sort((a,b)=>String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    }
    DS.models="ok";
  }catch(e){DS.models="error";DS.modelsErr=netErr(e);console.error("loadModels",e)}
  try{
    const r=await ghApi("/contents/reports.json",{headers:{Accept:"application/vnd.github.raw+json"}});
    if(r.ok){const d=JSON.parse(await r.text());REPORT_CAL=(d&&d.companies)||{}} else if(r.status===404) REPORT_CAL={};
  }catch(e){console.error("reports",e)}
  try{
    const r=await ghApi("/contents/templates");
    if(r.status===404){TEMPLATES=new Set()}
    else if(!r.ok){throw new Error(httpErr(r.status))}
    else{const list=await r.json();TEMPLATES=new Set((Array.isArray(list)?list:[]).map(f=>f.name).filter(n=>/_transfer_sheet\.xlsx$/i.test(n)).map(n=>n.replace(/_transfer_sheet\.xlsx$/i,"")))}
    DS.templatesErr="";
  }catch(e){DS.templatesErr=netErr(e);console.error("templates",e)}
  renderAll();
}
const b64bytes=buf=>{const u8=new Uint8Array(buf);let s="";for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s)};
const b64text=str=>b64bytes(new TextEncoder().encode(str));
async function putFile(path,content,message,sha){
  const body={message,content}; if(sha) body.sha=sha;
  const r=await ghApi("/contents/"+encPath(path),{method:"PUT",body:JSON.stringify(body),headers:{"Content-Type":"application/json"}});
  if(!r.ok) throw new Error(r.status===401||r.status===403?"GitHub did not allow saving. Check that the token has Contents: Read and write.":`GitHub returned error ${r.status} while saving.`);
  return r.json();
}
async function getJson(path){
  const r=await ghApi("/contents/"+encPath(path));
  if(r.status===404) return {sha:null,data:null};
  if(!r.ok) throw new Error(`GitHub returned error ${r.status}.`);
  const d=await r.json(), bin=atob(d.content.replace(/\n/g,""));
  return {sha:d.sha,data:JSON.parse(new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0))))};
}
async function downloadPath(path,name){
  const r=await ghApi("/contents/"+encPath(path),{headers:{Accept:"application/vnd.github.raw+json"}});
  if(!r.ok) throw new Error(r.status===404?"The file was not found in the data repo.":`GitHub returned error ${r.status}.`);
  const blob=new Blob([await r.arrayBuffer()],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
}

/* ---------- routing: #/c/<ticker> shows the company page ---------- */
let currentCompany=null;
let currentView="watchlist";
function setNav(view){
  document.querySelectorAll(".nav a[data-view]").forEach(a=>{if(a.dataset.view===view)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
}
function route(){
  const m=/^#\/c\/(.+)$/.exec(location.hash);
  if(m&&info(decodeURIComponent(m[1]))){currentView="company";$("view-models").hidden=true;setNav("watchlist");showCompany(decodeURIComponent(m[1]))}
  else if(location.hash==="#/models"){currentView="models";currentCompany=null;$("view-company").hidden=true;$("view-watchlist").hidden=true;$("view-models").hidden=false;setNav("models");renderModelsPage();window.scrollTo(0,0)}
  else{currentView="watchlist";currentCompany=null;$("view-company").hidden=true;$("view-models").hidden=true;$("view-watchlist").hidden=false;setNav("watchlist")}
}
function showCompany(t){
  const first=currentCompany!==t; currentCompany=t;
  $("view-watchlist").hidden=true; $("view-company").hidden=false; if(first) window.scrollTo(0,0);
  renderCompany();
}
const LOADING=new Set();
const actualsPath=t=>`actuals/${safeT(t)}_actuals.xlsx`;
// a failed load is never remembered as "no data": it shows an error and is retried (after 20 s or on "Try again")
async function ensureActuals(t){
  if(ACTUALS[t]!==undefined||LOADING.has("A:"+t)||!gh.token) return;
  if(ACT_ERR[t]&&Date.now()<(RETRY_AT["A:"+t]||0)) return;
  LOADING.add("A:"+t);
  try{
    const r=await ghApi("/contents/"+encPath(actualsPath(t)),{headers:{Accept:"application/vnd.github.raw+json"}});
    if(r.status===404) ACTUALS[t]=null;
    else if(!r.ok) throw new Error(httpErr(r.status));
    else ACTUALS[t]=await MMModels.readActuals(await r.arrayBuffer());
    delete ACT_ERR[t];
  }catch(e){ACT_ERR[t]=netErr(e);RETRY_AT["A:"+t]=Date.now()+20000;console.error("actuals",e)}
  finally{LOADING.delete("A:"+t)}
  if(currentCompany===t) renderCompany();
}
async function ensureModelData(t,path){
  if(MODEL_DATA[path]||LOADING.has(path)||!gh.token) return;
  if(MODEL_ERR[path]&&Date.now()<(RETRY_AT[path]||0)) return;
  LOADING.add(path);
  try{
    const r=await getJson(path);
    if(!r.data) throw new Error("The saved model file was not found in the data repo.");
    MODEL_DATA[path]=r.data; delete MODEL_ERR[path];
  }catch(e){MODEL_ERR[path]=netErr(e);RETRY_AT[path]=Date.now()+20000;console.error("model",e)}
  finally{LOADING.delete(path)}
  if(currentCompany===t) renderCompany();
}
function retryLoads(){
  for(const k in ACT_ERR) delete ACT_ERR[k];
  for(const k in MODEL_ERR) delete MODEL_ERR[k];
  for(const k in RETRY_AT) delete RETRY_AT[k];
  for(const k in ACTUALS) if(ACTUALS[k]===null) delete ACTUALS[k];
  loadModels(); renderCompany();
}
/* forecast vs actual: for every reported quarter, use your last model version from before the report */
const FVA_Q={};
function comparisonFor(t){
  const A=ACTUALS[t]; if(!A||!A.quarterly) return null;
  const vers=MODEL_INDEX.filter(m=>m.ticker===t&&!m.hidden).slice().sort((a,b)=>String(a.uploadedAt).localeCompare(String(b.uploadedAt)));
  if(!vers.length) return null;
  const cal=REPORT_CAL[t]||[], list=[];
  A.quarterly.periods.forEach(Q=>{
    if(qIndex(Q)==null||A.quarterly.value("net sales",Q)==null) return;
    const rep=(cal.find(e=>e.quarter===Q)||{}).date||null;
    const cands=vers.filter(v=>qIndex(v.basis)!=null&&qIndex(v.basis)<qIndex(Q)&&(!rep||String(v.uploadedAt).slice(0,10)<=rep));
    if(cands.length) list.push({quarter:Q,reportDate:rep,version:cands[cands.length-1]});
  });
  list.sort((a,b)=>qIndex(b.quarter)-qIndex(a.quarter));
  const selected=FVA_Q[t]&&list.some(x=>x.quarter===FVA_Q[t])?FVA_Q[t]:(list[0]&&list[0].quarter);
  const sel=list.find(x=>x.quarter===selected);
  if(sel&&!MODEL_DATA[sel.version.json]) ensureModelData(t,sel.version.json);
  return {list,selected,data:sel?MODEL_DATA[sel.version.json]||null:null};
}
function companyCtx(){
  const t=currentCompany, lm=latestModel(t), data=lm?MODEL_DATA[lm.json]:null;
  let result=null; try{result=data?MMModels.computeValuation(data):null}catch(e){}
  return {s:info(t),connected:!!gh.token,hasTemplate:TEMPLATES.has(safeT(t)),
    versions:MODEL_INDEX.filter(m=>m.ticker===t&&!m.hidden),latest:lm,data,result,actuals:ACTUALS[t]||null,hasActuals:!!ACTUALS[t],metric:chartMetric,
    wacc:lm?WACC_OVERRIDE[lm.json]:undefined,h:{fmt,pct,esc,fmtDate,flag,daysTo},
    comparison:comparisonFor(t),
    status:{models:DS.models,modelsErr:DS.modelsErr,actualsErr:ACT_ERR[t]||"",modelDataErr:lm?MODEL_ERR[lm.json]||"":""}};
}
function renderCompany(){
  if(!currentCompany) return;
  const t=currentCompany, lm=latestModel(t), data=lm?MODEL_DATA[lm.json]:null;
  if(lm&&!data) ensureModelData(t,lm.json);
  ensureActuals(t);
  try{MMCompany.render($("view-company"),companyCtx())}
  catch(e){
    console.error("company page",e);
    $("view-company").innerHTML=`<div class="cp"><a href="#/" class="back">‹ Watchlist</a><section class="card cp-chart"><div class="warn"><b>This page could not be shown.</b> ${esc(e&&e.message||String(e))}</div>
      <div class="cp-actions" style="margin-top:10px"><button class="pill" data-action="retry-load">Try again</button></div></section></div>`;
  }
}
// WACC slider: recalculates instantly while dragging; only the valuation card is redrawn
$("view-company").addEventListener("input",e=>{
  if(e.target.id!=="wacc-slider") return;
  const lm=latestModel(currentCompany); if(!lm) return;
  const w=Math.round(+e.target.value*10)/1000; WACC_OVERRIDE[lm.json]=w;
  MMCompany.updateValuation($("view-company"),companyCtx(),w);
});
window.addEventListener("hashchange",route);
{const bl=document.querySelector(".brand-link"); if(bl) bl.addEventListener("click",()=>{if(location.hash==="#/"||location.hash===""){route();window.scrollTo(0,0)}});}

/* ---------- upload: read, review, save ---------- */
let pending=null;
$("view-company").addEventListener("click",async e=>{
  const b=e.target.closest("[data-action]"); if(!b) return;
  const t=currentCompany, a=b.dataset.action;
  try{
    if(a==="upload"){openUpload(t)}
    else if(a==="download-template"){toast("Downloading…");await downloadPath(`templates/${safeT(t)}_transfer_sheet.xlsx`,`${safeT(t)}_transfer_sheet.xlsx`)}
    else if(a==="download-model"){const lm=latestModel(t);toast("Downloading…");await downloadPath(lm.xlsx,lm.fileName)}
    else if(a==="download-version"){toast("Downloading…");await downloadPath(b.dataset.path,b.dataset.name)}
    else if(a==="download-actuals"){toast("Downloading…");await downloadPath(actualsPath(t),`${safeT(t)}_historical_financials.xlsx`)}
    else if(a==="metric"){chartMetric=b.dataset.metric;renderCompany()}
    else if(a==="fva-q"){FVA_Q[t]=b.dataset.q;renderCompany()}
    else if(a==="retry-load"){toast("Loading again…");retryLoads()}
    else if(a==="wacc-implied"){const lm=latestModel(t);if(lm){const r=MMCompany.impliedWacc(companyCtx());
      if(r.error){toast(r.error)}else{WACC_OVERRIDE[lm.json]=r.wacc;MMCompany.updateValuation($("view-company"),companyCtx(),r.wacc)}}}
    else if(a==="wacc-reset"){const lm=latestModel(t);if(lm){delete WACC_OVERRIDE[lm.json];MMCompany.updateValuation($("view-company"),companyCtx(),MODEL_DATA[lm.json].inputs.wacc)}}
  }catch(err){toast(err.message)}
});
/* ---------- upload: choose file, confirm company, review, save ----------
   The company is read from inside the file (ticker cell, then the sheet title), never from the file name alone. */
function openUpload(expected){
  pending={expected:expected||null,file:null,buf:null,res:null,t:null,detected:null,choosing:false,note:""};
  $("dr-t").textContent="Upload model";
  openDlg("dlg-review"); renderPick();
}
function renderPick(){
  $("review-body").innerHTML=`<label class="dropzone" id="dropzone">
      <svg class="xl"><use href="#i-xl"/></svg>
      <b>Drop your Excel file here</b><span class="dim small">or</span>
      <span class="pill">Browse files</span>
      <span class="dim small">Your DCF with the transfer sheet, or the transfer sheet alone (.xlsx)</span>
    </label>`;
  const dz=$("dropzone");
  dz.onclick=e=>{e.preventDefault();$("model-file").value="";$("model-file").click()};
  ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("over")}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("over")}));
  dz.addEventListener("drop",e=>{const f=e.dataTransfer&&e.dataTransfer.files[0];if(f)handleFile(f)});
}
$("model-file").addEventListener("change",()=>{const f=$("model-file").files[0]; if(f&&pending) handleFile(f)});
const normT=x=>String(x||"").toUpperCase().replace(/[-_]+/g," ").replace(/\s+/g," ").trim();
function resolveTicker(raw,fileName){
  const all=UNIVERSE.map(([t])=>t);
  if(raw){const n=normT(raw);const hit=all.find(t=>normT(t)===n);if(hit)return hit}
  const fn=String(fileName||"").toLowerCase();               // last resort: company name or ticker in the file name
  const hit=UNIVERSE.find(([t,n])=>fn.includes(n.toLowerCase())||fn.includes(t.toLowerCase().replace(/\s+/g,"-"))||fn.includes(t.toLowerCase().replace(/\s+/g,"_")));
  return hit?hit[0]:null;
}
async function handleFile(file){
  $("review-body").innerHTML=`<p class="dim">Reading ${esc(file.name)}…</p>`;
  try{
    const buf=await file.arrayBuffer();
    const res=await MMModels.parseTransferSheet(buf,null);
    const detected=resolveTicker(res.model&&res.model.ticker,file.name);
    Object.assign(pending,{file,buf,res,detected,t:detected||pending.expected,choosing:!(detected||pending.expected)});
    if(pending.t) ensureActuals(pending.t);
    renderReview();
  }catch(err){$("review-body").innerHTML=`<div class="warn"><b>Could not read the file.</b> ${esc(err.message||String(err))}</div>
    <div class="actions"><button class="pill" id="rv-again">Choose another file</button><button class="pill" data-close>Close</button></div>`;
    $("rv-again").onclick=renderPick}
}
// plausibility: does the share count in the sheet fit the chosen company?
function shareCheck(t,res){
  const sh=res.model&&res.model.inputs&&res.model.inputs.shares; if(!sh) return null;
  let ref=null; const A=ACTUALS[t];
  if(A&&A.quarterly){const v=A.quarterly.get("shares outstanding").filter(x=>x!=null);if(v.length)ref=v[v.length-1]}
  if(ref==null&&MARKET&&MARKET.stocks&&MARKET.stocks[t]){const m=MARKET.stocks[t];if(m.kpi&&m.kpi.mcap&&m.price)ref=m.kpi.mcap/m.price}
  if(!ref) return null;
  return Math.abs(sh/ref-1)>0.2?`The sheet has ${fmt(sh)} m shares, but ${info(t).name} has about ${fmt(ref)} m. Is this the right company?`:null;
}
function renderReview(){
  const P=pending, {file,res}=P, r=res.result, t=P.t, s=t?info(t):null, prev=t?latestModel(t):null;
  const bad=[...res.errors], warn=[...res.warnings], ok=[];
  if(t){
    if(P.detected&&P.detected!==t) warn.unshift(`The transfer sheet says ${P.detected}, but you are saving it for ${t}.`);
    const sc=shareCheck(t,res); if(sc) warn.unshift(sc);
  }
  if(!bad.length){
    ok.push("Transfer sheet found and all forecast cells are filled");
    if(res.model.sheet&&res.model.sheet.vps!=null&&!warn.some(w=>w.startsWith("The sheet's own value"))) ok.push(`Value per share matches the sheet (${fmt(res.model.sheet.vps)})`);
  }
  let h=`<p class="rv-file"><svg class="xl"><use href="#i-xl"/></svg><span><b>${esc(file.name)}</b><br><span class="dim small">${res.model&&res.model.basis?"Based on "+esc(res.model.basis):""}${res.model&&res.model.templateVersion?" · template "+esc(res.model.templateVersion):""}</span></span></p>`;
  // company confirmation, with a simple way to change it
  if(t&&!P.choosing){
    h+=`<div class="rv-company">${flag(s.country)}<span>${prev?"Updated model for":"New model for"} <b>${esc(s.name)}</b> (${esc(t)})</span>
      <button class="link-btn" id="rv-change">Not the right company? Change</button></div>`;
  }else{
    h+=`<div class="rv-choose"><b>${t?"Choose the company for this model":"Which company is this model for?"}</b>
      <input class="field" id="rv-search" type="search" placeholder="Search company or ticker" autocomplete="off">
      <div id="rv-results" class="rv-results"></div></div>`;
  }
  if(r&&t){
    const up=s.price?r.vps/s.price-1:null;
    h+=`<div class="rv-stats"><div><small>Your value</small><b>${fmt(r.vps)}</b></div><div><small>Share price</small><b>${s.price!=null?fmt(s.price):"–"}</b></div>
      <div><small>Upside</small><b class="${up==null?"":up>=0?"pos":"neg"}">${up==null?"–":pct(up)}</b></div>
      <div><small>vs last version</small><b>${prev&&prev.valuePerShare?`<span class="${r.vps>=prev.valuePerShare?"pos":"neg"}">${pct(r.vps/prev.valuePerShare-1)}</span>`:"<span class='dim'>first</span>"}</b></div></div>`;
  }
  h+=`<ul class="checks">${bad.map(x=>`<li class="bad">${esc(x)}</li>`).join("")}${warn.map(x=>`<li class="warn-i">${esc(x)}</li>`).join("")}${ok.map(x=>`<li class="good">${esc(x)}</li>`).join("")}</ul>`;
  h+=`<label for="rv-note" class="rv-note-label">Note <span class="dim">(optional): what changed in this version?</span></label>
    <input class="field" id="rv-note" maxlength="200" placeholder="E.g. raised Data Center growth after the Q2 call" value="${esc(P.note)}">`;
  const canSave=!bad.length&&!!gh.token&&!!t&&!P.choosing;
  h+=`${!gh.token?`<p class="note">Connect GitHub under Settings to save models.</p>`:""}
    <div class="actions"><button class="pill" id="rv-other">Choose another file</button><button class="pill" data-close>Cancel</button><button class="pill primary" id="rv-save" ${canSave?"":"disabled"}>Save model</button></div>`;
  $("review-body").innerHTML=h;
  $("rv-note").oninput=e=>{P.note=e.target.value};
  $("rv-other").onclick=()=>{P.note=$("rv-note").value;renderPick()};
  const ch=$("rv-change"); if(ch) ch.onclick=()=>{P.choosing=true;renderReview();$("rv-search").focus()};
  const se=$("rv-search");
  if(se){
    const list=()=>{const q=se.value.trim().toLowerCase();
      const hits=UNIVERSE.filter(([tt,n])=>!q||(n+" "+tt).toLowerCase().includes(q)).slice(0,8);
      $("rv-results").innerHTML=hits.map(([tt,n])=>`<button class="rv-hit" data-co="${esc(tt)}">${flag(info(tt).country)}<span><b>${esc(n)}</b> <span class="dim">${esc(tt)}</span></span></button>`).join("")||`<p class="dim small">No match</p>`;};
    se.oninput=list; list();
    $("rv-results").onclick=e=>{const b=e.target.closest("[data-co]");if(!b)return;P.t=b.dataset.co;P.choosing=false;ensureActuals(P.t);renderReview()};
  }
  const btn=$("rv-save"); if(btn) btn.onclick=saveModel;
}
async function saveModel(){
  const P=pending, {t,file,buf,res}=P, btn=$("rv-save");
  btn.disabled=true; btn.textContent="Saving…";
  try{
    const now=new Date(), stamp=now.toISOString().replace(/[-:]/g,"").slice(0,15);
    const base=`models/${safeT(t)}/${stamp}`, safeName=file.name.replace(/[^\w.\-]+/g,"_");
    const xlsxPath=`${base}_${safeName}`, jsonPath=`${base}.json`;
    const msg=`Upload model ${t} (${res.model.basis||"no basis"})`;
    await putFile(xlsxPath,b64bytes(buf),msg);
    const data=Object.assign({},res.model,{ticker:t,fileName:file.name,uploadedAt:now.toISOString()});
    await putFile(jsonPath,b64text(JSON.stringify(data)),msg);
    const idx=await getJson("models/index.json");
    const list=(idx.data&&idx.data.models)||[];
    const s=info(t), note=String(P.note||"").trim();
    const entry={ticker:t,uploadedAt:now.toISOString(),basis:res.model.basis,valuePerShare:+res.result.vps.toFixed(4),
      fileName:file.name,xlsx:xlsxPath,json:jsonPath,templateVersion:res.model.templateVersion||null,
      note:note||null,priceAtUpload:s&&s.price!=null?s.price:null,priceDate:s&&s.priceDate||null};
    list.unshift(entry);
    await putFile("models/index.json",b64text(JSON.stringify({schema:1,models:list},null,1)),msg,idx.sha);
    MODEL_INDEX=list.sort((a,b)=>String(b.uploadedAt).localeCompare(String(a.uploadedAt))); MODEL_DATA[jsonPath]=data; DS.models="ok";
    closeAll(); toast(`Model saved for ${s.name}: ${fmt(entry.valuePerShare)} per share`);
    try{renderAll()}catch(e){console.error(e)}
  }catch(err){btn.disabled=false;btn.textContent="Save model";toast(err.message)}
}

/* ---------- index updates: notes and hidden versions (a few bytes in models/index.json) ---------- */
async function updateIndexEntry(jsonPath,patch,message){
  const idx=await getJson("models/index.json");
  const list=(idx.data&&idx.data.models)||[];
  const e=list.find(m=>m.json===jsonPath); if(!e) throw new Error("This version was not found in your model list.");
  Object.assign(e,patch);
  await putFile("models/index.json",b64text(JSON.stringify({schema:1,models:list},null,1)),message,idx.sha);
  const local=MODEL_INDEX.find(m=>m.json===jsonPath); if(local) Object.assign(local,patch);
  renderAll();
}

/* ---------- My models page ---------- */
const MM={filter:"all",open:new Set(),showHidden:new Set(),editing:null};
function modelStatus(entry,s){
  const bq=qIndex(entry.basis);
  if(bq==null) return {kind:"unknown",text:"Status unknown",short:"Status unknown"};
  const lr=s&&s.lastReport, nr=s&&s.nextReportInfo;
  if(lr&&qIndex(lr.quarter)>bq){
    if(entry.reviewedQuarter===lr.quarter) return {kind:"ok",text:`${lr.quarter} reviewed · assumptions kept`,short:`Reviewed ${lr.quarter}`};
    return {kind:"update",text:`${lr.quarter} reported ${fmtDate(lr.date)} · your model is based on ${entry.basis}`,short:`${lr.quarter.split(" ")[0]} reported · not reviewed`};
  }
  if(nr){const n=daysTo(nr.date);return {kind:"ok",text:`Up to date · ${nr.quarter} report in ${n} day${n===1?"":"s"}`,short:`Based on ${entry.basis}`}}
  // no report dates known: estimate from the calendar (reports come within ~2 months of quarter end)
  const q=((bq-1)%4)+1, y=Math.floor((bq-1)/4), nq=q===4?1:q+1, ny=q===4?y+1:y;
  if(TODAY>new Date(new Date(ny,nq*3,0).getTime()+60*864e5)) return {kind:"update",text:`A new report is likely out · your model is based on ${entry.basis}`,short:"New report likely out"};
  return {kind:"ok",text:"Up to date",short:`Based on ${entry.basis}`};
}
function renderModelsPage(){
  if(currentView!=="models") return;
  const el=$("view-models");
  try{
    const groups={};
    MODEL_INDEX.forEach(m=>{(groups[m.ticker]=groups[m.ticker]||[]).push(m)});
    const rows=Object.keys(groups).map(t=>{const all=groups[t],latest=all.find(m=>!m.hidden)||null,s=info(t)||{ticker:t,name:t,country:"SE"};
      return {t,s,all,latest,status:latest?modelStatus(latest,s):{kind:"hidden",text:"All versions hidden"}}})
      .sort((a,b)=>String((b.latest||b.all[0]).uploadedAt).localeCompare(String((a.latest||a.all[0]).uploadedAt)));
    const nUpd=rows.filter(r=>r.status.kind==="update").length;
    const shown=MM.filter==="update"?rows.filter(r=>r.status.kind==="update"):rows;
    const loading=gh.token&&DS.models==="loading", failed=gh.token&&DS.models==="error";
    let h=`<div class="mm-head"><h1>My models</h1><button class="pill primary" data-mm="upload"><svg><use href="#i-up"/></svg>Upload new model</button></div>`;
    if(!gh.token) h+=`<section class="card mm-empty"><p>Connect GitHub under Settings (on the watchlist page) to see and store your models.</p></section>`;
    else if(failed) h+=`<section class="card mm-empty"><div class="warn"><b>Your models could not be loaded from GitHub.</b> ${esc(DS.modelsErr)}</div><div class="cp-actions" style="margin-top:10px"><button class="pill" data-mm="retry">Try again</button></div></section>`;
    else if(loading&&!rows.length) h+=`<section class="card mm-empty"><p class="dim">Loading your models…</p></section>`;
    else if(!rows.length) h+=`<section class="card mm-empty"><h2>No models yet</h2><p class="dim">Upload your DCF with the Mr. Market transfer sheet. Mr. Market reads which company it is for and keeps every version here.</p></section>`;
    else{
      h+=`<div class="seg mm-filter" role="group" aria-label="Filter models"><button data-mm="filter" data-f="all" aria-pressed="${MM.filter==="all"}">All (${rows.length})</button><button data-mm="filter" data-f="update" aria-pressed="${MM.filter==="update"}">Needs update (${nUpd})</button></div>`;
      h+=`<section class="card mm-list"><div class="mm-row mm-hdr"><span></span><span>Company</span><span>Latest model</span><span>Based on</span><span class="r">Your value</span><span>Status</span></div>`;
      if(!shown.length) h+=`<p class="dim mm-none">No models need updating right now</p>`;
      shown.forEach(r=>{
        const L=r.latest||r.all[0], open=MM.open.has(r.t), tmplOld=L.templateVersion&&L.templateVersion<LATEST_TEMPLATE;
        h+=`<div class="mm-row${open?" open":""}">
          <button class="mm-tog" data-mm="toggle" data-t="${esc(r.t)}" aria-expanded="${open}" aria-label="Show versions"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg></button>
          <a class="mm-co" href="#/c/${encodeURIComponent(r.t)}">${flag(r.s.country)}<span><b>${esc(r.s.name)}</b><small>${esc(r.t)}</small></span></a>
          <span class="mm-file"><span class="fn">${esc(L.fileName)}</span><small title="${esc(new Date(L.uploadedAt).toLocaleString("en-GB"))}">uploaded ${ago(L.uploadedAt)}</small></span>
          <span>${esc(L.basis||"–")}</span>
          <span class="r">${L.valuePerShare!=null&&r.latest?fmt(L.valuePerShare):"–"}</span>
          <span class="mm-status"><span class="chip ${r.status.kind}">${esc(r.status.text)}</span>${tmplOld?`<small class="dim">Template ${esc(L.templateVersion)}, latest is ${LATEST_TEMPLATE}</small>`:""}</span>
        </div>`;
        if(open) h+=versionsHtml(r);
      });
      h+=`</section>`;
    }
    el.innerHTML=`<div class="mm">${h}</div>`;
  }catch(e){console.error(e);el.innerHTML=`<section class="card mm-empty"><div class="warn"><b>This page could not be shown.</b> ${esc(e.message||String(e))}</div></section>`}
}
function ago(iso){
  const d=new Date(iso); if(isNaN(d)) return "–";
  const days=Math.floor((Date.now()-d.getTime())/864e5);
  if(days<=0) return "today"; if(days===1) return "yesterday"; if(days<30) return `${days} days ago`;
  return "on "+d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
}
function versionsHtml(r){
  const vis=r.all.filter(m=>!m.hidden), hid=r.all.filter(m=>m.hidden), showHid=MM.showHidden.has(r.t);
  const row=(m,i,arr)=>{
    const prev=arr.slice(i+1).find(x=>x.valuePerShare), ch=prev&&m.valuePerShare?m.valuePerShare/prev.valuePerShare-1:null;
    const editing=MM.editing===m.json;
    const d=new Date(m.uploadedAt);
    return `<tr class="${m.hidden?"is-hidden":""}"><td>${isNaN(d)?"–":d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}<small>${isNaN(d)?"":d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</small></td>
      <td class="fn">${esc(m.fileName)}</td><td>${esc(m.basis||"–")}</td>
      <td class="r">${m.valuePerShare!=null?fmt(m.valuePerShare):"–"}${ch!=null&&!m.hidden?` <small class="${ch>=0?"pos":"neg"}">${pct(ch)}</small>`:""}</td>
      <td class="note-cell">${editing?`<input class="field" id="note-input" maxlength="200" value="${esc(m.note||"")}"><span class="note-act"><button class="link-btn" data-mm="note-save" data-path="${esc(m.json)}">Save</button><button class="link-btn" data-mm="note-cancel">Cancel</button></span>`
        :`${m.note?esc(m.note):`<span class="dim">No note</span>`} <button class="link-btn sm" data-mm="note-edit" data-path="${esc(m.json)}">${m.note?"Edit":"Add note"}</button>`}</td>
      <td class="acts"><button class="link-btn sm" data-mm="download" data-path="${esc(m.xlsx)}" data-name="${esc(m.fileName)}">Download</button>
        <button class="link-btn sm" data-mm="${m.hidden?"show":"hide"}" data-path="${esc(m.json)}">${m.hidden?"Show":"Hide"}</button></td></tr>`;
  };
  return `<div class="mm-versions"><table><thead><tr><th>Uploaded</th><th>File</th><th>Based on</th><th class="r">Your value</th><th>Note</th><th></th></tr></thead>
    <tbody>${vis.map((m,i)=>row(m,i,vis)).join("")}${showHid?hid.map((m,i)=>row(m,i,hid)).join(""):""}</tbody></table>
    ${hid.length?`<button class="link-btn sm mm-hidtog" data-mm="hidden-toggle" data-t="${esc(r.t)}">${showHid?"Hide":"Show"} ${hid.length} hidden version${hid.length>1?"s":""}</button>`:""}
    <div class="mm-vacts"><button class="pill" data-mm="upload" data-t="${esc(r.t)}"><svg><use href="#i-up"/></svg>Upload new version</button><a class="pill" href="#/c/${encodeURIComponent(r.t)}">Open company page</a></div></div>`;
}
$("view-models").addEventListener("click",async e=>{
  const b=e.target.closest("[data-mm]"); if(!b) return;
  const a=b.dataset.mm;
  try{
    if(a==="upload") openUpload(b.dataset.t||null);
    else if(a==="retry"){retryLoads()}
    else if(a==="filter"){MM.filter=b.dataset.f;renderModelsPage()}
    else if(a==="toggle"){const t=b.dataset.t;MM.open.has(t)?MM.open.delete(t):MM.open.add(t);renderModelsPage()}
    else if(a==="hidden-toggle"){const t=b.dataset.t;MM.showHidden.has(t)?MM.showHidden.delete(t):MM.showHidden.add(t);renderModelsPage()}
    else if(a==="download"){toast("Downloading…");await downloadPath(b.dataset.path,b.dataset.name)}
    else if(a==="note-edit"){MM.editing=b.dataset.path;renderModelsPage();const i=$("note-input");if(i){i.focus();i.onkeydown=ev=>{if(ev.key==="Enter")document.querySelector('[data-mm="note-save"]').click();if(ev.key==="Escape"){MM.editing=null;renderModelsPage()}}}}
    else if(a==="note-cancel"){MM.editing=null;renderModelsPage()}
    else if(a==="note-save"){const v=$("note-input").value.trim();b.disabled=true;await updateIndexEntry(b.dataset.path,{note:v||null},"Edit model note");MM.editing=null;renderModelsPage();toast("Note saved")}
    else if(a==="hide"){const p=b.dataset.path;await updateIndexEntry(p,{hidden:true},"Hide model version");toast("Version hidden",async()=>{try{await updateIndexEntry(p,{hidden:false},"Show model version")}catch(err){toast(err.message)}},"Undo")}
    else if(a==="show"){await updateIndexEntry(b.dataset.path,{hidden:false},"Show model version");toast("Version shown again")}
  }catch(err){toast(err.message)}
});

/* ---------- automatic update check ----------
   version.json in the repo always holds the latest version. If it differs from the code that is
   running, the page reloads itself with ?v=<new version>, which makes Safari fetch fresh files.
   Runs in the background, so it never slows the app down. */
let lastCheck=0;
async function checkForUpdate(){
  if(Date.now()-lastCheck<60000) return; lastCheck=Date.now();
  try{
    const r=await fetch("version.json?t="+Date.now(),{cache:"no-store"}); if(!r.ok) return;
    const v=String((await r.json()).version||""); if(!v||v===APP_VERSION) return;
    const url=new URL(location.href);
    if(url.searchParams.get("v")===v){toast(`Version ${v} is ready`,()=>location.reload(),"Reload");return} // GitHub still publishing
    url.searchParams.set("v",v); location.replace(url.toString());
  }catch(e){}
}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkForUpdate()});

function renderAll(){renderBanner();renderTable();renderStatus();renderCompany();renderModelsPage()}
window.addEventListener("error",e=>{if(e&&e.message)toast("Something went wrong: "+e.message)});
window.addEventListener("unhandledrejection",e=>{const m=e&&e.reason&&(e.reason.message||String(e.reason));if(m)toast("Something went wrong: "+m)});
$("app-version").textContent=APP_VERSION;
renderAll();
route();
loadMarket(false);
loadModels();
checkForUpdate();
})();
