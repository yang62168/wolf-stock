// Independent implementation of the documented MarketVolume methodology.
export const V_MARKETS = [{symbol:'sh000001',name:'沪市'}, {symbol:'sz399106',name:'深市'}, {symbol:'bj899050',name:'北证50参考'}];
export const vNumber = value => value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function vClock(now = new Date()) {
  const text = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now);
  return {date:text.slice(0,10),hhmm:text.slice(11,16).replace(':',''),text};
}
export function vMinute(hhmm) {return Number(hhmm.slice(0,2))*60+Number(hhmm.slice(2));}
export function vTradingMinute(hhmm) {
  const t=vMinute(hhmm);return Math.max(0,Math.min(120,t-570))+Math.max(0,Math.min(120,t-780));
}
export function vParseDaily(payload, symbol) {
  const node=payload?.data?.[symbol],rows=node?.day||node?.qfqday;
  if(!Array.isArray(rows))throw new Error('日线基准不可用');
  return [...new Map(rows.flatMap(r=>{
    const amount=vNumber(r[8]),volume=vNumber(r[5]);
    return /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && amount!==null && amount>=0 && volume!==null && volume>=0 ? [[r[0],{date:r[0],amount:amount*10000,volume}]]:[];
  })).values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function vParseIntraday(payload,symbol) {
  const days=payload?.data?.[symbol]?.data;
  if(!Array.isArray(days))throw new Error('五日分时基准不可用');
  return days.flatMap(day=>{
    if(!/^\d{8}$/.test(day.date)||!Array.isArray(day.data))return [];
    const map=new Map();
    for(const raw of day.data){
      const f=String(raw).trim().split(/\s+/),hhmm=f[0],amount=vNumber(f[3]),volume=vNumber(f[2]);
      if(!/^\d{4}$/.test(hhmm)||!((hhmm>='0930'&&hhmm<='1130')||(hhmm>='1300'&&hhmm<='1500'))||volume===null||volume<0||amount!==null&&amount<0)continue;
      const prev=map.get(hhmm);
      if(!prev||(amount??volume)>=(prev.amount??prev.volume))map.set(hhmm,{hhmm,amount,volume});
    }
    const rows=[...map.values()].sort((a,b)=>a.hhmm.localeCompare(b.hhmm));
    // Reject a corrupt cumulative curve rather than inventing negative flow.
    if(rows.some((r,i)=>i>0&&(r.volume<rows[i-1].volume||r.amount!==null&&rows[i-1].amount!==null&&r.amount<rows[i-1].amount)))return [];
    return [{date:day.date.slice(0,4)+'-'+day.date.slice(4,6)+'-'+day.date.slice(6),rows}];
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
export function vAt(rows,hhmm){return rows.findLast(r=>r.hhmm<=hhmm)||null;}
export function vParseMinuteVolume(payload,symbol){
  const rows=payload?.data?.[symbol]?.m1;
  if(payload?.code!==undefined&&payload.code!==0||!Array.isArray(rows))throw new Error('1分钟K线源未返回有效数据');
  const unique=new Map();
  for(const r of rows){
    const ts=String(r?.[0]||'');
    if(!/^\d{12}$/.test(ts))throw new Error('1分钟K线时间格式异常');
    const date=ts.slice(0,4)+'-'+ts.slice(4,6)+'-'+ts.slice(6,8),hhmm=ts.slice(8),volume=vNumber(r[5]);
    const parsed=new Date(date+'T00:00:00Z');
    if(!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==date||!((hhmm>='0930'&&hhmm<='1130')||(hhmm>='1300'&&hhmm<='1500'))||Number(hhmm.slice(2))>59)throw new Error('1分钟K线包含非法交易时间');
    if(volume===null||volume<0)throw new Error('1分钟成交量缺失或异常');
    // r[5] is the interval volume in lots, not a cumulative total. Last revision wins.
    unique.set(ts,{date,hhmm,volume});
  }
  return [...unique.values()].sort((a,b)=>(a.date+a.hhmm).localeCompare(b.date+b.hhmm));
}
function vExpectedMinutes(){
  const times=[];for(const [start,end]of [[571,690],[781,900]])for(let n=start;n<=end;n++)times.push(String(Math.floor(n/60)).padStart(2,'0')+String(n%60).padStart(2,'0'));return times;
}
export function vCompareMinuteVolume(quotes,histories,{previousDate=null,now=new Date()}={}){
  const scope=['sh000001','sz399106'],base={scope:'hs',source:'腾讯1分钟K线 · m1（单分钟成交量累加）',volumeUnit:'手',complete:false,date:null,hhmm:null,previousDate:null,current:null,previous:null,previousTotal:null,ratio:null,difference:null,forecast:null,state:'待基准',markets:[],warnings:[]};
  const qs=scope.map(s=>quotes.find(q=>q.symbol===s));
  if(qs.some(q=>!q||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(q.sourceTime||'')||!Number.isFinite(q.volume)||q.volume<0))return {...base,warnings:['沪深实时报价缺少有效累计成交量或时间']};
  const dates=qs.map(q=>q.sourceTime.slice(0,10)),times=qs.map(q=>q.sourceTime.slice(11,16).replace(':',''));
  if(new Set(dates).size!==1||new Set(times).size!==1)return {...base,warnings:['沪深报价日期或分钟不一致，等待同一分钟数据']};
  const clock=vClock(now),date=dates[0],hhmm=times[0];
  if(date>clock.date)return {...base,warnings:['报价日期晚于当前北京时间']};
  const phase=date!==clock.date?'historical':clock.hhmm<'0930'?'preopen':clock.hhmm>='1500'&&hhmm>='1500'?'closed':clock.hhmm>='1130'&&clock.hhmm<'1300'?'lunch':'trading';
  const delayed=phase==='trading'&&qs.some(q=>(now-new Date(q.sourceTime.replace(' ','T')+'+08:00'))/1000>180);
  Object.assign(base,{date,hhmm,phase,delayed,current:hhmm<'0930'||phase==='preopen'?null:qs.reduce((s,q)=>s+q.volume,0)});
  if(base.current===null)return {...base,warnings:['未开盘，不将竞价或上一交易日的量当作今日连续交易成交量']};
  if(hhmm>='1500')base.forecast=base.current;
  const previousDays=scope.map(s=>[...new Set((histories[s]||[]).filter(r=>r.date<date).map(r=>r.date))].sort().at(-1));
  if(previousDays.some(d=>!d)||new Set(previousDays).size!==1||previousDate&&previousDays[0]!==previousDate)return {...base,warnings:['未取得与上一交易日一致的沪深1分钟基准']};
  base.previousDate=previousDays[0];
  const expected=vExpectedMinutes(),cutoff=hhmm>='1500'?'1500':hhmm>='1130'&&hhmm<'1300'?'1130':hhmm;
  const perMarket=scope.map((s,i)=>{
    const rows=(histories[s]||[]).filter(r=>r.date===base.previousDate),map=new Map(rows.map(r=>[r.hhmm,r]));
    const missing=expected.filter(t=>!map.has(t));
    // Missing minutes are unknown, not zero; never compare the first N returned rows.
    const full=missing.length===0,total=full?rows.reduce((n,r)=>n+r.volume,0):null;
    const prior=full?rows.filter(r=>r.hhmm<=cutoff).reduce((n,r)=>n+r.volume,0):null;
    return {symbol:s,name:i?'深市':'沪市',current:qs[i].volume,previous:prior,previousTotal:total,complete:full,missingMinutes:missing.length};
  });
  base.markets=perMarket;
  if(perMarket.some(m=>!m.complete))return {...base,warnings:perMarket.filter(m=>!m.complete).map(m=>m.name+'上一交易日1分钟K线缺少'+m.missingMinutes+'个交易分钟，不生成不完整对比')};
  const previous=perMarket.reduce((n,m)=>n+m.previous,0),total=perMarket.reduce((n,m)=>n+m.previousTotal,0),ratio=previous>0?base.current/previous:null;
  const forecast=hhmm>='1500'?base.current:ratio!==null&&total>0&&vTradingMinute(hhmm)>=8?base.current*total/previous:null;
  return {...base,complete:true,previous,previousTotal:total,ratio,difference:base.current-previous,forecast,state:ratio===null?'基准为零':ratio>=1.03?'放量':ratio<=.97?'缩量':'平量'};
}
export function vAnalyze(quote,daily,days,{now=new Date(),estimate=false}={}) {
  const clock=vClock(now),date=quote.sourceTime?.slice(0,10),hhmm=quote.sourceTime?.slice(11,16).replace(':','');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d{4}$/.test(hhmm||'')||date>clock.date||quote.amount===null||!(quote.amount>=0))throw new Error('报价缺少有效金额或交易时间');
  const historical=date!==clock.date,phase=historical?'historical':clock.hhmm<'0930'?'preopen':clock.hhmm>='1500'&&hhmm>='1500'?'closed':clock.hhmm>='1130'&&clock.hhmm<'1300'?'lunch':'trading';
  const prev=daily.filter(r=>r.date<date).at(-1),yesterday=prev?days.find(d=>d.date===prev.date):null;
  const end=yesterday?.rows.find(r=>r.hhmm==='1500'),point=vAt(yesterday?.rows||[],hhmm);
  const estimateRow=r=>({...r,amount:r.amount??(estimate&&end?.volume>0&&prev?.amount>0?prev.amount*r.volume/end.volume:null)});
  const previousCurve=(yesterday?.rows||[]).map(estimateRow),baseline=point?estimateRow(point):null;
  const fullDay=hhmm>='1500',preopen=phase==='preopen'||hhmm<'0930';
  // Exact-time alignment: allow only the lunch gap or a <=2 minute provider gap.
  const aligned=baseline&&(vTradingMinute(hhmm)-vTradingMinute(baseline.hhmm)<=2);
  const previousAmount=preopen?null:fullDay?prev?.amount??null:aligned?baseline.amount:null;
  const previousVolume=preopen?null:fullDay?prev?.volume??null:aligned?baseline.volume:null;
  const ratio=previousAmount>0?quote.amount/previousAmount:null;
  let forecast=null;
  if(!preopen&&fullDay)forecast=quote.amount;
  else if(previousAmount>0&&prev?.amount>0&&vTradingMinute(hhmm)>=8)forecast=quote.amount*prev.amount/previousAmount;
  const currentCurve=(days.find(d=>d.date===date)?.rows||[]).map(r=>({...r,amount:r.amount??null})).filter(r=>r.hhmm<=hhmm);
  const ageSeconds=Math.max(0,(now-new Date(quote.sourceTime.replace(' ','T')+'+08:00'))/1000);
  const estimated=!!(estimate&&baseline&&point?.amount===null&&previousAmount!==null&&!fullDay);
  return {symbol:quote.symbol,name:quote.name,price:quote.price,changePercent:quote.changePercent,date,hhmm,phase,sourceTime:quote.sourceTime,ageSeconds,delayed:!historical&&phase==='trading'&&ageSeconds>180,amount:quote.amount,volume:quote.volume,previousDate:prev?.date??null,previousTotal:prev?.amount??null,previousAmount,previousVolume,volumeRatio:previousVolume>0?quote.volume/previousVolume:null,ratio,difference:previousAmount!==null?quote.amount-previousAmount:null,forecast,state:ratio===null?'待基准':ratio>=1.03?'放量':ratio<=.97?'缩量':'平量',estimated,previousCurve,currentCurve,baselineTime:baseline?.hhmm??null};
}
export function vAggregate(rows,symbols) {
  const chosen=symbols.map(s=>rows.find(r=>r.symbol===s)),available=chosen.filter(Boolean);
  const dates=new Set(available.map(r=>r.date)),times=available.map(r=>vMinute(r.hhmm));
  const complete=available.length===symbols.length&&dates.size===1&&Math.max(...times)-Math.min(...times)<=2;
  const sum=key=>complete&&chosen.every(r=>Number.isFinite(r[key]))?chosen.reduce((s,r)=>s+r[key],0):null;
  const amount=sum('amount'),previousAmount=sum('previousAmount'),previousTotal=sum('previousTotal');
  // All comparison dates must agree: never mix yesterday with an earlier session.
  const comparable=complete&&new Set(chosen.map(r=>r.previousDate)).size===1&&chosen.every(r=>r.previousDate);
  const base=comparable?previousAmount:null,ratio=amount!==null&&base>0?amount/base:null;
  const closed=complete&&chosen.every(r=>r.hhmm>='1500');
  const forecast=closed?amount:ratio!==null&&previousTotal>0&&chosen.every(r=>r.forecast!==null)?amount*previousTotal/base:null;
  const curve=key=>{
    if(!complete)return [];
    const maps=chosen.map(r=>new Map(r[key].map(p=>[p.hhmm,p.amount])));
    return [...maps[0]].flatMap(([hhmm])=>maps.every(m=>Number.isFinite(m.get(hhmm)))?[{hhmm,amount:maps.reduce((s,m)=>s+m.get(hhmm),0)}]:[]);
  };
  return {complete,amount,previousAmount:base,previousTotal:comparable?previousTotal:null,ratio,difference:ratio!==null?amount-base:null,forecast,state:ratio===null?'待基准':ratio>=1.03?'放量':ratio<=.97?'缩量':'平量',date:complete?chosen[0].date:null,previousDate:comparable?chosen[0].previousDate:null,hhmm:complete?[...chosen].sort((a,b)=>a.hhmm.localeCompare(b.hhmm))[0].hhmm:null,phase:complete?chosen[0].phase:null,delayed:chosen.some(r=>r?.delayed),estimated:chosen.some(r=>r?.estimated),currentCurve:curve('currentCurve'),previousCurve:comparable?curve('previousCurve'):[],missing:symbols.filter((s,i)=>!chosen[i])};
}
export class VolumePace {
  constructor(){this.reset();this.history=[];}
  reset(){this.previous=null;this.lastIncrement=null;this.increment=null;this.state=null;}
  update(snapshot){
    if(!snapshot?.complete||snapshot.phase!=='trading'||snapshot.delayed||snapshot.amount===null){this.reset();return;}
    const point={date:snapshot.date,hhmm:snapshot.hhmm,amount:snapshot.amount,source:snapshot.source};
    if(!this.previous){this.previous=point;return;}
    const gap=vMinute(point.hhmm)-vMinute(this.previous.hhmm);
    if(point.date!==this.previous.date||point.source!==this.previous.source||point.amount<this.previous.amount||gap>1||gap<0){this.reset();this.previous=point;return;}
    if(gap===0)return;
    const inc=point.amount-this.previous.amount;
    if(this.increment!==null){const state=inc>this.increment?'加速':inc<this.increment?'减速':this.state;if(state&&this.state&&state!==this.state)this.history.unshift({date:point.date,time:point.hhmm,from:this.state,to:state,increment:inc});this.history=this.history.slice(0,30);this.state=state;}
    this.lastIncrement=this.increment;this.increment=inc;this.previous=point;
  }
}
