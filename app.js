// Поиск объектов от собственников Сочи. Вход — по логину и паролю (выдаёт администратор) или кнопкой «Сайт» в боте
// (Telegram Mini App, одобренные участники). Данные — только из функции web в Supabase; здесь нет ни ключей, ни данных.
const tg = window.Telegram?.WebApp;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};

const KINDS = [['', 'Все'], ['квартира', 'Квартиры'], ['апартаменты', 'Апартаменты'], ['дом', 'Дома']];
const ROOMS = [[0, 'Студия'], [1, '1'], [2, '2'], [3, '3'], [4, '4+']];
const REPAIR = { modern: 'современный ✅ (по фото)', good: 'жилой, не современный (по фото)', old: 'старый (по фото)',
  none: 'без отделки (по фото)', unclear: 'по фото не понять' };

let token = store.get('token', null);
let auth = token ? { token } : tg?.initData || null;
let meta = null;                       // ЖК, районы, бюджеты — с сервера
let f = store.get('f', {});            // фильтры как в «🔎 Подбор» бота: zk, d, b, r, k, m
let text = store.get('text', '');
let offset = 0, total = 0, busy = false;

async function call(action, extra = {}) {
  const r = await fetch(window.API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, auth, ...extra }) });
  const data = await r.json().catch(() => ({ error: 'server' }));
  if (data.error === 'no_auth' || data.error === 'no_access') throw Object.assign(new Error(data.error), { gate: data.error });
  if (!r.ok || data.error) throw new Error(data.message || data.error || `HTTP ${r.status}`);
  return data;
}

// ---------- вход ----------
function gate(html) { $('#gate').innerHTML = html; $('#gate').hidden = false; $('#app').hidden = true; }

function showLogin(reason) {
  store.set('token', null);
  const msg = reason === 'no_access' ? 'Ваш Telegram не одобрен в боте. Войдите по логину и паролю от администратора.'
    : reason === 'expired' ? 'Сессия закончилась — войдите снова.' : 'Сайт только для участников сообщества. Логин и пароль выдаёт администратор.';
  gate(`<h2>Собственники Сочи</h2><p>${esc(msg)}</p>
    <form id="login" class="login">
      <input name="login" placeholder="Логин" autocomplete="username" autocapitalize="none" required>
      <input name="password" type="password" placeholder="Пароль" autocomplete="current-password" required>
      <button class="btn primary" type="submit">Войти</button>
      <p id="login-err" class="err"></p>
    </form>`);
  $('#login').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target, btn = form.querySelector('button');
    btn.disabled = true;
    $('#login-err').textContent = '';
    try {
      const r = await call('login', { login: form.login.value, password: form.password.value });
      token = r.token;
      store.set('token', token);
      auth = { token };
      start();
    } catch (err) {
      $('#login-err').textContent = err.message;
      btn.disabled = false;
    }
  });
}
function logout() { token = null; auth = null; showLogin(); }

async function start() {
  tg?.ready();
  tg?.expand();
  if (!auth) return showLogin();
  try { meta = await call('init'); }
  catch (e) { return e.gate ? showLogin(token ? 'expired' : e.gate) : gate(`<h2>Ошибка</h2><p>${esc(e.message)}</p>`); }
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = meta.name || '';
  $('#logout').hidden = !token;
  $('#q').value = text;
  chips();
  search();
}

// ---------- фильтры ----------
const zkName = id => meta.zk.find(z => z.id === id)?.name;
function chips() {
  const lbl = (base, list) => list.length ? `${base}: ${list.length > 2 ? list.slice(0, 2).join(', ') + ` +${list.length - 2}` : list.join(', ')}` : base;
  const items = [
    ['zk', lbl('🏢 ЖК', (f.zk || []).map(zkName).filter(Boolean)), !!f.zk?.length],
    ['d', lbl('📍 Район', (f.d || []).map(k => meta.areas.find(a => a[0] === k)?.[1]).filter(Boolean)), !!f.d?.length],
    ['b', f.b ? `💰 ${meta.budgets.find(b => b[0] === f.b)?.[1]}` : '💰 Бюджет', !!f.b],
    ['r', lbl('🛏 Комнаты', ROOMS.filter(r => f.r?.includes(r[0])).map(r => r[1])), !!f.r?.length],
    ['k', f.k ? `🏠 ${KINDS.find(k => k[0] === f.k)?.[1]}` : '🏠 Тип', !!f.k],
    ['m', '✨ Только современный ремонт', !!f.m],
  ];
  const any = items.some(i => i[2]) || text;
  $('#chips').innerHTML = items.map(([k, t, on]) => `<button class="chip${on ? ' on' : ''}" data-f="${k}">${esc(t)}</button>`).join('')
    + (any ? '<button class="chip" data-f="reset">Сбросить всё</button>' : '');
}

$('#chips').addEventListener('click', e => {
  const k = e.target.closest('[data-f]')?.dataset.f;
  if (!k) return;
  if (k === 'm') { f.m = !f.m || undefined; return changed(); }
  if (k === 'reset') { f = {}; text = ''; $('#q').value = ''; return changed(); }
  openSheet(k);
});

let sheetKey = null;
function openSheet(k) {
  sheetKey = k;
  const titles = { zk: 'ЖК', d: 'Район и микрорайон', b: 'Бюджет', r: 'Комнаты', k: 'Тип' };
  $('#sheet-title').textContent = titles[k];
  $('#sheet-find').hidden = k !== 'zk';
  $('#sheet-find').value = '';
  renderSheet();
  $('#sheet').hidden = false;
  tg?.BackButton.show();
}
function closeSheet() {
  if ($('#sheet').hidden) return;
  $('#sheet').hidden = true;
  tg?.BackButton.hide();
  changed();
}
tg?.BackButton.onClick(() => $('#viewer').hidden ? closeSheet() : closeViewer());

function opt(type, name, value, label, checked, note = '') {
  return `<label class="opt"><input type="${type}" name="${name}" value="${esc(value)}"${checked ? ' checked' : ''}><span>${esc(label)}</span>${note ? `<em>${esc(note)}</em>` : ''}</label>`;
}
function renderSheet() {
  const k = sheetKey, body = $('#sheet-body');
  if (k === 'zk') {
    const q = $('#sheet-find').value.trim().toLowerCase();
    const list = meta.zk.filter(z => !q || z.name.toLowerCase().includes(q));
    body.innerHTML = list.map(z => opt('checkbox', 'zk', z.id, z.name, f.zk?.includes(z.id), z.n)).join('') || '<p class="muted">Не нашёл такой ЖК</p>';
  } else if (k === 'd') {
    const isDistrict = a => !a[0].startsWith('m');
    body.innerHTML = '<div class="group">Районы</div>' + meta.areas.filter(isDistrict).map(a => opt('checkbox', 'd', a[0], a[1], f.d?.includes(a[0]))).join('')
      + '<div class="group">Микрорайоны</div>' + meta.areas.filter(a => !isDistrict(a)).map(a => opt('checkbox', 'd', a[0], a[1], f.d?.includes(a[0]))).join('');
  } else if (k === 'b') {
    body.innerHTML = opt('radio', 'b', '', 'Любой', !f.b) + meta.budgets.map(b => opt('radio', 'b', b[0], b[1], f.b === b[0])).join('');
  } else if (k === 'r') {
    body.innerHTML = ROOMS.map(r => opt('checkbox', 'r', r[0], r[1], f.r?.includes(r[0]))).join('');
  } else if (k === 'k') {
    body.innerHTML = KINDS.map(x => opt('radio', 'k', x[0], x[1], (f.k || '') === x[0])).join('');
  }
}
$('#sheet-find').addEventListener('input', renderSheet);
$('#sheet-body').addEventListener('change', e => {
  const i = e.target;
  if (i.type === 'radio') { f[i.name] = i.value || undefined; if (sheetKey !== 'zk') closeSheet(); return; }
  const v = i.name === 'd' ? i.value : +i.value;
  const set = new Set(f[i.name] || []);
  i.checked ? set.add(v) : set.delete(v);
  f[i.name] = set.size ? [...set] : undefined;
});
$('#sheet-clear').addEventListener('click', () => { f[sheetKey] = undefined; renderSheet(); });
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet(); });

function changed() {
  f = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
  store.set('f', f);
  store.set('text', text);
  chips();
  search();
}
$('#qform').addEventListener('submit', e => { e.preventDefault(); text = $('#q').value.trim(); $('#q').blur(); changed(); });

// ---------- выдача ----------
async function search(more = false) {
  if (busy) return;
  busy = true;
  if (!more) { offset = 0; $('#list').innerHTML = ''; $('#status').textContent = 'Ищу…'; $('#more').hidden = true; }
  $('#more').disabled = true;
  try {
    const r = await call('search', { f, text, offset });
    total = r.count;
    $('#list').insertAdjacentHTML('beforeend', r.items.map(card).join(''));
    offset += r.items.length;
    $('#status').textContent = (total ? `Найдено: ${total.toLocaleString('ru-RU')}` : 'Ничего не нашёл')
      + (r.understood ? ` · понял запрос так: ${r.understood}` : '')
      + (total ? ' · сначала современный ремонт, затем новые' : '');
    $('#more').hidden = offset >= total;
    $('#more').textContent = `Показать ещё (${Math.min(r.page, total - offset)} из оставшихся ${(total - offset).toLocaleString('ru-RU')})`;
  } catch (e) {
    if (e.gate) return showLogin(token ? 'expired' : e.gate);
    $('#status').textContent = `Ошибка поиска: ${e.message}`;
  } finally {
    busy = false;
    $('#more').disabled = false;
  }
}
$('#more').addEventListener('click', () => search(true));
$('#logout').addEventListener('click', logout);

const mln = v => (v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
function card(x) {
  const what = x.kind === 'дом' ? (x.type_name || 'Дом') : x.rooms === 0 ? 'Студия' : `${x.rooms ?? '?'}-к ${x.kind === 'апартаменты' ? 'апартаменты' : 'квартира'}`;
  const head = [what, x.area && `${x.area} м²`, x.floor && `${x.floor}/${x.floors ?? '?'} эт.`].filter(Boolean).join(', ');
  const price = x.price ? `${mln(x.price)} млн ₽${x.area ? ` <small>· ${Math.round(x.price / x.area).toLocaleString('ru-RU')} ₽/м²</small>` : ''}` : 'цена не указана';
  const where = [x.complex && `ЖК ${x.complex}`, x.address, x.mkr].filter(Boolean).join(' · ');
  const rep = REPAIR[x.repair] ?? (x.condition_name ? `по данным: ${x.condition_name}` : 'не указан');
  const date = x.created_at ? new Date(x.created_at).toLocaleDateString('ru-RU') : '—';
  const photos = x.photos || [];
  return `<article class="card" data-id="${x.id}">
    <div class="photo-wrap"><div class="photos">${photos.length
      ? photos.map((p, i) => `<img src="${esc(p)}" alt="" loading="lazy" data-i="${i}">`).join('')
      : '<span class="none">нет фото</span>'}</div>${photos.length > 1 ? `<span class="pcount">${photos.length} фото</span>` : ''}</div>
    <div class="body">
      <div class="title">${esc(head)}</div>
      <div class="price">${price}</div>
      <div class="where">${esc(where)}</div>
      <div class="rep${x.repair === 'modern' ? ' modern' : ''}">Ремонт: ${esc(rep)}</div>
      <div class="meta muted">Добавлено: ${date} · №${x.id}</div>
      ${x.description ? `<details><summary>Описание</summary><p>${esc(x.description)}</p></details>` : ''}
      <div class="actions"><button class="btn" data-phone>📞 Телефон</button></div>
    </div>
  </article>`;
}

$('#list').addEventListener('click', async e => {
  const img = e.target.closest('.photos img');
  if (img) return openViewer(img.closest('.photos'), +img.dataset.i);
  const b = e.target.closest('[data-phone]');
  if (!b) return;
  const box = b.parentElement, id = +b.closest('.card').dataset.id;
  b.disabled = true;
  b.textContent = 'Узнаю номер…';
  try {
    const p = await call('phone', { id });
    if (!p.phone) throw new Error(p.error || 'номер не найден');
    box.innerHTML = `<div class="phone"><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>${p.owner ? ` — ${esc(p.owner)}` : ''}
      <small>может быть подменный номер</small></div><button class="btn" data-copy="${esc(p.phone)}">Копировать</button>`;
  } catch (err) {
    if (err.gate) return showLogin(token ? 'expired' : err.gate);
    b.disabled = false;
    b.textContent = '📞 Телефон';
    box.querySelector('.muted')?.remove();
    const why = /^HTTP/.test(err.message) ? 'в «Делаем сделки» нет мобильного номера' : err.message;
    box.insertAdjacentHTML('beforeend', `<span class="muted">Не получилось: ${esc(why)}</span>`);
  }
});
$('#list').addEventListener('click', e => {
  const c = e.target.closest('[data-copy]');
  if (!c) return;
  navigator.clipboard?.writeText(c.dataset.copy).then(() => { c.textContent = 'Скопировано'; }, () => {});
});

// ---------- фото на весь экран ----------
function openViewer(strip, i) {
  const v = $('#viewer'), s = v.querySelector('.viewer-strip');
  s.innerHTML = [...strip.querySelectorAll('img')].map(im => `<img src="${esc(im.src)}" alt="">`).join('');
  v.hidden = false;
  s.scrollLeft = i * s.clientWidth;
  tg?.BackButton.show();
}
function closeViewer() { $('#viewer').hidden = true; if ($('#sheet').hidden) tg?.BackButton.hide(); }
$('#viewer').addEventListener('click', e => { if (e.target.closest('.viewer-close') || e.target.tagName !== 'IMG') closeViewer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeViewer(); closeSheet(); } });

start();
