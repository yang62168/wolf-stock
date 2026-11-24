import {VolumePace} from './volume-engine.mjs';
const vEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const vFmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const vMoney=n=>!Number.isFinite(n)?'—':Math.abs(n)>=1e12?vFmt(n/1e12)+' 万亿':Math.abs(n)>=1e8?vFmt(n/1e8)+' 亿':vFmt(n/1e4)+' 万';
const vSign=n=>Number.isFinite(n)?(n>0?'+':'')+vMoney(n):'—';
const vTone=n=>n>0?'up':n<0?'down':'';
const vPhases={preopen:'未开盘',trading:'交易中',lunch:'午休',closed:'已收盘',historical:'历史交易日'};
let vCleanup=null;
export function unmountVolume(){vCleanup?.();vCleanup=null;}
export function mountVolume(root){
  unmountVolume();let alive=true,timer=null,request=null,busy=false,last=null,previous=null,failures=0,stocks=[],scope='hs',interval=10,paused=false,revision=0;
  let pace=new VolumePace();const $=selector=>root.querySelector(selector);
  try{const saved=JSON.parse(localStorage.getItem('wolf-volume-v1')||'{}');stocks=(saved.stocks||[]).filter(s=>/^(sh|sz|bj)\d{6}$/.test(s)).slice(0,8);scope=saved.scope==='hsb'?'hsb':'hs';}catch{}
  const persist=()=>{try{localStorage.setItem('wolf-volume-v1',JSON.stringify({stocks,scope}));}catch{}};
  root.className='volume-monitor';
  root.innerHTML=`<section class="panel vm-heading"><div><span class="vm-eyebrow">MARKET VOLUME</span><h2>量能监控</h2><p>看成交额的变化，也看资金进入的节奏。</p></div><div class="vm-controls"><label>统计口径<select id="vmScope"><option value="hs">沪深 · 指数聚合参考</option><option value="hsb">沪深 + 北证50参考</option></select></label><label>刷新间隔<select id="vmInterval"><option value="10">10 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select></label><button type="button" class="btn" id="vmPause">暂停</button><button type="button" class="btn primary" id="vmRefresh">立即刷新</button></div></section>
  <div class="notice" id="vmStatus" role="status">正在读取公开行情…</div>
  <div id="vmOverview"></div><div id="vmCharts"></div><div id="vmMarkets"></div>
  <section class="panel vm-watch"><div class="vm-section-head"><h2>个股量能</h2><button class="btn" id="vmImport" type="button">从自选列表载入</button></div><form id="vmForm" class="tool-form"><label class="wide">监视证券（最多8只）<input id="vmQuery" placeholder="名称、拼音或代码，如 002241" maxlength="32" required></label><button class="btn primary" id="vmAdd">添加监视</button></form><div id="vmStocks"></div></section>
  <section class="panel"><div class="vm-section-head"><h2>分钟节奏</h2><span id="vmPaceLabel">等待连续采样</span></div><p class="vm-hint">每跨过一个数据分钟记录累计成交额增量，再与上次分钟增量比较。仅在本页可见、交易中且数据新鲜时采样；跨午休、断线、换日会重置。采样增量可能受刷新秒位影响。</p><div id="vmPace"></div></section>
  <section class="panel vm-method"><h2>计算口径与数据说明</h2><ul><li>金额统一为元，界面换算为万、亿、万亿；成交量单位为手。</li><li>放缩量比 = 当前累计成交额 ÷ 上一交易日同一时刻累计额。≥1.03 为放量，≤0.97 为缩量，中间为平量。它不同于行情软件的个股“量比”。</li><li>预计全天 = 当前累计额 × 昨日全天额 ÷ 昨日同时刻累计额。开盘不足8分钟或基准缺失时不预测，收盘后显示实际值。</li><li>沪深采用上证指数与深证综指的成交额相加，作为市场量能参考；创业板、科创50只显示点位，不重复计入。北证50是指数参考，不能视作全北交所成交额；其分时缺少金额时，按昨日累计量占全天量的比例估算并标注。</li><li>对比曲线严格匹配上一交易日；缺失市场、日期不一致或源时间相差超过2分钟时不计算合计。昨日分时缺失时不使用线性时间进度替代。</li><li>网页隐藏时暂停请求；失败保留上次成功快照并显示失败提示，连续失败后降频。关闭网页后停止监控。</li></ul><div class="vm-section-head"><a href="https://github.com/SeptemberL/MarketVolume" target="_blank" rel="noopener">参考项目：SeptemberL / MarketVolume</a><button class="btn" id="vmExport" type="button">导出当前快照</button></div></section>`;
  $('#vmScope').value=scope;
  const status=(text,error=false)=>{if(!alive)return;$('#vmStatus').textContent=text;$('#vmStatus').className='notice'+(error?' message-error':'');};
  function table(headers,rows){return rows.length?`<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="vm-hint">暂无数据</p>';}
  function renderStocks(){
    const rows=stocks.map(symbol=>{
      const s=last?.stocks?.find(r=>r.symbol===symbol),old=previous?.stocks?.find(r=>r.symbol===symbol);
      const delta=s&&old&&s.date===old.date&&s.sourceTime>old.sourceTime&&s.amount>=old.amount&&!s.delayed?s.amount-old.amount:null;
      return [`${vEsc(s?.name||symbol)}<small>${vEsc(symbol)}</small>`,vFmt(s?.price),`<span class="${vTone(s?.changePercent)}">${vFmt(s?.changePercent)}%</span>`,vMoney(s?.amount),vMoney(s?.previousTotal),vMoney(s?.previousAmount),`<span class="${vTone((s?.ratio??1)-1)}">${vFmt(s?.ratio)} 倍</span>`,vSign(delta),vMoney(s?.forecast),s?.error?vEsc(s.error):vEsc(s?.sourceTime||'等待刷新'),`<button class="btn" type="button" data-vm-remove="${symbol}">移除</button>`];
    });
    $('#vmStocks').innerHTML=rows.length?table(['证券','现价','涨跌幅','当前累计额','昨日全天额','昨日同时刻','放缩量比','较上次刷新','预计全天额','报价时间 / 状态','操作'],rows):'<p class="vm-hint">添加证券后，可同时比较当前成交额、昨日同时刻和预计全天额。</p>';
    root.querySelectorAll('[data-vm-remove]').forEach(b=>b.onclick=()=>{stocks=stocks.filter(s=>s!==b.dataset.vmRemove);persist();previous=null;renderStocks();refresh();});
  }
  function chart(m){
    let current=m.currentCurve||[],prior=m.previousCurve||[];
    if(m.hhmm&&Number.isFinite(m.amount))current=[...current.filter(p=>p.hhmm!==m.hhmm),{hhmm:m.hhmm,amount:m.amount}].sort((a,b)=>a.hhmm.localeCompare(b.hhmm));
    const all=[...current,...prior].filter(p=>Number.isFinite(p.amount));if(!all.length)return '<p class="vm-hint">五日分时暂未返回可用累计曲线。</p>';
    const W=960,H=290,L=76,R=22,T=24,B=244,max=Math.max(1,...all.map(p=>p.amount))*1.08;
    const minute=h=>{const t=Number(h.slice(0,2))*60+Number(h.slice(2));return t<=690?t-570:120+t-780;},x=h=>L+Math.max(0,Math.min(240,minute(h)))/240*(W-L-R),y=a=>B-a/max*(B-T);
    const line=(rows,color,label)=>{const paths=[];let prev=-10;for(const p of rows.filter(p=>Number.isFinite(p.amount))){const n=minute(p.hhmm);paths.push((n-prev>2?'M':'L')+x(p.hhmm).toFixed(1)+' '+y(p.amount).toFixed(1));prev=n;}return `<path d="${paths.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`+rows.filter(p=>Number.isFinite(p.amount)).map(p=>`<circle cx="${x(p.hhmm)}" cy="${y(p.amount)}" r="3" fill="${color}" opacity=".2"><title>${label} ${p.hhmm.slice(0,2)}:${p.hhmm.slice(2)}：${vMoney(p.amount)}</title></circle>`).join('');};
    return `<div class="vm-legend"><span>● ${vEsc(m.date)} 当前交易日</span><span>● ${vEsc(m.previousDate||'基准缺失')} 上一交易日${m.estimated?'（含估算）':''}</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="当前交易日与上一交易日累计成交额曲线，纵轴单位亿元"><title>当前交易日和上一交易日累计成交额</title>${[0,.25,.5,.75,1].map(n=>`<path d="M${L} ${y(n*max)}H${W-R}" stroke="#e6ebf2"/><text x="${L-10}" y="${y(n*max)+5}" text-anchor="end">${vFmt(n*max/1e8,0)}</text>`).join('')}<text x="${L}" y="14">亿元</text>${['0930','1030','1130','1400','1500'].map(h=>`<text x="${x(h)}" y="${B+26}" text-anchor="middle">${h.slice(0,2)}:${h.slice(2)}</text>`).join('')}${line(prior,'#99a8ba','上一交易日')}${line(current,'#356caf','当前交易日')}</svg>`;
  }
  function render(data){
    const m=data.market,delta=m.ratio===null?null:(m.ratio-1)*100;
    $('#vmOverview').innerHTML=`<div class="vm-indices">${data.indices.map(q=>`<section class="panel"><span>${vEsc(q.name)}</span><strong>${vFmt(q.price)}</strong><b class="${vTone(q.changePercent)}">${vFmt(q.changePercent)}%</b><small>${vEsc(q.sourceTime)}</small></section>`).join('')}</div><section class="panel vm-summary"><div class="vm-section-head"><h2>${scope==='hs'?'沪深量能参考':'沪深与北证50量能参考'}</h2><span class="vm-state ${vTone(delta)}">${vEsc(m.state)}${m.estimated?' · 含估算':''}${m.delayed?' · 数据延迟':''}</span></div><div class="vm-metrics">${[['当前累计成交额',vMoney(m.amount)],['较昨日同时刻',vSign(m.difference)],['放缩量比',vFmt(m.ratio)+' 倍'],['预计全天成交额',vMoney(m.forecast)]].map(([label,value],i)=>`<div><span>${label}</span><strong class="${i===1||i===2?vTone(delta):''}">${value}</strong></div>`).join('')}</div><p class="vm-hint">${vEsc(m.date||'部分市场数据缺失')} ${vEsc(m.hhmm?m.hhmm.slice(0,2)+':'+m.hhmm.slice(2):'')} · ${vPhases[m.phase]||'不可合计'} · 基准 ${vEsc(m.previousDate||'缺失')} 同时刻 ${vMoney(m.previousAmount)} · 昨日全天 ${vMoney(m.previousTotal)}${!m.complete?' · 市场数据不齐或时间不一致，合计留空':''} · 涨停 ${data.limits?.up??'—'} 家 / 跌停 ${data.limits?.down??'—'} 家（${vEsc(data.limits?.date||'数据缺失')}）${data.limits?.down>10?' · 跌停家数超过10家':''}</p></section>`;
    $('#vmCharts').innerHTML=`<section class="panel vm-chart"><h2>累计成交额对照</h2>${chart(m)}<p class="vm-hint">横轴合并午休时段；曲线点可悬停查看金额。灰线为上一交易日完整分布，蓝线截止当前数据时刻。</p></section>`;
    $('#vmMarkets').innerHTML=`<section class="panel"><h2>分市场明细</h2>${table(['市场','当前累计额','昨日同时刻','差额','放缩量比','预计全天','口径 / 状态'],data.markets.map(r=>[vEsc(r.name),vMoney(r.amount),vMoney(r.previousAmount),vSign(r.difference),vFmt(r.ratio)+' 倍',vMoney(r.forecast),r.error?vEsc(r.error):`${r.estimated?'昨日分时金额按成交量占比估算':'公开行情'}<small>${vEsc(r.sourceTime||'')} ${r.delayed?'数据延迟':''}</small>`]))}</section>`;
    renderStocks();$('#vmPaceLabel').textContent=pace.state||'等待连续分钟采样';
    $('#vmPace').innerHTML=`<p class="vm-hint">本次分钟采样增量 ${vMoney(pace.increment)} · 上次 ${vMoney(pace.lastIncrement)}</p>`+table(['日期','分钟','节奏变化','采样增量'],pace.history.map(h=>[vEsc(h.date),h.time.slice(0,2)+':'+h.time.slice(2),h.from+' → '+h.to,vMoney(h.increment)]));
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
  function invalidate(){revision++;request?.abort();last=null;previous=null;pace=new VolumePace();$('#vmOverview').innerHTML='';$('#vmCharts').innerHTML='';$('#vmMarkets').innerHTML='';$('#vmPaceLabel').textContent='等待连续采样';$('#vmPace').innerHTML='';status(paused?'设置已保存，恢复监控后读取。':'设置已变更，正在重新读取…');clearTimeout(timer);if(!busy)refresh();}
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
