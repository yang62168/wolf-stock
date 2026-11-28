import {symbol} from './analytics.mjs';
import {mountReviewPanels} from './daily-review-panels.mjs';
import {broadEtfs} from './daily-review-data.mjs';

const dateFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const quantity=(value,digits=0)=>Number.isFinite(value)?value.toLocaleString('zh-CN',{maximumFractionDigits:digits}):'—';
const money=value=>!Number.isFinite(value)?'—':value>=1e8?quantity(value/1e8,2)+' 亿':value>=1e4?quantity(value/1e4,2)+' 万':quantity(value,2)+' 元';
const percent=value=>Number.isFinite(value)?quantity(value,2)+'%':'—';
const heights=value=>Number.isInteger(value)&&value>0?value:null;
const safeGroup=value=>typeof value==='string'&&value.trim()?value.trim():'未分类';
const boardNames={main:'沪深主板',growth:'创业板',star:'科创板',beijing:'北交所',other:'其他'};

function boardFor(code){
  if(code.startsWith('bj'))return 'beijing';
  if(/^sz30[012]/.test(code))return 'growth';
  if(/^sh68[89]/.test(code))return 'star';
  if(/^(?:sh60[0135]|sz00[0-3])/.test(code))return 'main';
  return 'other';
}

function boardTime(raw){
  const value=String(raw??'').trim();
  if(!/^\d{5,6}$/.test(value))return '';
  const time=value.padStart(6,'0');
  return /^(?:09|10|11|13|14|15)[0-5]\d[0-5]\d$/.test(time)?time:'';
}

function displayTime(value){
  return value?value.replace(/^(..)(..)(..)$/,'$1:$2:$3'):'—';
}

export function recentPoolDates(now=new Date(),count=4){
  const date=new Date(dateFormat.format(now)+'T00:00:00Z');
  if(timeFormat.format(now)<'09:30')date.setUTCDate(date.getUTCDate()-1);
  const days=[];
  while(days.length<count){
    if(date.getUTCDay()>0&&date.getUTCDay()<6)days.push(date.toISOString().slice(0,10));
    date.setUTCDate(date.getUTCDate()-1);
  }
  return days;
}

export function summarizeDailyLimits(records){
  const unique=new Map();
  for(const row of records){
    const code=symbol(row?.symbol||row?.code);
    if(!code)continue;
    unique.set(code,{...row,symbol:code,industry:safeGroup(row.industry),board:boardFor(code),
      consecutive:heights(row.consecutive),firstTime:boardTime(row.firstTime),lastTime:boardTime(row.lastTime)});
  }
  const rows=[...unique.values()].sort((a,b)=>(b.consecutive??0)-(a.consecutive??0)
    ||(a.firstTime||'z').localeCompare(b.firstTime||'z')||a.symbol.localeCompare(b.symbol));
  const ladder=new Map(),industries=new Map(),boards=new Map();
  for(const row of rows){
    if(!ladder.has(row.consecutive))ladder.set(row.consecutive,[]);
    ladder.get(row.consecutive).push(row);
    if(!industries.has(row.industry))industries.set(row.industry,[]);
    industries.get(row.industry).push(row);
    boards.set(row.board,(boards.get(row.board)||0)+1);
  }
  return {rows,ladder,boards,
    industries:[...industries].sort(([nameA,a],[nameB,b])=>Number(nameA==='未分类')-Number(nameB==='未分类')||b.length-a.length||nameA.localeCompare(nameB,'zh-CN')),
    first:ladder.get(1)?.length??0,
    consecutive:rows.filter(row=>row.consecutive>=2).length,
    highest:rows[0]?.consecutive??null};
}

export function mountDailyLimits(root,linkStocks){
  let controller=null, report=null;
  const $=selector=>root.querySelector(selector);
  const earlier=recentPoolDates();
  root.classList.add('dl-review');
  root.innerHTML=`<form id="dlDateForm" class="dl-controls">
    <label>交易日期 <input id="dlDate" type="date" max="${dateFormat.format(new Date())}" value="${earlier[0]}" required></label>
    <button class="btn primary" type="submit">查询涨停</button>
    <button class="btn" id="dlRecent" type="button">最近有数据的交易日</button>
  </form>
  <p class="dl-status" id="dlStatus" role="status"></p>
  <div id="dlReport"></div>`;
  const dateInput=$('#dlDate'), status=$('#dlStatus'), reportNode=$('#dlReport');

  async function request(path,signal){
    const response=await window.WolfAPI.fetch(path,{cache:'no-store',
      signal:AbortSignal.any([signal,AbortSignal.timeout(24000)])});
    if(response.status===404)return {};
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'行情读取失败。');
    return data;
  }

  function stockLink(row){
    return `<a class="stock-link" href="?tab=market" data-stock="${esc(row.symbol)}" data-name="${esc(row.name||row.symbol)}">${esc(row.name||row.symbol)}</a>`;
  }

  function renderDetails(){
    const query=$('#dlSearch').value.trim().toLowerCase();
    const industry=$('#dlIndustry').value,board=$('#dlBoard').value,level=$('#dlLevel').value;
    const rows=report.rows.filter(row=>(!query||[row.name,row.symbol].some(value=>String(value??'').toLowerCase().includes(query)))
      &&(!industry||row.industry===industry)&&(!board||row.board===board)&&(!level||String(row.consecutive)===level));
    $('#dlCount').textContent=`${rows.length} / ${report.rows.length} 只`;
    $('#dlStocks').innerHTML=rows.length?`<div class="table-scroll"><table>
      <thead><tr><th>股票</th><th>交易板块</th><th>行业</th><th>连板</th><th>首封时间</th><th>最后封板</th><th>开板次数</th><th>封板资金</th><th>成交额</th><th>换手率</th></tr></thead>
      <tbody>${rows.map(row=>`<tr><td>${stockLink(row)}<small>${row.symbol.slice(2)}</small></td><td>${boardNames[row.board]}</td>
      <td>${esc(row.industry)}</td><td>${row.consecutive??'—'}</td><td>${displayTime(row.firstTime)}</td><td>${displayTime(row.lastTime)}</td>
      <td>${quantity(row.breaks)}</td><td>${money(row.funds)}</td><td>${money(row.amount)}</td><td>${percent(row.turnover)}</td></tr>`).join('')}</tbody>
    </table></div>`:'<p class="dl-empty">没有符合当前筛选条件的股票。</p>';
    linkStocks();
  }

  function render(data,date,signal){
    report=summarizeDailyLimits(data.rows);
    if(!report.rows.length){
      reportNode.innerHTML='<p class="dl-empty">这个日期没有返回可用的涨停记录。</p>';
      return;
    }
    const heightLabel=level=>level===1?'首板':level===null?'板数缺失':level+' 连板';
    const known=report.industries.filter(([name])=>name!=='未分类');
    const leaders=known.slice(0,3).map(([name,rows])=>`${esc(name)} ${rows.length} 只`).join('、');
    const chips=(rows,limit)=>rows.slice(0,limit).map(stockLink).join('');
    reportNode.innerHTML=`<section class="dl-hero">
      <div class="dl-overview-heading"><div><p>${esc(date)}</p><h2>涨停概览</h2></div><p>${esc(data.source||'涨停池')}${data.stale?' · 缓存数据':''}</p></div>
      <div class="dl-metrics">${[['封板家数',report.rows.length],['首板',report.first],['连板',report.consecutive],['最高连板',report.highest??'—']].map(([label,n])=>`<div><span>${label}</span><strong>${n}</strong></div>`).join('')}</div>
      ${leaders?`<p class="dl-snapshot">涨停家数靠前的行业：${leaders}。</p>`:''}
      <p class="dl-snapshot" id="dlThemeLeaders" hidden></p>
      <div class="dl-board-mix">${[...report.boards].map(([board,count])=>`<span>${boardNames[board]} <b>${count}</b></span>`).join('')}</div>
    </section>
    <section class="dl-card"><h2>近 30 个交易日连板高度</h2><div id="dlHeight" role="status">正在获取交易日和涨停池…</div></section>
    <section class="dl-card">
      <div class="dl-overview-heading"><h2>宽基 ETF 成交额与上证分时</h2><button class="btn" id="dlEtfLoad" type="button">加载分时</button></div>
      <p class="dl-footnote">篮子包括 ${broadEtfs.map(([,name])=>name).join('、')}。</p>
      <div id="dlEtf" role="status"></div>
    </section>
    <section class="dl-card">
      <div class="dl-overview-heading"><h2>监管异动 · 距线测算</h2><button class="btn" id="dlDeviationLoad" type="button">测算候选</button></div>
      <p class="dl-footnote">扫描当日连板股、已保存自选及上日高板。按前复权日线和对应分类指数估算向上偏离，距线以区间和指数不变为条件。交易所公告重置、无涨跌幅限制交易日及其他认定条件未计入。</p>
      <div id="dlDeviation" role="status"></div>
    </section>
    <section class="dl-card"><h2>指数简述</h2><div id="dlIndexBrief" role="status">正在读取四大指数日线…</div></section>
    <section class="dl-card"><h2>题材解析与次日观察</h2><div id="dlThemes"><p class="dl-footnote">正在核对上日涨停池和题材标签…</p></div></section>
    <section class="dl-card" id="dlWatchPanel">
      <h2>昨日自选回顾</h2><div id="dlWatchResults" role="status">正在确认上一交易日…</div>
      <details><summary>编辑所选日期的复盘自选</summary>
        <form id="dlReviewWatch" class="dl-theme-edit">
          <label>复盘自选代码 <textarea id="dlReviewSymbols" rows="2" maxlength="300" placeholder="例如 002771 603019，最多 24 只"></textarea></label>
          <div class="dl-controls"><button class="btn" id="dlImportWatch" type="button">载入行情中心自选</button><button class="btn primary" type="submit">保存本日名单</button></div>
          <span class="dl-footnote" id="dlWatchStatus" role="status"></span>
        </form>
      </details>
    </section>
    <div class="dl-columns">
      <section class="dl-card"><h2>连板梯队</h2>
      <ul class="dl-ladder">${[...report.ladder].map(([level,rows])=>`<li>
        <button class="dl-group" type="button" data-dl-level="${level}">${heightLabel(level)} <b>${rows.length} 只</b></button>
        <div class="dl-chips">${chips(rows,level===1?8:12)}${rows.length>(level===1?8:12)?`<button class="dl-more" type="button" data-dl-level="${level}">查看全部</button>`:''}</div>
      </li>`).join('')}</ul></section>
      <section class="dl-card"><h2>行业涨停分布</h2>
      <ul class="dl-industries">${report.industries.map(([name,rows])=>`<li><button class="dl-group" data-dl-industry="${esc(name)}" type="button">
        <span>${esc(name)}</span><strong>${rows.length} 只</strong></button>
        <meter min="0" max="${report.rows.length}" value="${rows.length}" aria-label="${esc(name)}涨停家数"></meter>
        <div class="dl-chips">${chips(rows,4)}</div></li>`).join('')}</ul></section>
    </div>
    <section class="dl-card" id="dlDetails">
      <div class="dl-overview-heading"><h2>涨停股明细</h2><span id="dlCount"></span></div>
      <div class="dl-controls dl-filters">
        <label>搜索股票 <input type="search" id="dlSearch" placeholder="名称或代码"></label>
        <label>行业 <select id="dlIndustry"><option value="">全部</option>${report.industries.map(([name])=>`<option>${esc(name)}</option>`).join('')}</select></label>
        <label>交易板块 <select id="dlBoard"><option value="">全部</option>${[...report.boards.keys()].map(board=>`<option value="${board}">${boardNames[board]}</option>`).join('')}</select></label>
        <label>连板 <select id="dlLevel"><option value="">全部</option>${[...report.ladder.keys()].map(level=>`<option value="${level}">${heightLabel(level)}</option>`).join('')}</select></label>
        <button class="btn" type="button" id="dlClear">清除筛选</button>
      </div>
      <div id="dlStocks"></div>
      <p class="dl-footnote">按涨停池返回的行业分类汇总。开板次数为该股当日记录，盘中数据随行情变化。</p>
    </section>`;
    for(const id of ['dlSearch','dlIndustry','dlBoard','dlLevel'])$('#'+id).oninput=renderDetails;
    function setFilter(field,value){
      for(const id of ['dlSearch','dlIndustry','dlBoard','dlLevel'])$('#'+id).value='';
      if(field)$(field).value=value;
      renderDetails();
      if(field)$(field).focus();
    }
    $('#dlClear').onclick=()=>setFilter();
    for(const item of root.querySelectorAll('[data-dl-level]'))item.onclick=()=>setFilter('#dlLevel',item.dataset.dlLevel);
    for(const item of root.querySelectorAll('[data-dl-industry]'))item.onclick=()=>setFilter('#dlIndustry',item.dataset.dlIndustry);
    renderDetails();
    mountReviewPanels({root,date,report,signal,request:path=>request(path,signal),
      esc,quantity,stockLink,linkStocks});
  }

  async function load(dates){
    controller?.abort();
    const request=new AbortController();
    controller=request;
    status.classList.remove('error');
    reportNode.innerHTML='';
    try{
      for(const date of dates){
        status.textContent=`正在读取 ${date} 的涨停池…`;
        const data=await loadLatestPool(date,request.signal);
        if(request.signal.aborted)return;
        if(!data.rows?.length)continue;
        dateInput.value=date;
        status.textContent=date===dates[0]?'':`已切换至最近有数据的日期 ${date}。`;
        render(data,date,request.signal);
        return;
      }
      status.textContent=dates.length===1?`${dates[0]} 暂无涨停池记录，请核对交易日期。`:'最近查询的日期暂时没有涨停池记录。';
    }catch(error){
      if(request.signal.aborted)return;
      status.classList.add('error');
      status.textContent=error.name==='TimeoutError'?'涨停池请求超时，请重试。':`读取失败：${error.message}`;
    }
  }
  async function loadLatestPool(date,signal){
    const data=await request('/api/limits?date='+date.replaceAll('-',''),signal);
    if(Object.keys(data).length&&!Array.isArray(data.rows))throw new Error('涨停池读取失败。');
    return data;
  }
  $('#dlDateForm').onsubmit=event=>{event.preventDefault();load([dateInput.value]);};
  $('#dlRecent').onclick=()=>load(recentPoolDates());
  load(earlier);
  return ()=>controller?.abort();
}
