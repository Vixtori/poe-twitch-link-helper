(() => {
  'use strict';
  if (window.top !== window) return;
  const visible = e => !!e && !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const label = e => String(e?.innerText || e?.value || e?.getAttribute('aria-label') || '').trim().replace(/\s+/g,' ');
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const controls = (root = document) => all('button,a,input[type="submit"],input[type="button"],[role="button"]',root);
  const unique = list => list.length === 1 ? list[0] : null;
  const named = (re,root = document) => unique(controls(root).filter(e=> re.test(label(e))));
  const usernameInput = () => unique(all('input#login-username'));
  const passwordInput = () => unique(all('input#password-input[type="password"],input[autocomplete="current-password"][type="password"]'));
  const loginButton = () => unique(all('[data-a-target="login-button"]')) || named(/^(Log In|Войти)$/i, document.querySelector('nav') || document);
  const menuButton = () => unique(all('button[data-a-target="user-menu-toggle"]')) || unique(all('button[aria-label="User Menu"],button[aria-label="Меню пользователя"]').filter(e=>!e.querySelector('button')));
  const logoutButton = () => unique(all('[data-a-target="user-menu-logout"]')) || named(/^(Log Out|Выйти|Выход)$/i) || unique(all('[role="menuitem"]').filter(e=>/^(Log Out|Выйти|Выход)$/i.test(label(e))));
  function currentTwitchUser() {
    const names=[...new Set(all('[data-a-target="user-display-name"],[data-a-target="user-menu-header"]').map(e=>label(e)).filter(t=>/^[A-Za-z0-9_]{3,25}$/.test(t)).map(x=>x.toLowerCase()))];
    return names.length===1 ? names[0] : '';
  }
  const enabled = e => visible(e) && !e.disabled && !e.matches(':disabled') && !e.closest('[inert],[aria-disabled="true"],fieldset[disabled]') &&
    !/(?:^|\s)(?:disabled|is-disabled)(?:\s|$)/i.test(e.className || '') && getComputedStyle(e).pointerEvents!=='none';
  const onTwitch = () => ['www.twitch.tv','id.twitch.tv'].includes(location.hostname);
  function loginSubmitButton() {
    const user=usernameInput(), pass=passwordInput();
    if (!user || !pass) return null;
    let root=user.parentElement;
    for(let i=0;root && root!==document.body && i<12;i++,root=root.parentElement) {
      if (!root.contains(pass)) continue;
      const button=named(/^(?:Войти|Log In|Login|Sign In)$/i,root);
      if(button) return button;
    }
    return null;
  }
  function emailPrompt() {
    if(!onTwitch()) return null;
    const laterButtons=controls().filter(e=>/^(?:Напомнить позже|Remind me later|Remind later)$/i.test(label(e)));
    if(laterButtons.length!==1) return null;
    const later=laterButtons[0];let root=later.parentElement,pending=null;
    for(let i=0;root && root!==document.body && i<12;i++,root=root.parentElement) {
      const text=label(root);
      if(text.length>4000) break;
      if(!PoeQueuePage.emailReminder(text,label(later))) continue;
      const close=named(/^(?:Close|Закрыть|Закрыть окно|Close dialog|Close modal)$/i,root) || unique(all('button[aria-label]',root).filter(e=>/^(?:Close|Закрыть|Закрыть окно|Close dialog|Close modal)$/i.test(e.getAttribute('aria-label')))) || unique(all('button[data-a-target="modal-close-button"]',root));
      const choice=PoeQueuePage.emailChoice({text,laterLabel:label(later),laterEnabled:enabled(later),closeEnabled:enabled(close)});
      const result={button:choice==='later'?later:choice==='close'?close:null,choice};
      if(result.button) return result;
      pending=result;
    }
    return pending;
  }
  function popupPrompt() {
    const dialogSelector='[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog,[data-a-target="modal"]';
    const closeLabel=/^(?:Close|Dismiss|Закрыть|Закрыть окно|Close dialog|Close modal|Close Modal|×|✕|✖)$/i;
    const candidates=controls().filter(e=>closeLabel.test(label(e)) || closeLabel.test(e.getAttribute('aria-label') || '') || e.matches('[data-a-target="modal-close-button"],[data-test-selector="modal-close-button"]'));
    const dialogs=all(dialogSelector).filter(e=>!all(dialogSelector,e).length);
    for(const close of candidates) {
      const root=close.closest(dialogSelector) || close.parentElement?.parentElement;
      if(!root || root===document.body || root===document.documentElement) continue;
      if(!dialogs.includes(root)) dialogs.push(root);
    }
    for(const root of dialogs.reverse()) {
      const text=label(root);
      // Keep required login and verification UI open, as well as pending unlink confirmation.
      if(root.querySelector('input[type="password"],input[autocomplete="one-time-code"],iframe[src*="captcha"]') || all('input[maxlength="1"]',root).length>=4 || /captcha|verify (?:that )?you are human|подтвердите,? что вы человек/i.test(text)) continue;
      if(location.hostname==='id.twitch.tv' && authorizeButton()) continue;
      if(location.hostname==='www.pathofexile.com' && /Twitch/i.test(text) && /confirm|are you sure|подтверд|уверены/i.test(text)) continue;
      const closes=candidates.filter(e=>root.contains(e) && enabled(e));
      const later=controls(root).find(e=>/^(?:Напомнить позже|Remind me later|Remind later|Не сейчас|Not now)$/i.test(label(e)) && enabled(e));
      const button=closes[0] || later;
      if(button) return {button,key:'popup:'+hash((root.getAttribute('aria-label') || '')+'|'+text.replace(/\d+/g,'#').slice(0,1000))};
    }
    return null;
  }
  function authorizeButton() {
    if(location.hostname!=='id.twitch.tv' || !/^\/oauth2\/(?:authorize|consent)\/?$/.test(location.pathname)) return null;
    return named(/^(?:Authorize|Allow|Авторизовать|Авторизоваться|Разрешить|Разрешить доступ)$/i);
  }
  function controlPoint(e) {
    if(!enabled(e)) return null;
    const r=e.getBoundingClientRect();
    if(r.width<=0 || r.height<=0) return null;
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
  }
  const sameOriginLink = a => {
    if (a.tagName !== 'A') return true;
    try { const u = new URL(a.href); return u.protocol === 'https:' && ['www.pathofexile.com','id.twitch.tv'].includes(u.hostname); } catch { return false; }
  };
  function twitchControl(mode) {
    if (location.hostname !== 'www.pathofexile.com' || !/^\/my-account\/connections\/?$/.test(location.pathname)) return null;
    const found = [];
    for (const e of controls().filter(el=>PoeQueuePage.connectionAction(label(el))===mode && sameOriginLink(el))) {
      let row = e.parentElement;
      for (let i=0; row && i<6 && row !== document.body; i++, row=row.parentElement) {
        const t = label(row);
        if (t.length > 1500 || /\b(?:Steam|Microsoft|Sony|PlayStation|Xbox|Epic Games|Email)\b/i.test(t)) break;
        const actionCount=controls(row).filter(n=>PoeQueuePage.connectionAction(label(n))).length;
        if (actionCount !== 1) break;
        const twitchLabel = all('*',row).some(n=>n.children.length === 0 && /^Twitch:?$/i.test(label(n))) || all('img[alt]',row).some(n=>/^Twitch$/i.test(n.alt));
        if (twitchLabel || PoeQueuePage.twitchRow(t,actionCount)) { found.push({button:e,row}); break; }
      }
    }
    return found.length === 1 ? found[0] : null;
  }
  function linkedUsername(row) {
    if (!row) return '';
    return PoeQueuePage.linkedTwitch(label(row),all('a[href]',row).map(a=>a.href));
  }
  function unlinkConfirmation() {
    if(location.hostname!=='www.pathofexile.com' || !/^\/my-account\/connections\/?$/.test(location.pathname)) return null;
    const found=[];
    for(const root of all('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog')) {
      const text=label(root);
      if(!/Twitch/i.test(text) || !/(?:remove|unlink|disconnect|отвяз|удалить связь)/i.test(text) || root.querySelector('input[type="password"],input[autocomplete="one-time-code"]')) continue;
      const button=named(/^(?:Yes|Yes,? (?:remove|unlink|disconnect)|Confirm|Remove|Unlink|Disconnect|Да|Подтвердить|Отвязать)$/i,root);
      if(button && enabled(button)) found.push({button,user:linkedUsername(root)});
    }
    const buttons=[...new Map(found.map(x=>[x.button,x])).values()];
    return buttons.length===1 ? buttons[0] : null;
  }
  function checkUnlinkAccount(a) {
    const identity=poeIdentity();
    if(!a.username || !a.poeAccount || identity.conflict || identity.name.toLowerCase()!==a.poeAccount.toLowerCase()) throw new Error('Аккаунт PoE изменился перед отвязкой.');
  }
  function hash(text) { let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16); }
  function dropControls() {
    const isPoe=location.hostname==='www.pathofexile.com' && /^\/my-account\/twitch\/?$/.test(location.pathname);
    const isTwitch=location.hostname==='www.twitch.tv' && /^\/drops\/inventory\/?$/.test(location.pathname);
    if(!isPoe && !isTwitch) return {items:[],ambiguous:0};
    const found=[];
    for(const button of controls().filter(e=>PoeQueuePage.activationLabel(label(e)))) {
      let root=button.parentElement, group=isPoe?(document.querySelector('main,#main,#content') || document.body):null;
      for(let i=0;!group && root && root!==document.body && i<12;i++,root=root.parentElement) {
        const t=label(root);
        if(t.length>6000 || /^(?:MAIN|NAV|HEADER|FOOTER)$/.test(root.tagName)) break;
        const categories=all('a[href*="/directory/category/"]',root).map(a=>new URL(a.href).pathname);
        const validCategories=categories.length>0 && categories.every(path=>/^\/directory\/category\/path-of-exile(?:-2)?\/?$/.test(path));
        const gameHeading=all('h1,h2,h3,h4',root).some(e=>/^Path of Exile(?: 2)?$/i.test(label(e)));
        if(/\bPath of Exile(?: 2)?\b/i.test(t) && (validCategories || (!categories.length && gameHeading))) {group=root;break;}
      }
      if(!group) continue;
      let card=button.parentElement,signature='';
      for(let i=0;card && i<12;i++,card=card.parentElement) {
        const count=controls(card).filter(e=>PoeQueuePage.activationLabel(label(e))).length;
        if(count>1) break;
        const text=label(card).replace(/(?:Активировать|Activate|Claim now|Claim|Получить сейчас|Получить|Redeem)(?:\s*\(?\d+\s*(?:s|sec|сек\.?|секунд[уы]?)?\)?)?/gi,'').replace(/\b\d+\s*(?:seconds?|секунд[уы]?)\b/gi,'').replace(/\s+/g,' ').trim();
        const images=all('img[alt]',card).map(e=>e.alt).join(' ');
        if(text.length>2 || images) {signature=text+'|'+images;break;}
        if(card===group) break;
      }
      // A lone unnamed button is still trackable on this page. Duplicate keys are withheld.
      const key=(isPoe?'poe:':'twitch:')+hash(signature || 'unnamed-reward');
      found.push({button,key,ready:enabled(button)});
    }
    // Do not act on indistinguishable cards; their layout needs a manual check.
    const items=found.filter(item=>found.filter(other=>other.key===item.key).length===1).slice(0,100);
    return {items,ambiguous:found.length-items.length};
  }
  function poeIdentity() {
    if (location.hostname !== 'www.pathofexile.com') return {name:'',conflict:false};
    const links=all('a[href*="/account/view-profile/"]');
    return PoeQueuePage.identity({text:document.body?.innerText || '',profileTexts:links.map(label),profileUrls:links.map(a=>a.href)});
  }
  function observe() {
    const loginForm = !!usernameInput() && !!passwordInput();
    const connect = twitchControl('connect'); const unlink = twitchControl('unlink');
    const alerts = all('[role="alert"],[data-a-target="passport-error"]');
    const badText = /incorrect|invalid password|something went wrong|not supported|too many|try again later|неверн|неправильн|не поддержива|слишком много|повторите позже/i;
    const challengeText = /verify (?:that )?you are human|checking your browser|подтвердите,? что вы человек/i;
    const pageText = document.body?.innerText || '';
    const poe = poeIdentity();
    const email=emailPrompt();
    const auth=PoeQueuePage.oauthContext(location.href,pageText),authorize=authorizeButton();
    const verificationVisible=onTwitch() && (all('input[autocomplete="one-time-code"]').length>0 || all('input[maxlength="1"]').length>=4);
    const dropScan=dropControls(),dropButtons=dropScan.items;
    const popup=popupPrompt();
    const unlinkConfirm=unlinkConfirmation();
    const main=document.querySelector('main,[role="main"],#main,#content');
    const inventoryHeading=all('h1,h2,h3,[role="heading"],[role="tab"]').some(e=>/inventory|инвентарь|drops|награды|rewards/i.test(label(e)));
    const loading=all('[aria-busy="true"],[role="progressbar"]').some(e=>!e.closest('nav,header'));
    const inventoryEvidence=dropButtons.length>0 || inventoryHeading || /(?:Drops(?:\s|&).*?(?:Rewards|награды)|Инвентарь|Inventory|Полученные награды|Claimed rewards)/i.test(main?.innerText || pageText);
    const inventoryRoute=location.hostname==='www.twitch.tv' && /^\/drops\/inventory\/?$/.test(location.pathname);
    const dropsPageReady=!popup && !loading && ((location.hostname==='www.pathofexile.com' && /^\/my-account\/twitch\/?$/.test(location.pathname) && !!poe.name) ||
      (inventoryRoute && !loginForm && !loginButton() && inventoryEvidence));
    const dropsReason=popup?'popup':loading?'loading':loginForm || loginButton()?'login_required':!inventoryEvidence && inventoryRoute?'inventory_not_recognized':dropsPageReady?'ready':'wrong_page_or_identity';
    return {loginForm, loginButton:!!loginButton(), userMenu:!!menuButton(), logoutButton:!!logoutButton(),logoutReady:enabled(logoutButton()),
      loginSubmitReady:enabled(loginSubmitButton()),loginUsername:usernameInput()?.value || '',
      emailReminder:!!email,emailDismissAvailable:enabled(email?.button),verificationVisible,
      popupKey:popup?.key || '',popupReady:!!popup,
      oauthConsent:auth.consent,oauthPoeApp:auth.poeApp,oauthUser:auth.currentUser,authorizeReady:enabled(authorize),authorizePoint:controlPoint(authorize),
      currentUser:currentTwitchUser(), poeIdentity:poe.name,poeIdentityConflict:poe.conflict,
      linkState:connect && !unlink ? 'unlinked' : unlink && !connect ? 'linked' : 'unknown',
      linkedUser:linkedUsername(unlink?.row),
      unlinkConfirmReady:!!unlinkConfirm,unlinkConfirmUser:unlinkConfirm?.user || '',
      dropsPageReady,dropsReason,dropAmbiguous:dropScan.ambiguous,dropButtons:dropButtons.map(({key,ready})=>({key,ready})),
      diagnostics:{readyState:document.readyState,hasMain:!!main,inventoryHeading,loading,dialogCount:all('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog').length,closeCount:all('[data-a-target="modal-close-button"]').length},
      blocked:alerts.some(e=>badText.test(label(e))) || challengeText.test(pageText)};
  }
  function click(e) {
    if (!enabled(e)) throw new Error('Кнопка на странице не найдена или недоступна.');
    if (e.tagName === 'A' && e.target === '_blank') e.target = '_self';
    e.scrollIntoView?.({block:'center',inline:'center'});
    e.focus({preventScroll:true});
    e.click();
  }
  function fill(e,value) {
    if (!e || !visible(e) || e.disabled) throw new Error('Поле входа недоступно.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);
    e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function run(a) {
    if (!a) return;
    if (a.kind === 'fill') {
      if (location.hostname !== 'www.twitch.tv' || !usernameInput() || !passwordInput()) throw new Error('Форма Twitch изменилась.');
      fill(usernameInput(),a.username); fill(passwordInput(),a.password); passwordInput().focus();
      return;
    }
    if (a.kind === 'openLogin') return click(loginButton());
    if (a.kind === 'submitLogin') {
      if(location.hostname!=='www.twitch.tv' || usernameInput()?.value.toLowerCase()!==a.username.toLowerCase() || passwordInput()?.value!==a.password) throw new Error('Данные формы изменились. Проверь логин и пароль перед входом.');
      return click(loginSubmitButton());
    }
    if (a.kind === 'dismissEmail') {
      const prompt=emailPrompt();
      if(!prompt) return;
      return click(prompt.button);
    }
    if(a.kind==='dismissPopup') {
      const popup=popupPrompt();
      if(!popup || popup.key!==a.key) return {deferred:true};
      return click(popup.button);
    }
    if (a.kind === 'authorize') {
      return click(authorizeButton());
    }
    if (a.kind === 'openMenu') return click(menuButton());
    if (a.kind === 'logout') {
      const user=currentTwitchUser();
      if(location.hostname!=='www.twitch.tv' || (user && a.username && user!==a.username.toLowerCase())) throw new Error('Аккаунт Twitch изменился перед выходом. Проверь страницу.');
      return click(logoutButton());
    }
    if (a.kind === 'connect') return click(twitchControl('connect')?.button);
    if (a.kind === 'unlink') {
      checkUnlinkAccount(a);
      const target=twitchControl('unlink');
      if(!target || !a.username || linkedUsername(target.row).toLowerCase()!==a.username.toLowerCase()) throw new Error('Привязанный Twitch изменился или его логин не распознан.');
      // The MAIN-world helper approves only a recognized confirmation from this checked click.
      target.button.setAttribute('data-poe-queue-unlink',JSON.stringify({username:a.username,poeAccount:a.poeAccount}));
      try {return click(target.button);} finally {target.button.removeAttribute('data-poe-queue-unlink');}
    }
    if(a.kind==='confirmUnlink') {
      checkUnlinkAccount(a);
      const confirmation=unlinkConfirmation();
      const linked=linkedUsername(twitchControl('unlink')?.row);
      if(!confirmation || (confirmation.user && confirmation.user.toLowerCase()!==a.username.toLowerCase()) || (linked && linked.toLowerCase()!==a.username.toLowerCase())) throw new Error('Подтверждение отвязки изменилось.');
      return click(confirmation.button);
    }
    if (a.kind === 'activateDrop') {
      const target=unique(dropControls().items.filter(e=>e.key===a.key));
      if(!target || !target.ready) return {deferred:true};
      return click(target.button);
    }
  }
  let busy = false; let alive = true;
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if (sender.id !== chrome.runtime.id || msg?.type !== 'readPage') return;
    reply({observation:observe(),page:location.origin+location.pathname});
  });
  async function tick() {
    if (busy || !alive) return; busy = true;
    try {
      const r = await chrome.runtime.sendMessage({type:'poll',observation:observe()});
      try {
        const result=run(r?.action);
        if(result?.deferred) await chrome.runtime.sendMessage({type:'actionDeferred',kind:r.action.kind,key:r.action.key});
      }
      catch (e) { await chrome.runtime.sendMessage({type:'actionFailed',kind:r?.action?.kind,message:e.message}); }
    } catch (e) {
      // A transient message failure must not disable page observation forever.
      if (/extension context invalidated/i.test(String(e?.message))) alive = false;
      else {
        try { await chrome.runtime.sendMessage({type:'observerFailed'}); } catch { /* Reconnect on the next tick. */ }
      }
    }
    finally { busy = false; }
  }
  tick(); setInterval(tick,1800);
})();
