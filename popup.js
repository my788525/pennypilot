// popup.js — main surface. Reads bundled data, renders dated events + locality/rights/benefits cards.
(async function () {
  const $ = (id) => document.getElementById(id);
  const CACHE = {};
  const settings = (await chrome.storage.sync.get(['settings'])).settings || {};
  const doneMap = (await chrome.storage.sync.get(['doneMap'])).doneMap || {};

  if (!settings.state && !settings.zip) $('firstRun').hidden = false;

  const remote = (await chrome.storage.sync.get(['remoteData'])).remoteData || {};
  const custom = (await chrome.storage.sync.get(['customReminders'])).customReminders || [];
  const snoozed = (await chrome.storage.sync.get(['snoozed'])).snoozed || {};
  const { events, all, st, lifeNotes } = await PP.buildEvents(settings, remote.alerts || [], custom, snoozed);
  CACHE.events = events;

  // ---- Shield gauge ----
  const sh = PP.shield(events, doneMap);
  const arc = $('gaugeArc');
  const r = 18, c = 2 * Math.PI * r;
  arc.style.strokeDasharray = c;
  arc.style.strokeDashoffset = c * (1 - sh.score / 100);
  arc.style.stroke = sh.score < 60 ? '#dc2626' : sh.score < 85 ? '#b7791f' : '#15803d';
  $('gaugeVal').textContent = sh.score;
  $('gauge').title = sh.label + ' · ' + sh.secured + ' of ' + sh.total + ' secured';

  // ---- Savings strip ----
  const sv = PP.savings(events, doneMap);
  $('saved').innerHTML =
    `<span>✅ ${sv.earlyDone} date${sv.earlyDone === 1 ? '' : 's'} confirmed early</span>` +
    (sv.taxDone ? `<span>🧾 ${sv.taxDone} tax deadline${sv.taxDone === 1 ? '' : 's'} cleared — avoids IRS penalties</span>` : '');

  // ---- Upcoming list ----
  const open = events.filter((e) => !doneMap[e.key]);
  $('upCount').textContent = open.length ? '(' + open.length + ')' : '';
  const up = $('upcoming');
  if (!open.length) {
    up.innerHTML = '<p class="muted">All clear. Nothing due soon. 🎉</p>';
  } else {
    up.innerHTML = open.map((e) => itemHtml(e, false)).join('');
  }
  wireItems(up);

  // ---- Done list ----
  const doneList = events.filter((e) => doneMap[e.key]);
  $('doneCount').textContent = doneList.length ? '(' + doneList.length + ')' : '';
  const dn = $('done');
  dn.innerHTML = doneList.length ? doneList.map((e) => itemHtml(e, true)).join('') : '<p class="muted">Nothing checked off yet.</p>';
  wireItems(dn);

  // ---- Snoozed list (paused reminders; re-surface after window) ----
  // Derived from the FULL event set (`all`), since `events` already excludes snoozed items.
  const nowMs = Date.now();
  const snoozedList = all.filter((e) => snoozed[e.key] && snoozed[e.key] > nowMs);
  $('snoozedCount').textContent = snoozedList.length ? '(' + snoozedList.length + ')' : '';
  const sz = $('snoozed');
  sz.innerHTML = snoozedList.length ? snoozedList.map((e) => snoozedHtml(e)).join('') : '<p class="muted">Nothing snoozed. Snooze hides a reminder for 3 days, then it returns here → Upcoming.</p>';
  wireUnsnooze(sz);

  // ---- Locality card ----
  const loc = await PP.getLocality(settings);
  if (loc) {
    $('locCard').hidden = false;
    let h = '';
    if (loc.label) h += `<div class="loc-name">${PP.esc(loc.label)}</div>`;
    if (loc.county) h += `<div class="muted small">${PP.esc(loc.county)} County</div>`;
    if (loc.minWage) h += `<div class="loc-row"><b>Minimum wage $${loc.minWage}/hr</b> <span class="muted small">since ${PP.esc(loc.minWageEffective)}</span></div>` +
      (loc.minWageNote ? `<div class="muted small">${PP.esc(loc.minWageNote)}</div>` : '');
    if (loc.cityIncomeTax) {
      const t = loc.cityIncomeTax;
      let txt = '';
      if (t.type === 'flat') txt = `City income tax ≈ ${(t.resident * 100).toFixed(2)}% resident` + (t.nonresident ? ` / ${(t.nonresident * 100).toFixed(2)}% non-resident` : '');
      else if (t.type === 'surchargeOnState') txt = `City surcharge ${ (t.rate * 100).toFixed(2)}% on state tax`;
      else if (t.type === 'brackets') txt = `City income tax 3.08%–3.88% on top of state tax`;
      h += `<div class="loc-row"><b>${txt}</b></div>` + (t.note ? `<div class="muted small">${PP.esc(t.note)}</div>` : '');
    }
    if (loc.propertyTax) h += `<div class="loc-row">🏠 Property tax</div><div class="muted small">${PP.esc(loc.propertyTax.note)}</div>`;
    h += `<div class="muted small">Source: ${PP.esc(loc.source || 'official publication')}</div>`;
    $('locality').innerHTML = h;
  }

  // ---- Rights card ----
  const rights = await PP.getRights(st);
  if (rights) {
    $('rightsCard').hidden = false;
    const rows = (rights.federal || []).concat(rights.state || []);
    $('rights').innerHTML = rows.slice(0, 4).map((r) =>
      `<div class="mini-item"><b>${PP.esc(r.title)}</b><div class="muted small">${PP.esc(r.detail)}</div></div>`
    ).join('');
  }

  // ---- Benefits card ----
  const ben = await PP.getBenefits(st);
  if (ben) {
    $('benCard').hidden = false;
    let h = ben.federal.slice(0, 4).map((b) =>
      `<div class="mini-item"><b>${PP.esc(b.title)}</b><div class="muted small">${PP.esc(b.detail)}</div>` +
      (b.link ? `<a class="ext" href="${b.link}" target="_blank" rel="noopener">${PP.esc(b.linkLabel || 'Official site')} ↗</a>` : '') + `</div>`
    ).join('');
    if (ben.stateFood) h += `<div class="mini-item"><b>Food assistance in your state</b><div class="muted small">${PP.esc(ben.stateFood)} — confirm eligibility with your state agency.</div></div>`;
    if (ben.sites) h += `<div class="mini-item muted small">Tools: ` +
      Object.values(ben.sites).map((s) => `<a class="ext" href="${s.link}" target="_blank" rel="noopener">${PP.esc(s.site)} ↗</a>`).join(' · ') + `</div>`;
    $('benefits').innerHTML = h;
  }

  // ---- Insight + waiting cost ----
  await PP.loadInsights();
  $('insight').textContent = PP.getInsight() || '';
  const wc = PP.waitingCost();
  $('waiting').innerHTML = PP.esc(wc.penaltyFact) + '<br><span class="muted">' + PP.esc(wc.compoundNote) + '</span>';

  // ---- Recommended tools (symbiotic backlinks, FTC-disclosed) ----
  // Gated behind the same "Sponsored content" toggle so turning ads off removes all promo surfaces.
  if (window.PP_SITES && settings.showAds !== false) {
    $('recsCard').hidden = false;
    $('recs').innerHTML = Object.values(window.PP_SITES).map((s) =>
      `<a class="rec" href="${s.url}" target="_blank" rel="noopener noreferrer">${PP.esc(s.label)} ↗</a>`
    ).join('');
    $('disc').textContent = window.PP_DISCLOSURE || '';
  }

  // ---- Sponsored offers (third-party creatives, served first-party, generic, labeled) ----
  const ads = await PP.loadAds();
  if (ads.length && settings.showAds !== false) {
    $('adsCard').hidden = false;
    $('ads').innerHTML = ads.map((a) =>
      `<a class="ad" href="${PP.esc(a.url)}" target="_blank" rel="noopener noreferrer sponsored">
         <span class="ad-tag">Sponsored</span>
         <span class="ad-title">${PP.esc(a.title)}</span>
         ${a.body ? `<span class="ad-body muted small">${PP.esc(a.body)}</span>` : ''}
         <span class="ad-adv muted small">${PP.esc(a.advertiser || '')}</span>
       </a>`
    ).join('');
  }

  // ---- helpers ----
  function itemHtml(e, isDone) {
    const days = e.days;
    const cls = days <= 0 ? 'due' : days <= 7 ? 'urgent' : days <= 30 ? 'soon' : 'ok';
    const dayLabel = days < 0 ? 'overdue' : days === 0 ? 'today' : days + 'd';
    const pen = e.penaltyNote ? `<div class="pen">⚠ ${PP.esc(e.penaltyNote)}</div>` : '';
    const note = e.note ? `<div class="muted small">${PP.esc(e.note)}</div>` : '';
    // Near-due (≤3 days): snooze is pointless, so disable it.
    const nearDue = days >= 0 && days <= 3;
    const snoozeBtn = isDone ? '' :
      `<button class="snooze" data-key="${PP.esc(e.key)}"${nearDue ? ' disabled title="Due within 3 days — snooze disabled"' : ''}>Snooze 3d</button>`;
    return `<div class="item ${cls}" data-key="${PP.esc(e.key)}">
      <button class="check" data-key="${PP.esc(e.key)}" title="Mark done" aria-label="Mark done">${isDone ? '↺' : '✓'}</button>
      <div class="body">
        <div class="ttl">${PP.esc(e.title)} <span class="pill ${cls}">${dayLabel}</span></div>
        ${note}${pen}
        ${snoozeBtn}
      </div>
    </div>`;
  }
  function wireItems(container) {
    container.querySelectorAll('.check').forEach((b) => b.onclick = async () => {
      const key = b.dataset.key;
      const dm = (await chrome.storage.sync.get(['doneMap'])).doneMap || {};
      if (dm[key]) { delete dm[key]; } else { dm[key] = { doneAt: Date.now(), early: (events.find(e=>e.key===key)||{}).days > 0 }; }
      await chrome.storage.sync.set({ doneMap: dm });
      chrome.runtime.sendMessage({ type: 'RETICK' });
      location.reload();
    });
    container.querySelectorAll('.snooze').forEach((b) => b.onclick = async () => {
      if (b.disabled) return;
      const key = b.dataset.key;
      const sm = (await chrome.storage.sync.get(['snoozed'])).snoozed || {};
      sm[key] = Date.now() + 72 * 3600000;
      await chrome.storage.sync.set({ snoozed: sm });
      chrome.runtime.sendMessage({ type: 'SNOOZE', key, hours: 72 }); // tell background to re-tick (suppress notifications)
      b.textContent = 'Snoozed'; setTimeout(() => location.reload(), 500);
    });
  }
  function snoozedHtml(e) {
    const ret = new Date(snoozed[e.key]);
    const retLabel = ret.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `<div class="item snoozed-item" data-key="${PP.esc(e.key)}">
      <button class="unsnooze" data-key="${PP.esc(e.key)}" title="Bring back now" aria-label="Bring back now">↩</button>
      <div class="body">
        <div class="ttl">${PP.esc(e.title)}</div>
        <div class="muted small">Returns ${PP.esc(retLabel)}</div>
      </div>
    </div>`;
  }
  function wireUnsnooze(container) {
    container.querySelectorAll('.unsnooze').forEach((b) => b.onclick = async () => {
      const key = b.dataset.key;
      const sm = (await chrome.storage.sync.get(['snoozed'])).snoozed || {};
      delete sm[key];
      await chrome.storage.sync.set({ snoozed: sm });
      chrome.runtime.sendMessage({ type: 'RETICK' });
      location.reload();
    });
  }

  $('optLink').onclick = () => chrome.runtime.openOptionsPage();
  $('firstRunLink').onclick = () => chrome.runtime.openOptionsPage();
  $('wbLink').onclick = async () => {
    try {
      // A popup's own window is NOT a valid side-panel host; open in a real browser window.
      const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
      if (!wins.length) throw new Error('no normal window');
      await chrome.sidePanel.open({ windowId: wins[0].id });
    } catch (e) {
      $('wbLink').textContent = 'Right-click the PennyPilot icon → “Show in side panel”';
    }
  };
})();
