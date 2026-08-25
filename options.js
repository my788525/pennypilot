// options.js — settings: location (+ resolved locality), life events, quiet hours, premium, data & privacy
const $ = (id) => document.getElementById(id);
let CAL, ZIP, LOC = null;

// Enable/disable the quiet-hours time inputs based on the master toggle.
function syncQuietHoursUI() {
  const on = $('qhOn').checked;
  const times = $('qhTimes');
  times.classList.toggle('disabled', !on);
  $('qhStart').disabled = !on;
  $('qhEnd').disabled = !on;
}

// IDs MUST match core.js / background.js lifeEventEvents().
const LIFE_EVENTS = [
  { id: 'marriage', label: 'Recently married', note: 'Review filing status, joint vs. separate returns, and beneficiary updates.' },
  { id: 'baby', label: 'New child', note: 'Claim the child tax credit; update W-4 and dependent care FSAs.' },
  { id: 'moved', label: 'Moved states', note: 'Re-check your state tax deadline, city wage/income tax, and residency rules.' },
  { id: 'self_employed', label: 'Became self-employed', note: 'Estimated quarterly taxes (Apr/Jun/Sep/Jan) now apply — set reminders early.' },
  { id: 'new_job', label: 'Changed jobs', note: 'Rollover deadlines for retirement accounts; update W-4 withholding.' },
  { id: 'home', label: 'Bought/sold a home', note: 'Mortgage interest, property-tax deadlines, and capital-gains considerations.' },
  { id: 'student_loan', label: 'Paying student loans', note: 'Up to $2,500 of student-loan interest may be deductible.' }
];

async function init() {
  CAL = await PP.loadCal();
  ZIP = await PP.loadZip();

  const sel = $('state');
  Object.values(CAL.states)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((s) => {
      const o = document.createElement('option');
      o.value = s.abbr; o.textContent = s.name;
      sel.appendChild(o);
    });

  const { settings = {} } = await chrome.storage.sync.get(['settings']);
  if (settings.state) sel.value = settings.state;
  if (settings.zip) $('zip').value = settings.zip;
  if (settings.quietHours) {
    $('qhOn').checked = !!settings.quietHours.enabled;
    $('qhStart').value = settings.quietHours.start ?? 22;
    $('qhEnd').value = settings.quietHours.end ?? 8;
  }
  syncQuietHoursUI();

  sel.addEventListener('change', save);
  $('zip').addEventListener('input', save);
  $('zip').addEventListener('blur', updatePreview);
  $('qhOn').addEventListener('change', () => { syncQuietHoursUI(); save(); });
  $('qhStart').addEventListener('change', save);
  $('qhEnd').addEventListener('change', save);
  $('adsOn').addEventListener('change', save);

  if (typeof settings.showAds === 'boolean') $('adsOn').checked = settings.showAds;

  buildLife(settings.lifeEvents || []);
  wireData();
  buildCustom();

  $('crAdd').onclick = addCustom;

  updatePreview();
}

async function save() {
  const base = (await chrome.storage.sync.get(['settings'])).settings || {};
  const zip = $('zip').value.trim();
  const settings = {
    zip: zip || null,
    lifeEvents: base.lifeEvents || [],
    quietHours: {
      enabled: $('qhOn').checked,
      start: parseInt($('qhStart').value, 10) || 22,
      end: parseInt($('qhEnd').value, 10) || 8
    },
    locality: null,
    state: $('state').value || null,
    showAds: $('adsOn') ? $('adsOn').checked : true
  };
  // Resolve locality (state/county/city) from full ZIP — drives city-level cards & events.
  // ZIP-derived state wins over the manual fallback selector.
  if (zip && /^\d{5}$/.test(zip)) {
    try {
      const loc = await loadLocality();
      const hit = loc.map[zip];
      if (hit) {
        const st = hit[0];
        let cityKey = (hit[2] || '').toLowerCase().trim();
        if (st === 'DC') cityKey = 'washington dc';
        settings.locality = { state: st, county: hit[1] || null, city: hit[2] || null, cityKey };
        settings.state = st;
      }
    } catch (e) { /* degrade to manual state silently */ }
  }
  await chrome.storage.sync.set({ settings });
  updatePreview();
  try { chrome.runtime.sendMessage({ type: 'RETICK' }); } catch (e) {}
}

async function loadLocality() {
  if (!LOC) {
    try { LOC = await PP.loadGzipJson('data/zip-to-locality.json.gz'); }
    catch (e) { LOC = await (await fetch(chrome.runtime.getURL('data/zip-to-locality.json'))).json(); }
  }
  return LOC;
}

async function updatePreview() {
  const zip = $('zip').value.trim();
  let st = $('state').value || null;
  let cityHit = null;
  if (zip && /^\d{5}$/.test(zip)) {
    try { const loc = await loadLocality(); cityHit = loc.map[zip]; if (cityHit) st = cityHit[0]; } catch (e) {}
  }
  if (!st && zip && zip.length >= 3 && ZIP.map[zip.slice(0, 3)]) st = ZIP.map[zip.slice(0, 3)];

  const el = $('preview');
  if (!st) { el.innerHTML = '<span class="muted">No location set — you’ll only get federal-date reminders. Add your ZIP (or state) to unlock local ones.</span>'; return; }
  const s = CAL.states[st];
  let html =
    `<div class="row"><span class="k">State</span><span class="v">${PP.esc(s.name)}</span></div>
     <div class="row"><span class="k">State min. wage</span><span class="v">$${PP.esc(s.minWage)}/hr</span></div>
     <div class="row"><span class="k">State income tax</span><span class="v">${s.hasStateIncomeTax ? 'Yes' : 'None'}</span></div>
     <div class="row"><span class="k">State tax deadline</span><span class="v">${PP.esc(s.taxDeadline)}</span></div>`;
  if (s.minWageNote) html += `<div class="loc">${PP.esc(s.minWageNote)}</div>`;

  if (cityHit) {
    html += `<div class="loc hi">ZIP ${PP.esc(zip)} → ${PP.esc(cityHit[2] || '—')}${cityHit[1] ? ', ' + PP.esc(cityHit[1]) + ' County' : ''}, ${PP.esc(cityHit[0])}</div>`;
    if (cityHit[2]) html += `<div class="loc muted">City-level wage & tax data will surface in your popup for this location.</div>`;
  } else if (zip && /^\d{5}$/.test(zip)) {
    html += `<div class="loc muted">ZIP not in our city database yet — showing state-level data. (Coverage is expanding.)</div>`;
  }
  el.innerHTML = html;
}

function buildLife(active) {
  const box = $('lifeChecks');
  box.innerHTML = '';
  LIFE_EVENTS.forEach((ev) => {
    const on = active.includes(ev.id);
    const label = document.createElement('label');
    label.className = on ? 'on' : '';
    label.innerHTML = `<input type="checkbox" data-id="${ev.id}" ${on ? 'checked' : ''}/> ${PP.esc(ev.label)}`;
    box.appendChild(label);
  });
  box.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', onLifeChange));
  renderLifeNote(active);
}

async function onLifeChange() {
  const ids = Array.from(document.querySelectorAll('#lifeChecks input:checked')).map((c) => c.dataset.id);
  const { settings = {} } = await chrome.storage.sync.get(['settings']);
  settings.lifeEvents = ids;
  await chrome.storage.sync.set({ settings });
  document.querySelectorAll('#lifeChecks label').forEach((l, i) => l.classList.toggle('on', ids.includes(LIFE_EVENTS[i].id)));
  renderLifeNote(ids);
}

function renderLifeNote(ids) {
  const notes = LIFE_EVENTS.filter((e) => ids.includes(e.id)).map((e) => '• ' + e.note);
  $('lifeNote').innerHTML = ids.length
    ? `<b>Review checklist:</b><br>${notes.map(PP.esc).join('<br>')}`
    : 'Select any events you’re going through and we’ll surface the dates you shouldn’t miss.';
}

function wireData() {
  $('exportBtn').onclick = async () => {
    const data = await chrome.storage.sync.get(['settings', 'doneMap']);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'pennypilot-data.json'; a.click();
    URL.revokeObjectURL(url);
  };
  $('clearBtn').onclick = async () => {
    await chrome.storage.sync.set({ doneMap: {} });
    $('clearNote').textContent = '“Done” history cleared.';
    try { chrome.runtime.sendMessage({ type: 'RETICK' }); } catch (e) {}
  };
  const op = $('openPanel');
  if (op) op.onclick = openPanel;
}

async function openPanel() {
  const btn = $('openPanel');
  try {
    if (!chrome.sidePanel || !chrome.sidePanel.open) throw new Error('unsupported');
    const w = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: w.id });
  } catch (e) {
    if (btn) btn.textContent = 'Right-click the PennyPilot icon → “Show in side panel”';
  }
}

// ---- Custom reminders (user-created: name + due date + note) ----
async function buildCustom() {
  const box = $('customList');
  if (!box) return;
  const list = (await chrome.storage.sync.get(['customReminders'])).customReminders || [];
  if (!list.length) { box.innerHTML = '<p class="muted small">No personal reminders yet — add one below.</p>'; return; }
  box.innerHTML = '';
  list.sort((a, b) => (a.due < b.due ? -1 : 1)).forEach((r) => {
    const div = document.createElement('div');
    div.className = 'crem';
    div.innerHTML =
      `<div class="crem-main"><b>${PP.esc(r.name)}</b> <span class="muted small">due ${PP.esc(r.due)}</span>` +
      (r.note ? `<div class="muted small">${PP.esc(r.note)}</div>` : '') + `</div>` +
      `<button class="linkbtn danger" data-id="${PP.esc(r.id)}">Delete</button>`;
    div.querySelector('button').onclick = () => deleteCustom(r.id);
    box.appendChild(div);
  });
}
async function addCustom() {
  const name = $('crName').value.trim();
  const due = $('crDue').value;
  const note = $('crNote').value.trim();
  if (!name || !due) { $('crMsg').textContent = 'Name and due date are required.'; return; }
  const list = (await chrome.storage.sync.get(['customReminders'])).customReminders || [];
  list.push({ id: 'c' + Date.now().toString(36), name, due, note, createdAt: Date.now() });
  await chrome.storage.sync.set({ customReminders: list });
  $('crName').value = ''; $('crDue').value = ''; $('crNote').value = ''; $('crMsg').textContent = '';
  await buildCustom();
  try { chrome.runtime.sendMessage({ type: 'RETICK' }); } catch (e) {}
}
async function deleteCustom(id) {
  let list = (await chrome.storage.sync.get(['customReminders'])).customReminders || [];
  list = list.filter((r) => r.id !== id);
  await chrome.storage.sync.set({ customReminders: list });
  await buildCustom();
  try { chrome.runtime.sendMessage({ type: 'RETICK' }); } catch (e) {}
}

init();
