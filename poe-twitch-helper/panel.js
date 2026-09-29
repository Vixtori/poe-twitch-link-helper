'use strict';
const $ = id=>document.getElementById(id);
let state; let signature=''; let rendering = false;
const phaseNames = {ready:'Готов к запуску',preflight:'Проверка PoE',cleanupUnlink:'Отвязка прежнего Twitch',cleanupWait:'Завершение прежней отвязки',login:'Вход в Twitch',switchLogout:'Выход из прежнего Twitch',connect:'Привязка Twitch',oauth:'Разрешение на Twitch',dropsTwitch:'Активация Drops в Twitch',dropsPoe:'Активация наград PoE',review:'Переход к отвязке',unlink:'Отвязка Twitch',waitUnlink:'Подтверждение отвязки',logout:'Выход из Twitch',done:'Очередь завершена'};
async function send(type,extra={}) {
  const r = await chrome.runtime.sendMessage({type,...extra});
  if (r?.error) throw new Error(r.error);
  if (r?.state) render(r.state);
  return r;
}
function render(s) {
  state=s; const a=s.accounts[s.index];
  const sig = s.phase+':'+s.index+':'+s.created;
  if (signature !== sig) { $('loginVerified').checked=false; signature=sig; }
  $('progress').textContent=s.accounts.filter(x=>x.status==='done').length+' из '+s.accounts.length;
  $('current').textContent=a ? a.username : 'Очередь пуста';
  $('phase').textContent=(s.paused?'Пауза · ':'')+(phaseNames[s.phase] || s.phase);
  $('hint').textContent=s.hint || 'Добавь список и нажми «Начать».';
  const seconds=s.pendingAction?Math.max(0,Math.ceil((s.pendingAction.dueAt-Date.now())/1000)):0;
  $('timing').textContent=s.pendingAction ? 'Пауза перед следующим действием: '+seconds+' с. Затем повторно проверю состояние страницы.' : 'Пауза между действиями: минимум 3 секунды. Ожидание активации: минимум 22 секунды.';
  const o=s.lastObservation;
  const age=Date.now()-(s.observedAt || 0);
  const links={unlinked:'не привязан',linked:'привязан',unknown:'не распознана'};
  const reasons={popup:'Поверх страницы открыто окно',loading:'Сайт показывает загрузку',login_required:'Twitch просит войти',inventory_not_recognized:'Не найдены признаки инвентаря',ready:'Страница наград распознана',wrong_page_or_identity:'Ожидается другая страница или имя аккаунта'};
  $('diagnosticStatus').textContent=['dropsTwitch','dropsPoe'].includes(s.phase) && o ? (reasons[o.dropsReason] || 'Проверяю страницу')+'. Кнопок активации: '+(o.dropButtons?.length || 0)+'.' : '';
  $('observed').textContent=!o ? 'Ожидаю данные рабочей вкладки.' :
    'Рабочая страница: '+o.pageHost+o.pagePath+'. '+(o.site==='poe' ?
    'PoE: '+(o.poeIdentity || 'имя не распознано')+'. Связь Twitch: '+(links[o.linkState] || 'не распознана')+'. ' : '')+
    (age>12000 ? 'Данные устарели. Нажми «Обновить страницу».' : '');
  $('loginLabel').textContent='Я сверил логин в меню Twitch. Сейчас открыт '+(a?.username || 'нужный аккаунт')+'.';
  $('loginCheck').hidden=s.phase!=='login';
  $('confirmLogin').disabled=s.paused || !$('loginVerified').checked;
  $('start').disabled=s.phase!=='ready' || !s.accounts.length;
  $('import').disabled=!['ready','done'].includes(s.phase);
  $('pause').disabled=s.paused || ['ready','done'].includes(s.phase);
  $('resume').disabled=!s.paused || s.tabId===null;
  $('focus').disabled=s.tabId===null;
  $('reload').disabled=s.tabId===null;
  $('recover').hidden=s.tabId!==null || ['ready','done'].includes(s.phase);
  $('manualStep').hidden=!['preflight','cleanupUnlink','cleanupWait','oauth','dropsTwitch','dropsPoe','unlink','waitUnlink'].includes(s.phase);
  $('manualStep').disabled=s.paused;
  $('export').disabled=!s.accounts.length;
  $('poe').disabled=!['ready','done'].includes(s.phase);
  $('cleanupExisting').disabled=!['ready','done'].includes(s.phase);
  if(!['ready','done'].includes(s.phase)) $('cleanupExisting').checked=s.cleanupExisting!==false;
  if (s.expectedPoe && document.activeElement!==$('poe')) $('poe').value=s.expectedPoe;
  const frag=document.createDocumentFragment();
  s.accounts.forEach((x,i)=>{const li=document.createElement('li');li.textContent=x.username+(x.status==='done'?' · готово':i===s.index&&s.phase!=='ready'?' · текущий':' · ожидает');li.className=x.status==='done'?'done':i===s.index?'active':'';frag.append(li);});
  $('list').replaceChildren(frag);
}
function bind(id,fn){$(id).addEventListener('click',async()=>{ $('error').textContent='';try{await fn();}catch(e){$('error').textContent=e.message;} });}
bind('import',async()=>{await send('import',{text:$('accounts').value});$('accounts').value='';$('file').value='';});
bind('start',()=>send('start',{expectedPoe:$('poe').value,cleanupExisting:$('cleanupExisting').checked}));
bind('diagnostics',async()=>{
  const r=await send('diagnostics');
  const blob=new Blob([JSON.stringify(r.diagnostics,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='poe-twitch-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
});
for(const id of ['pause','resume','focus','recover','reload','confirmLogin']) bind(id,()=>send(id));
bind('manualStep',async()=>{
  const user=state.accounts[state.index]?.username;
  const actions={preflight:'Я открыл аккаунт PoE '+state.expectedPoe+' и проверил, что Twitch не привязан.',oauth:'Я проверил: Twitch '+user+' привязан именно к PoE '+state.expectedPoe+'.',unlink:'Я завершил отвязку Twitch '+user+' от PoE '+state.expectedPoe+' и снова вижу кнопку Connect.',waitUnlink:'Я завершил отвязку Twitch '+user+' от PoE '+state.expectedPoe+' и снова вижу кнопку Connect.'};
  actions.cleanupUnlink=actions.cleanupWait='Я завершил отвязку прежнего Twitch '+state.cleanupTarget+' от PoE '+state.expectedPoe+' и снова вижу Connect.';
  actions.dropsTwitch=actions.dropsPoe='Я самостоятельно проверил и активировал доступные награды PoE для Twitch '+user+' на этой странице и дождался завершения.';
  if(confirm(actions[state.phase]+'\n\nПодтвердить этот результат вручную? В отчёте будет указано ручное подтверждение.')) await send('manualStep');
});
bind('clear',async()=>{if(confirm('Очистить очередь и пароли из памяти? Уже сделанные привязки на сайте сохранятся.')){await send('clear');$('accounts').value='';$('file').value='';}});
bind('export',()=>{
  const report={created:new Date().toISOString(),poe:state.expectedPoe,phase:state.phase,
    note:'Статус done означает подтверждённую отвязку. verifiedBy: page означает проверку страницы, user означает ручное подтверждение. activationClicks считает нажатия, а не выданные награды. Выдача наград не проверяется автоматически.',
    accounts:state.accounts};
  const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='poe-twitch-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
});
$('file').addEventListener('change',async()=>{const f=$('file').files[0];if(!f)return;if(f.size>100000){$('error').textContent='Для списка достаточно TXT до 100 КБ.';return;}$('accounts').value=await f.text();});
for(const id of ['loginVerified']) $(id).addEventListener('change',()=>{if(state)render(state);});
async function refresh(){if(rendering)return;rendering=true;try{await send('state');}catch{$('error').textContent='Расширение перезагружено. Обнови эту страницу.';}finally{rendering=false;}}
refresh();setInterval(refresh,1400);
