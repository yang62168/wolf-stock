import {ma} from './analytics.mjs';
import {closedBars} from './knight-engine.mjs';

const dateOf=t=>String(t).replace(/[- :]/g,'').slice(0,8);
const clockOf=t=>String(t).replace(/[- :]/g,'').slice(8,12);

// Source: 兰斯洛t（骑士佬）, 2026-09-03 11:53, worksheet cell B643.
// Numeric thresholds and the non-ordered bullish proxy are implementation choices.
export function knightDailySignal(daily,minutes,{breakVolume=1.2,pullVolume=.8,minBody=2,maxBias=2,now=new Date()}={}){
  if(![breakVolume,pullVolume,minBody,maxBias].every(Number.isFinite)||breakVolume<1||breakVolume>5||pullVolume<=0||pullVolume>1||minBody<=0||minBody>10||maxBias<=0||maxBias>10)throw new Error('日线55战法参数超出有效范围。');
  const ds=closedBars(daily,'day',now),ms=closedBars(minutes,'m15',now);
  if(ds.length<59||!ms.length)return {eligible:false,dailyUp:false,stage:'数据不足',reason:'日线模式需要至少59根完整日K及当前交易日完整15分K。'};
  const latest=ms.at(-1),session=dateOf(latest.time),dayIndex=ds.findIndex(b=>dateOf(b.time)===session),finished=dayIndex>=0;
  const history=ds.filter(b=>dateOf(b.time)<session),prior=history.at(-1);
  if(!prior||history.length<58)return {eligible:false,dailyUp:false,stage:'数据日期不匹配',reason:'缺少观察日之前的完整日线。',time:latest.time};
  const current=finished?ds[dayIndex]:null;
  const lineFor=price=>(history.slice(-54).reduce((s,b)=>s+b.close,0)+price)/55;
  const day55=current?ma(ds,55,dayIndex):lineFor(latest.close),price=current?.close??latest.close,bias=(price/day55-1)*100;
  const common={eligible:false,strategy:'daily',time:latest.time,dayTime:current?.time??prior.time,price,day55,bias,dailyUp:false,dailyCount:ds.length,minuteCount:ms.length,session};
  let setup=null;
  // Observation is the second or third trading session INCLUDING the breakout day.
  for(const offset of [1,2]){
    const i=history.length-offset,k=history[i];
    if(!k||i<57)continue;
    const line=ma(history,55,i),previous=ma(history,55,i-1),averages=[5,10,20].map(n=>ma(history,n,i));
    const bullish=averages.every((v,j)=>v>ma(history,[5,10,20][j],i-3)&&k.close>v);
    const averageVolume=history.slice(i-5,i).reduce((s,b)=>s+b.volume,0)/5,ratio=averageVolume>0?k.volume/averageVolume:0;
    if(bullish&&history[i-1].close<=previous&&k.close>line&&k.close>k.open&&(k.close/k.open-1)*100>=minBody&&ratio>=breakVolume){
      setup={breakTime:k.time,volumeRatio:ratio,ma5:averages[0],ma10:averages[1],ma20:averages[2],sessionNumber:offset+1};break;
    }
  }
  if(!setup)return {...common,stage:'等待日线突破',reason:'最近两个完整交易日未发现符合多头代理条件、放量大阳突破日MA55的结构。'};
  Object.assign(common,setup,{dailyUp:true});
  const today=ms.filter(b=>dateOf(b.time)===session),opening=today.filter(b=>clockOf(b.time)>='0945'&&clockOf(b.time)<='1000');
  const completeOpening=opening[0]&&clockOf(opening[0].time)==='0945';
  // Completed 15-minute candles only prove an opening-dip/reclaim proxy, never tick speed.
  if(completeOpening){
    const first=opening[0],firstLine=lineFor(first.close);
    const dip=first.open>=firstLine&&first.low<firstLine;
    const recovery=dip?opening.find(b=>b.close>lineFor(b.close)):null;
    const holds=recovery&&latest.close>lineFor(latest.close);
    if(holds&&bias>=0&&bias<=maxBias)return {...common,eligible:true,stage:'开盘回收代理符合',branch:'开盘快速下探回收（15分代理）',pullTime:first.time,confirmTime:recovery.time,reason:'突破后第'+setup.sessionNumber+'个交易日，首根15分K下探日55，10:00前完整15分收回，最新收盘仍在线上。',reasons:['5/10/20均线上行且突破收盘在三线上方，不限定三线彼此顺序',`日突破量 / 前5日均量 ${setup.volumeRatio.toFixed(2)}倍`,'仅为完整15分代理，需人工核对开盘真实速度、分时路径及大盘背景',`距日MA55 ${bias.toFixed(2)}%`]};
  }
  if(current&&current.close<day55){
    const ratio=prior.volume>0?current.volume/prior.volume:Infinity;
    if(ratio<=pullVolume&&Math.abs(bias)<=maxBias)return {...common,eligible:true,stage:'收盘缩量落线下',branch:'尾盘落在55下且日K缩量',pullTime:current.time,confirmTime:current.time,pullRatio:ratio,reason:'突破后第'+setup.sessionNumber+'个交易日，完整日K收盘在日55下方且较前一交易日缩量；尚不要求先收回55。',reasons:['仅使用收盘后的完整日K，盘中累计量不作缩量结论',`当日量 / 前一日量 ${ratio.toFixed(2)}倍`,`距日MA55 ${bias.toFixed(2)}%`,'这是原文第二种观察买点；后续回抽、止损及板块背景仍需核对']};
    return {...common,stage:'落线下但条件不足',reason:Math.abs(bias)>maxBias?'收盘偏离日55超过距离上限。':'完整日K未达到设定的较前日缩量条件。'};
  }
  return {...common,stage:'等待日线回踩',reason:finished?'已有日线突破，当前未满足两种回踩分支。':'已有日线突破；开盘回收代理未通过，尾盘缩量分支须等收盘后判断。'};
}
