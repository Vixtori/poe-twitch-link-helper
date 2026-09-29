// Runs only on PoE connections, in the page world. No credentials are read here.
(() => {
  'use strict';
  const originalConfirm=window.confirm;
  let armed=null;
  window.addEventListener('click',event=>{
    if(location.hostname!=='www.pathofexile.com' || !/^\/my-account\/connections\/?$/.test(location.pathname)) return;
    const button=event.target.closest?.('[data-poe-queue-unlink]');
    if(!button || !/^(?:Remove|Disconnect|Unlink|Remove Connection)$/i.test(button.innerText.trim())) return;
    let expected;
    try {expected=JSON.parse(button.getAttribute('data-poe-queue-unlink'));} catch {return;}
    if(!/^[a-z0-9_]{3,25}$/i.test(expected.username || '') || !/^.{1,80}#\d{4}$/.test(expected.poeAccount || '')) return;
    const header=(document.body.innerText || '').match(/\bLogged in as\s+([^\n\r#<>]{1,80}#\d{4})(?!\d)/i);
    if(!header || header[1].trim().toLowerCase()!==expected.poeAccount.toLowerCase()) return;
    let row=button.parentElement,matched=false;
    for(let i=0;row && row!==document.body && i<6;i++,row=row.parentElement) {
      const text=row.innerText || '';
      if(/\b(?:Steam|Microsoft|Sony|PlayStation|Xbox|Epic Games|Email)\b/i.test(text)) break;
      const user=text.match(/(?:^|\s)Twitch\s*\(\s*([a-z0-9_]{3,25})\s*\)/i);
      if(user && user[1].toLowerCase()===expected.username.toLowerCase()){matched=true;break;}
    }
    if(!matched)return;
    const token={};armed=token;
    // Permit only a synchronous confirmation belonging to this one verified Remove click.
    queueMicrotask(()=>{if(armed===token)armed=null;});
  },true);
  window.confirm=function(message){
    const text=String(message).trim();
    const twitchRemoval=/\btwitch\b/i.test(text) && /\b(?:remove|unlink|disconnect)\b|отвяз|удалить связь/i.test(text);
    const genericConnection=/^Are you sure (?:that )?you want to (?:remove|unlink|disconnect) (?:this|the) (?:account|connection|link)\??$/i.test(text);
    if(armed && (twitchRemoval || genericConnection)) {armed=null;return true;}
    return originalConfirm.call(window,message);
  };
})();
