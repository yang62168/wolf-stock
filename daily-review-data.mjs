import {symbol} from './analytics.mjs';

export const reviewIndices=[
  ['sh000001','上证指数'],['sz399001','深证成指'],['sz399006','创业板指'],['sh000688','科创50'],
];
export const broadEtfs=[
  ['sh510050','上证50ETF'],['sh510300','沪深300ETF'],['sh510500','中证500ETF'],
  ['sh512100','中证1000ETF'],['sz159915','创业板ETF'],['sh588000','科创50ETF'],
];

export function calendarBars(data){
  if(!Array.isArray(data?.bars))return [];
  return data.bars.filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.time)&&Number.isFinite(row.close)&&row.close>0);
}

export function dailyPerformance(bars,date){
  const index=bars.findIndex(bar=>bar.time===date);
  if(index<1)return null;
  const bar=bars[index],base=bars[index-1].close;
  return {...bar,change:(bar.close/base-1)*100,lowChange:Number.isFinite(bar.low)?(bar.low/base-1)*100:null,
    amplitude:Number.isFinite(bar.high)&&Number.isFinite(bar.low)?(bar.high-bar.low)/base*100:null};
}

export function reviewBenchmark(code){
  if(/^sh60[0135]/.test(code))return ['sh000002','上证A股指数'];
  if(/^sz00[0-3]/.test(code))return ['sz399107','深证A股指数'];
  if(/^sz30[012]/.test(code))return ['sz399102','创业板综指'];
  if(/^sh68[89]/.test(code))return ['sh000688','科创50'];
  return null;
}

export function deviationWindows(stock,index,date){
  const sessions=index.filter(row=>row.time<=date);
  if(sessions.at(-1)?.time!==date)return [];
  const closes=new Map(stock.map(row=>[row.time,row.close]));
  const final=closes.get(date), indexFinal=sessions.at(-1).close;
  if(!(final>0))return [];
  return [[10,100],[30,200]].flatMap(([window,limit])=>{
    if(sessions.length<=window)return [];
    const interval=sessions.slice(-window-1);
    if(interval.some(row=>!(closes.get(row.time)>0)))return [];
    let closest=null;
    for(let days=1;days<=window;days++){
      const start=interval[window-days];
      const base=closes.get(start.time);
      const indexRatio=indexFinal/start.close;
      const deviation=(final/base-indexRatio)*100;
      const distance=((limit/100+indexRatio)*base/final-1)*100;
      if(!closest||distance<closest.distance)closest={window,limit,days,deviation,distance};
    }
    return [closest];
  });
}

export function normalizeReviewSymbols(values){
  const rows=new Map();
  for(const value of values){
    const raw=typeof value==='string'?value:value?.symbol;
    const token=typeof raw==='string'?raw.trim():'';
    const suffix=/^(\d{6})\.(SH|SZ|BJ)$/i.exec(token);
    const code=symbol(suffix?suffix[2]+suffix[1]:token);
    if(code&&!rows.has(code))rows.set(code,{symbol:code,name:typeof value==='object'?String(value.name||'').slice(0,40):''});
  }
  return [...rows.values()];
}

function isMinute(time){
  return /^(?:09:[3-5]\d|10:[0-5]\d|11:(?:[0-2]\d|30)|1[34]:[0-5]\d|15:00)$/.test(time);
}

function minuteAmounts(points){
  const amounts=new Map();
  let before=null;
  for(const point of points){
    if(!isMinute(point.time))continue;
    const amount=point.amount;
    if(Number.isFinite(amount)&&amount>=0){
      if(point.time==='09:30')amounts.set(point.time,amount);
      if(before&&amount>=before.amount){
        const minute=label=>Number(label.slice(0,2))*60+Number(label.slice(3));
        if(minute(point.time)-minute(before.time)===1)amounts.set(point.time,amount-before.amount);
      }
    }
    before=Number.isFinite(amount)&&amount>=0?point:null;
  }
  return amounts;
}

export function etfTimeline(index,funds,date){
  const expected=date.replaceAll('-','');
  if(index?.date!==expected||!Array.isArray(index.points)||!funds.length||funds.some(fund=>fund?.date!==expected||!Array.isArray(fund.points)))return [];
  const amounts=funds.map(fund=>minuteAmounts(fund.points));
  const prices=new Map(index.points.filter(point=>isMinute(point.time)&&Number.isFinite(point.price)).map(point=>[point.time,point.price]));
  const points=[];
  for(const [start,end] of [[570,690],[780,900]])for(let minute=start;minute<=end;minute++){
    const time=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
    const samples=amounts.map(series=>series.get(time));
    points.push({time,price:prices.get(time)??null,amount:samples.every(Number.isFinite)?samples.reduce((a,b)=>a+b,0):null});
  }
  return points;
}

export async function reviewPool(items,workers,task,signal){
  const results=new Array(items.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(workers,items.length)},async()=>{
    while(next<items.length&&!signal.aborted){
      const index=next++;
      try{results[index]=await task(items[index]);}
      catch{results[index]=null;}
    }
  }));
  return results;
}
