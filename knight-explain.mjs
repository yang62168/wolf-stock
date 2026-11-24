import {ma} from './analytics.mjs';
import {closedBars} from './knight-engine.mjs';
const compact=t=>String(t??'').replace(/[- :]/g,'');
const day=t=>compact(t).slice(0,8),clock=t=>compact(t).slice(8,12);
const finite=Number.isFinite;
const fmt=(n,d=2)=>finite(n)?n.toFixed(d):'未提供';
const row=(id,label,status,actual,expected,origin='tool',group='共同前提',source='?tab=knight#kn-13')=>({id,label,status,actual,expected,origin,group,source});
const verdict=value=>value?'pass':'fail';
const waiting=(id,label,expected,group,source)=>row(id,label,'pending','尚未形成可确认的完整结构',expected,'tool',group,source);

// Diagnostics describe the same completed candles and the engine-selected timestamps.
// The engine remains the only authority for structural eligibility; rows are never scored.
export function explainKnight(daily,minutes,result,opts={}){
  const now=opts.now??new Date(),ds=closedBars(daily,'day',now),ms=closedBars(minutes,'m15',now),isDaily=opts.strategy==='daily';
  const settings={breakVolume:1.2,pullVolume:.8,minBody:2,maxBias:2,tolerance:1,lookback:24,fresh:3,...opts};
  const source=isDaily?'?tab=knight#kn-13':'?tab=knight#kn-3',checks=[];
  const enough=ds.length>=(isDaily?59:60)&&ms.length>=(isDaily?1:60);
  checks.push(row('data','完整K线数量',enough?'pass':'missing',`日K ${ds.length} 根；15分K ${ms.length} 根`,isDaily?'至少59根完整日K及当前交易日完整15分K':'至少60根完整日K、60根完整15分K','data','数据',source));
  if(!enough){checks.push(waiting('structure','结构条件',isDaily?'共同前提＋开盘分支或尾盘分支':'日趋势＋突破＋回踩＋再突破','结构',source));return checks;}
  if(isDaily)dailyChecks(ds,ms,result,settings,checks);else minuteChecks(ds,ms,result,settings,checks);
  return checks;
}
function minuteChecks(ds,ms,result,o,out){
  const source='?tab=knight#kn-3',d=ds.at(-1),m=ms.at(-1),day55=ma(ds,55),prev55=ma(ds,55,ds.length-6),line=ma(ms,55),bias=(m.close/line-1)*100;
  out.push(row('daily-close','日线支撑',verdict(d.close>day55&&m.close>day55),`日收 ${fmt(d.close)}；最新15分收 ${fmt(m.close)}；日55 ${fmt(day55)}`,'完整日收盘与最新15分收盘均高于日MA55','tool','共同前提',source));
  out.push(row('daily-slope','日55斜率',verdict(day55>prev55),`当前 ${fmt(day55)}；5个交易日前 ${fmt(prev55)}`,'日MA55较5个交易日前上升','tool','共同前提',source));
  out.push(row('minute-support','最新15分位置',verdict(m.close>=line),`收盘 ${fmt(m.close)}；15分55 ${fmt(line)}`,'收盘不低于15分MA55','tool','共同前提',source));
  out.push(row('distance','距15分55',verdict(bias<=o.maxBias),`${fmt(bias)}%`,`乖离≤${o.maxBias}%（下方位置另由支撑条件检查）`,'tool','共同前提',source));
  const selected=ms.findIndex(b=>b.time===result.breakTime);
  let b=selected;
  if(b<0&&result.dailyUp&&m.close>=line&&bias<=o.maxBias){
    for(let i=Math.max(55,ms.length-1-o.lookback);i<ms.length;i++)if(ms[i].close>ma(ms,55,i)&&ms[i-1].close<=ma(ms,55,i-1)&&ms[i].close>ms[i].open)b=i;
  }
  if(b>=55){
    const k=ms[b],base=ms.slice(b-5,b).reduce((n,x)=>n+x.volume,0)/5,ratio=base>0?k.volume/base:null;
    out.push(row('break','15分价格突破',verdict(k.close>ma(ms,55,b)&&ms[b-1].close<=ma(ms,55,b-1)&&k.close>k.open),`${k.time} · 红K收 ${fmt(k.close)}；55 ${fmt(ma(ms,55,b))}`,'红K从55下方收至上方','original','三步结构',source));
    out.push(row('break-volume','突破量',ratio===null?'missing':verdict(ratio>=o.breakVolume),`${fmt(ratio)}倍 · 突破量/前5根均量`,`≥${o.breakVolume}倍`,'tool','三步结构',source));
  }else{
    const evaluated=result.dailyUp&&m.close>=line&&bias<=o.maxBias;
    out.push(row('break','15分放量突破',evaluated?'fail':'pending',evaluated?'回看范围内未找到合格的放量红K突破':'共同前提未通过，本轮未继续匹配',`最近回看${o.lookback}根，量比≥${o.breakVolume}`,'tool','三步结构',source));
  }
  const p=ms.findIndex(b=>b.time===result.pullTime);
  if(p>=0&&selected>=0){
    const pull=ms[p],breakBar=ms[selected],lp=ma(ms,55,p),ratio=breakBar.volume>0?pull.volume/breakBar.volume:null;
    out.push(row('pull','回踩位置与顺序','pass',`${pull.time} · 低 ${fmt(pull.low)}；实体底 ${fmt(Math.min(pull.open,pull.close))}；55 ${fmt(lp)}`,'突破后8根内缩量绿K触线；实体容差'+o.tolerance+'%，期间保持结构','tool','三步结构',source));
    out.push(row('pull-volume','回踩量',ratio===null?'missing':verdict(ratio<=o.pullVolume),`${fmt(ratio)}倍 · 回踩量/突破量`,`≤${o.pullVolume}倍`,'tool','三步结构',source));
  }else out.push(waiting('pull','缩量回踩',`放量突破后8根内；量比≤${o.pullVolume}；实体容差${o.tolerance}%`,'三步结构',source));
  const confirm=ms.findIndex(b=>b.time===result.confirmTime);
  if(confirm>=0){const z=ms[confirm];out.push(row('confirm','再次突破与时效','pass',`${z.time} · 收 ${fmt(z.close)}；前高 ${fmt(ms[confirm-1].high)}`,'红K越过前一根高点，位于最近'+o.fresh+'根，确认后完整K仍在55上','tool','三步结构',source));}
  else out.push(waiting('confirm','再次突破与时效',`回踩后红K越过前高，确认位于最近${o.fresh}根`,'三步结构',source));
}
function dailyChecks(ds,ms,result,o,out){
  const latest=ms.at(-1),session=day(latest.time),history=ds.filter(b=>day(b.time)<session),current=ds.find(b=>day(b.time)===session),prior=history.at(-1);
  if(history.length<58||!prior){out.push(row('history','观察日前日线','missing','观察日前日线不足','需要至少58根历史日K','data'));return;}
  const candidates=[];
  for(const offset of [1,2]){
    const i=history.length-offset,k=history[i];if(!k||i<57)continue;
    const av=[5,10,20].map(n=>ma(history,n,i)),before=[5,10,20].map(n=>ma(history,n,i-3)),line=ma(history,55,i),prevLine=ma(history,55,i-1),base=history.slice(i-5,i).reduce((n,b)=>n+b.volume,0)/5;
    const bullish=av.every((v,j)=>v>before[j]&&k.close>v),cross=history[i-1].close<=prevLine&&k.close>line&&k.close>k.open,body=(k.close/k.open-1)*100,volume=base>0?k.volume/base:null;
    candidates.push({k,offset,av,before,line,bullish,cross,body,volume});
  }
  const chosen=candidates.find(c=>c.k.time===result.breakTime),shown=chosen?[chosen]:candidates;
  for(const c of shown){const group=`突破日核对 ${c.k.time}${chosen?'':'（候选，未确认）'}`,suffix=c.k.time;
    out.push(row('bullish-'+suffix,'5/10/20多头代理',verdict(c.bullish),`MA5/10/20：${c.av.map(v=>fmt(v)).join(' / ')}；3日前：${c.before.map(v=>fmt(v)).join(' / ')}；收 ${fmt(c.k.close)}`,'三线各自上行，突破收盘在三线上方；三线互相顺序不限','proxy',group));
    out.push(row('cross-'+suffix,'日55价格突破',verdict(c.cross),`开 ${fmt(c.k.open)}；收 ${fmt(c.k.close)}；日55 ${fmt(c.line)}`,'前日收盘在55下或线上，当日红K收至55上方','tool',group));
    out.push(row('body-'+suffix,'大阳实体',verdict(c.body>=o.minBody),`${fmt(c.body)}%`,`实体涨幅≥${o.minBody}%`,'tool',group));
    out.push(row('volume-'+suffix,'日突破量',c.volume===null?'missing':verdict(c.volume>=o.breakVolume),`${fmt(c.volume)}倍 · 当日量/前5日均量`,`≥${o.breakVolume}倍`,'tool',group));
  }
  if(!chosen){out.push(row('setup','共同前提组合','fail','未找到同一突破日全部条件同时通过的结构','每个候选日分别核对，不能跨日拼接条件','tool','共同前提'));out.push(waiting('branches','两种回踩分支','共同前提成立后，开盘回收或尾盘缩量满足一种即可','分支关系','?tab=knight#kn-13'));return;}
  out.push(row('window','交易日窗口','pass',`突破日 ${chosen.k.time}；当前为第${chosen.offset+1}个交易日`,'突破日计第1日，观察第2或第3个交易日','tool','共同前提'));
  const lineFor=price=>(history.slice(-54).reduce((sum,b)=>sum+b.close,0)+price)/55,line=current?ma(ds,55,ds.indexOf(current)):lineFor(latest.close),price=current?.close??latest.close,bias=(price/line-1)*100;
  out.push(row('distance','距日55',verdict(Math.abs(bias)<=o.maxBias),`${fmt(bias)}% · 收 ${fmt(price)}；日55 ${fmt(line)}`,`绝对偏离≤${o.maxBias}%`,'tool','共同前提'));
  const opening=ms.filter(b=>day(b.time)===session&&clock(b.time)>='0945'&&clock(b.time)<='1000'),first=opening.find(b=>clock(b.time)==='0945'),recovery=first&&first.open>=lineFor(first.close)&&first.low<lineFor(first.close)?opening.find(b=>b.close>lineFor(b.close)):null;
  out.push(row('opening-data','开盘完整15分K',first?'pass':'missing',first?first.time:'未取得观察日09:45完整K线','观察日09:45完整15分K','data','分支一：开盘回收代理'));
  out.push(row('opening-dip','开盘下探',first?verdict(first.open>=lineFor(first.close)&&first.low<lineFor(first.close)):'pending',first?`开 ${fmt(first.open)}；低 ${fmt(first.low)}；日55代理 ${fmt(lineFor(first.close))}`:'等待完整开盘K','从日55上方向下探线','proxy','分支一：开盘回收代理'));
  out.push(row('opening-reclaim','10:00前收回',first?verdict(Boolean(recovery)):'pending',recovery?`${recovery.time} · 收 ${fmt(recovery.close)}`:'尚未观察到合格回收','10:00前完整15分K收回日55上方；不能还原K内速度','proxy','分支一：开盘回收代理'));
  out.push(row('opening-hold','最新仍在日55上',verdict(latest.close>lineFor(latest.close)),`收 ${fmt(latest.close)}；日55代理 ${fmt(lineFor(latest.close))}`,'最新完整15分收盘仍在日55上方','proxy','分支一：开盘回收代理'));
  out.push(row('tail-close','完整日K已收盘',current?'pass':'pending',current?current.time:'盘中日K不用于缩量判断','等待观察日完整日K','data','分支二：尾盘缩量落线下'));
  out.push(row('tail-below','尾盘落在55下',current?verdict(current.close<line):'pending',current?`收 ${fmt(current.close)}；日55 ${fmt(line)}`:'等待收盘','完整日收盘低于日MA55；无需先收回','original','分支二：尾盘缩量落线下'));
  const ratio=current&&prior.volume>0?current.volume/prior.volume:null;
  out.push(row('tail-volume','全天缩量',!current?'pending':ratio===null?'missing':verdict(ratio<=o.pullVolume),ratio===null?'未取得可比较的完整日量':`${fmt(ratio)}倍 · 当日量/前一日量`,`≤${o.pullVolume}倍；盘中累计量不作结论`,'tool','分支二：尾盘缩量落线下'));
  out.push(row('branch-relation','分支关系','info',result.branch||'两种分支尚未出现完整匹配','共同前提＋（分支一 或 分支二）；不是两分支同时满足','tool','分支关系'));
}
export function screeningChecks(result,gate,opts,adjustments={}){
  const items=[],source=opts.strategy==='daily'?'?tab=knight#kn-13':'?tab=knight#kn-3';
  const same=adjustments.day==='前复权'&&adjustments.minute==='前复权';
  items.push(row('adjustment','价格复权口径',same?'pass':'missing',`日K ${adjustments.day||'未提供'}；15分K ${adjustments.minute||'未提供'}`,'日K、15分K同为前复权','data','数据',source));
  let sync=null;
  if(result.time&&gate.time){const minutes=t=>Number(clock(t).slice(0,2))*60+Number(clock(t).slice(2,4));sync=day(result.time)===day(gate.time)&&Math.abs(minutes(result.time)-minutes(gate.time))<=30;}
  items.push(row('synchronization','行情时间同步',sync===null?'missing':verdict(sync),`个股 ${result.time||'未提供'}；沪深300 ${gate.time||'未提供'}`,'同一数据日期，完整15分K时间差不超过30分钟','data','数据',source));
  items.push(row('market-filter','额外大盘动能过滤',!opts.env?'info':gate.time?verdict(gate.ok):'missing',opts.env?gate.reason:'本轮未启用（不拦截技术结构）','启用时：沪深300完整15分在MA20/55上，MA20较3根前上行','proxy','大盘环境',source));
  return {checks:items,usable:same&&sync===true};
}
