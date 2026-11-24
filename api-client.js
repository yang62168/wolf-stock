(()=>{
  'use strict';
  const site='https://wolf-trading-notebook.companionablechipmunk.chatgpt.site';
  const configured=String(window.WOLF_API_BASE_URL||'').trim();
  const base=configured||(/^[a-z0-9-]+\.github\.io$/i.test(location.hostname)?site:'');
  if(base){const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('行情后端地址必须是HTTPS站点根地址');}
  function resolve(path){
    if(typeof path!=='string'||!path.startsWith('/api/'))throw new Error('仅支持/api/查询路径');
    const target=new URL(path,base||location.origin);
    if(!target.pathname.startsWith('/api/'))throw new Error('行情接口路径无效');
    return target.href;
  }
  window.WolfAPI={base,resolve,fetch(path,options={}){
    // Never send cookies or a Sites service credential from an external frontend.
    return window.fetch(resolve(path),{...options,mode:'cors',credentials:'omit'});
  }};
})();
