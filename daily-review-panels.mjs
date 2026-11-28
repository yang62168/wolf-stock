import {
  broadEtfs, calendarBars, dailyPerformance, deviationWindows, etfTimeline,
  normalizeReviewSymbols, reviewBenchmark, reviewIndices, reviewPool,
} from './daily-review-data.mjs';

const notesKey='wolf-daily-review-v1';
const heightKey='wolf-daily-heights-v1';
const phaseOptions=['酝酿期','发酵期','延续期','分歧期','退潮期'];
const limitLine=25;

function read(key,fallback){
  try{return JSON.parse(localStorage.getItem(key))??fallback;}
  catch{return fallback;}
}

function write(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));return true;}
  catch{return false;}
}

const groupNames=rows=>rows.map(row=>row.name||row.symbol.slice(2)).join('、');
const pauseMessage='<p class="dl-empty">暂无可用数据。</p>';
const heightOf=row=>Number.isInteger(row.consecutive)&&row.consecutive>0?row.consecutive:0;
const showPercent=(value,format)=>Number.isFinite(value)?(value>0?'+':'')+format(value,2)+'%':'—';

function reportChart(points,{esc,quantity,kind}){
  const heightMode=kind==='height';
  const width=920,height=230,left=54,right=854,top=23,bottom=184;
  const prices=points.map(point=>heightMode?point.height:point.price).filter(Number.isFinite);
  if(!prices.length)return pauseMessage;
  const minimum=heightMode?0:Math.min(...prices)*0.999;
  const maximum=heightMode?Math.max(1,...prices):Math.max(...prices)*1.001;
  const x=i=>left+(i/Math.max(points.length-1,1))*(right-left);
  const y=value=>bottom-(value-minimum)/(maximum-minimum)*(bottom-top);
  const maxAmount=Math.max(1,...points.map(point=>point.amount||0));
  let prev=-2;
  const line=points.map((point,i)=>{
    const value=heightMode?point.height:point.price;
    if(!Number.isFinite(value))return '';
    const command=i===prev+1?'L':'M';
    prev=i;
    return command+x(i)+' '+y(value);
  }).join('');
  const grid=Array.from({length:5},(_,i)=>{
    const value=minimum+(maximum-minimum)*i/4,p=y(value);
    return `<line x1="${left}" x2="${right}" y1="${p}" y2="${p}"/><text x="${left-7}" y="${p+4}" text-anchor="end">${quantity(value,heightMode?1:0)}</text>${heightMode?'':`<text x="${right+7}" y="${p+4}">${quantity(i*maxAmount/4/1e8,2)} 亿</text>`}`;
  }).join('');
  const ticks=points.map((point,i)=>{
    if(i!==points.length-1&&i%Math.max(1,Math.ceil(points.length/7))!==0)return '';
    return `<text x="${x(i)}" y="${bottom+23}" text-anchor="middle">${esc(heightMode?point.date.slice(5):point.time)}</text>`;
  }).join('');
  const bars=heightMode?'':points.map((point,i)=>{
    if(!Number.isFinite(point.amount))return '';
    const barHeight=point.amount/maxAmount*(bottom-top);
    return `<rect x="${x(i)-1.2}" y="${bottom-barHeight}" width="2.4" height="${barHeight}"><title>${esc(point.time)} · ${quantity(point.amount/1e8,2)} 亿元</title></rect>`;
  }).join('');
  const dots=heightMode?points.map((point,i)=>Number.isFinite(point.height)?`<circle cx="${x(i)}" cy="${y(point.height)}" r="4"><title>${esc(point.date)} · ${point.height} 板 · ${esc(point.leaders)}</title></circle>`:'').join(''):'';
  const label=heightMode?'近30个交易日最高连板走势':'上证分时与宽基ETF分钟成交额';
  return `<div class="dl-plot"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><title>${label}</title>${grid}${ticks}${bars}<path d="${line}"/>${dots}</svg></div>`;
}

export function mountReviewPanels({root,date,report,signal,request,esc,quantity,stockLink,linkStocks}){
  const $=selector=>root.querySelector(selector);
  const dayNotes=()=>read(notesKey,{})[date]||{};
  const saveDay=change=>{
    const all=read(notesKey,{});
    return write(notesKey,{...all,[date]:{...all[date],...change}});
  };
  const verifiedDate= date < new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
    || new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date())>='15:00';
  const allBars=new Map();
  const bars=code=>{
    if(!allBars.has(code))allBars.set(code,request('/api/bars?period=day&symbol='+code)
      .then(calendarBars).catch(error=>{allBars.delete(code);throw error;}));
    return allBars.get(code);
  };
  const poolData=new Map();
  const fetchPool=day=>{
    if(!poolData.has(day))poolData.set(day,request('/api/limits?date='+day.replaceAll('-',''))
      .catch(error=>{poolData.delete(day);throw error;}));
    return poolData.get(day);
  };
  const cache=read(heightKey,{});
  let previousDate=null,previousPool=null;
  let previousRows=new Map();
  function rowFor(code){
    return report.rows.find(row=>row.symbol===code)||previousRows.get(code)||{symbol:code,name:code.slice(2)};
  }
  const heightPoint=(day,rows)=>{
    const height=Math.max(0,...rows.map(heightOf));
    return {date:day,height:height||null,leaders:height?groupNames(rows.filter(row=>heightOf(row)===height)):''};
  };

  async function renderHeight(sessions){
    const box=$('#dlHeight');
    if(!sessions.length){box.textContent='交易日序列暂不可用。';return;}
    const dates=sessions.map(row=>row.time);
    const selected=heightPoint(date,report.rows);
    const fresh=Object.create(null);
    let received=0;
    const cachedPoint=day=>day===date?selected:fresh[day]||cache[day];
    function draw(loading){
      if(signal.aborted)return;
      const points=dates.map(day=>cachedPoint(day)||{date:day,height:null});
      const covered=points.filter(point=>Number.isFinite(point.height));
      const recentLeader=covered.at(-1);
      box.innerHTML=`${reportChart(points,{esc,quantity,kind:'height'})}
        <p class="dl-footnote">${loading?'正在补齐较早日期。 ':''}已取得 ${covered.length} / ${dates.length} 个交易日的连板高度，缺失日留空。${recentLeader?` 最近有数据日 ${esc(recentLeader.date)} · ${recentLeader.height} 板 · ${esc(recentLeader.leaders)}。`:''}</p>`;
    }
    draw(true);
    await reviewPool(dates.filter(day=>day!==date&&!cachedPoint(day)?.height),3,async day=>{
      const data=await fetchPool(day);
      if(signal.aborted||data.stale||!Array.isArray(data.rows)||!data.rows.length)return;
      const point=heightPoint(day,data.rows);
      if(point.height){
        fresh[day]=point;
        if(++received%5===0)draw(true);
      }
    },signal);
    if(signal.aborted)return;
    if(verifiedDate&&selected.height)fresh[date]=selected;
    const merged={...read(heightKey,{}),...fresh};
    write(heightKey,Object.fromEntries(Object.entries(merged).sort(([a],[b])=>b.localeCompare(a)).slice(0,150)));
    draw(false);
  }

  async function loadEtf(){
    const box=$('#dlEtf'),button=$('#dlEtfLoad');
    button.disabled=true;
    box.textContent='正在读取上证指数及宽基 ETF 分时…';
    const series=await reviewPool([reviewIndices[0],...broadEtfs],3,([code])=>request('/api/minute?symbol='+code),signal);
    if(signal.aborted)return;
    const matching=series.slice(1).filter(item=>item?.date===date.replaceAll('-','')).length;
    const points=etfTimeline(series[0],series.slice(1),date);
    const hasAmounts=points.some(point=>Number.isFinite(point.amount))&&points.some(point=>Number.isFinite(point.price));
    box.innerHTML=hasAmounts?`${reportChart(points,{esc,quantity,kind:'etf'})}<p class="dl-footnote">金柱为 6 只 ETF 的同期分钟成交额合计，蓝线为上证指数。缺少任何一只同分钟金额时，该柱留空。</p>`
      :`<p class="dl-empty">该日期未取齐可用的 ETF 分钟成交额（同日分时 ${matching} / ${broadEtfs.length}）。现有接口主要返回最近一日分时。</p>`;
    button.disabled=false;
  }

  async function loadIndexes(){
    const results=await reviewPool(reviewIndices,3,([code])=>bars(code),signal);
    if(signal.aborted)return;
    const items=reviewIndices.map(([,name],i)=>({name,performance:dailyPerformance(results[i]||[],date)}));
    const out=$('#dlIndexBrief');
    out.innerHTML=`<div class="table-scroll"><table><thead><tr><th>指数</th><th>涨跌幅</th><th>盘中最低涨跌幅</th><th>振幅</th></tr></thead><tbody>
      ${items.map(({name,performance:p})=>`<tr><td>${name}</td><td class="${p?.change>0?'up':p?.change<0?'down':''}">${showPercent(p?.change,quantity)}</td><td>${showPercent(p?.lowChange,quantity)}</td><td>${showPercent(p?.amplitude,quantity)}</td></tr>`).join('')}
      </tbody></table></div><p class="dl-footnote">以所选日期日线计算，盘中以当前行情为准。</p>`;
    const calendar=(results[0]||[]).filter(row=>row.time<=date);
    previousDate=calendar.at(-1)?.time===date?calendar.at(-2)?.time:null;
    renderHeight(calendar.slice(-30));
    if(previousDate){
      try{
        const data=await fetchPool(previousDate);
        if(!data.stale&&Array.isArray(data.rows)&&data.rows.length)previousPool=data.rows;
      }catch{}
      if(signal.aborted)return;
      previousRows=new Map((previousPool||[]).map(row=>[row.symbol,row]));
    }
    if(signal.aborted)return;
    renderThemes();
    renderWatch();
  }

  function renderThemes(){
    const saved=dayNotes().themes||{};
    const tags=read('wolf-tools-v1',{}).tags;
    const defaults=Array.isArray(tags)?Object.fromEntries(tags.filter(tag=>tag?.name&&Array.isArray(tag.symbols)).map(tag=>[tag.name,tag.symbols])):{};
    const names=[...new Set([...Object.keys(saved),...Object.keys(defaults)])];
    const themes=names.map(name=>{
      const note=Object.hasOwn(saved,name)?saved[name]:{};
      const matches=normalizeReviewSymbols(note.symbols??(Object.hasOwn(defaults,name)?defaults[name]:[]));
      const codes=new Set(matches.map(row=>row.symbol));
      const stocks=report.rows.filter(row=>codes.has(row.symbol));
      const current=new Set(stocks.map(row=>row.symbol));
      const broken=verifiedDate&&previousPool?[...previousRows.values()].filter(row=>codes.has(row.symbol)&&heightOf(row)>=2&&!current.has(row.symbol)):[];
      const top=stocks[0]?.consecutive;
      const leader=top>=2?stocks.filter(row=>row.consecutive===top):[];
      return {name,note,matches,stocks,broken,leader};
    }).sort((a,b)=>b.stocks.length-a.stocks.length||a.name.localeCompare(b.name,'zh-CN'));
    const featured=themes.filter(theme=>!theme.note.other);
    const other=themes.filter(theme=>theme.note.other);
    const summary=$('#dlThemeLeaders');
    const active=featured.filter(theme=>theme.stocks.length).slice(0,3);
    summary.hidden=!active.length;
    summary.textContent=active.length?'重点题材：'+active.map(theme=>theme.name+' '+theme.stocks.length+' 只').join('、')+'。':'';
    const themeLink=row=>stockLink(row)+(heightOf(row)>=2?`（${heightOf(row)}板）`:'');
    const symbolsHelp='股票代码用空格、逗号或换行分隔。一只股票可加入多个题材。';
    const editor=({name,note,matches})=>`<details><summary>编辑题材</summary><form class="dl-theme-edit" data-dl-theme="${esc(name)}">
          <label>题材成员代码<textarea name="symbols" rows="2" maxlength="1200" title="${symbolsHelp}">${matches.map(row=>row.symbol).join(' ')}</textarea></label>
          <label>题材阶段 <select name="phase"><option value="">待填写</option>${phaseOptions.map(phase=>`<option ${phase===note.phase?'selected':''}>${phase}</option>`).join('')}</select></label>
          <label>辨识度标的 <input name="recognition" maxlength="120" value="${esc(note.recognition)}"></label>
          <label>次日观察<textarea name="comment" rows="3" maxlength="1200">${esc(note.comment)}</textarea></label>
          <label class="dl-inline"><input name="other" type="checkbox" ${note.other?'checked':''}> 归为其他概念</label>
          <button class="btn" type="submit">保存</button><span class="dl-footnote" role="status"></span>
        </form></details>`;
    $('#dlThemes').innerHTML=`
      <form id="dlThemeAdd" class="dl-controls">
        <label>题材名称 <input name="name" type="text" maxlength="30" required placeholder="如 华为算力"></label>
        <label>题材成员代码 <input name="symbols" maxlength="1200" placeholder="如 002771, 603019"></label>
        <button class="btn" type="submit">新增题材</button>
        <span class="dl-footnote" role="status" id="dlThemeStatus"></span>
      </form>
      ${themes.length?'':'<p class="dl-empty">从站内「概念标签」载入分类，或为所选交易日添加题材。</p>'}
      <div class="dl-theme-grid">${featured.map(({name,note,matches,stocks,broken,leader})=>`<article class="dl-theme">
        <h3>${esc(name)} <span>${stocks.length} 只涨停</span></h3>
        <dl><dt>题材阶段</dt><dd>${esc(note.phase||'待填写')}</dd>
        <dt>身位龙</dt><dd>${leader.length?leader.map(themeLink).join('、'):stocks.length?'暂无连板':'—'}</dd>
        <dt>辨识度</dt><dd>${esc(note.recognition||'—')}</dd>
        <dt>${verifiedDate?'昨日连板今日未封板':'断板'}</dt><dd>${broken.length?broken.map(themeLink).join('、'):previousPool&&verifiedDate?'—':'待收盘及上日数据'}</dd>
        <dt>涨停名单</dt><dd>${stocks.map(themeLink).join('、')||'—'}</dd>
        <dt>次日观察</dt><dd class="dl-note">${esc(note.comment||'—')}</dd></dl>
        ${editor({name,note,matches})}
      </article>`).join('')}</div>
      ${other.length?`<h3 class="dl-other-title">其他概念</h3><div class="dl-theme-grid">${other.map(theme=>`<article class="dl-theme"><h3>${esc(theme.name)} <span>${theme.stocks.length} 只涨停</span></h3><p>${theme.stocks.map(themeLink).join('、')||'—'}</p>${editor(theme)}</article>`).join('')}</div>`:''}
      ${themes.length?'<p class="dl-footnote">同一股票可计入多个题材。身位龙按题材内最高连板显示，辨识度和题材阶段由你填写。</p>':''}`;
    const codesFrom=text=>normalizeReviewSymbols(String(text).split(/[\s,，、;；]+/)).map(row=>row.symbol);
    $('#dlThemeAdd').onsubmit=event=>{
      event.preventDefault();
      const values=new FormData(event.currentTarget),name=String(values.get('name')).trim();
      const hint=$('#dlThemeStatus');
      if(!name||names.includes(name)){hint.textContent='题材名称为空或已存在。';return;}
      if(!saveDay({themes:{...saved,[name]:{symbols:codesFrom(values.get('symbols'))}}})){
        hint.textContent='保存失败，浏览器存储不可用。';return;
      }
      renderThemes();
      $('#dlThemeStatus').textContent=`已添加 ${name}。`;
    };
    for(const form of $('#dlThemes').querySelectorAll('[data-dl-theme]'))form.onsubmit=event=>{
      event.preventDefault();
      const values=new FormData(form),name=form.dataset.dlTheme;
      const change={symbols:codesFrom(values.get('symbols')),phase:String(values.get('phase')),other:values.has('other'),
        recognition:String(values.get('recognition')).trim(),comment:String(values.get('comment')).trim()};
      if(saveDay({themes:{...saved,[name]:change}})){
        renderThemes();
        $('#dlThemeStatus').textContent=`已保存 ${name}。`;
      }else{
        form.querySelector('[role=status]').textContent='保存失败，浏览器存储不可用。';
      }
    };
    linkStocks();
  }

  async function renderWatch(){
    const node=$('#dlWatchResults');
    if(!previousDate){node.textContent='上一交易日暂无法确认。';return;}
    const planned=read(notesKey,{})[previousDate]?.watch;
    const rows=normalizeReviewSymbols(Array.isArray(planned)?planned:[]);
    if(!rows.length){node.textContent=`${previousDate} 尚未保存复盘自选。选到该交易日即可补录。`;return;}
    node.textContent=`正在核对 ${previousDate} 保存的 ${rows.length} 只自选…`;
    const current=new Map(report.rows.map(row=>[row.symbol,row]));
    const previous=await reviewPool(rows,3,async row=>{
      const onBoard=current.get(row.symbol);
      if(onBoard&&Number.isFinite(onBoard.changePercent))return onBoard.changePercent;
      const daily=await bars(row.symbol),index=daily.findIndex(point=>point.time===date);
      return index>0&&daily[index-1].time===previousDate?dailyPerformance(daily,date)?.change:null;
    },signal);
    if(signal.aborted)return;
    node.innerHTML=`<p class="dl-footnote">名单日期 ${esc(previousDate)} · 复盘日期 ${esc(date)}</p>
      <div class="table-scroll"><table><thead><tr><th>复盘自选</th><th>所选日涨跌幅</th><th>结果</th></tr></thead><tbody>
      ${rows.map((row,i)=>{
        const currentRow=current.get(row.symbol),priorRow=previousRows.get(row.symbol),change=previous[i];
        const result=currentRow?(heightOf(currentRow)>=2?heightOf(currentRow)+' 连板':'涨停')
          :!Number.isFinite(change)?'行情缺失':!verifiedDate?'暂未封板':priorRow?'断板':'未涨停';
        return `<tr><td>${stockLink({...row,name:currentRow?.name||priorRow?.name||row.name||row.symbol.slice(2)})}</td><td class="${change>0?'up':change<0?'down':''}">${showPercent(change,quantity)}</td><td>${result}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    linkStocks();
  }

  async function loadDeviations(){
    const box=$('#dlDeviation'),button=$('#dlDeviationLoad');
    if(!verifiedDate){box.textContent='当天收盘后可测算收盘偏离。';return;}
    button.disabled=true;
    const candidates=normalizeReviewSymbols([
      ...report.rows.filter(row=>heightOf(row)>=2).slice(0,10),
      ...normalizeReviewSymbols(dayNotes().watch||[]).slice(0,8),
      ...[...previousRows.values()].filter(row=>heightOf(row)>=3).slice(0,6),
    ]).filter(row=>reviewBenchmark(row.symbol)).slice(0,18);
    box.textContent=`正在核对 ${candidates.length} 只候选的日线…`;
    const result=await reviewPool(candidates,3,async row=>{
      const [code,name]=reviewBenchmark(row.symbol);
      const [stock,index]=await Promise.all([bars(row.symbol),bars(code)]);
      const windows=deviationWindows(stock,index,date);
      if(!windows.length)return null;
      return {row:{...row,name:row.name||rowFor(row.symbol).name},benchmark:name,windows,
        near:windows.reduce((a,b)=>a.distance<=b.distance?a:b)};
    },signal);
    if(signal.aborted)return;
    const valid=result.filter(Boolean);
    const near=valid.filter(row=>row.near.distance<=limitLine).sort((a,b)=>a.near.distance-b.near.distance);
    box.innerHTML=`<p class="dl-footnote">候选 ${candidates.length} 只，有可比日线 ${valid.length} 只，距线不超过 ${limitLine}% 的候选 ${near.length} 只。</p>
      ${near.length?`<div class="table-scroll"><table><thead><tr><th>股票</th><th>基准指数</th><th>对应阈值</th><th>区间偏离</th><th>距线参考</th></tr></thead><tbody>
      ${near.map(({row,benchmark,near:n})=>`<tr><td>${stockLink(row)}</td><td>${esc(benchmark)}</td><td>${n.window} 日 +${n.limit}%</td><td>${showPercent(n.deviation,quantity)}（${n.days} 日）</td><td>${n.distance<=0?'测算已达线':quantity(n.distance,2)+'%'}</td></tr>`).join('')}</tbody></table></div>`:pauseMessage}`;
    button.disabled=false;
    linkStocks();
  }

  const watchInput=$('#dlReviewSymbols');
  const watchPreview=rows=>rows.map(row=>row.symbol).join(' ');
  watchInput.value=watchPreview(normalizeReviewSymbols(dayNotes().watch||[]));
  $('#dlImportWatch').onclick=()=>{
    const watch=read('wolf-market-v1',{}).watch;
    watchInput.value=watchPreview(normalizeReviewSymbols(Array.isArray(watch)?watch:[]));
  };
  $('#dlReviewWatch').onsubmit=event=>{
    event.preventDefault();
    const existing=normalizeReviewSymbols([...(dayNotes().watch||[]),...(read('wolf-market-v1',{}).watch||[])]);
    const names=new Map(existing.map(row=>[row.symbol,row.name]));
    const watch=normalizeReviewSymbols(watchInput.value.split(/[\s,，、;；]+/)).slice(0,24)
      .map(row=>({...row,name:names.get(row.symbol)||rowFor(row.symbol).name||row.symbol.slice(2)}));
    const saved=saveDay({watch});
    $('#dlWatchStatus').textContent=saved?`已保存 ${date} 的 ${watch.length} 只自选。`:'保存失败，浏览器存储不可用。';
    watchInput.value=watchPreview(watch);
  };
  $('#dlEtfLoad').onclick=loadEtf;
  $('#dlDeviationLoad').onclick=loadDeviations;
  loadIndexes();
}
