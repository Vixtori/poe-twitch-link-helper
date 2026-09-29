export const URLS = Object.freeze({
  twitch: 'https://www.twitch.tv/drops/inventory',
  connections: 'https://www.pathofexile.com/my-account/connections',
  rewards: 'https://www.pathofexile.com/my-account/twitch'
});
export const TIMING = Object.freeze({actionDelayMs:3000,activationWaitMs:22000,emptyStableMs:5000,emptyInventoryMs:22000});

export function pageObservation(observation, page) {
  const u = new URL(page);
  const origins = {'https://www.pathofexile.com':'poe','https://www.twitch.tv':'twitch','https://id.twitch.tv':'oauth'};
  const site = origins[u.origin];
  if (!site) throw new Error('Рабочая вкладка открыта на другом сайте.');
  return {...observation,site,connections:site==='poe' && /^\/my-account\/connections\/?$/.test(u.pathname),
    pageHost:u.hostname,pagePath:u.pathname};
}

export function parseAccounts(text) {
  const source = String(text).replace(/\u00a0/g, ' ').trim();
  const re = /(?:^[ \t]*[-*•][ \t]+)?(?:Логин(?:\s*\(\s*Login\s*\))?|Login)\s*:\s*([A-Za-z0-9_]{3,25})(?:[ \t]*\\)?\s+(?:Пароль(?:\s*\(\s*Password\s*\))?|Password)\s*:\s*(\S+)/gimu;
  const result = []; const seen = new Set(); let end = 0;
  for (const m of source.matchAll(re)) {
    if (source.slice(end, m.index).trim()) throw new Error('Не удалось прочитать запись перед аккаунтом №' + (result.length + 1));
    const username = m[1]; const key = username.toLowerCase();
    if (seen.has(key)) throw new Error('Один логин указан дважды. Удали повтор и загрузи список снова.');
    seen.add(key); result.push({username, password: m[2], status: 'pending'}); end = m.index + m[0].length;
  }
  if (!result.length || source.slice(end).trim()) throw new Error('Нужны логин и пароль с подписями. Поддерживаются Логин, Login и двуязычные подписи из списка. Проверь последнюю запись.');
  if (result.length > 46) throw new Error('В одной очереди можно обработать до 46 аккаунтов.');
  return result;
}

export function initialState(accounts = []) {
  return {accounts, index: 0, phase: 'ready', paused: false, tabId: null,
    expectedPoe: '', poeIdentity: '', cleanupExisting:true,hint: '', issued: [], created: Date.now(), updated: Date.now()};
}
export function publicState(s) {
  return {...s, accounts: s.accounts.map(({username, status, linkedVerifiedBy, unlinkedVerifiedBy,activationClicks}) => ({username, status, linkedVerifiedBy, unlinkedVerifiedBy,activationClicks}))};
}
export function enter(s, phase, hint = '') {
  s.phase = phase; s.hint = hint; s.issued = [];s.uiAttempts={}; s.updated = Date.now();
}
function retryUi(s,kind,now,args={}) {
  s.uiAttempts ||= {};
  const key=kind+':'+(args.key || '');
  const previous=s.uiAttempts[key];
  if(previous && now-previous.at<8000) return null;
  if(previous?.count>=3) return stop(s,'Кнопка не изменила страницу после трёх попыток. Нажми «Скачать диагностику» и пришли файл вместе со скриншотом рабочей вкладки.');
  s.uiAttempts[key]={at:now,count:(previous?.count || 0)+1};
  return {kind,...args};
}
export function traceEvent(s,event,now=Date.now(),extra={}) {
  s.trace ||= [];
  s.trace.push({at:now,event,phase:s.phase,index:s.index,...extra});
  s.trace=s.trace.slice(-120);
}
export function diagnosticReport(s) {
  const o=s.lastObservation || {};
  // Whitelist only technical flags; no passwords, form values, page text or OAuth query.
  const flags={};
  for(const key of ['loginForm','loginButton','userMenu','logoutButton','logoutReady','loginSubmitReady','emailReminder','emailDismissAvailable','verificationVisible','popupReady','oauthConsent','oauthPoeApp','authorizeReady','connections','linkState','dropsPageReady','dropsReason','dropAmbiguous','blocked']) {
    if(['string','boolean','number'].includes(typeof o[key])) flags[key]=o[key];
  }
  return {version:'0.2.0',phase:s.phase,index:s.index,count:s.accounts.length,paused:s.paused,
    page:o.pageHost+o.pagePath,observedAt:s.observedAt,flags,dom:o.diagnostics || {},
    rewards:(o.dropButtons || []).map(b=>({key:b.key,ready:!!b.ready})),trace:s.trace || []};
}
function once(s, name, args = {}) {
  if (s.issued.includes(name)) return null;
  s.issued.push(name);
  return {kind: name, ...args};
}
function stop(s, text) { s.paused = true; s.hint = text; return null; }
function checkPoe(s, o) {
  if (o.poeIdentityConflict) { stop(s,'На странице видны разные имена PoE. Сверь текущий аккаунт и обнови страницу.'); return false; }
  if (!o.poeIdentity) { s.hint = 'Не удалось определить аккаунт PoE. Войди на сайте и открой Manage account.'; return false; }
  if (o.poeIdentity.toLowerCase() !== s.expectedPoe.toLowerCase()) {
    stop(s, 'Открыт другой аккаунт PoE: ' + o.poeIdentity + '. Ожидается ' + s.expectedPoe + '.'); return false;
  }
  s.poeIdentity = o.poeIdentity;
  return true;
}
function beginLogin(s) { s.verifiedTwitch=''; enter(s, 'login', 'Заполняю данные Twitch и нажимаю «Войти». Проверки входа при необходимости выполни на сайте.'); return {kind:'navigate', url:URLS.twitch}; }
function beginDrops(s,phase='dropsTwitch') {
  s.dropWaitSince={};s.dropClicked={};s.dropEmptySince=null;
  enter(s,phase,'Проверяю кнопки активации наград PoE. Для каждой кнопки дождусь окончания паузы и её доступности.');
  return {kind:'navigate',url:phase==='dropsTwitch'?URLS.twitch:URLS.rewards};
}
function finishDropPage(s) {
  if(s.phase==='dropsTwitch') return beginDrops(s,'dropsPoe');
  enter(s,'unlink','Доступные кнопки наград обработаны. Перехожу к отвязке Twitch автоматически.');
  return {kind:'navigate',url:URLS.connections};
}
function handleDrops(s,o,now) {
  const expectedSite=s.phase==='dropsTwitch'?'twitch':'poe';
  if(o.site!==expectedSite) return null;
  if(expectedSite==='poe' && !checkPoe(s,o)) return null;
  const a=s.accounts[s.index];
  if(o.currentUser && o.currentUser.toLowerCase()!==a.username.toLowerCase()) return stop(s,'В инвентаре открыт другой Twitch: '+o.currentUser+'.');
  if(!o.dropsPageReady) {s.hint='Ожидаю страницу наград. Если она не распознана, проверь и активируй награды на сайте, затем подтверди шаг вручную.';return null;}
  if(o.dropAmbiguous) {s.hint='Несколько кнопок активации не удалось различить. Активируй эти награды на сайте вручную.';return null;}
  const buttons=Array.isArray(o.dropButtons)?o.dropButtons:[];
  s.dropWaitSince ||= {};s.dropClicked ||= {};
  if(buttons.length) {
    s.dropEmptySince=null;
    for(const b of buttons) if(s.dropWaitSince[b.key]===undefined) s.dropWaitSince[b.key]=now;
    if(buttons.some(b=>s.dropClicked[b.key]!==undefined)) {
      s.hint='Кнопка активации нажата. Ожидаю изменения карточки награды, повторно её не нажимаю.';return null;
    }
    const target=buttons[0];
    const remaining=TIMING.activationWaitMs-(now-s.dropWaitSince[target.key]);
    if(remaining>0) {s.hint='Кнопка «Активировать» обнаружена. Ожидание: '+Math.ceil(remaining/1000)+' с.';return null;}
    if(!target.ready) {s.hint='22 секунды прошли, но «Активировать» ещё недоступна. Жду, пока сайт разрешит нажатие.';return null;}
    s.dropClicked[target.key]=now;a.activationClicks=(a.activationClicks||0)+1;
    s.hint='Нажимаю доступную кнопку активации награды PoE.';
    return {kind:'activateDrop',key:target.key};
  }
  if(s.dropEmptySince===null || s.dropEmptySince===undefined) s.dropEmptySince=now;
  const emptyWait=s.phase==='dropsTwitch'?TIMING.emptyInventoryMs:TIMING.emptyStableMs;
  if(now-s.dropEmptySince<emptyWait) {s.hint='Жду завершения загрузки списка наград: '+Math.ceil((emptyWait-(now-s.dropEmptySince))/1000)+' с.';return null;}
  return finishDropPage(s);
}

// Observations come only from the one working tab. Unknown pages never imply success.
export function decide(s, o, now=Date.now()) {
  if (s.paused || ['ready','done'].includes(s.phase)) return null;
  const a = s.accounts[s.index];
  if (!a) return stop(s, 'Очередь закончилась.');
  if (o.blocked) return stop(s, 'Сайт показал проверку или ошибку. Заверши её вручную, затем нажми «Продолжить». Автоповтора входа нет.');
  if(['waitUnlink','cleanupWait'].includes(s.phase) && o.site==='poe' && o.connections && o.unlinkConfirmReady) {
    if(!checkPoe(s,o)) return null;
    const username=s.phase==='cleanupWait'?s.cleanupTarget:a.username;
    if(o.linkedUser && o.linkedUser.toLowerCase()!==username?.toLowerCase()) return stop(s,'Привязанный Twitch изменился перед подтверждением отвязки.');
    if(o.unlinkConfirmUser && o.unlinkConfirmUser.toLowerCase()!==username?.toLowerCase()) return stop(s,'В подтверждении отвязки указан другой Twitch.');
    return once(s,'confirmUnlink',{username,poeAccount:s.expectedPoe});
  }
  if(o.popupKey && o.popupReady) {
    s.hint='Закрываю всплывающее окно крестиком и проверяю страницу снова.';
    return retryUi(s,'dismissPopup',now,{key:o.popupKey});
  }
  if (['twitch','oauth'].includes(o.site) && ['login','switchLogout','oauth','logout','dropsTwitch'].includes(s.phase)) {
    if(o.emailReminder) {
      if(!o.emailDismissAvailable) { s.hint='Открыто напоминание об email, но кнопка пока недоступна. Дождись загрузки или закрой это окно вручную.';return null; }
      s.hint='Закрываю напоминание об email через «Напомнить позже» или крестик.';
      s.issued=s.issued.filter(x=>x!=='openMenu');
      return retryUi(s,'dismissEmail',now);
    }
    s.issued=s.issued.filter(x=>x!=='dismissEmail');
    if(s.uiAttempts) delete s.uiAttempts['dismissEmail:'];
    if(o.verificationVisible) {s.hint='Twitch ждёт подтверждения входа. Выполни проверку на сайте, затем помощник продолжит.';return null;}
  }
  if (s.phase === 'preflight') {
    if (o.site !== 'poe' || !o.connections) return null;
    if (!checkPoe(s,o)) return null;
    if (o.linkState === 'linked') {
      if(o.linkedUser?.toLowerCase()===a.username.toLowerCase()) {
        s.resumeLinked=true;return beginLogin(s);
      }
      if(s.cleanupExisting && o.linkedUser) {
        s.cleanupTarget=o.linkedUser;
        enter(s,'cleanupUnlink','Снимаю прежнюю связь Twitch '+o.linkedUser+' перед обработкой '+a.username+'.');return null;
      }
      s.hint='Есть прежняя привязка Twitch. Отвяжи её на сайте или включи удаление прежней связи перед запуском.';return null;
    }
    if (o.linkState !== 'unlinked') { s.hint = 'Не распознана строка Twitch. Убедись, что открыт Manage account на английском языке.'; return null; }
    return beginLogin(s);
  }
  if(['cleanupUnlink','cleanupWait'].includes(s.phase)) {
    if(o.site!=='poe' || !o.connections || !checkPoe(s,o)) return null;
    if(o.linkState==='unlinked') {s.cleanupTarget='';return beginLogin(s);}
    if(s.phase==='cleanupWait') {s.hint='Ожидаю завершения автоматической отвязки прежнего Twitch.';return null;}
    if(o.linkState!=='linked' || !o.linkedUser) return null;
    if(o.linkedUser.toLowerCase()!==s.cleanupTarget.toLowerCase()) return stop(s,'Прежняя связь Twitch изменилась. Проверь аккаунт на странице.');
    const username=s.cleanupTarget;enter(s,'cleanupWait','Нажимаю Remove у прежнего Twitch.');return {kind:'unlink',username,poeAccount:s.expectedPoe};
  }
  if (s.phase === 'login') {
    if (o.site !== 'twitch') return null;
    if(!o.currentUser && o.logoutButton && !o.loginForm) {
      s.switchFrom='';enter(s,'switchLogout','Twitch уже открыт, но логин не виден. Выхожу и войду в аккаунт из очереди.');return null;
    }
    if (o.currentUser && o.currentUser.toLowerCase() !== a.username.toLowerCase()) {
      s.switchFrom=o.currentUser;
      enter(s,'switchLogout','Выхожу из Twitch '+o.currentUser+', затем войду как '+a.username+'.');
      return null;
    }
    if (o.loginForm) {
      if(!s.issued.includes('fill')) return once(s, 'fill', {username:a.username, password:a.password});
      if(o.loginUsername && o.loginUsername.toLowerCase()!==a.username.toLowerCase()) return stop(s,'Логин в форме Twitch изменился. Проверь данные текущего аккаунта.');
      if(o.loginSubmitReady && o.loginUsername?.toLowerCase()===a.username.toLowerCase()) {
        s.hint='Нажимаю «Войти» и ожидаю ответ Twitch. Повторной автоматической попытки не будет.';
        return once(s,'submitLogin',{username:a.username,password:a.password});
      }
      return null;
    }
    if (o.currentUser && o.currentUser.toLowerCase() === a.username.toLowerCase()) {
      s.verifiedTwitch=a.username;
      if(s.resumeLinked) {s.resumeLinked=false;a.linkedVerifiedBy='page';return beginDrops(s);}
      enter(s,'connect','Найден нужный Twitch. Открываю привязку PoE.'); return {kind:'navigate',url:URLS.connections};
    }
    if (o.loginButton) return retryUi(s,'openLogin',now);
    if (o.userMenu) return retryUi(s,'openMenu',now);
    return null;
  }
  if (s.phase === 'connect') {
    if (o.site !== 'poe' || !o.connections) return null;
    if (!checkPoe(s,o)) return null;
    if (o.linkState === 'linked') return stop(s,'До нажатия Connect обнаружена привязка. Проверь строку Twitch вручную.');
    if (o.linkState !== 'unlinked') { s.hint = 'Не нашёл однозначную кнопку Connect в строке Twitch. Нажми её на сайте самостоятельно.'; return null; }
    enter(s,'oauth','Ожидаю страницу Twitch, проверю приложение Path of Exile и нажму Authorize.');
    return {kind:'connect'};
  }
  // A manual Connect click may have navigated before the automatic selector matched.
  if (s.phase === 'oauth') {
    if (o.site === 'oauth') {
      const point=o.authorizePoint;
      if(!o.authorizeReady || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {s.hint='Ожидаю доступную кнопку «Разрешить» на странице Twitch.';return null;}
      s.hint='Нажимаю «Разрешить» настоящим кликом мыши.';
      return retryUi(s,'authorizeMouse',now,{x:point.x,y:point.y});
    }
    if(o.site==='poe' && !o.connections && o.pagePath?.startsWith('/my-account/') && !s.issued.includes('returnConnections')) {
      s.issued.push('returnConnections');return {kind:'navigate',url:URLS.connections};
    }
    if (o.site !== 'poe' || !o.connections) return null;
    if (!checkPoe(s,o)) return null;
    if (o.linkState !== 'linked') return null;
    if (o.linkedUser && o.linkedUser.toLowerCase() !== a.username.toLowerCase()) return stop(s,'PoE показывает другой Twitch: ' + o.linkedUser + '. Не отвязываю его автоматически.');
    a.linkedVerifiedBy = 'page';
    return beginDrops(s);
  }
  if(s.phase==='dropsTwitch' && o.site==='twitch' && (o.loginForm || o.loginButton)) {
    s.reauthCount=(s.reauthCount || 0)+1;
    if(s.reauthCount>2) return stop(s,'Twitch повторно потерял вход. Скачай диагностику и проверь рабочую вкладку.');
    s.resumeLinked=true;return beginLogin(s);
  }
  if(['dropsTwitch','dropsPoe'].includes(s.phase)) return handleDrops(s,o,now);
  // Continue automatically if a queue restored from an older build stopped at the review gate.
  if(s.phase==='review') {
    if(o.site!=='poe' || !checkPoe(s,o)) return null;
    return finishDropPage(s);
  }
  if (s.phase === 'unlink') {
    if (o.site !== 'poe' || !o.connections) return null;
    if (!checkPoe(s,o)) return null;
    if (o.linkState === 'unlinked') return startLogout(s);
    if (o.linkState !== 'linked') { s.hint = 'Кнопка отвязки Twitch не распознана. Отвяжи на сайте и вернись в Manage account.'; return null; }
    if (!o.linkedUser) { s.hint = 'PoE не показывает распознанный логин рядом с кнопкой. Сверь Twitch и отвяжи его вручную. После этого очередь продолжится.'; return null; }
    if (o.linkedUser.toLowerCase() !== a.username.toLowerCase()) return stop(s,'Привязан другой Twitch: ' + o.linkedUser + '. Автоматическая отвязка остановлена.');
    enter(s,'waitUnlink','Подтверждаю отвязку и жду, пока PoE покажет отсутствие связи.'); return {kind:'unlink',username:a.username,poeAccount:s.expectedPoe};
  }
  if (s.phase === 'waitUnlink') {
    if (o.site === 'poe' && o.connections && checkPoe(s,o) && o.linkState === 'unlinked') return startLogout(s);
    return null;
  }
  if (s.phase === 'switchLogout') {
    if(o.site!=='twitch') return null;
    if(o.currentUser?.toLowerCase()===a.username.toLowerCase()) {
      s.switchFrom='';enter(s,'login','Нужный Twitch уже открыт. Проверяю вход.');return null;
    }
    if(!o.currentUser && !o.logoutButton && (o.loginForm || o.loginButton)) {
      s.switchFrom='';return beginLogin(s);
    }
    if(o.logoutButton) {
      s.hint='Нажимаю «Выйти» и жду появления формы входа Twitch.';
      if(o.logoutReady===false) return null;
      return once(s,'logout',{username:o.currentUser || s.switchFrom});
    }
    if(o.userMenu) return retryUi(s,'openMenu',now);
    s.hint='Ожидаю меню Twitch или завершения выхода.';return null;
  }
  if (s.phase === 'logout') {
    if (o.site !== 'twitch') return null;
    if (!o.currentUser && !o.logoutButton && (o.loginForm || o.loginButton)) {
      a.password = '';
      if (s.index + 1 >= s.accounts.length) { enter(s,'done','Все аккаунты обработаны. Пароли удалены из памяти расширения.'); return null; }
      s.index++;s.reauthCount=0; return beginLogin(s);
    }
    if (o.currentUser && o.currentUser.toLowerCase() !== a.username.toLowerCase()) return stop(s,'В Twitch открыт другой аккаунт. Выйди вручную, затем продолжи.');
    if (o.logoutButton) return o.logoutReady===false ? null : once(s,'logout',{username:a.username});
    if (o.userMenu) return retryUi(s,'openMenu',now);
    return null;
  }
  return null;
}
function startLogout(s) {
  s.accounts[s.index].status = 'done';
  s.accounts[s.index].unlinkedVerifiedBy = 'page';
  s.accounts[s.index].password = '';
  enter(s,'logout','Отвязка подтверждена страницей PoE. Выхожу из текущего Twitch.');
  return {kind:'navigate',url:URLS.twitch};
}

export function command(s, type, o = {}) {
  if (type === 'pause') { s.paused = true;s.pendingAction=null; return null; }
  if (type === 'resume') { s.paused = false;s.watch=null;s.uiAttempts={}; s.updated = Date.now(); return null; }
  if (type === 'start') {
    if (s.phase !== 'ready' || !s.accounts.length) throw new Error('Сначала загрузи список аккаунтов.');
    const name = String(o.expectedPoe || '').trim();
    if (!/^.{1,80}#\d{4}$/.test(name)) throw new Error('Введи полное имя аккаунта PoE, например Player#1234.');
    s.expectedPoe = name;s.cleanupExisting=o.cleanupExisting!==false; enter(s,'preflight','Проверяю PoE и наличие прежней привязки Twitch.');
    return {kind:'navigate',url:URLS.connections};
  }
  if (s.paused) throw new Error('Сначала нажми «Продолжить».');
  if (type === 'manualStep') {
    if(['dropsTwitch','dropsPoe'].includes(s.phase)) {
      if(o.site!==(s.phase==='dropsTwitch'?'twitch':'poe')) throw new Error('Открой страницу наград в рабочей вкладке.');
      if(o.site==='poe' && (o.poeIdentityConflict || (o.poeIdentity && o.poeIdentity.toLowerCase()!==s.expectedPoe.toLowerCase()))) throw new Error('Открыт другой аккаунт PoE или имя распознано неоднозначно.');
      if(o.currentUser && o.currentUser.toLowerCase()!==s.accounts[s.index].username.toLowerCase()) throw new Error('Открыт другой Twitch.');
      if(o.loginForm || o.verificationVisible) throw new Error('Сначала заверши вход и проверку на сайте.');
      if(o.dropButtons?.length || o.dropAmbiguous) throw new Error('На странице ещё видны кнопки активации. Дождись завершения получения наград.');
      return finishDropPage(s);
    }
    if (o.site !== 'poe') throw new Error('Открой нужную страницу PoE в рабочей вкладке.');
    if (o.poeIdentityConflict) throw new Error('Страница показывает разные имена PoE. Обнови её и сверь аккаунт.');
    if (o.poeIdentity && o.poeIdentity.toLowerCase() !== s.expectedPoe.toLowerCase()) throw new Error('Открыт другой аккаунт PoE.');
    if (['preflight','cleanupUnlink','cleanupWait'].includes(s.phase)) {
      if (!o.connections || o.linkState === 'linked') throw new Error('Сначала проверь и убери существующую связь Twitch в Manage account.');
      return beginLogin(s);
    }
    if (s.phase === 'oauth') {
      if (o.linkState === 'unlinked') throw new Error('Страница показывает отсутствие связи Twitch.');
      if (o.linkedUser && o.linkedUser.toLowerCase() !== s.accounts[s.index].username.toLowerCase()) throw new Error('На странице другой Twitch.');
      s.accounts[s.index].linkedVerifiedBy = 'user';
      return beginDrops(s);
    }
    if (['unlink','waitUnlink'].includes(s.phase)) {
      if (!o.connections || o.linkState === 'linked') throw new Error('Сначала заверши отвязку Twitch в Manage account.');
      const action=startLogout(s); s.accounts[s.index].unlinkedVerifiedBy='user'; return action;
    }
    throw new Error('На этом шаге ручное подтверждение не требуется.');
  }
  if (type === 'confirmLogin') {
    if (s.phase !== 'login') throw new Error('Сейчас другой шаг.');
    if (o.currentUser && o.currentUser.toLowerCase() !== s.accounts[s.index].username.toLowerCase()) throw new Error('На сайте открыт другой Twitch.');
    if (o.site !== 'twitch' || o.loginForm || o.loginButton) throw new Error('Сначала заверши вход в Twitch в рабочей вкладке.');
    s.verifiedTwitch=s.accounts[s.index].username;
    if(s.resumeLinked) {s.resumeLinked=false;s.accounts[s.index].linkedVerifiedBy='page';return beginDrops(s);}
    enter(s,'connect','Вход подтверждён пользователем. Открываю привязку.'); return {kind:'navigate',url:URLS.connections};
  }
  if (type === 'reviewed') {
    if (s.phase !== 'review') throw new Error('Сначала дождись подтверждения привязки.');
    return finishDropPage(s);
  }
  throw new Error('Недоступное действие.');
}

// Poll-driven scheduling survives worker suspension and rechecks the page at dispatch.
// Pending metadata never includes passwords or cached DOM elements.
export function nextAction(s,o,now=Date.now()) {
  if(!s.paused && !['ready','done'].includes(s.phase)) {
    const fingerprint=JSON.stringify([s.phase,s.index,o.site,o.pagePath,o.linkState,o.currentUser,!!o.loginForm,!!o.loginButton,!!o.logoutButton,!!o.verificationVisible,o.popupKey,!!o.emailReminder,o.dropsReason,o.dropButtons]);
    if(s.watch?.fingerprint!==fingerprint) {
      s.watch={fingerprint,since:now};
      traceEvent(s,'observation_changed',now,{reason:o.dropsReason || ''});
    }
    const elapsed=now-s.watch.since;
    if(elapsed>=60000 && !o.blocked && !o.verificationVisible && !o.popupReady && ['dropsTwitch','dropsPoe'].includes(s.phase) && !o.dropsPageReady && !o.loginForm && !o.loginButton) {
      const key=s.index+':'+s.phase;s.recoveries ||= {};
      if(!s.recoveries[key]) {
        s.recoveries[key]=1;s.watch.since=now;s.pendingAction=null;
        s.hint='Страница наград не распознана за 60 секунд. Один раз перезагружаю её.';
        traceEvent(s,'reload_unrecognized_inventory',now);return {kind:'reload'};
      }
    }
    if(elapsed>=90000 && !o.blocked && !o.verificationVisible) {
      traceEvent(s,'stalled',now,{reason:o.dropsReason || ''});
      s.pendingAction=null;
      return stop(s,'Шаг не меняется 90 секунд. Причина: '+(o.dropsReason || s.phase)+'. Нажми «Скачать диагностику» и пришли файл вместе со скриншотом рабочей вкладки.');
    }
  }
  const draft=structuredClone(s);
  const action=decide(draft,o,now);
  if(!action) {Object.assign(s,draft);s.pendingAction=null;return null;}
  const key=JSON.stringify([s.phase,s.index,action.kind,action.username||'',action.url||'',action.key||'']);
  if(s.pendingAction?.key!==key) {
    s.pendingAction={key,dueAt:Math.max(now+TIMING.actionDelayMs,(s.lastActionAt||0)+TIMING.actionDelayMs)};
    s.hint=draft.hint;return null;
  }
  if(now<s.pendingAction.dueAt) return null;
  Object.assign(s,draft);s.pendingAction=null;s.lastActionAt=now;
  traceEvent(s,'action',now,{kind:action.kind});return action;
}
