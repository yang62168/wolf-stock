(()=>{
  'use strict';
  const sources={
    experience:{key:'waves',title:'🐺 狼大经验总结',description:'把已经验证过的浪型判断与点位推演方法沉淀成可复用条目 —— 每一条都保留他当时的原话口径、数字与作废条件。',meta:'共 3 条 · 更新 2026-11-04'},
    trade:{key:'notes',title:'📘 狼大交易笔记',description:'整篇导入的交易方法论 —— 复盘思路、做 T、止盈止损、调仓、趋势波段、龙头甄选、焚诀、科创 ETF、金玉良言与年终总结。',meta:'共 18 章 · 语料补充 2026-11-24'},
    knight:{key:'knight',title:'🗡️ 骑士 55 战法',description:'兰斯洛t（兰骑士）· 55 线趋势战法完全手册',meta:'共 14 节 · 语料补充 2026-11-17'}
  };
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function readingDirectory(data,prefix){return `<nav class="reading-toc" id="reading-toc" aria-label="本页目录"><details open><summary><strong>本页目录</strong><span>共 ${data.articles.length} 篇 · 点击标题跳转</span></summary><ol>${data.articles.map((article,index)=>`<li><a href="#${prefix}-${index+1}"><span class="toc-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><span>${escape(article.title)}</span></a></li>`).join('')}</ol></details></nav>`;}
  for(const [tab,source] of Object.entries(sources)){const count=window.ORIGINAL[source.key].articles.length;source.meta=source.meta.replace(/共\s*\d+/,'共 '+count);const badge=document.querySelector(`[data-tab="${tab}"] span`);if(badge)badge.textContent=count;}
  let workspace,renderId=0;
  function navigate(path){history.pushState({},'',path);render();window.scrollTo(0,0);document.getElementById('navMenu').hidden=true;document.getElementById('menu').setAttribute('aria-expanded','false');}
  async function render(){
    const own=++renderId;window.MarketApp?.unmount();workspace?.unmount();
    const tab=new URLSearchParams(location.search).get('tab')||'overview',isCollection=Object.hasOwn(sources,tab),isResearch=tab==='search'||tab==='fish';
    let page;if(!isCollection&&!isResearch&&tab!=='market'){workspace=await import('./workspace.mjs?v=overview1');if(own!==renderId)return;page=workspace.pages[tab];}
    const s=tab==='market'||tab==='technical'?{key:'market',title:tab==='technical'?'◩ 技术分析图表':'📈 行情中心',description:'查看 A 股、ETF 与主要指数的最新报价，对照均线观察趋势与节奏。',meta:'报价自动刷新 · 非交易时段展示最近一次行情'}:tab==='search'?{title:'🔎 全文检索与出处',description:'按关键词和作者查阅正文、原材料摘录与整理说明。',meta:'原文、解读与工具参数分别展示'}:tab==='fish'?{title:'🐟 鱼大专栏',description:'鱼大独立归属；本人原话确认后按来源收录。',meta:'已建立专栏 · 本人确认条目 '+window.RESEARCH_DATA.fish.confirmed.length}:page?{title:page[0],description:page[1],meta:'分析工具 · 数据时间以来源为准'}:sources[tab]||sources.experience;
    document.querySelectorAll('[data-tab]').forEach(a=>{const selected=a.dataset.tab===tab||(a.dataset.tab==='experience'&&!isCollection&&!isResearch&&!page&&tab!=='market');a.classList.toggle('active',selected);if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    document.title=s.title+' · 股票分析系统';document.getElementById('banner').innerHTML=`<span class="watermark" aria-hidden="true">${tab==='fish'?'🐟':'🐺'}</span><h1>${escape(s.title)}</h1><p>${escape(s.description)}</p><small>${escape(s.meta)}</small>`;
    document.getElementById('banner').hidden=tab==='overview';
    const content=document.getElementById('content'),tools=document.getElementById('readingTools');tools.hidden=true;
    if(tab==='market'||tab==='technical'){window.MarketApp.mount(content);return;}
    if(page){workspace.mount(content,tab);return;}
    content.className='';window.Research.toolbar(tools,navigate);
    if(tab==='search'){window.Research.searchPage(content);return;}
    if(tab==='fish'){window.Research.fishPage(content);return;}
    const d=window.ORIGINAL[s.key],prefix=s.key==='notes'?'tn':s.key==='knight'?'kn':'exp';
    content.innerHTML=readingDirectory(d,prefix)+d.intro+d.articles.map((a,i)=>`<article class="article" id="${prefix}-${i+1}"><header class="article-heading"><span class="number">${a.number}</span><div class="heading-content"><h2>${escape(a.title)}</h2><div class="metadata">${s.key==='waves'?'▧':s.key==='knight'?'◉':'▣'} ${escape(a.metadata)}</div></div></header>${window.Research.sourcePanel(a.id)}<div class="article-body">${a.html}</div></article>`).join('')+'<a class="reading-toc-return" href="#reading-toc" aria-label="返回本页目录">☷ 目录 ↑</a>';
    window.Research.decorate(content);
    if(location.hash){const el=document.getElementById(location.hash.slice(1));if(el)requestAnimationFrame(()=>el.scrollIntoView());}
  }
  document.addEventListener('click',e=>{const a=e.target.closest('a[href^="?tab="]');if(!a||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(a.getAttribute('href'));});
  document.getElementById('menu').onclick=()=>{const menu=document.getElementById('navMenu');menu.hidden=!menu.hidden;document.getElementById('menu').setAttribute('aria-expanded',String(!menu.hidden));};
  window.addEventListener('popstate',render);render();
})();
