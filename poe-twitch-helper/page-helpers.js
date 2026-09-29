// Shared by the isolated content script and offline regression tests.
var PoeQueuePage = (() => {
  'use strict';
  const clean = value => String(value || '').replace(/\u00a0/g,' ').trim();
  function accountName(value) {
    const name = clean(value);
    return /^[^\n\r#<>]{1,80}#\d{4}$/.test(name) ? name : '';
  }
  function identity({text = '', profileTexts = [], profileUrls = []} = {}) {
    const strong = [];
    // Read the visible signed-in name. Profile URLs do not necessarily use '#'.
    for (const pattern of [/\bLogged in as\s+([^\n\r#<>]{1,80}#\d{4})(?!\d)/gi,
      /\bSocial Connections for\s+([^\n\r#<>]{1,80}#\d{4})(?!\d)/gi]) {
      for (const m of String(text).matchAll(pattern)) strong.push(accountName(m[1]));
    }
    const strongNames = [...new Map(strong.filter(Boolean).map(n=>[n.toLowerCase(),n])).values()];
    if (strongNames.length > 1) return {name:'',conflict:true,source:'visible'};
    if (strongNames.length === 1) return {name:strongNames[0],conflict:false,source:'visible'};
    const names = profileTexts.map(accountName).filter(Boolean);
    if (!names.length) for (const href of profileUrls) {
      try {
        const u = new URL(href); const part=u.pathname.split('/account/view-profile/')[1];
        if (part) names.push(accountName(decodeURIComponent(part.split('/')[0]) + (/^#\d{4}$/.test(u.hash) ? u.hash : '')));
      } catch { /* Ignore malformed profile links. */ }
    }
    const unique = [...new Map(names.filter(Boolean).map(n=>[n.toLowerCase(),n])).values()];
    return {name:unique.length===1 ? unique[0] : '',conflict:unique.length>1,source:'profile'};
  }
  function twitchRow(text, actionCount) {
    const t=clean(text).replace(/\s+/g,' ');
    return actionCount===1 && t.length<=1500 &&
      !/\b(?:Steam|Microsoft|Sony|PlayStation|Xbox|Epic Games|Email)\b/i.test(t) &&
      /(?:^|\s)Twitch(?=[:\s(]|$)/i.test(t);
  }
  function connectionAction(label) {
    const t=clean(label);
    if(/^(?:Connect|Link)$/i.test(t)) return 'connect';
    if(/^(?:Remove|Disconnect|Unlink|Remove Connection)$/i.test(t)) return 'unlink';
    return '';
  }
  function linkedTwitch(text, urls=[]) {
    const names=[];
    for(const href of urls) {
      try {
        const u=new URL(href);
        if(/^https:\/\/(?:www\.)?twitch\.tv$/.test(u.origin) && /^\/[a-z0-9_]{3,25}\/?$/i.test(u.pathname)) {
          const name=u.pathname.replaceAll('/','');
          if(!['settings','directory','login','drops'].includes(name.toLowerCase())) names.push(name);
        }
      } catch { /* A relative or unrelated link is not an identity signal. */ }
    }
    const m=String(text).match(/(?:^|\s)Twitch\s*\(\s*([a-z0-9_]{3,25})\s*\)/i);
    if(m) names.push(m[1]);
    const unique=[...new Map(names.map(n=>[n.toLowerCase(),n])).values()];
    return unique.length===1 ? unique[0] : '';
  }
  function activationLabel(label) {
    return /^(?:Активировать|Activate|Claim(?: now)?|Получить(?: сейчас)?|Redeem)(?:\s*\(?\d+\s*(?:s|sec|сек\.?|секунд[уы]?)?\)?)?$/i.test(clean(label));
  }
  function emailReminder(text, laterLabel) {
    const t=clean(text);
    return /^(?:Напомнить позже|Remind me later|Remind later)$/i.test(clean(laterLabel)) &&
      /(?:подтверд[^\n]{0,45}(?:почт|email)|(?:verify|confirm)[^\n]{0,45}(?:e-?mail)|email verification)/i.test(t) &&
      !/(?:captcha|authenticator|two.factor|двухфактор|аутентификатор)/i.test(t);
  }
  function emailChoice({text,laterLabel,laterEnabled,closeEnabled}) {
    if (!emailReminder(text,laterLabel)) return '';
    return laterEnabled ? 'later' : closeEnabled ? 'close' : '';
  }
  function oauthContext(page,text) {
    const empty={consent:false,poeApp:false,currentUser:''};
    try {
      const u=new URL(page);
      if (u.origin!=='https://id.twitch.tv' || !/^\/oauth2\/(?:authorize|consent)\/?$/.test(u.pathname)) return empty;
      let poeApp=false;
      try {
        const redirect=new URL(u.searchParams.get('redirect_uri'));
        poeApp=redirect.origin==='https://www.pathofexile.com' && !redirect.username && !redirect.password && /\bPath of Exile\b/i.test(text);
      } catch { /* Unknown application remains manual. */ }
      // Twitch can render the final consent screen without retaining redirect_uri in the visible URL.
      // In that case require both the exact PoE application name and the official redirect shown by Twitch.
      if(!poeApp) poeApp=/\bPath of Exile\b/i.test(text) &&
        /(?:redirect|перенаправ)[^\n]{0,100}https:\/\/www\.pathofexile\.com(?=[:/\s]|$)/i.test(text);
      const user=String(text).match(/(?:logged in as|signed in as|вы вошли(?: в систему)? как|вошли как|авторизованы как)\s*:?\s*([a-z0-9_]{3,25})/i) ||
        String(text).match(/(?:\bNot|Не)\s+([a-z0-9_]{3,25})\s*\?/i) ||
        String(text).match(/\b([a-z0-9_]{3,25})\s+(?:Это не вы\?|Not you\?)/i);
      return {consent:true,poeApp,currentUser:user ? user[1] : ''};
    } catch { return empty; }
  }
  return Object.freeze({identity,twitchRow,connectionAction,linkedTwitch,activationLabel,emailReminder,emailChoice,oauthContext});
})();
