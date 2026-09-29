import {parseAccounts,initialState,publicState,nextAction,command,enter,URLS,pageObservation,traceEvent,diagnosticReport} from './core.mjs';

const uiUrl = chrome.runtime.getURL('panel.html');
chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(t => t.url === uiUrl);
  if (existing) await chrome.tabs.update(existing.id,{active:true});
  else await chrome.tabs.create({url:uiUrl});
});
const read = async () => (await chrome.storage.session.get('queue')).queue || initialState();
const write = s => chrome.storage.session.set({queue:s});
const trustedUi = sender => sender.id === chrome.runtime.id && sender.url === uiUrl;
function allowedPage(sender) {
  try { const u = new URL(sender.url); return u.protocol === 'https:' && ['www.twitch.tv','id.twitch.tv','www.pathofexile.com'].includes(u.hostname); }
  catch { return false; }
}
async function navigate(s, action) {
  if (action?.kind !== 'navigate' || !Object.values(URLS).includes(action.url)) return;
  s.lastObservation = null; s.observedAt = 0;
  s.pendingAction=null;s.lastActionAt=Date.now();
  if (s.tabId === null) { const tab = await chrome.tabs.create({url:action.url, active:true}); s.tabId = tab.id; }
  else { await chrome.tabs.update(s.tabId,{url:action.url,active:true}); }
}
async function debuggerClick(tabId,x,y) {
  if(!Number.isFinite(x) || !Number.isFinite(y) || x<0 || y<0 || x>10000 || y>10000) throw new Error('Координаты кнопки «Разрешить» недоступны.');
  const target={tabId};let attached=false;
  try {
    await chrome.debugger.attach(target,'1.3');attached=true;
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
  } finally {
    if(attached) await chrome.debugger.detach(target).catch(()=>{});
  }
}
async function readWorkingPage(s) {
  if (s.tabId === null) throw new Error('Сначала восстанови рабочую вкладку.');
  let r;
  try { r=await chrome.tabs.sendMessage(s.tabId,{type:'readPage'},{frameId:0}); }
  catch { throw new Error('Нет связи с рабочей вкладкой. Нажми «Обновить страницу» и дождись её загрузки.'); }
  if (!r?.observation || !r.page) throw new Error('Не удалось прочитать страницу. Нажми «Обновить страницу».');
  s.lastObservation=pageObservation(r.observation,r.page);s.observedAt=Date.now();
  await write(s);return s.lastObservation;
}
let serial = Promise.resolve();
chrome.runtime.onMessage.addListener((msg,sender,reply) => {
  serial = serial.catch(()=>{}).then(async()=> {
    let s = await read();
    if (!msg || typeof msg.type !== 'string') throw new Error('Неизвестное сообщение.');
    if (trustedUi(sender)) {
      if (msg.type === 'state') return {state:publicState(s)};
      if (msg.type === 'diagnostics') {
        try { await readWorkingPage(s); } catch { traceEvent(s,'working_tab_unreachable'); }
        return {diagnostics:diagnosticReport(s)};
      }
      if (msg.type === 'import') {
        if (!['ready','done'].includes(s.phase)) throw new Error('Заверши или очисти текущую очередь.');
        s = initialState(parseAccounts(msg.text)); await write(s); return {state:publicState(s)};
      }
      if (msg.type === 'clear') { await chrome.storage.session.remove('queue'); return {state:publicState(initialState())}; }
      if (msg.type === 'focus') {
        if (s.tabId !== null) await chrome.tabs.update(s.tabId,{active:true});
        return {state:publicState(s)};
      }
      if (msg.type === 'reload') {
        if (s.tabId===null) throw new Error('Рабочая вкладка закрыта. Сначала восстанови её.');
        s.lastObservation=null;s.observedAt=0;s.pendingAction=null;s.watch=null;s.uiAttempts={};await write(s);
        await chrome.tabs.reload(s.tabId);return {state:publicState(s)};
      }
      if (msg.type === 'recover') {
        if (!s.accounts.length || ['ready','done'].includes(s.phase)) throw new Error('Активной очереди нет.');
        const oldPhase = s.phase;
        if (oldPhase === 'waitUnlink') enter(s,'unlink','Сверь текущее состояние привязки после восстановления вкладки.');
        if (oldPhase === 'cleanupWait') enter(s,'cleanupUnlink','Сверь состояние прежней привязки после восстановления вкладки.');
        s.tabId = null; s.paused = false;
        if(oldPhase==='switchLogout') s.issued=[];
        const url = ['login','switchLogout','logout','dropsTwitch'].includes(s.phase) ? URLS.twitch : ['review','dropsPoe'].includes(s.phase) ? URLS.rewards : URLS.connections;
        await navigate(s,{kind:'navigate',url}); await write(s); return {state:publicState(s)};
      }
      const observation = ['confirmLogin','manualStep','reviewed'].includes(msg.type) ? await readWorkingPage(s) : s.lastObservation || {};
      const action = command(s,msg.type,{...observation,expectedPoe:msg.expectedPoe,cleanupExisting:msg.cleanupExisting});
      await write(s); await navigate(s,action); await write(s);
      return {state:publicState(s)};
    }
    if (sender.id !== chrome.runtime.id || sender.tab?.id !== s.tabId || sender.frameId !== 0 || !allowedPage(sender)) return {};
    if (msg.type === 'poll') {
      // Validate site from the sender, not page text.
      const o = pageObservation(msg.observation || {},sender.url);
      s.lastObservation = o; s.observedAt = Date.now();
      if (!s.paused && s.phase === 'connect' && o.site === 'oauth') enter(s,'oauth','Проверяю приложение PoE на Twitch перед нажатием Authorize.');
      const action = nextAction(s,o,Date.now());
      await write(s);
      if(action?.kind==='reload') {await chrome.tabs.reload(s.tabId);return {};}
      if(action?.kind==='authorizeMouse') {
        try {
          await debuggerClick(s.tabId,action.x,action.y);
          traceEvent(s,'trusted_mouse_click',Date.now(),{kind:'authorizeMouse'});
        } catch(e) {
          s.pendingAction=null;
          traceEvent(s,'trusted_mouse_failed',Date.now(),{kind:'authorizeMouse'});
          s.hint='Клик мыши по «Разрешить» не выполнен: '+String(e.message || e).slice(0,160)+'. Повторю после паузы.';
        }
        await write(s);return {};
      }
      if (action?.kind === 'navigate') { await navigate(s,action); await write(s); return {}; }
      return {action};
    }
    if(msg.type==='actionDeferred' && msg.kind==='activateDrop' && ['dropsTwitch','dropsPoe'].includes(s.phase)) {
      if(s.dropClicked?.[msg.key]!==undefined) {
        delete s.dropClicked[msg.key];
        s.accounts[s.index].activationClicks=Math.max(0,(s.accounts[s.index].activationClicks||0)-1);
      }
      s.pendingAction=null;s.hint='Кнопка активации изменила состояние. Жду её доступности.';await write(s);
    }
    if (msg.type === 'actionFailed') {
      traceEvent(s,'action_failed',Date.now(),{kind:String(msg.kind || '')});
      const retryable=['dismissPopup','dismissEmail','openMenu','openLogin'].includes(msg.kind);
      s.paused = !retryable;
      s.hint = 'Автоматическое действие не выполнено. ' + String(msg.message || 'Проверь страницу.').slice(0,220) + (retryable?' Повторно проверю кнопку после паузы.':' Скачай диагностику и проверь рабочую вкладку.');
      await write(s);
    }
    if(msg.type==='observerFailed') {
      s.paused=true;traceEvent(s,'observer_failed');
      s.hint='Ошибка чтения страницы. Скачай диагностику и пришли её вместе со скриншотом рабочей вкладки.';await write(s);
    }
    return {};
  });
  serial.then(reply,e=> reply({error:trustedUi(sender) ? String(e.message).slice(0,250) : 'Действие остановлено.'}));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  serial = serial.catch(()=>{}).then(async()=> {
    const s = await read();
    if (s.tabId === tabId && !['ready','done'].includes(s.phase)) {
      s.tabId = null; s.paused = true; s.hint = 'Рабочая вкладка закрыта. Нажми «Восстановить вкладку».'; await write(s);
    }
  });
});
