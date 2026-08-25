// sidebar.js — Pro workbench: full list + check, stats, life-event chips, export
const $ = (id) => document.getElementById(id);
const CHECK = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const LIFE_LABELS = {
  marriage: 'Married', baby: 'New child', moved: 'Moved', self_employed: 'Self-employed',
  new_job: 'Job change', home: 'Home sale', student_loan: 'Student loans'
};

let CACHE = { events: [], doneMap: {}, st: null, cal: null, settings: {} };

async function loadDone() { return (await chrome.storage.sync.get(['doneMap'])).doneMap || {}; }
async function saveDone(map) {
  await chrome.storage.sync.set({ doneMap: map });
  try { chrome.runtime.sendMessage({ type: 'RETICK' }); } catch (e) {}
}

function gaugeSVG(score) {
  const r = 24, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return `<svg width="56" height="56" viewBox="0 0 56 56">
    <circle cx="28" cy="28" r="${r}" fill="none" stroke="#e6eaf2" stroke-width="6"/>
    <circle cx="28" cy="28" r="${r}" fill="none" stroke="#1d4ed8" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>`;
}
function daysLabel(d) { return d < 0 ? 'past' : d === 0 ? 'Today' : d === 1 ? '1 day' : d + ' days'; }
function daysClass(d) { return d < 0 ? 'over' : d === 0 ? 'today' : d <= 7 ? 'soon' : ''; }

async function render() {
  const { events, doneMap, st, cal, settings } = CACHE;
  const sh = PP.shield(events, doneMap);
  const sv = PP.savings(events, doneMap);

  const labelClass = sh.label === 'At risk' ? 'at-risk' : sh.label === 'Watchful' ? 'watchful' : '';
  $('shield').innerHTML =
    `<div class="gauge">${gaugeSVG(sh.score)}<div class="num">${sh.score}</div></div>
     <div class="meta"><div class="label ${labelClass}">Shield: ${sh.label}</div>
     <div class="sec">${sh.secured} of ${sh.total} key dates secured</div></div>`;

  $('stats').innerHTML =
    `<div class="stat"><div class="n">${sh.total}</div><div class="l">Upcoming</div></div>
     <div class="stat"><div class="n">${sv.earlyDone}</div><div class="l">On time</div></div>
     <div class="stat"><div class="n">${sh.pendingUrgent}</div><div class="l">Urgent ≤14d</div></div>`;

  // locality card
  const loc = await PP.getLocality(settings);
  const locCard = $('locCard');
  if (loc) {
    locCard.style.display = '';
    let h = '';
    if (loc.label) h += `<div class="loc-name">${PP.esc(loc.label)}</div>`;
    if (loc.county) h += `<div class="muted small">${PP.esc(loc.county)} County</div>`;
    if (loc.minWage) h += `<div class="loc-row"><b>Min wage $${loc.minWage}/hr</b> <span class="muted small">since ${PP.esc(loc.minWageEffective)}</span></div>`;
    if (loc.cityIncomeTax) {
      const t = loc.cityIncomeTax; let txt = '';
      if (t.type === 'flat') txt = `City tax ≈ ${(t.resident * 100).toFixed(2)}%`;
      else if (t.type === 'surchargeOnState') txt = `City surcharge ${(t.rate * 100).toFixed(2)}% on state tax`;
      else if (t.type === 'brackets') txt = 'City income tax 3.08%–3.88%';
      h += `<div class="loc-row"><b>${txt}</b></div>`;
    }
    if (loc.propertyTax) h += `<div class="loc-row">🏠 ${PP.esc(loc.propertyTax.note)}</div>`;
    locCard.innerHTML = h;
  } else { locCard.style.display = 'none'; }

  // today's insight
  await PP.loadInsights();
  $('insight').textContent = PP.getInsight() || '';

  // life events
  const life = settings.lifeEvents || [];
  $('life').innerHTML = life.length
    ? `<div class="section-title" style="padding:0">Your situation</div><div class="chips">${life.map((id) => `<span class="chip on">${PP.esc(LIFE_LABELS[id] || id)}</span>`).join('')}</div>`
    : '';

  const ul = $('list');
  ul.innerHTML = '';
  const upcoming = events.filter((e) => e.days >= 0 && !doneMap[e.key]);
  if (!upcoming.length) ul.innerHTML = `<div class="item"><div class="cat tax">✓</div><div class="body"><div class="t">All clear</div><div class="sub">No upcoming money dates.</div></div></div>`;
  else upcoming.forEach((e) => ul.appendChild(itemEl(e, false)));

  const doneEvents = events.filter((e) => e.days >= 0 && doneMap[e.key]);
  $('doneCount').textContent = `Done (${doneEvents.length})`;
  const dl = $('doneList'); dl.innerHTML = '';
  doneEvents.forEach((e) => dl.appendChild(itemEl(e, true)));

  // Snoozed bucket (paused reminders; re-surface after window)
  const snoozedEvents = (CACHE.all || []).filter((e) => CACHE.snoozed[e.key] && CACHE.snoozed[e.key] > Date.now());
  $('snoozedCount').textContent = `Snoozed (${snoozedEvents.length})`;
  const sl = $('snoozedList'); sl.innerHTML = '';
  snoozedEvents.forEach((e) => sl.appendChild(snoozedEl(e)));
}

function itemEl(e, isDone) {
  const div = document.createElement('div');
  div.className = 'item' + (isDone ? ' done' : '');
  const cat = e.category || 'tax';
  div.innerHTML =
    `<div class="cat ${cat}">${cat === 'tax' ? '$' : cat === 'enrollment' ? '✚' : cat === 'education' ? '§' : cat === 'wage' ? '⚒' : '★'}</div>
     <div class="body"><div class="t">${PP.esc(e.title)}</div>
       <div class="sub">${PP.esc(e.date)}${e.note ? ' · ' + PP.esc(e.note) : ''}</div>
       ${e.penaltyNote && !isDone ? `<div class="sub"><span class="pen">⚠ ${PP.esc(e.penaltyNote)}</span></div>` : ''}</div>
     <div class="days ${daysClass(e.days)}">${daysLabel(e.days)}</div>
     <button class="checkbtn" title="${isDone ? 'Mark not done' : 'Mark done'}">${CHECK}</button>`;
  div.querySelector('.checkbtn').addEventListener('click', (ev) => { ev.stopPropagation(); toggleDone(e); });
  return div;
}

async function toggleDone(e) {
  const map = await loadDone();
  if (map[e.key]) delete map[e.key];
  else map[e.key] = { doneAt: Date.now(), early: e.days > 0 };
  await saveDone(map);
  CACHE.doneMap = map;
  render();
}

function snoozedEl(e) {
  const div = document.createElement('div');
  div.className = 'item snoozed';
  const ret = new Date(CACHE.snoozed[e.key]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  div.innerHTML =
    `<div class="cat wage">⏸</div>
     <div class="body"><div class="t">${PP.esc(e.title)}</div><div class="sub">Returns ${PP.esc(ret)}</div></div>
     <button class="checkbtn unsnooze" title="Bring back now" aria-label="Bring back now">↩</button>`;
  div.querySelector('.unsnooze').addEventListener('click', (ev) => { ev.stopPropagation(); unsnooze(e); });
  return div;
}
async function unsnooze(e) {
  const sm = (await chrome.storage.sync.get(['snoozed'])).snoozed || {};
  delete sm[e.key];
  await chrome.storage.sync.set({ snoozed: sm });
  try { chrome.runtime.sendMessage({ type: 'RETICK' }); } catch (err) {}
  CACHE.snoozed = sm;
  render();
}

function renderTools() {
  const box = $('tools');
  if (!box) return;
  // Gated behind the same "Sponsored content" toggle so turning ads off removes all promo surfaces.
  if (CACHE.settings && CACHE.settings.showAds === false) { box.style.display = 'none'; return; }
  if (!window.PP_SITES) { box.style.display = 'none'; return; }
  const links = Object.values(window.PP_SITES).map((s) => `<a href="${s.url}" target="_blank" rel="noopener noreferrer">${PP.esc(s.label)}</a>`).join('');
  box.style.display = '';
  box.innerHTML = `<div class="tools-h">Recommended tools <span class="tag-sponsored">Partner</span></div><div class="tools-l">${links}</div><div class="tools-d">${PP.esc(window.PP_DISCLOSURE || '')}</div>`;
}

async function renderAds() {
  const box = $('sponsors');
  if (!box) return;
  if (CACHE.settings && CACHE.settings.showAds === false) { box.style.display = 'none'; return; }
  const ads = await PP.loadAds();
  if (!ads.length) { box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = `<div class="tools-h">Sponsored <span class="tag-sponsored">Ad</span></div><div class="tools-l col">` +
    ads.map((a) =>
      `<a class="ad-link" href="${PP.esc(a.url)}" target="_blank" rel="noopener noreferrer sponsored">
         <b>${PP.esc(a.title)}</b>${a.body ? `<span class="muted small"> — ${PP.esc(a.body)}</span>` : ''}
         <span class="ad-adv muted small">${PP.esc(a.advertiser || '')}</span>
       </a>`
    ).join('') + `</div>`;
}

async function init() {
  const { settings = {} } = await chrome.storage.sync.get(['settings']);
  CACHE.settings = settings;
  CACHE.doneMap = await loadDone();
  const remote = (await chrome.storage.sync.get(['remoteData'])).remoteData || {};
  const custom = (await chrome.storage.sync.get(['customReminders'])).customReminders || [];
  const snoozed = (await chrome.storage.sync.get(['snoozed'])).snoozed || {};
  const { events, all, st, cal } = await PP.buildEvents(settings, remote.alerts || [], custom, snoozed);
  CACHE.events = events; CACHE.all = all; CACHE.st = st; CACHE.cal = cal; CACHE.snoozed = snoozed;

  if (!st && !events.length) { $('setup').classList.remove('hidden'); $('optLink').onclick = () => chrome.runtime.openOptionsPage(); return; }
  $('main').classList.remove('hidden');
  await render();
  renderTools();
  await renderAds();
  $('optLink').onclick = () => chrome.runtime.openOptionsPage();
}

init();
