// «Для Агента» — поиск объектов от собственников Сочи. Вход — по логину и паролю (выдаёт администратор или регистрация
// с одобрением) или кнопкой «Сайт» в боте (Telegram Mini App). Данные — только из функции web; здесь нет ни ключей, ни данных.
const tg = window.Telegram?.WebApp;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};
const MSG = 'Здравствуйте! Ваше предложение по продаже в Сочи ещё актуально? Хотели уточнить несколько нюансов по просмотру.';
const KINDS = [['квартира', 'Квартиры'], ['апартаменты', 'Апартаменты'], ['дом', 'Дома'], ['коммерция', 'Коммерция'], ['участок', 'Участки']];
const ROOMS = [[0, 'Студия'], [1, '1'], [2, '2'], [3, '3'], [4, '4+']];
const FIN = [['designer', 'Дизайнерский'], ['modern', 'Современный'], ['euro', 'Евроремонт'], ['clean', 'Чистовая'], ['rough', 'Черновая']];
const FINL = { ...Object.fromEntries(FIN), whitebox: 'White box' };   // white box в фильтре нет, в данных — остаётся
const PMAX = 300;

let token = store.get('token', null);
let auth = token ? { token } : tg?.initData || null;
let me = null, meta = null;
let f = store.get('f2', {}), text = store.get('text', ''), sort = store.get('sort', 'new');
const mobile = () => innerWidth <= 760;
let lays = store.get('lay', {}), fclosed = store.get('fclosed', false);   // вид выдачи — свой для телефона и компьютера
const lay = () => lays[mobile() ? 'm' : 'd'] ?? (mobile() ? '3' : '6');
let favMode = false, beforeFav = null;   // «Избранное» не затирает сохранённые фильтры
let sel = new Set(store.get('sel', []));
let offset = 0, total = 0, busy = false, view = 'list', items = new Map();

// настройки — в браузере и на сервере (в Telegram браузерное хранилище бывает пустым при каждом запуске)
function savePrefs() {
  store.set('f2', f); store.set('text', text); store.set('sort', sort); store.set('lay', lays); store.set('fclosed', fclosed);
  clearTimeout(savePrefs.t);
  savePrefs.t = setTimeout(() => call('prefs', { prefs: { f, text, sort, lay: lays, fclosed } }).catch(() => {}), 700);
}

async function call(action, extra = {}) {
  const r = await fetch(window.API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, auth, ...extra }) });
  const data = await r.json().catch(() => ({ error: 'server', message: `Ошибка сервера (HTTP ${r.status})` }));
  if (['no_auth', 'no_access', 'expired', 'kicked', 'off'].includes(data.error)) throw Object.assign(new Error(data.message), { gate: data.error });
  if (!r.ok || data.error) throw new Error(data.message || data.error || `HTTP ${r.status}`);
  return data;
}
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, ms); }

// ---------- вход и регистрация ----------
function gate(html) { $('#gate').innerHTML = html; $('#gate').hidden = false; $('#app').hidden = true; }
const docs = '<a href="oferta.html" target="_blank">оферты</a>, <a href="rules.html" target="_blank">правил</a> и <a href="privacy.html" target="_blank">политики конфиденциальности</a>';

function showLogin(reason, tab = 'login') {
  token = null; store.set('token', null);
  if (reason === 'expired') {
    gate(`<h2>Доступ закончился</h2><p>Обратитесь за доступом к администратору — он продлит его.</p>
      <p class="muted">Тарифы — <a href="prices.html" target="_blank">на странице тарифов</a>.</p>
      <button class="btn ghost" id="relogin">Войти под другим логином</button>`);
    $('#relogin').onclick = () => { auth = null; showLogin(); };
    return;
  }
  const why = { no_access: 'Ваш Telegram не одобрен в боте. Войдите по логину и паролю.', kicked: 'Выполнен вход на другом устройстве — войдите снова.',
    off: 'Доступ закрыт — обратитесь к администратору.', no_auth: '' }[reason] ?? '';
  gate(`
    <div class="tabs2"><button class="seg ${tab === 'login' ? 'on' : ''}" data-tab="login">Вход</button><button class="seg ${tab === 'reg' ? 'on' : ''}" data-tab="reg">Регистрация</button></div>
    ${why ? `<p class="muted">${esc(why)}</p>` : ''}
    ${tab === 'login' ? `<form id="login" class="form">
      <input name="login" placeholder="Логин" autocomplete="username" autocapitalize="none" required>
      <input name="password" type="password" placeholder="Пароль" autocomplete="current-password" required>
      <button class="btn primary" type="submit">Войти</button>
      <p class="err" id="gerr"></p></form>
      <p class="hint">Сайт для риелторов: проверенные объекты от собственников Сочи.<br>Нет логина — зарегистрируйтесь, доступ откроет администратор.</p>`
    : `<form id="reg" class="form">
      <input name="name" placeholder="Имя и фамилия" required>
      <input name="phone" type="tel" placeholder="Телефон" required>
      <input name="email" type="email" placeholder="E-mail (необязательно)">
      <input name="company" placeholder="Агентство (необязательно)">
      <input name="login" placeholder="Придумайте логин (латиница)" autocapitalize="none" required>
      <input name="password" type="password" placeholder="Придумайте пароль (от 6 символов)" autocomplete="new-password" required>
      <label class="chk"><input type="checkbox" name="agree" required> <span>Принимаю условия ${docs}</span></label>
      <button class="btn primary" type="submit">Отправить заявку</button>
      <p class="err" id="gerr"></p></form>`}`);
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => showLogin(reason, b.dataset.tab));
  $('#login')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fm = e.target, btn = fm.querySelector('button');
    btn.disabled = true; $('#gerr').textContent = '';
    try {
      const r = await call('login', { login: fm.login.value, password: fm.password.value });
      token = r.token; store.set('token', token); auth = { token }; start();
    } catch (err) { $('#gerr').textContent = err.message; btn.disabled = false; }
  });
  $('#reg')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fm = e.target, btn = fm.querySelector('button');
    btn.disabled = true; $('#gerr').textContent = '';
    try {
      const r = await call('register', Object.fromEntries(['name', 'phone', 'email', 'company', 'login', 'password'].map(k => [k, fm[k].value]).concat([['agree', fm.agree.checked]])));
      gate(`<h2>Заявка отправлена</h2><p>${esc(r.message)}</p><button class="btn ghost" id="back">Ко входу</button>`);
      $('#back').onclick = () => showLogin();
    } catch (err) { $('#gerr').textContent = err.message; btn.disabled = false; }
  });
}
function logout() { token = null; auth = null; store.set('token', null); showLogin(); }

async function start() {
  tg?.ready(); tg?.expand(); try { tg?.disableVerticalSwipes?.(); } catch { /* старый Telegram */ }
  if (!auth) return showLogin();
  try { meta = await call('init'); }
  catch (e) { return e.gate ? showLogin(e.gate) : gate(`<h2>Ошибка</h2><p>${esc(e.message)}</p>`); }
  me = meta.me;
  const p = me.prefs;
  if (p && typeof p === 'object') {
    if (p.f && typeof p.f === 'object') f = p.f;
    if (typeof p.text === 'string') text = p.text;
    if (typeof p.sort === 'string') sort = p.sort;
    if (p.lay && typeof p.lay === 'object') lays = p.lay;
    if (typeof p.fclosed === 'boolean') fclosed = p.fclosed;
  }
  if (Array.isArray(f.fin)) { f.fin = f.fin.filter(x => FINL[x] && x !== 'whitebox'); if (!f.fin.length) delete f.fin; }
  document.title = 'Для Агента — объекты от собственников Сочи';
  $('#gate').hidden = true; $('#app').hidden = false;
  $('#who').textContent = me.name || me.login;
  if (me.role === 'admin') { $('#until').textContent = 'администратор'; $('#go-admin').hidden = false; }
  else if (me.expires_at) {
    const d = new Date(me.expires_at), left = Math.ceil((d - Date.now()) / 864e5);
    $('#until').textContent = `доступ до ${d.toLocaleDateString('ru-RU')}${left <= 5 ? ` · осталось ${left} дн.` : ''}`;
    $('#until').classList.toggle('warn', left <= 5);
  }
  $('#logout').hidden = !!me.tg;
  $('#go-map').hidden = !meta.features.map;
  document.querySelectorAll('[data-go="favs"]').forEach(b => b.hidden = !meta.features.favorites);
  document.querySelectorAll('[data-go="sels"]').forEach(b => b.hidden = !meta.features.selections);
  $('#q').value = text; $('#sort').value = sort;
  $('#filters').classList.toggle('closed', mobile() || fclosed);
  renderFilters(); selbar(); applyLay();
  search();
}

// ---------- фильтры ----------
const arr = k => Array.isArray(f[k]) ? f[k] : [];
function toggleIn(k, v) { const s = new Set(arr(k)); s.has(v) ? s.delete(v) : s.add(v); f[k] = [...s]; if (!f[k].length) delete f[k]; }
function chipRow(el, list, key) {
  el.innerHTML = list.map(([v, t]) => `<button type="button" class="chip${arr(key).includes(v) ? ' on' : ''}" data-v="${esc(v)}">${esc(t)}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; toggleIn(key, typeof list[0][0] === 'number' ? +b.dataset.v : b.dataset.v); renderFilters(); };
}
function renderFilters() {
  chipRow($('#f-kind'), KINDS, 'k');
  chipRow($('#f-rooms'), ROOMS, 'r');
  chipRow($('#f-fin'), FIN, 'fin');
  const flags = [['fz', 'ФЗ-214'], ['pool', 'Бассейн'], ['uniq', 'Только уникальные'], ['unseen', 'Непросмотренные'], ['fav', '★ Избранное']]
    .filter(([k]) => k !== 'fav' || meta.features.favorites);
  const modernOn = meta.features.modern_filter;
  $('#f-flags').innerHTML = flags.map(([k, t]) => `<button type="button" class="chip${f[k] ? ' on' : ''}" data-k="${k}">${t}</button>`).join('')
    + `<button type="button" class="chip${f.m ? ' on' : ''}" data-k="m" ${modernOn ? '' : 'disabled title="Скоро: ремонт по фото проверяется каждую ночь, кнопка включится, когда база будет проверена"'}>✨ Ремонт по фото${modernOn ? '' : ' (скоро)'}</button>`;
  $('#f-flags').onclick = e => { const b = e.target.closest('[data-k]'); if (!b || b.disabled) return; f[b.dataset.k] = !f[b.dataset.k] || undefined; renderFilters(); };
  for (const k of ['amin', 'amax', 'fmin', 'fmax']) $('#' + k).value = f[k] ?? '';
  $('#nf').checked = !!f.nf; $('#nl').checked = !!f.nl;
  $('#pmin').value = f.pmin ?? ''; $('#pmax').value = f.pmax ?? '';
  $('#pmin-r').value = f.pmin ?? 0; $('#pmax-r').value = f.pmax ?? PMAX; paintRange();
  const nd = arr('d').length, nz = arr('zk').length;
  $('#open-areas').textContent = nd ? `📍 Район: ${arr('d').map(k => meta.areas.find(a => a[0] === k)?.[1]).filter(Boolean).slice(0, 2).join(', ')}${nd > 2 ? ` +${nd - 2}` : ''}` : '📍 Район';
  $('#open-areas').classList.toggle('on', !!nd);
  $('#open-zk').textContent = nz ? `🏢 ЖК: ${nz}` : '🏢 ЖК';
  $('#open-zk').classList.toggle('on', !!nz);
  const n = Object.keys(f).filter(k => f[k] !== undefined && !(Array.isArray(f[k]) && !f[k].length)).length;
  $('#fcount').textContent = n ? `(${n})` : '';
}
function paintRange() {
  const a = +$('#pmin-r').value, b = +$('#pmax-r').value;
  $('#price-fill').style.left = `${a / PMAX * 100}%`; $('#price-fill').style.right = `${100 - b / PMAX * 100}%`;
}
function readInputs() {
  for (const k of ['amin', 'amax', 'fmin', 'fmax', 'pmin', 'pmax']) { const v = +$('#' + k).value; if (v > 0) f[k] = v; else delete f[k]; }
  if (f.pmax >= PMAX) delete f.pmax;
  f.nf = $('#nf').checked || undefined; f.nl = $('#nl').checked || undefined;
}
$('#pmin-r').addEventListener('input', () => {
  let a = +$('#pmin-r').value, b = +$('#pmax-r').value; if (a > b) { a = b; $('#pmin-r').value = a; }
  $('#pmin').value = a || ''; paintRange(); readInputs();
});
$('#pmax-r').addEventListener('input', () => {
  let a = +$('#pmin-r').value, b = +$('#pmax-r').value; if (b < a) { b = a; $('#pmax-r').value = b; }
  $('#pmax').value = b >= PMAX ? '' : b; paintRange(); readInputs();
});
for (const k of ['pmin', 'pmax']) $('#' + k).addEventListener('input', () => {
  const v = +$('#' + k).value; $(`#${k}-r`).value = v > 0 ? Math.min(v, PMAX) : (k === 'pmin' ? 0 : PMAX); paintRange();
});
// поля сразу попадают в фильтр: иначе нажатие на любую кнопку фильтра стирало набранную площадь, этаж и цену
for (const k of ['amin', 'amax', 'fmin', 'fmax', 'pmin', 'pmax']) $('#' + k).addEventListener('input', readInputs);
for (const k of ['nf', 'nl']) $('#' + k).addEventListener('change', readInputs);
$('#toggle-f').onclick = () => { fclosed = $('#filters').classList.toggle('closed'); if (!mobile()) savePrefs(); };
$('#apply').onclick = () => { readInputs(); if (mobile()) $('#filters').classList.add('closed'); changed(); };
$('#reset').onclick = () => { f = {}; text = ''; $('#q').value = ''; leaveFav(); renderFilters(); changed(); };
$('#sort').onchange = () => { sort = $('#sort').value; savePrefs(); search(); };
$('#qform').addEventListener('submit', e => { e.preventDefault(); text = $('#q').value.trim(); readInputs(); $('#q').blur(); changed(); });
function changed() {
  f = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
  if (!favMode) savePrefs();
  renderFilters();
  view === 'map' ? loadMap() : search();
}
function leaveFav() { favMode = false; beforeFav = null; document.querySelectorAll('[data-go="favs"]').forEach(b => b.classList.remove('on')); }
function applyLay() {
  const l = lay();
  $('#list').classList.remove('l1', 'l3', 'l6'); $('#list').classList.add('l' + l);
  document.querySelectorAll('[data-lay]').forEach(b => b.classList.toggle('on', b.dataset.lay === l));
}
document.querySelectorAll('[data-lay]').forEach(b => b.onclick = () => { lays = { ...lays, [mobile() ? 'm' : 'd']: b.dataset.lay }; applyLay(); savePrefs(); });

// окна: районы, ЖК
function sheet(title, html, wide = false) {
  $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html;
  $('#sheet').classList.toggle('wide', wide); $('#sheet').hidden = false; tg?.BackButton.show();
}
function closeSheet() { if ($('#sheet').hidden) return; $('#sheet').hidden = true; if ($('#viewer').hidden) tg?.BackButton.hide(); }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet(); });
tg?.BackButton.onClick(() => $('#viewer').hidden ? closeSheet() : closeViewer());
const opt = (name, value, label, checked, note = '') =>
  `<label class="opt"><input type="checkbox" name="${name}" value="${esc(value)}"${checked ? ' checked' : ''}><span>${esc(label)}</span>${note !== '' ? `<em>${esc(note)}</em>` : ''}</label>`;
$('#open-areas').onclick = () => {
  const big = meta.areas.filter(a => !a[0].startsWith('m'));
  sheet('Район и микрорайон', `<div class="group">Районы</div>${big.map(a => opt('d', a[0], a[1], arr('d').includes(a[0]))).join('')}
    <div class="group">Микрорайоны</div>${meta.areas.filter(a => a[0].startsWith('m')).map(a => opt('d', a[0], a[1], arr('d').includes(a[0]))).join('')}
    <div class="sheet-foot"><button class="btn ghost" id="s-clear">Сбросить</button><button class="btn primary" data-close>Готово</button></div>`);
  bindChecks('d', false);
};
$('#open-zk').onclick = () => {
  sheet('ЖК', `<input id="zk-find" type="search" placeholder="Найти ЖК"><div id="zk-list"></div>
    <div class="sheet-foot"><button class="btn ghost" id="s-clear">Сбросить</button><button class="btn primary" data-close>Готово</button></div>`);
  const draw = () => {
    const q = $('#zk-find').value.trim().toLowerCase();
    $('#zk-list').innerHTML = meta.zk.filter(z => !q || z.name.toLowerCase().includes(q)).map(z => opt('zk', z.id, z.name, arr('zk').includes(z.id), z.n)).join('') || '<p class="muted">Не нашёл такой ЖК</p>';
  };
  $('#zk-find').oninput = draw; draw();
  bindChecks('zk', true);
};
function bindChecks(key, num) {
  $('#sheet-body').onchange = e => { const i = e.target; if (i.name !== key) return; toggleIn(key, num ? +i.value : i.value); renderFilters(); };
  $('#s-clear').onclick = () => { delete f[key]; renderFilters(); $('#sheet-body').querySelectorAll('input[type=checkbox]').forEach(i => i.checked = false); };
}

// ---------- выдача ----------
const mln = v => (v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const rub = v => Math.round(v).toLocaleString('ru-RU') + ' ₽';
const zkName = c => c ? 'ЖК ' + String(c).replace(/(^|\s)ЖК(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim() : '';
function what(x) {
  if (x.kind === 'участок') return `Участок${x.land ? ` ${x.land} сот.` : ''}${x.use_land ? ` · ${x.use_land}` : ''}`;
  if (x.kind === 'коммерция') return [x.type_name || 'Коммерция', x.area && `${x.area} м²`].filter(Boolean).join(' · ');
  if (x.kind === 'дом') return [x.type_name || 'Дом', x.area && `${x.area} м²`, x.land && `участок ${x.land} сот.`].filter(Boolean).join(' · ');
  const t = x.rooms === 0 ? 'Студия' : `${x.rooms ?? '?'}-комн. ${x.kind === 'апартаменты' ? 'апартаменты' : 'квартира'}`;
  return [t, x.area && `${x.area} м²`, x.floor && `${x.floor}/${x.floors ?? '?'} эт.`].filter(Boolean).join(' · ');
}
const photoUrl = (x, k) => `${meta.photos}/${x.num}/${k}.jpg`;

async function search(more = false) {
  if (busy) return;
  busy = true;
  if (!more) { offset = 0; items.clear(); $('#list').innerHTML = ''; $('#status').textContent = 'Ищу…'; $('#more').hidden = true; }
  $('#more').disabled = true;
  try {
    const r = await call('search', { f, text, offset, sort });
    total = r.count;
    r.items.forEach(x => items.set(x.num, x));
    $('#list').insertAdjacentHTML('beforeend', r.items.map(card).join(''));
    offset += r.items.length;
    $('#status').textContent = (total ? `Найдено: ${total.toLocaleString('ru-RU')}` : 'Ничего не нашёл — попробуйте убрать часть фильтров') + (r.understood ? ` · понял запрос так: ${r.understood}` : '');
    $('#more').hidden = offset >= total;
    $('#more').textContent = `Показать ещё ${Math.min(r.page, total - offset)} из ${(total - offset).toLocaleString('ru-RU')}`;
  } catch (e) {
    if (e.gate) return showLogin(e.gate);
    $('#status').textContent = `Ошибка поиска: ${e.message}`;
  } finally { busy = false; $('#more').disabled = false; }
}
$('#more').addEventListener('click', () => search(true));

function gallery(x) {
  const n = x.web_photos || 0;
  return `<div class="gal" data-n="${n}">
    <div class="strip">${n ? Array.from({ length: n }, (_, k) => `<div class="ph"><img src="${esc(photoUrl(x, k))}" alt="" loading="lazy" data-k="${k}"></div>`).join('')
      : '<div class="none">Фото загружаются<br>(обновляются каждую ночь)</div>'}</div>
    ${n > 1 ? `<button class="nav l" data-nav="-1" aria-label="Назад">‹</button><button class="nav r" data-nav="1" aria-label="Вперёд">›</button>
      <div class="dots">${Array.from({ length: n }, (_, k) => `<i class="${k ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    ${meta.features.selections ? `<label class="pick"><input type="checkbox" data-sel ${sel.has(x.num) ? 'checked' : ''}> В подборку</label>` : ''}
    ${meta.features.favorites ? `<button class="fav${x.fav ? ' on' : ''}" data-fav aria-label="В избранное">${x.fav ? '★' : '☆'}</button>` : ''}
    ${x.seen ? '<span class="seenmark">Просмотрено</span>' : ''}
  </div>`;
}
// вертикальное фото — целиком на размытом фоне, горизонтальное — на всю рамку 4:3 (низ с водяными знаками обрезается)
document.addEventListener('load', e => {
  const im = e.target;
  if (im.tagName !== 'IMG' || !im.parentElement?.classList.contains('ph')) return;
  if (im.naturalHeight > im.naturalWidth * 1.05) { im.parentElement.classList.add('tall'); im.parentElement.style.setProperty('--bg', `url("${im.src}")`); }
}, true);
function tags(x) {
  return [...(x.finish || []).map(t => `<span class="tag">${FINL[t] ?? t}</span>`),
    x.fz214 ? '<span class="tag">ФЗ-214</span>' : '', x.pool ? '<span class="tag">Бассейн</span>' : '',
    x.ad_state === 'unique' ? '<span class="tag ok">Уникальна</span>' : x.ad_state === 'ads' ? '<span class="tag grey">Есть в рекламе</span>' : ''].join('');
}
function card(x) {
  const ppm = x.price && x.area ? `${Math.round(x.price / x.area).toLocaleString('ru-RU')} ₽/м²` : '';
  const where = [zkName(x.complex), x.address, x.mkr].filter(Boolean).join(' · ');
  const date = x.created_at ? new Date(x.created_at).toLocaleDateString('ru-RU') : '—';
  return `<article class="card${x.seen ? ' seen' : ''}" data-num="${x.num}">
    ${gallery(x)}
    <div class="body">
      <div class="price${x.ad_state === 'unique' ? ' uniq' : ''}"><b>${x.price ? rub(x.price) : 'Цена не указана'}</b><small>${ppm}</small></div>
      <div class="title" data-open>${esc(what(x))}</div>
      <div class="addr">${esc(where)}</div>
      <div class="tags">${tags(x)}</div>
      <div class="meta">Добавлено ${date} · № ${x.num}</div>
      ${x.descr ? `<details data-d><summary>Описание</summary><p>${esc(x.descr)}</p></details>` : ''}
      ${x.note ? `<div class="note">📝 ${esc(x.note)}</div>` : ''}
      <div class="actions">${x.phone ? phoneBox(x.phone, null) : '<button class="btn soft" data-phone>📞 Телефон</button>'}
        ${meta.features.notes ? '<button class="btn ghost" data-note>📝 Заметка</button>' : ''}</div>
    </div>
  </article>`;
}
function phoneBox(p, owner) {
  const d = p.replace(/\D/g, ''), t = encodeURIComponent(MSG);
  return `<div class="phone"><div><a class="num" href="tel:${esc(p)}">${esc(p)}</a>${owner ? ` — ${esc(owner)}` : ''} <small>может быть подменный</small></div>
    ${meta.features.messengers ? `<div class="msgs"><a class="m-call" href="tel:${esc(p)}">Позвонить</a>
      <a class="m-wa" href="https://wa.me/${d}?text=${t}" target="_blank" rel="noopener">WhatsApp</a>
      <button class="m-copy" data-copy="${esc(p)}">Копировать</button></div>` : ''}</div>`;
}

// действия в карточке
$('#list').addEventListener('click', e => onCard(e, e.target.closest('.card')));
async function onCard(e, cardEl) {
  if (!cardEl) return;
  const num = +cardEl.dataset.num, x = items.get(num);
  const t = e.target;
  if (t.closest('[data-nav]')) { const g = t.closest('.gal'); const s = g.querySelector('.strip'); s.scrollBy({ left: s.clientWidth * +t.closest('[data-nav]').dataset.nav, behavior: 'smooth' }); return; }
  if (t.closest('[data-sel]')) { const c = t.closest('[data-sel]'); c.checked ? sel.add(num) : sel.delete(num); store.set('sel', [...sel]); selbar(); return; }
  if (t.closest('.pick')) return;
  if (t.closest('[data-fav]')) {
    const b = t.closest('[data-fav]'), on = !b.classList.contains('on');
    b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; if (x) x.fav = on;
    call('fav', { num, on }).catch(err => toast(err.message));
    return;
  }
  if (t.matches('.strip img')) { openViewer(t.closest('.strip'), +t.dataset.k); markSeen(cardEl, num); return; }
  if (t.closest('[data-open]')) { openItem(num); return; }
  if (t.closest('summary')) { markSeen(cardEl, num); return; }
  if (t.closest('[data-copy]')) { copy(t.closest('[data-copy]').dataset.copy, 'Номер скопирован'); return; }
  if (t.closest('[data-note]')) { noteSheet(num, x); return; }
  const b = t.closest('[data-phone]');
  if (!b) return;
  const box = b.parentElement;
  b.disabled = true; b.textContent = 'Узнаю номер…';
  try {
    const p = await call('phone', { num });
    if (!p.phone) throw new Error(p.error || 'номер не найден');
    b.outerHTML = phoneBox(p.phone, p.owner);
    if (x) { x.phone = p.phone; x.ad_state = p.ad_state ?? x.ad_state; }
    markSeen(cardEl, num);
  } catch (err) {
    if (err.gate) return showLogin(err.gate);
    b.disabled = false; b.textContent = '📞 Телефон';
    box.querySelector('.err')?.remove();
    box.insertAdjacentHTML('beforeend', `<span class="err">${esc(err.message)}</span>`);
  }
}
$('#list').addEventListener('scroll', e => {
  const s = e.target; if (!s.classList?.contains('strip')) return;
  const k = Math.round(s.scrollLeft / s.clientWidth);
  s.parentElement.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i === k));
}, true);
function markSeen(cardEl, num) {
  const x = items.get(num);
  if (!x || x.seen) return;
  x.seen = true; cardEl?.classList.add('seen');
  cardEl?.querySelector('.gal')?.insertAdjacentHTML('beforeend', '<span class="seenmark">Просмотрено</span>');
  call('view', { num }).catch(() => {});
}
function copy(t, msg) { navigator.clipboard?.writeText(t).then(() => toast(msg), () => toast(t)); }
function noteSheet(num, x) {
  sheet(`Заметка к № ${num}`, `<textarea id="note-t" rows="5" placeholder="Видно только вам">${esc(x?.note ?? '')}</textarea>
    <div class="sheet-foot"><button class="btn ghost" data-close>Отмена</button><button class="btn primary" id="note-save">Сохранить</button></div>`);
  $('#note-save').onclick = async () => {
    const v = $('#note-t').value.trim();
    try { await call('note', { num, text: v }); if (x) x.note = v || null; closeSheet(); rerender(num); toast('Заметка сохранена'); }
    catch (e) { toast(e.message); }
  };
}
function rerender(num) {
  const el = document.querySelector(`.card[data-num="${num}"]`), x = items.get(num);
  if (el && x) el.outerHTML = card(x);
}

// объект целиком (карта, заголовок)
async function openItem(num) {
  let x = items.get(num);
  try { const r = await call('item', { num }); x = r.item; items.set(num, x); } catch (e) { if (e.gate) return showLogin(e.gate); if (!x) return toast(e.message); }
  sheet(`№ ${num}`, `<div class="list l1">${card({ ...x, seen: false }).replace('<details data-d>', '<details data-d open>')}</div>`, true);
  const el = $('#sheet-body .card');
  el.addEventListener('click', e => onCard(e, el));
  document.querySelector(`#list .card[data-num="${num}"]`) && markSeen(document.querySelector(`#list .card[data-num="${num}"]`), num);
}

// ---------- фото на весь экран ----------
function openViewer(strip, i) {
  const v = $('#viewer'), s = v.querySelector('.viewer-strip'), imgs = [...strip.querySelectorAll('img')];
  s.innerHTML = imgs.map(im => `<img src="${esc(im.src)}" alt="">`).join('');
  v.hidden = false; s.scrollLeft = i * s.clientWidth;
  const count = () => {
    const k = Math.round(s.scrollLeft / s.clientWidth);
    v.querySelector('.viewer-count').textContent = `${k + 1} / ${imgs.length}`;
    v.querySelector('.viewer-nav.l').hidden = k <= 0; v.querySelector('.viewer-nav.r').hidden = k >= imgs.length - 1;
  };
  s.onscroll = count; count();
  tg?.BackButton.show();
}
function closeViewer() { $('#viewer').hidden = true; if ($('#sheet').hidden) tg?.BackButton.hide(); }
const viewerStep = d => { const s = $('.viewer-strip'); s.scrollBy({ left: s.clientWidth * d, behavior: 'smooth' }); };
$('#viewer').addEventListener('click', e => {
  const n = e.target.closest('[data-vnav]');
  if (n) return viewerStep(+n.dataset.vnav);
  if (e.target.closest('.viewer-close') || e.target.tagName !== 'IMG') closeViewer();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeViewer(); closeSheet(); }
  if (!$('#viewer').hidden && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) viewerStep(e.key === 'ArrowRight' ? 1 : -1);
});

// ---------- подборка ----------
function selbar() {
  $('#selbar').hidden = !sel.size || !meta?.features.selections;
  $('#selcount').textContent = `Выбрано: ${sel.size}`;
}
$('#sel-clear').onclick = () => { sel.clear(); store.set('sel', []); selbar(); document.querySelectorAll('[data-sel]').forEach(c => c.checked = false); };
$('#sel-make').onclick = () => {
  const prof = store.get('agent', { name: me.name || '', phone: '' });
  sheet('Подборка в PDF', `
    <label class="field">Название<input id="s-title" placeholder="Например: Для Ивана — 2к до 15 млн" maxlength="80"></label>
    <div class="hint">Сразу два PDF: <b>клиенту</b> — без контактов собственника, цены с вашей комиссией; <b>агенту</b> — цены собственника, телефоны и пометка «Уникальна».
      Неоткрытые телефоны откроются сами в пределах ваших лимитов.</div>
    <label class="field">Комиссия сверху цены (для клиента): <b id="s-mk-v">5%</b><input id="s-mk" type="range" min="0" max="10" step="0.5" value="5"></label>
    <div class="hint">Цены в PDF клиенту будут увеличены на этот процент (округление до 10 000 ₽). 0% — цены собственника.</div>
    <label class="field">Ваше имя в PDF<input id="s-name" value="${esc(prof.name)}"></label>
    <label class="field">Ваш телефон в PDF<input id="s-phone" type="tel" value="${esc(prof.phone)}"></label>
    <div class="hint">Объектов: ${sel.size} (до 30). Фото и описания — из нашей базы, источники не указываются. PDF хранится 7 дней во вкладке «Мои подборки».</div>
    <p class="err" id="s-err"></p>
    <div class="sheet-foot"><button class="btn ghost" data-close>Отмена</button><button class="btn primary" id="s-go">Сформировать</button></div>`);
  $('#s-mk').oninput = () => $('#s-mk-v').textContent = `${$('#s-mk').value}%`;
  $('#s-go').onclick = async () => {
    const b = $('#s-go'); b.disabled = true; b.textContent = 'Собираю два PDF… (до минуты)'; $('#s-err').textContent = '';
    store.set('agent', { name: $('#s-name').value, phone: $('#s-phone').value });
    try {
      const r = await call('sel_create', { nums: [...sel], title: $('#s-title').value, markup: +$('#s-mk').value,
        agent: $('#s-name').value, agent_phone: $('#s-phone').value });
      $('#sheet-body').innerHTML = `<p>Подборка готова — два PDF.</p>
        <div class="sheet-foot"><a class="btn primary" href="${esc(r.url)}" target="_blank" rel="noopener" data-url="${esc(r.url)}">PDF клиенту</a>
        <a class="btn soft" href="${esc(r.url_agent)}" target="_blank" rel="noopener" data-url="${esc(r.url_agent)}">PDF агенту (с телефонами)</a></div>
        ${r.phones < r.total ? `<p class="hint">Телефоны в PDF агенту: ${r.phones} из ${r.total} — остальные не открылись (лимит номеров или у объявления нет мобильного).</p>` : ''}
        <p class="hint">Ссылки действуют час; сама подборка хранится 7 дней во вкладке «Мои подборки».</p>`;
      if (tg?.openLink) $('#sheet-body').onclick = ev => { const a = ev.target.closest('[data-url]'); if (a) { ev.preventDefault(); tg.openLink(a.dataset.url); } };
    } catch (e) { if (e.gate) return showLogin(e.gate); $('#s-err').textContent = e.message; b.disabled = false; b.textContent = 'Сформировать'; }
  };
};
async function showSelections() {
  sheet('Мои подборки', '<p class="muted">Загрузка…</p>');
  try {
    const r = await call('sel_list');
    $('#sheet-body').innerHTML = r.items.length ? r.items.map(s => `<div class="opt" style="cursor:default"><span><b>${esc(s.title)}</b><br>
      <small class="muted">${new Date(s.created_at).toLocaleString('ru-RU')} · ${{ agent: 'для агента · ', client: 'для клиента · ' }[s.mode] ?? ''}+${s.markup}% · объектов: ${s.nums.length}<br>
      удалится ${new Date(Date.parse(s.created_at) + 7 * 864e5).toLocaleDateString('ru-RU')}</small></span>
      ${s.url ? `<a class="btn soft" href="${esc(s.url)}" target="_blank" rel="noopener" data-url="${esc(s.url)}">${s.url_agent ? 'Клиенту' : 'PDF'}</a>` : ''}
      ${s.url_agent ? `<a class="btn soft" href="${esc(s.url_agent)}" target="_blank" rel="noopener" data-url="${esc(s.url_agent)}">Агенту</a>` : ''}
      <button class="btn ghost" data-again="${s.nums.join(',')}">В подборку</button></div>`).join('')
      : '<p class="muted">Подборок за последние 7 дней нет. Отметьте объекты галочкой «В подборку» и нажмите «Сформировать PDF».</p>';
    $('#sheet-body').onclick = e => {
      const a = e.target.closest('[data-url]'); if (a && tg?.openLink) { e.preventDefault(); tg.openLink(a.dataset.url); }
      const g = e.target.closest('[data-again]'); if (g) { g.dataset.again.split(',').forEach(n => sel.add(+n)); store.set('sel', [...sel]); selbar(); toast('Объекты добавлены в подборку'); }
    };
  } catch (e) { if (e.gate) return showLogin(e.gate); $('#sheet-body').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ---------- карта ----------
let map = null, cluster = null;
async function loadMap() {
  if (!window.L) return toast('Карта ещё загружается…');
  if (!map) {
    map = L.map('map', { zoomControl: true }).setView([43.585, 39.723], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  }
  [50, 400].forEach(ms => setTimeout(() => map.invalidateSize(), ms));
  $('#status').textContent = 'Загружаю точки…';
  try {
    const r = await call('map', { f, text });
    cluster?.remove();
    cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
    for (const [num, lat, lng, price, rooms, kind, area, floor, floors, addr, ph] of r.points) {
      const m = L.marker([lat, lng]);
      m.bindPopup(() => `<div class="mpop">${ph ? `<img src="${esc(photoUrl({ num }, 0))}" alt="" data-num="${num}">` : ''}
        <b>${price ? mln(price) + ' млн ₽' : ''}</b><br>${esc(what({ kind, rooms, area, floor, floors }))}${addr ? `<br><span class="a">${esc(addr)}</span>` : ''}
        <br><a href="#" data-num="${num}">Открыть № ${num}</a></div>`, { minWidth: 220, maxWidth: 240 });
      cluster.addLayer(m);
    }
    map.addLayer(cluster);
    if (r.points.length) map.fitBounds(cluster.getBounds(), { maxZoom: 15, padding: [20, 20] });
    $('#status').textContent = `На карте: ${r.points.length.toLocaleString('ru-RU')}${r.points.length >= 4000 ? ' (первые 4000 — уточните фильтры)' : ''}`;
  } catch (e) { if (e.gate) return showLogin(e.gate); $('#status').textContent = `Ошибка карты: ${e.message}`; }
}
$('#map').addEventListener('click', e => { const a = e.target.closest('[data-num]'); if (a) { e.preventDefault(); openItem(+a.dataset.num); } });
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
  $('#list').hidden = view === 'map'; $('#map').hidden = view !== 'map'; $('#more').hidden = view === 'map' || offset >= total; $('#layouts').hidden = view === 'map';
  view === 'map' ? loadMap() : search();
});

// ---------- меню ----------
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
  const g = b.dataset.go;
  if (g === 'favs') {
    if (favMode) { ({ f, text } = beforeFav); $('#q').value = text; leaveFav(); changed(); return; }
    beforeFav = { f, text }; favMode = true; b.classList.add('on');
    f = { fav: true }; text = ''; $('#q').value = ''; changed();
    toast('Показано избранное — нажмите «★ Избранное» ещё раз, чтобы вернуться к поиску', 4000);
  }
  if (g === 'sels') showSelections();
  if (g === 'admin') admin();
});
$('#logout').onclick = logout;

// ---------- админ-панель ----------
const FEAT = { map: 'Карта', favorites: 'Избранное', selections: 'Подборки PDF', messengers: 'Кнопки мессенджеров', registration: 'Регистрация на сайте',
  modern_filter: 'Фильтр «Ремонт по фото»', notes: 'Заметки к объектам', compare: 'Сравнение (резерв)' };
const LIM = { phone_hour: 'Телефонов в час', phone_day: 'Телефонов в сутки', sel_hour: 'Подборок в час', max_sessions: 'Одновременных входов', access_days: 'Дней доступа по умолчанию' };
async function admin() {
  sheet('Админ-панель', '<p class="muted">Загрузка…</p>', true);
  let r;
  try { r = await call('admin_users'); } catch (e) { $('#sheet-body').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const day = s => s ? new Date(s).toLocaleDateString('ru-RU') : '—';
  const pend = r.users.filter(u => u.status === 'pending');
  const row = u => `<tr data-login="${esc(u.login)}">
    <td><b>${esc(u.name || '')}</b><br><small>${esc(u.login)}${u.tg_id ? ' · Telegram' : ''}</small><br><small>${esc([u.phone, u.email, u.company].filter(Boolean).join(' · '))}</small></td>
    <td class="st-${u.status}">${{ pending: 'заявка', active: 'активен', off: 'отключён' }[u.status]}${u.role === 'admin' ? '<br><b>админ</b>' : ''}</td>
    <td>${u.role === 'admin' ? '∞' : day(u.expires_at)}<br><small class="muted">вход: ${day(u.last_login)}</small></td>
    <td>${u.phones_day} тел. / ${u.pdfs_day} PDF<br><small class="muted">входов: ${u.sessions}</small></td>
    <td><input data-lim="lim_phone_hour" placeholder="${r.limits.phone_hour}" value="${u.lim_phone_hour ?? ''}" title="телефонов в час">
      <input data-lim="lim_phone_day" placeholder="${r.limits.phone_day}" value="${u.lim_phone_day ?? ''}" title="телефонов в сутки"><br>
      <input data-lim="lim_sel_hour" placeholder="${r.limits.sel_hour}" value="${u.lim_sel_hour ?? ''}" title="подборок в час">
      <input data-lim="max_sessions" placeholder="${r.limits.max_sessions}" value="${u.max_sessions ?? ''}" title="одновременных входов"></td>
    <td class="row-actions">
      ${u.status !== 'active' ? '<button class="btn primary" data-a="approve">Одобрить +30 дн.</button>' : '<button class="btn soft" data-a="plus">+30 дней</button>'}
      ${u.status !== 'off' ? '<button class="btn ghost" data-a="off">Отключить</button>' : ''}
      <button class="btn ghost" data-a="lims">Сохранить лимиты</button>
      <button class="btn ghost" data-a="pass">Новый пароль</button>
      <button class="btn ghost" data-a="kick">Выкинуть входы</button>
      <button class="btn ghost" data-a="role">${u.role === 'admin' ? 'Снять админа' : 'Сделать админом'}</button>
      <input type="date" data-a="date" value="${u.expires_at ? u.expires_at.slice(0, 10) : ''}" title="доступ до">
    </td></tr>`;
  $('#sheet-body').innerHTML = `
    ${pend.length ? `<div class="group">Заявки на доступ: ${pend.length}</div>` : ''}
    <div class="group">Участники (${r.users.length})</div>
    <input id="a-find" type="search" placeholder="Поиск по имени, логину, телефону">
    <div class="ascroll"><table class="atable"><thead><tr><th>Участник</th><th>Статус</th><th>Доступ до</th><th>Сегодня</th><th>Лимиты: тел/час, тел/сут, PDF/час, входов</th><th></th></tr></thead>
      <tbody id="a-rows">${[...pend, ...r.users.filter(u => u.status !== 'pending')].map(row).join('')}</tbody></table></div>
    <div class="group">Добавить участника</div>
    <form id="a-new" class="agrid"><input name="login" placeholder="логин (латиница)" required><input name="password" placeholder="пароль (от 6)" required>
      <input name="name" placeholder="Имя"><input name="phone" placeholder="Телефон"><input name="days" type="number" value="30" title="дней доступа">
      <button class="btn primary">Добавить</button></form>
    <div class="group">Лимиты по умолчанию (для всех, кроме админов)</div>
    <form id="a-lim" class="agrid">${Object.entries(LIM).map(([k, t]) => `<label class="field">${t}<input name="${k}" type="number" min="0" value="${r.limits[k]}"></label>`).join('')}
      <button class="btn primary">Сохранить лимиты</button></form>
    <div class="group">Инструменты сайта (можно выключить)</div>
    <form id="a-feat" class="agrid">${Object.entries(FEAT).map(([k, t]) => `<label class="chk opt"><input type="checkbox" name="${k}" ${r.features[k] ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      <button class="btn primary">Сохранить</button></form>`;
  $('#a-find').oninput = () => { const q = $('#a-find').value.toLowerCase(); document.querySelectorAll('#a-rows tr').forEach(tr => tr.hidden = !tr.textContent.toLowerCase().includes(q)); };
  const save = async (login, set, kick = false) => {
    try { const x = await call('admin_user', { login, set, kick }); if (x.error) throw new Error(x.message); toast('Сохранено'); admin(); } catch (e) { toast(e.message); }
  };
  $('#a-rows').onclick = e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const tr = b.closest('tr'), login = tr.dataset.login, a = b.dataset.a;
    if (a === 'approve') save(login, { status: 'active', add_days: 30 });
    if (a === 'plus') save(login, { add_days: 30 });
    if (a === 'off' && confirm(`Отключить ${login}?`)) save(login, { status: 'off' });
    if (a === 'kick') save(login, {}, true);
    if (a === 'role') save(login, { role: b.textContent.startsWith('Снять') ? 'user' : 'admin' });
    if (a === 'pass') { const p = prompt(`Новый пароль для ${login} (от 6 символов):`); if (p) save(login, { password: p }); }
    if (a === 'lims') save(login, Object.fromEntries([...tr.querySelectorAll('[data-lim]')].map(i => [i.dataset.lim, i.value])));
  };
  $('#a-rows').onchange = e => { const i = e.target.closest('input[data-a="date"]'); if (i) save(i.closest('tr').dataset.login, { expires_at: i.value ? new Date(i.value + 'T23:59:00').toISOString() : null }); };
  $('#a-new').onsubmit = async e => {
    e.preventDefault(); const fm = e.target;
    try { const x = await call('admin_create', Object.fromEntries(['login', 'password', 'name', 'phone', 'days'].map(k => [k, fm[k].value]))); if (x.error) throw new Error(x.message); toast('Участник добавлен'); admin(); }
    catch (err) { toast(err.message); }
  };
  $('#a-lim').onsubmit = async e => {
    e.preventDefault(); const fm = e.target;
    try { await call('admin_settings', { limits: Object.fromEntries(Object.keys(LIM).map(k => [k, fm[k].value])) }); toast('Лимиты сохранены'); } catch (err) { toast(err.message); }
  };
  $('#a-feat').onsubmit = async e => {
    e.preventDefault(); const fm = e.target;
    try { const x = await call('admin_settings', { features: Object.fromEntries(Object.keys(FEAT).map(k => [k, fm[k].checked])) }); meta.features = x.features; renderFilters(); toast('Сохранено'); }
    catch (err) { toast(err.message); }
  };
}

start();
