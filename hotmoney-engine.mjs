export const TRADERS=[
 {id:'zhang',name:'章盟主',seatIds:['10025080'],aliases:['国泰海通证券股份有限公司上海长宁区江苏路证券营业部','国泰海通证券股份有限公司上海江苏路证券营业部','国泰君安证券股份有限公司上海江苏路证券营业部'],sources:[{label:'外部席位关联资料',url:'https://www.zhunshangshi.com/hm/%E7%AB%A0%E7%9B%9F%E4%B8%BB/?page=1'}]},
 {id:'xinyi',name:'作手新一',seatIds:['10025054'],aliases:['国泰海通证券股份有限公司南京太平南路证券营业部','国泰君安证券股份有限公司南京太平南路证券营业部'],sources:[{label:'每经报道：疑似代表席位',url:'https://www.nbd.com.cn/articles/2020-01-11/1399811.html'},{label:'外部近期关联资料',url:'https://www.kanpanba.com/lhb/trader/%E4%BD%9C%E6%89%8B%E6%96%B0%E4%B8%80'}]}
];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function disclosurePeriod(reason=''){
 const text=String(reason),multi=/连续|累计|异常波动期间|交易异常波动/.test(text);
 if(multi){const found=/(?:连续)?\s*(\d+|[一二三四五六七八九十]+)\s*(?:个)?交易日/.exec(text);const nums={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,二十:20,三十:30};const days=found?Number(found[1])||nums[found[1]]||null:null;return {kind:'multi',days,label:days?`${days}日累计榜`:'多日累计榜',key:days?'multi-'+days:'multi-unknown'};}
 if(/当日|日收盘|日价格|日换手|日振幅|日涨幅|日跌幅|首个交易日|上市首日|首日/.test(text))return {kind:'day',days:1,label:'单日榜',key:'day'};
 return {kind:'unknown',days:null,label:'口径待核',key:'unknown'};
}
export function traderTags(row){return TRADERS.filter(t=>t.seatIds.includes(row.seatId)||t.aliases.includes(row.seatName)).map(t=>t.id)}
export function prepareBillboard(rows){
 const exact=new Map(),groups=new Map();
 for(const row of rows){const period=disclosurePeriod(row.reason),base=JSON.stringify([row.date,row.symbol,row.seatId,period.key,period.kind==='unknown'||period.key==='multi-unknown'?row.reason:'']),key=JSON.stringify([base,row.buy,row.sell,row.net]);
  if(exact.has(key)){const record=exact.get(key);if(!record.reasons.includes(row.reason))record.reasons.push(row.reason);record.sourceCount++;continue}
  const item={...row,period,reasons:[row.reason],sourceCount:1,tags:traderTags(row),conflict:false,key};exact.set(key,item);const group=groups.get(base)||[];group.push(item);groups.set(base,group);
 }
 for(const group of groups.values())if(group.length>1)for(const record of group)record.conflict=true;
 return [...exact.values()];
}
export function filterBillboard(rows,{trader='tracked',period='day',query='',favorites=[]}={}){
 const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 return rows.filter(r=>(trader==='all'||trader==='tracked'&&r.tags.length>0||trader==='favorites'&&favorites.some(f=>f.seatId===r.seatId)||r.tags.includes(trader))&&(period==='all'||r.period.kind===period)&&words.every(word=>[r.name,r.code,r.symbol,r.seatName,...r.tags.map(id=>TRADERS.find(t=>t.id===id)?.name||'')].join(' ').toLowerCase().includes(word)));
}
export function summarizeBillboard(rows){
 const kinds=new Set(rows.map(r=>r.period.key)),mixed=kinds.size>1||rows.some(r=>r.period.kind==='unknown'||r.period.key==='multi-unknown');
 const usable=rows.filter(r=>!r.conflict),sums={};for(const field of ['buy','sell','net']){const known=usable.filter(r=>finite(r[field]));sums[field]={value:known.length?known.reduce((sum,r)=>sum+r[field],0):null,known:known.length,total:usable.length,complete:known.length===usable.length&&usable.length>0};}
 return {rows:rows.length,stocks:new Set(rows.map(r=>r.symbol)).size,seats:new Set(rows.map(r=>r.seatId)).size,mixed,conflicts:rows.filter(r=>r.conflict).length,sums};
}
export function sortBillboard(rows,order='net-desc'){
 const [field,direction]=order==='buy-desc'?['buy',-1]:order==='sell-desc'?['sell',-1]:order==='net-asc'?['net',1]:['net',-1];
 return [...rows].sort((a,b)=>finite(a[field])&&finite(b[field])?(a[field]-b[field])*direction||a.symbol.localeCompare(b.symbol):finite(a[field])?-1:finite(b[field])?1:a.symbol.localeCompare(b.symbol));
}
export function commonBillboardKeys(rows){
 const groups=new Map();for(const row of rows){if(row.conflict||row.period.kind==='unknown'||row.period.key==='multi-unknown')continue;const key=JSON.stringify([row.date,row.symbol,row.period.key]),tags=groups.get(key)||new Set();row.tags.forEach(tag=>tags.add(tag));groups.set(key,tags)}
 return new Set([...groups].filter(([,tags])=>tags.size>1).map(([key])=>key));
}
