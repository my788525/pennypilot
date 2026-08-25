// background.js — MV3 service worker: badge + notifications + daily alarm.
// Skips "done" items (user-confirmed) so they never re-surface in badge/notification.
// No remote code; data is bundled locally.

const CAL_URL = chrome.runtime.getURL('data/calendar.json');
const ZIP_URL = chrome.runtime.getURL('data/zip3-to-state.json');
const CITY_URL = chrome.runtime.getURL('data/cityFinance.json');
let CAL = null, ZIP = null, CITY = null;

// Remote data override layer (W6). DISABLED until hosting override.json.
// Fetches ONLY generic, PII-free JSON; never remote code (MV3 CSP compliant).
const REMOTE_ENABLED = false;
const REMOTE_URL = 'https://data.pennypilot.app/override.json';

async function loadData() {
  if (!CAL) CAL = await (await fetch(CAL_URL)).json();
  if (!ZIP) ZIP = await (await fetch(ZIP_URL)).json();
  if (!CITY) CITY = await (await fetch(CITY_URL)).json();
}

// Pull the latest generic override/alert data (scam warnings, temporary tax
// extensions, newly-effective wage dates). No PII is sent; only public JSON is fetched.
async function fetchRemote() {
  if (!REMOTE_ENABLED) return;
  try {
    const res = await fetch(REMOTE_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.alerts)) {
      await chrome.storage.sync.set({ remoteData: { version: data.version || 0, alerts: data.alerts, fetchedAt: Date.now() } });
    }
  } catch (e) { /* keep last good data on network/parse error */ }
}

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr + 'T00:00:00') - new Date()) / 86400000);
}
function resolveState(settings) {
  if (settings.zip && ZIP && ZIP.map[settings.zip.slice(0, 3)]) return ZIP.map[settings.zip.slice(0, 3)];
  return settings.state || null;
}

// Life-event dated reminders (mirrors core.js). Kept compact & faithful.
function lifeDatedEvents(lifeEvents) {
  const dated = [];
  const has = (k) => lifeEvents && lifeEvents.includes(k);
  const taxDay = '2027-04-15';
  if (has('baby')) dated.push({ key: 'life-ctc@' + taxDay, title: 'Claim Child Tax Credit — file by Tax Day', date: taxDay, days: daysUntil(taxDay) });
  if (has('home')) dated.push({ key: 'life-mortgage@' + taxDay, title: 'Gather mortgage interest & property-tax docs', date: taxDay, days: daysUntil(taxDay) });
  if (has('self_employed')) {
    for (const [q, d] of [['q1', '2026-04-15'], ['q2', '2026-06-15'], ['q3', '2026-09-15'], ['q4', '2027-01-15']]) {
      dated.push({ key: 'life-est-' + q + '@' + d, title: 'Estimated tax due (self-employed)', date: d, days: daysUntil(d) });
    }
  }
  return dated.filter((e) => e.days >= -1);
}

// City-level minimum-wage change event (forward-looking; mirrors core.js).
function cityDatedEvents(settings) {
  if (!settings.locality || !settings.locality.cityKey || !CITY || !CITY.cities) return [];
  const c = CITY.cities[settings.locality.cityKey];
  if (!c || !c.minWage || !c.minWageEffective) return [];
  const d = daysUntil(c.minWageEffective);
  if (d < 0) return [];
  return [{ key: 'city-' + settings.locality.cityKey + '@' + c.minWageEffective, title: c.label + ' minimum wage → $' + c.minWage + '/hr', date: c.minWageEffective, days: d, scope: 'city' }];
}

// User-created custom reminders (name + due date + note). Mirrors the custom block in
// core.js buildEvents so done/snoozed keys align across popup, sidebar, and the badge.
function customDatedEvents(customReminders) {
  const out = [];
  if (!customReminders || !customReminders.length) return out;
  for (const r of customReminders) {
    if (!r || !r.due) continue;
    const d = daysUntil(r.due);
    if (d >= -1) out.push({ key: 'custom-' + r.id, title: r.name || 'Reminder', date: r.due, days: d, scope: 'custom' });
  }
  return out;
}

// Returns upcoming events with a stable key. Mirrors core.js key scheme.
function upcomingEvents(settings, doneMap, remoteAlerts) {
  const st = resolveState(settings);
  const events = [];
  for (const f of CAL.federalDates) {
    const d = daysUntil(f.date);
    if (d >= -1) events.push({ key: f.id + '@' + f.date, title: f.title, date: f.date, days: d, scope: 'federal' });
  }
  if (st && CAL.states[st]) {
    const s = CAL.states[st];
    const td = daysUntil(s.taxDeadline);
    if (td >= -1) {
      events.push({ key: 'tax-' + st + '@' + s.taxDeadline, title: s.name + ' state tax deadline', date: s.taxDeadline, days: td, scope: 'state' });
    }
  }
  for (const e of lifeDatedEvents(settings.lifeEvents)) {
    events.push({ key: e.key, title: e.title, date: e.date, days: e.days, scope: 'life' });
  }
  for (const e of cityDatedEvents(settings)) {
    events.push({ key: e.key, title: e.title, date: e.date, days: e.days, scope: 'city' });
  }
  for (const a of (remoteAlerts || [])) {
    const d = daysUntil(a.date);
    if (d >= -1) events.push({ key: 'remote-' + a.key, title: a.title, date: a.date, days: d, scope: 'alert', category: a.category || 'alert', note: a.note || null, source: a.source || null, penaltyNote: null });
  }
  // exclude user-confirmed "done"
  const live = events.filter((e) => !(doneMap && doneMap[e.key]));
  live.sort((a, b) => a.days - b.days);
  return live;
}

function inQuietHours(qh) {
  if (!qh || !qh.enabled) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = (qh.start || 22) * 60, end = (qh.end || 8) * 60;
  if (start <= end) return cur >= start && cur < end;
  return cur >= start || cur < end; // wraps midnight
}

async function tick() {
  await loadData();
  const { settings = {}, doneMap = {}, snoozed = {}, remoteData = {}, customReminders = [] } =
    await chrome.storage.sync.get(['settings', 'doneMap', 'snoozed', 'remoteData', 'customReminders']);
  if (!settings.state && !settings.zip) { chrome.action.setBadgeText({ text: '' }); return; }

  // Built-in dated events + user custom reminders, then drop done/snoozed to get the
  // truly-visible shortest countdown for the toolbar badge.
  const events = upcomingEvents(settings, doneMap, remoteData && remoteData.alerts);
  for (const e of customDatedEvents(customReminders)) events.push(e);

  const now = Date.now();
  const live = events.filter((e) =>
    !(doneMap && doneMap[e.key]) &&
    !(snoozed[e.key] && now < snoozed[e.key])
  );
  live.sort((a, b) => a.days - b.days);

  if (!live.length) {
    // All clear / all done — positive reinforcement instead of empty badge.
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#15803d' });
    return;
  }

  const next = live[0];
  const badge = next.days <= 0 ? '!' : String(Math.min(next.days, 99));
  chrome.action.setBadgeText({ text: badge });
  chrome.action.setBadgeBackgroundColor({ color: next.days <= 7 ? '#b7791f' : '#1d4ed8' });

  // Notifications: only within 7 days, throttled 30 days, respect quiet hours
  // (snoozed items are already excluded from `live`).
  if (inQuietHours(settings.quietHours)) return;
  const notified = (await chrome.storage.sync.get(['notified'])).notified || {};
  for (const e of live) {
    if (e.days >= 0 && e.days <= 7) {
      const last = notified[e.key];
      if (!last || (now - last) > 30 * 86400000) {
        try {
          await chrome.notifications.create(e.key, {
            type: 'basic', iconUrl: 'icons/icon48.png',
            title: 'PennyPilot: ' + e.title,
            message: (e.days === 0 ? 'Due today' : e.days + ' day(s) left') + '.'
          });
        } catch (err) { /* notifications may be unavailable in some contexts */ }
        notified[e.key] = now;
      }
    }
  }
  await chrome.storage.sync.set({ notified });
}

// Snooze a specific event for N hours (called from popup/sidebar via message).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'RETICK') { tick(); return; }
  if (msg && msg.type === 'SNOOZE' && msg.key) {
    chrome.storage.sync.get(['snoozed'], ({ snoozed = {} }) => {
      snoozed[msg.key] = Date.now() + (msg.hours || 72) * 3600000;
      chrome.storage.sync.set({ snoozed });
      tick();
    });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await loadData();
  const s = (await chrome.storage.sync.get(['settings'])).settings;
  if (!s || (!s.state && !s.zip)) chrome.runtime.openOptionsPage();
  chrome.alarms.create('daily', { periodInMinutes: 1440 });
  chrome.alarms.create('remote', { periodInMinutes: 10080 }); // weekly override pull
  fetchRemote();
  tick();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'daily') tick();
  else if (a.name === 'remote') fetchRemote();
});
chrome.runtime.onStartup.addListener(tick);
