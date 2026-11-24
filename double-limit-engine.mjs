import {ma} from './analytics.mjs';
import {chinaClock} from './knight-engine.mjs';
export const DOUBLE_DEFAULTS=Object.freeze({mode:'strict',lookback:20,strongRise:20,redVolume:1.5,shrinkDivisor:3});
const good=n=>typeof n==='number'&&Number.isFinite(n);
const dateOf=t=>String(t||'').replace(/[- :]/g,'').slice(0,8);
const source='?tab=trade#tn-14';
const priceEq=(a,b)=>good(a)&&good(b)&&Math.abs(a-b)<.0049;
export function doubleRate(symbol,name=''){
 if(/ST|退|^N|^C/i.test(name)||! /^(?:sh(?:60|68)|sz(?:00|30))\d{4}$/.test(symbol))return null;
 return /^(?:sh68|sz30)/.test(symbol)?20:10;
}
export function downPrice(reference,rate){if(!(reference>0)||![10,20].includes(rate))return null;return Math.round(Math.round(reference*100)*(100-rate)/100)/100}
const validBar=b=>/^20\d{6}$/.test(dateOf(b?.time))&&[b.open,b.close,b.high,b.low,b.volume].every(good)&&b.low>0&&b.volume>=0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close);
const tradingMinute=time=>{let n=Number(time.slice(0,2))*60+Number(time.slice(2,4));return n>690&&n<780?690:Math.min(n,900)};
export function doubleLimitSignal({raw=[],adjusted=[],quote,minute=null,context={},now=new Date(),options={}}={}){
 const o={...DOUBLE_DEFAULTS,...options};
 if(!['strict','source-window'].includes(o.mode)||!Number.isInteger(o.lookback)||o.lookback<10||o.lookback>60||!(o.strongRise>=0&&o.strongRise<=200)||!(o.redVolume>=1&&o.redVolume<=10)||![3,4].includes(o.shrinkDivisor))throw new Error('双跌停策略参数无效。');
 const checks=[],add=(id,label,status,actual,expected,origin='工具口径')=>checks.push({id,label,status,actual,expected,origin,source});
 const result=(stage,reason,extra={})=>({eligible:false,shape:false,stage,reason,checks,parameters:o,...extra});
 const rate=doubleRate(quote?.symbol,quote?.name);add('scope','证券范围',rate?'pass':'fail',quote?.name||'未提供名称','仅非ST沪深普通A股；排除ETF、指数、北交所、新股标记及退市标记','数据校验');
 if(!rate)return result('范围不支持','本版仅筛选非ST沪深普通A股。');
 const clock=chinaClock(now),today=clock.date.replaceAll('-',''),asOf=dateOf(quote?.sourceTime),asTime=String(quote?.sourceTime||'').slice(11,16).replace(':','');
 if(!/^20\d{6}$/.test(asOf)||asOf>today||![quote.price,quote.open,quote.low,quote.high,quote.previousClose].every(v=>good(v)&&v>0))return result('数据不足','报价缺少有效时间、昨收或OHLC，不能推断跌停价。');
 const completed=asOf<today||clock.time>='1500';
 const prior=raw.filter(b=>validBar(b)&&dateOf(b.time)<asOf).sort((a,b)=>dateOf(a.time).localeCompare(dateOf(b.time)));
 if(new Set(prior.map(b=>dateOf(b.time))).size!==prior.length)return result('数据异常','历史日K有重复日期，本轮不计算。');
 const latest=raw.find(b=>dateOf(b.time)===asOf);
 const current={time:asOf,open:quote.open,close:quote.price,low:quote.low,high:quote.high,volume:quote.volume,previousClose:quote.previousClose};
 if(completed&&latest&&priceEq(latest.close,quote.price))Object.assign(current,latest,{previousClose:latest.previousClose??quote.previousClose});
 const series=[...prior,current],end=series.length-1;
 const adj=adjusted.filter(b=>validBar(b)&&dateOf(b.time)<=asOf).sort((a,b)=>dateOf(a.time).localeCompare(dateOf(b.time)));
 const latestAge=tradingMinute(clock.time)-tradingMinute(asTime);
 const currentSession=asOf===today&&clock.time>='0930'&&/^[0-2]\d[0-5]\d$/.test(asTime)&&asTime<=clock.time&&latestAge<=15;
 add('fresh','报价时效',currentSession?'pass':'pending',`${quote.sourceTime}；扫描 ${clock.date} ${clock.time}`,'使用本交易日、未晚于扫描时间的报价；滞后不超过15个交易分钟','数据校验');
 let match=null,pending=false;
 // A completed red candle must immediately precede the first shrinking limit-down day.
 for(let i=end;i>=Math.max(1,end-3);i--){
  const d=series[i],red=series[i-1],floor=downPrice(d.previousClose,rate);
  if(!floor||!priceEq(d.close,floor)||!(red.close>red.open))continue;
  if(i===end&&!completed){pending=true;continue}
  const base=series.slice(i-6,i-1);
  if(base.length!==5||!base.every(b=>b.volume>0)||!(red.volume>0&&d.volume>0))continue;
  const redRatio=red.volume/(base.reduce((sum,b)=>sum+b.volume,0)/5),shrink=d.volume/red.volume;
  if(redRatio<o.redVolume||!(shrink<1/o.shrinkDivisor))continue;
  match={index:i,red,d,floor,redRatio,shrink};break;
 }
 if(!match){add('pattern','红K → 缩量跌停',pending?'pending':'fail',pending?'当日仍在交易，不能用部分日量确认缩量':'最近窗口未找到满足时序和量比的完整日K',`红K量/前5日均量 ≥ ${o.redVolume}；下一日收盘跌停，量 < 红K的1/${o.shrinkDivisor}`,'原话条件＋工具阈值');return result(pending?'等待收盘确认':'未形成量价组合',pending?'盘中成交量尚未结束，暂不确认缩量跌停。':'未找到放量红K紧接缩量收盘跌停的组合。')}
 const {index:i,red,d,floor,redRatio,shrink}=match,position=end-i+1,d2=series[i+1];
 const common={shape:true,redDate:dateOf(red.time),firstDate:dateOf(d.time),redVolumeRatio:redRatio,shrinkRatio:shrink,sessionNumber:position,rate,asOf,price:quote.price,secondRatio:d2?.volume>0?d2.volume/red.volume:null};
 add('red','放量红K', 'pass',`${dateOf(red.time)}：收 ${red.close} > 开 ${red.open}；量比 ${redRatio.toFixed(2)}`,`前一日红K；放量代理为前5日均量的${o.redVolume}倍`,'原话条件＋工具阈值');
 add('shrink','缩量收盘跌停','pass',`${dateOf(d.time)} 收 ${d.close}；跌停价 ${floor}；量/红K ${(shrink*100).toFixed(2)}%`,`使用原价及源昨收计算跌停价；成交量严格小于红K的1/${o.shrinkDivisor}`,'原话条件');
 const ai=adj.findIndex(b=>dateOf(b.time)===dateOf(red.time)),required=Math.max(25,o.lookback);
 if(ai<required){add('rise','个股前期强势','missing',`红K前可用日K ${Math.max(0,ai)} 根`,`至少${required}根前复权日K`,'数据校验');return result('前期趋势数据不足','缩量形态存在，缺少足够的前期强势与趋势证据。',common)}
 const rise=(adj[ai].close/adj[ai-o.lookback].close-1)*100,m20=ma(adj,20,ai),old20=ma(adj,20,ai-5),strong=rise>=o.strongRise&&adj[ai].close>m20&&m20>old20;
 add('rise','个股前期强势',strong?'pass':'fail',`${o.lookback}日涨幅 ${rise.toFixed(2)}%；红K收盘 ${adj[ai].close}；MA20 ${m20.toFixed(2)} / 5日前 ${old20.toFixed(2)}`,`涨幅 ≥ ${o.strongRise}%，红K收于上升MA20之上；连板是原文偏好，非必选`,'原话背景＋工具代理');
 common.priorRise=rise;
 if(!strong)return result('前期强势未通过','量价形态存在，但前期强势或上涨趋势代理未通过。',common);
 let windowOK=false;
 if(o.mode==='strict'){
  const secondClosed=i+1<end||completed,secondFloor=downPrice(d2?.previousClose,rate),second=secondClosed&&priceEq(d2?.close,secondFloor)&&d2?.volume>0;
  add('window','严格双跌停观察窗口',second?'pass':secondClosed?'fail':'pending',`${position}号交易日；第二日${second?'收盘跌停':secondClosed?'未收盘跌停':'尚未完成'}`,'工具加严：连续两日收盘跌停后，仅观察紧接的下一交易日开板；不作为原文唯一解释');
  common.secondDate=d2?dateOf(d2.time):null;
  if(position<3)return result('等待双跌停完成','第一日缩量条件成立；严格模式等待第二日收盘跌停。',common);
  if(!second)return result('第二跌停未通过','严格模式要求连续两日收盘跌停；第二日不满足。',common);
  windowOK=position===3;
 }else{
  windowOK=position===2||position===3;
  add('window','原文时序观察窗口',windowOK?'pass':'pending',`首个缩量跌停日起第 ${position} 个交易日`,'工具起算：首个缩量跌停为第1日，观察第2/3日；原材料未统一起算点');
 }
 if(!windowOK)return result(position===1?'缩量形态观察':'观察窗口已过',position===1?'等待后续交易日，不预判开板。':'所选工具窗口已过，本轮不列为开板候选。',common);
 common.needsMinute=true;
 const entryFloor=downPrice(quote.previousClose,rate);common.downPrice=entryFloor;
 const sameMinute=minute&&minute.symbol===quote.symbol&&dateOf(minute.date)===asOf;
 const points=sameMinute?(minute.points||[]).filter(p=>/^\d{2}:\d{2}$/.test(p.time)&&p.time.replace(':','')<=asTime&&good(p.price)).sort((a,b)=>a.time.localeCompare(b.time)):[];
 let touched=false,opened=null;for(const p of points){if(priceEq(p.price,entryFloor))touched=true;else if(touched&&p.price>entryFloor&&!opened)opened=p.time}
 const last=points.at(-1),synced=!!last&&tradingMinute(asTime)-tradingMinute(last.time.replace(':',''))<=5;
 const released=!!opened&&quote.price>entryFloor&&last?.price>entryFloor&&synced;
 common.openTime=opened;common.sealed=priceEq(quote.price,entryFloor);
 add('opening','开板证据',released?'pass':sameMinute?'pending':'missing',sameMinute?`触板 ${touched?'有':'无'}；开板 ${opened||'未采样到'}；最新 ${last?.time||'—'}；现价 ${quote.price}`:'分时数据未读取或日期不一致','同日分时先采样到跌停价，后采样到高于跌停价，且报价和分时均未回封；采样滞后不超过5分钟','原话条件＋分时采样代理');
 // Context must be matched to this group, rather than inferring sector leadership from a name.
 const sector=context.sector,leader=context.leader,sectorQ=context.sectorQuote,leaderQ=context.leaderQuote;
 const sb=(sector||[]).filter(b=>validBar(b)&&dateOf(b.time)<=dateOf(red.time)).sort((a,b)=>dateOf(a.time).localeCompare(dateOf(b.time))),si=sb.length-1;
 const sectorUp=si>=25&&dateOf(sb.at(-1).time)===dateOf(red.time)&&sb[si].close>ma(sb,20,si)&&ma(sb,20,si)>ma(sb,20,si-5);
 const sectorRebound=sectorQ&&dateOf(sectorQ.sourceTime)===asOf&&sectorQ.price>sectorQ.previousClose&&sectorQ.previousClose>0;
 const leaderRebound=leaderQ&&dateOf(leaderQ.sourceTime)===asOf&&leaderQ.price>leaderQ.previousClose&&leaderQ.price>leaderQ.open&&leaderQ.previousClose>0;
 add('sector-history','板块此前上涨',!sector?'missing':sectorUp?'pass':'fail',sector?`${context.sectorName||'板块代表'}：红K同日收于上升MA20 ${sectorUp?'通过':'未通过或历史不足'}`:'未提供板块代表指数/ETF','红K同日板块代表收于上升MA20之上；代表行情仅为板块代理','原话背景＋工具代理');
 add('sector-now','板块正在反弹',!sectorQ?'missing':sectorRebound?'pass':'fail',sectorQ?`${sectorQ.name} ${sectorQ.price} / 昨收 ${sectorQ.previousClose} · ${sectorQ.sourceTime}`:'未提供同日板块代表报价','同日板块代表涨幅为正；不以个股开板替代板块反弹','原话条件＋工具代理');
 add('leader','龙头持续反弹',!leaderQ?'missing':leaderRebound?'pass':'fail',leaderQ?`${leaderQ.name} ${leaderQ.price} / 昨收 ${leaderQ.previousClose} / 开盘 ${leaderQ.open} · ${leaderQ.sourceTime}`:'未指定板块龙头','龙头同日价格高于昨收和开盘（代理）；持续性和遇阻需人工核对','原话条件＋工具代理');
 add('manual','板块归属与反弹确认',context.confirmed?'pass':'pending',context.confirmed?'已勾选本组人工确认':'尚未人工确认','人工确认本池同属所填板块、龙头身份、板块反弹及龙头未遇阻；不由程序猜测','原话条件·人工复核');
 const proxyPassed=sectorUp&&sectorRebound&&leaderRebound;
 const contextTimes=[sectorQ?.sourceTime,leaderQ?.sourceTime].every(t=>t&&String(t).slice(11,16).replace(':','')<=asTime&&Math.abs(tradingMinute(asTime)-tradingMinute(String(t).slice(11,16).replace(':','')))<=15);
 add('context-time','板块与龙头时效',contextTimes?'pass':'missing',contextTimes?'与个股同日，时点相差不超过15个交易分钟':'缺少同步报价或报价晚于个股时点','板块和龙头不能使用未来时点或过期报价','数据校验');
 if(common.sealed)return result('跌停回封 / 等待开板','现价仍在跌停价，不能假设可成交。',common);
 if(!released)return result(opened?'开板采样待同步':'开板待确认','未取得完整的分时触板→开板证据；单看日内高低价不能证明先后顺序。',common);
 if(!proxyPassed||!context.confirmed||!contextTimes)return result('已开板 · 板块条件待核','个股已采样到开板；板块、龙头或人工核对尚未齐备。',common);
 if(!currentSession)return result('历史形态 / 报价待更新','形态可复盘，但不把非本交易日或滞后报价作为当前信号。',common);
 return result('条件候选 · 仍需盯盘','量价时序、开板采样、板块代理和人工确认已齐备；不保证可成交或反弹延续。',{...common,eligible:true});
}
