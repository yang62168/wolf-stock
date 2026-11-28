import {VolumePace,vMinute} from './volume-engine.mjs';
const vEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const vFmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const vMoney=n=>!Number.isFinite(n)?'—':Math.abs(n)>=1e12?vFmt(n/1e12)+' 万亿':Math.abs(n)>=1e8?vFmt(n/1e8)+' 亿':vFmt(n/1e4)+' 万';
const vSign=n=>Number.isFinite(n)?(n>0?'+':'')+vMoney(n):'—';
const vLots=n=>!Number.isFinite(n)?'—':Math.abs(n)>=1e8?vFmt(n/1e8)+' 亿手':Math.abs(n)>=1e4?vFmt(n/1e4)+' 万手':vFmt(n,0)+' 手';
const vTone=n=>n>0?'up':n<0?'down':'';
const vPercent=n=>Number.isFinite(n)?(n>0?'+':'')+vFmt(n)+'%':'—';
const vRatio=n=>Number.isFinite(n)?vFmt(n)+' 倍':'—';
const vTime=h=>h?h.slice(0,2)+':'+h.slice(2):'—';
const vPhases={preopen:'未开盘',trading:'交易中',lunch:'午休',closed:'已收盘',historical:'历史交易日'};
const firstMinute=570,lastMinute=900;
const chartWidth=960,plotLeft=72,plotRight=937;
const minuteX=minute=>plotLeft+(minute<780?minute-firstMinute:minute-659)/(lastMinute-659)*(plotRight-plotLeft);
const axisMinutes=[570,630,690,840,900];
const timeLabel=minute=>Math.floor(minute/60).toString().padStart(2,'0')+':'+String(minute%60).padStart(2,'0');

export function volumeChartData(record) {
  const series=(rows=[])=>{
    const amounts=new Map();
    for(const {hhmm,amount} of rows){
      if(!/^\d{4}$/.test(hhmm)||Number(hhmm.slice(2))>=60||!Number.isFinite(amount)||amount<0)continue;
      const minute=vMinute(hhmm);
      if((minute>=firstMinute&&minute<=690)||(minute>=780&&minute<=lastMinute))amounts.set(minute,amount);
    }
    return new Map([...amounts].sort(([first],[second])=>first-second));
  };
  const increments=amounts=>new Map([...amounts].flatMap(([minute,amount])=>{
    const prior=amounts.get(minute-1);
    return Number.isFinite(prior)&&amount>=prior?[[minute,amount-prior]]:[];
  }));
  const current=series(record.currentCurve),prior=series(record.previousCurve);
  const currentIncrement=increments(current),priorIncrement=increments(prior);
  const latest=series([{hhmm:record.hhmm,amount:record.amount}]);
  for(const [minute,amount] of latest){
    if(record.phase==='trading')currentIncrement.delete(minute);
    current.set(minute,amount);
  }
  return {current:new Map([...current].sort(([a],[b])=>a-b)),prior,currentIncrement,priorIncrement};
}

function volumeChart(series,{bars=false,unit}){
  const [current,prior]=series;
  const height=bars?168:233,top=14,bottom=height-30;
  const maximum=Math.max(unit.scale/100,...current.values(),...prior.values())*1.06;
  const y=amount=>bottom-amount/maximum*(bottom-top);
  const grid=[0,0.25,0.5,0.75,1].map(fraction=>{
    const level=y(fraction*maximum);
    return `<line class="vm-gridline" x1="${plotLeft}" x2="${plotRight}" y1="${level}" y2="${level}"/><text x="${plotLeft-10}" y="${level+4}" text-anchor="end">${vFmt(fraction*maximum/unit.scale,1)}</text>`;
  }).join('');
  const ticks=axisMinutes.map(minute=>`<text x="${minuteX(minute)}" y="${height-7}" text-anchor="middle">${timeLabel(minute)}</text>`).join('');
  const paint=(amounts,style)=>{
    if(bars)return [...amounts].map(([minute,amount])=>`<rect class="vm-bar ${style}" x="${minuteX(minute)+(style==='current'?0:-1.65)}" y="${y(amount)}" width="1.55" height="${bottom-y(amount)}"/>`).join('');
    let previous=-Infinity;
    const points=[...amounts].map(([minute,amount])=>{
      const position=(minute===previous+1?'L':'M')+minuteX(minute)+' '+y(amount);
      previous=minute;
      return position;
    }).join('');
    const endpoints=[...amounts].filter(([minute])=>!amounts.has(minute-1)&&!amounts.has(minute+1))
      .map(([minute,amount])=>`<circle class="vm-bar ${style}" cx="${minuteX(minute)}" cy="${y(amount)}" r="3"/>`).join('');
    return `<path class="vm-line ${style}" d="${points}"/>${endpoints}`;
  };
  return `<svg class="vm-plot" data-vm-plot viewBox="0 0 ${chartWidth} ${height}" role="img" aria-label="${bars?'每分钟成交额':'累计成交额'}，单位${unit.name}">
    ${grid}${ticks}${paint(prior,'prior')}${paint(current,'current')}
    <line class="vm-crosshair" data-vm-cursor x1="0" x2="0" y1="${top}" y2="${bottom}"/>
  </svg>`;
}

let vCleanup=null;
export function unmountVolume(){vCleanup?.();vCleanup=null;}
export function mountVolume(root){
  unmountVolume();let alive=true,timer=null,request=null,busy=false,last=null,previous=null,failures=0,stocks=[],scope='hs',interval=10,paused=false,revision=0;
  let pace=new VolumePace(),selected='market',cursor=null;
  const $=selector=>root.querySelector(selector);
  try{const saved=JSON.parse(localStorage.getItem('wolf-volume-v1')||'{}');stocks=(saved.stocks||[]).filter(s=>/^(sh|sz|bj)\d{6}$/.test(s)).slice(0,8);scope=saved.scope==='hsb'?'hsb':'hs';}catch{}
  const persist=()=>{try{localStorage.setItem('wolf-volume-v1',JSON.stringify({stocks,scope}));}catch{}};
  root.className='volume-monitor';
  root.innerHTML=`<section class="panel vm-heading" aria-label="监控设置"><div class="vm-controls"><label>统计口径<select id="vmScope"><option value="hs">沪深 · 指数聚合参考</option><option value="hsb">沪深 + 北证50参考</option></select></label><label>刷新间隔<select id="vmInterval"><option value="10">10 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select></label><button type="button" class="btn" id="vmPause">暂停</button><button type="button" class="btn primary" id="vmRefresh">立即刷新</button></div></section>
  <div class="notice" id="vmStatus" role="status">正在读取公开行情…</div>
  <div id="vmOverview"></div>
  <section class="panel vm-chart">
    <div class="vm-section-head"><h2>分时量能</h2><label class="vm-chart-control">查看标的 <select id="vmChartSymbol"></select></label></div>
    <div id="vmCharts"></div>
  </section>
  <div id="vmVolume"></div><div id="vmMarkets"></div>
  <section class="panel vm-watch"><div class="vm-section-head"><h2>个股量能</h2><button class="btn" id="vmImport" type="button">从自选列表载入</button></div><form id="vmForm" class="tool-form"><label class="wide">监视证券（最多8只）<input id="vmQuery" placeholder="名称、拼音或代码，如 002241" maxlength="32" required></label><button class="btn primary" id="vmAdd">添加监视</button></form><div id="vmStocks"></div></section>
  <section class="panel"><div class="vm-section-head"><h2>分钟节奏</h2><span id="vmPaceLabel">等待连续采样</span></div><p class="vm-hint">每跨过一个数据分钟记录累计成交额增量，再与上次分钟增量比较。仅在本页可见、交易中且数据新鲜时采样；跨午休、断线、换日会重置。采样增量可能受刷新秒位影响。</p><div id="vmPace"></div></section>
  <section class="panel vm-method"><div class="vm-section-head"><h2>数据说明</h2><button class="btn" id="vmExport" type="button">导出当前快照</button></div><details><summary>展开计算口径</summary><ul><li>金额统一为元，界面换算为万、亿、万亿。成交量单位为手。</li><li>放缩量比 = 当前累计成交额 ÷ 上一交易日同一时刻累计额。≥1.03 为放量，≤0.97 为缩量，中间为平量。</li><li>预计全天按当前累计额与上一交易日分时分布推算。开盘不足8分钟或基准缺失时留空，收盘后显示实际值。</li><li>沪深采用上证指数与深证综指成交额聚合参考。北证50成交额为指数参考，分时金额缺失时的估算会标注。</li><li>缺失市场、日期不一致或源时间相差超过2分钟时不计算合计。刷新失败时保留最后成功快照并显示提示。</li></ul><div class="vm-links"><a href="https://github.com/SeptemberL/MarketVolume" target="_blank" rel="noopener">量能计算参考</a><a href="https://github.com/LostMoonkin/ashare-volpulse" target="_blank" rel="noopener">界面参考</a></div></details></section>`;
  $('#vmScope').value=scope;
  const status=(text,error=false)=>{if(!alive)return;$('#vmStatus').textContent=text;$('#vmStatus').className='notice'+(error?' message-error':'');};
  function table(headers,rows){return rows.length?`<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="vm-hint">暂无数据</p>';}
  function renderStocks(){
    const rows=stocks.map(symbol=>{
      const s=last?.stocks?.find(r=>r.symbol===symbol),old=previous?.stocks?.find(r=>r.symbol===symbol);
      const delta=Number.isFinite(s?.amount)&&Number.isFinite(old?.amount)&&s.source===old.source&&s.date===old.date&&s.sourceTime>old.sourceTime&&s.amount>=old.amount&&!s.delayed?s.amount-old.amount:null;
      return [`<button class="vm-stock-link" type="button" data-vm-focus="${symbol}">${vEsc(s?.name||symbol)}</button><small>${vEsc(symbol)}</small>`,vFmt(s?.price),`<span class="${vTone(s?.changePercent)}">${vPercent(s?.changePercent)}</span>`,vMoney(s?.amount),vMoney(s?.previousTotal),vMoney(s?.previousAmount),`<span class="${vTone((s?.ratio??1)-1)}">${vRatio(s?.ratio)}</span>`,vSign(delta),vMoney(s?.forecast),s?.error?vEsc(s.error):vEsc(s?.sourceTime||'等待刷新'),`<button class="btn" type="button" data-vm-remove="${symbol}" aria-label="移除 ${vEsc(s?.name||symbol)}">移除</button>`];
    });
    $('#vmStocks').innerHTML=rows.length?table(['证券','现价','涨跌幅','当前累计额','昨日全天额','昨日同时刻','放缩量比','较上次刷新','预计全天额','报价时间 / 状态','操作'],rows):'<p class="vm-hint">添加证券后，可同时比较当前成交额、昨日同时刻和预计全天额。</p>';
    root.querySelectorAll('[data-vm-remove]').forEach(b=>b.onclick=()=>{stocks=stocks.filter(s=>s!==b.dataset.vmRemove);persist();renderStocks();invalidate();});
    root.querySelectorAll('[data-vm-focus]').forEach(b=>b.onclick=()=>{
      selected=b.dataset.vmFocus;cursor=null;renderCharts(last);
      $('#vmChartSymbol').focus();
    });
  }
  function renderCharts(data){
    const choose=$('#vmChartSymbol'),chart=$('#vmCharts');
    const selectedMarkets=data?.markets||[],watched=data?.stocks||[];
    const targets=[['market',scope==='hs'?'沪深两市':'沪深与北证50',data?.market]];
    for(const market of selectedMarkets)targets.push([market.symbol,market.name,market]);
    for(const symbol of stocks){
      const record=watched.find(stock=>stock.symbol===symbol);
      if(!targets.some(([key])=>key===symbol))targets.push([symbol,record?.name||symbol,record]);
    }
    const options=targets.map(([value,name])=>'<option value="'+vEsc(value)+'">'+vEsc(name)+'</option>').join('');
    if(choose.dataset.options!==options){
      choose.innerHTML=options;
      choose.dataset.options=options;
    }
    const [active,name,record]=targets.find(([value])=>value===selected)||targets[0];
    selected=active;
    choose.value=active;
    if(!record||record.error){
      chart.innerHTML='<p class="vm-hint">'+vEsc(record?.error||'等待量能数据')+'</p>';
      return;
    }
    const {current,prior,currentIncrement,priorIncrement}=volumeChartData(record);
    const times=[...new Set([...current.keys(),...prior.keys()])].sort((a,b)=>a-b);
    if(!times.length){
      chart.innerHTML='<p class="vm-hint">暂无可用分时成交额</p>';
      return;
    }
    const amountMax=Math.max(...current.values(),...prior.values());
    const unit=amountMax>=1e8?{name:'亿元',scale:1e8}:amountMax>=1e4?{name:'万元',scale:1e4}:{name:'元',scale:1};
    const incrementReady=currentIncrement.size||priorIncrement.size;
    chart.innerHTML=`
      <div class="vm-chart-meta"><strong>${vEsc(name)}</strong><div class="vm-legend"><span>${vEsc(record.date||'当前交易日')}</span><span>${vEsc(record.previousDate||'上一交易日基准缺失')}${record.estimated?' · 含估算':''}</span></div></div>
      <div class="vm-plot-scroll">
        <div class="vm-plot-grid"><div class="vm-plot-heading">累计成交额 <small>${unit.name}</small></div>
        ${volumeChart([current,prior],{unit})}
        <div class="vm-plot-heading">每分钟成交额 <small>${unit.name}</small></div>
        ${incrementReady?volumeChart([currentIncrement,priorIncrement],{bars:true,unit}):'<p class="vm-hint">连续分钟数据不足，暂无增量对照。</p>'}</div>
      </div>
      <label class="vm-time-control">定位时间 <input id="vmChartTime" type="range" min="0" max="${times.length-1}" step="1" ${times.length===1?'disabled':''}></label>
      <div class="vm-chart-readout" id="vmChartReadout"></div>`;
    const slider=$('#vmChartTime'),readout=$('#vmChartReadout');
    const latest=[...current.keys()].at(-1)??times.at(-1);
    const lines=chart.querySelectorAll('[data-vm-cursor]');
    function move(minute){
      slider.value=times.indexOf(minute);
      slider.setAttribute('aria-valuetext',timeLabel(minute));
      const x=minuteX(minute);
      for(const line of lines){
        line.setAttribute('x1',x);
        line.setAttribute('x2',x);
      }
      readout.innerHTML=`<strong>${timeLabel(minute)}</strong>
        <span>当前累计 <b>${vMoney(current.get(minute))}</b></span>
        <span>上日累计 <b>${vMoney(prior.get(minute))}</b></span>
        <span>当前分钟 <b>${vMoney(currentIncrement.get(minute))}</b></span>
        <span>上日分钟 <b>${vMoney(priorIncrement.get(minute))}</b></span>`;
    }
    slider.oninput=()=>{cursor=times[Number(slider.value)];move(cursor);};
    for(const plot of chart.querySelectorAll('[data-vm-plot]')){
      // The two plots use the same x scale and show the same selected minute.
      plot.onpointermove=event=>{
        if(event.pointerType==='touch')return;
        const rect=plot.getBoundingClientRect();
        if(!rect.width)return;
        const x=(event.clientX-rect.left)*chartWidth/rect.width;
        const nearest=times.reduce((best,minute)=>Math.abs(minuteX(minute)-x)<Math.abs(minuteX(best)-x)?minute:best,times[0]);
        if(times[Number(slider.value)]!==nearest)move(nearest);
      };
      plot.onpointerleave=()=>move(times.includes(cursor)?cursor:latest);
    }
    move(times.includes(cursor)?cursor:latest);
  }

  function render(data){
    const m=data.market;
    const delta=Number.isFinite(m.ratio)?(m.ratio-1)*100:null;
    const tone=m.state==='放量'?'up':m.state==='缩量'?'down':'';
    const indexRows=data.indices.map(q=>`<div class="vm-index-row">
      <span>${vEsc(q.name)}</span><strong>${vFmt(q.price)}</strong><b class="${vTone(q.changePercent)}">${vPercent(q.changePercent)}</b>
    </div>`).join('');
    $('#vmOverview').innerHTML=`<div class="vm-overview-grid">
      <section class="panel vm-summary">
        <div class="vm-section-head"><h2>${scope==='hs'?'沪深两市成交额':'沪深与北证50成交额参考'}</h2><span class="vm-state ${tone}">${vEsc(m.state)}${m.estimated?' · 含估算':''}</span></div>
        <div class="vm-hero"><div><span>当前累计</span><strong>${vMoney(m.amount)}</strong></div>
        <div class="vm-hero-change"><span>较上一交易日同期</span><strong class="${tone}">${vPercent(delta)}</strong><small class="${tone}">${vSign(m.difference)}</small></div></div>
        <div class="vm-summary-stats">${[
          ['同期放缩量比',vRatio(m.ratio)],['预计全天成交额',vMoney(m.forecast)],['上一交易日全天',vMoney(m.previousTotal)]
        ].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
        <div class="vm-summary-meta"><span>${vEsc(m.date||'—')} ${vEsc(vTime(m.hhmm))}</span><span>${vPhases[m.phase]||'待行情'}${m.delayed?' · 数据延迟':''}</span><span>上日同期 ${vMoney(m.previousAmount)}</span></div>
        ${!m.complete?'<p class="vm-hint">市场数据不齐或时间不一致，合计暂缺。</p>':''}
      </section>
      <section class="panel vm-index-panel">
        <div class="vm-section-head"><h2>主要指数</h2></div>
        ${indexRows||'<p class="vm-hint">暂无指数报价</p>'}
        <div class="vm-limits"><span>涨停 <b class="up">${vFmt(data.limits?.up,0)}</b></span><span>跌停 <b class="down">${vFmt(data.limits?.down,0)}</b></span><small>${vEsc(data.limits?.date||'')}</small>${data.limits?.down>10?'<span>跌停家数超过10家</span>':''}</div>
      </section>
    </div>`;
    renderCharts(data);
    $('#vmMarkets').innerHTML=`<section class="panel"><h2>分市场明细</h2>${table(
      ['市场','当前累计额','昨日同时刻','差额','放缩量比','预计全天','口径 / 状态'],
      data.markets.map(r=>[vEsc(r.name),vMoney(r.amount),vMoney(r.previousAmount),vSign(r.difference),vRatio(r.ratio),vMoney(r.forecast),r.error?vEsc(r.error):`${r.estimated?'昨日分时金额按成交量占比估算':vEsc(r.source||'公开行情')}<small>${vEsc(r.sourceTime||'')} ${r.delayed?'数据延迟':''}</small>`])
    )}</section>`;
    renderMinuteVolume(data.minuteVolume);
    renderStocks();$('#vmPaceLabel').textContent=pace.state||'等待连续分钟采样';
    $('#vmPace').innerHTML=`<p class="vm-hint">本次分钟采样增量 ${vMoney(pace.increment)} · 上次 ${vMoney(pace.lastIncrement)}</p>`+table(['日期','分钟','节奏变化','采样增量'],pace.history.map(h=>[vEsc(h.date),vTime(h.time),h.from+' → '+h.to,vMoney(h.increment)]));
  }

  function renderMinuteVolume(v){
    if(!v){$('#vmVolume').innerHTML='<section class="panel"><h2>沪深1分钟成交量对比</h2><p class="vm-hint">暂无1分钟成交量数据。</p></section>';return;}
    const tone=vTone((v.ratio??1)-1);
    $('#vmVolume').innerHTML=`<section class="panel vm-volume"><div class="vm-section-head"><h2>沪深1分钟成交量对比</h2><span class="vm-state ${tone}">${vEsc(v.state)}${v.delayed?' · 数据延迟':''}</span></div><div class="vm-metrics">${[['当前累计量',vLots(v.current)],['昨日同一分钟累计量',vLots(v.previous)],['成交量放缩量比',vFmt(v.ratio)+' 倍'],['较昨日同时刻增减',Number.isFinite(v.difference)?(v.difference>0?'+':'')+vLots(v.difference):'—'],['昨日全天成交量',vLots(v.previousTotal)],['预计全天成交量',vLots(v.forecast)]].map(([label,value],i)=>`<div><span>${label}</span><strong class="${i===2||i===3?tone:''}">${value}</strong></div>`).join('')}</div><p class="vm-hint">数据日 ${vEsc(v.date||'—')} · ${vEsc(v.hhmm?v.hhmm.slice(0,2)+':'+v.hhmm.slice(2):'—')} · ${vPhases[v.phase]||'待报价'} · 基准日 ${vEsc(v.previousDate||'—')}。${vEsc(v.source)}；仅沪深，不含北证、创业板或科创50的重复计入。</p>${v.markets?.length?table(['市场','当前累计量','昨日同一分钟','昨日全天量','分钟完整性'],v.markets.map(m=>[vEsc(m.name),vLots(m.current),vLots(m.previous),vLots(m.previousTotal),m.complete?'240个交易分钟齐全':'缺'+m.missingMinutes+'分钟'])):''}<p class="vm-hint">${v.warnings?.length?v.warnings.map(vEsc).join('；'):'当前量取实时报价p[6]；昨日量为m1每分钟成交量逐条累加，按时间戳对齐。预测按昨日成交量分布外推，开盘不足8分钟不预测，收盘后即实际累计量。'}</p></section>`;
  }
  function schedule(){clearTimeout(timer);if(alive&&!paused&&!document.hidden)timer=setTimeout(refresh,(failures>=2?Math.max(30,interval):interval)*1000);}
  async function refresh(){
    if(!alive||busy||document.hidden)return;if(paused)return;
    busy=true;const own=revision;request=new AbortController();$('#vmRefresh').disabled=true;const query=new URLSearchParams({scope,stocks:stocks.join(',')});
    try{
      const response=await window.WolfAPI.fetch('/api/volume-monitor?'+query,{cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(22000)])}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'量能读取失败');if(!alive||own!==revision)return;
      previous=last;last=data;failures=0;pace.update(data.market);render(data);
      status(`${data.source} · 抓取 ${new Date(data.fetchedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai'})}（北京时间）${data.market.phase==='historical'?' · 显示最近可用交易日，非今日实时数据':''}${data.market.delayed?' · 报价时间滞后，暂停节奏采样':''}${data.warnings.length?' · '+data.warnings.join('；'):''}`);
    }catch(e){if(alive&&own===revision&&e.name!=='AbortError'){failures++;pace.reset();$('#vmPaceLabel').textContent='采样已中断';status(`更新失败：${e.message}。${last?'画面保留上次成功数据（'+new Date(last.fetchedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai'})+'），请核对报价日期与时间。':'暂无成功快照。'}${failures>=2?' 已降频重试。':''}`,true);}}
    finally{busy=false;if(alive){$('#vmRefresh').disabled=false;if(own!==revision&&!paused&&!document.hidden){clearTimeout(timer);timer=setTimeout(refresh,0);}else schedule();}}
  }
  function invalidate(){revision++;request?.abort();last=null;previous=null;cursor=null;pace=new VolumePace();$('#vmOverview').innerHTML='';renderCharts(null);$('#vmVolume').innerHTML='';$('#vmMarkets').innerHTML='';$('#vmPaceLabel').textContent='等待连续采样';$('#vmPace').innerHTML='';status(paused?'设置已保存，恢复监控后读取。':'设置已变更，正在重新读取…');clearTimeout(timer);if(!busy)refresh();}
  $('#vmChartSymbol').onchange=()=>{selected=$('#vmChartSymbol').value;cursor=null;renderCharts(last);};
  $('#vmScope').onchange=()=>{scope=$('#vmScope').value;persist();invalidate();};
  $('#vmInterval').onchange=()=>{interval=Number($('#vmInterval').value);schedule();};
  $('#vmPause').onclick=()=>{paused=!paused;$('#vmPause').textContent=paused?'恢复监控':'暂停';if(paused){clearTimeout(timer);request?.abort();pace.reset();status('已暂停监控，画面保留上次成功数据。');}else refresh();};
  $('#vmRefresh').onclick=()=>{if(paused){paused=false;$('#vmPause').textContent='暂停';}clearTimeout(timer);refresh();};
  $('#vmImport').onclick=()=>{try{const watch=JSON.parse(localStorage.getItem('wolf-market-v1')||'{}').watch||[];stocks=[...new Set(watch.map(w=>w.symbol).filter(s=>/^(sh|sz|bj)\d{6}$/.test(s)))].slice(0,8);if(!stocks.length){status('自选列表为空，请先添加证券。');return;}persist();renderStocks();invalidate();}catch{status('自选列表无法读取。',true);}};
  $('#vmForm').onsubmit=async e=>{
    e.preventDefault();const button=$('#vmAdd');if(stocks.length>=8){status('最多监视8只证券。',true);return;}button.disabled=true;
    try{
      const raw=$('#vmQuery').value.trim();let symbol=raw.toLowerCase();
      if(/^\d{6}$/.test(symbol))symbol=(/^(92|8|4)/.test(symbol)?'bj':/^[569]/.test(symbol)?'sh':'sz')+symbol;
      if(!/^(sh|sz|bj)\d{6}$/.test(symbol)){const response=await window.WolfAPI.fetch('/api/search?q='+encodeURIComponent(raw),{signal:AbortSignal.timeout(12000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'搜索失败');symbol=data.results?.[0]?.symbol;}
      if(!alive)return;if(!symbol)throw new Error('未找到该证券，请输入完整代码');if(stocks.includes(symbol))throw new Error('已在监视列表');stocks.push(symbol);persist();$('#vmQuery').value='';renderStocks();invalidate();
    }catch(e){status(e.message,true);}finally{if(alive)button.disabled=false;}
  };
  $('#vmExport').onclick=()=>{if(!last){status('暂无可导出的成功快照。');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(last,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='量能监控-'+(last.market.date||'snapshot')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const visibility=()=>{clearTimeout(timer);if(document.hidden){request?.abort();pace.reset();}else refresh();};document.addEventListener('visibilitychange',visibility);
  vCleanup=()=>{alive=false;clearTimeout(timer);request?.abort();document.removeEventListener('visibilitychange',visibility);};render({market:{state:'待数据',ratio:null,complete:false},markets:[],stocks:[],indices:[]});refresh();
}
