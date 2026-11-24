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
    const point={date:snapshot.date,hhmm:snapshot.hhmm,amount:snapshot.amount};
    if(!this.previous){this.previous=point;return;}
    const gap=vMinute(point.hhmm)-vMinute(this.previous.hhmm);
    if(point.date!==this.previous.date||point.amount<this.previous.amount||gap>1||gap<0){this.reset();this.previous=point;return;}
    if(gap===0)return;
    const inc=point.amount-this.previous.amount;
    if(this.increment!==null){const state=inc>this.increment?'加速':inc<this.increment?'减速':this.state;if(state&&this.state&&state!==this.state)this.history.unshift({date:point.date,time:point.hhmm,from:this.state,to:state,increment:inc});this.history=this.history.slice(0,30);this.state=state;}
    this.lastIncrement=this.increment;this.increment=inc;this.previous=point;
  }
}
