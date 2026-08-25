// core.js — shared logic for popup / options / sidebar (classic script).
// Loaded before page scripts. No remote code; all data is bundled locally.
window.PP = (function () {
  const CAL_URL = chrome.runtime.getURL('data/calendar.json');
  const ZIP_URL = chrome.runtime.getURL('data/zip3-to-state.json');
  const CITY_URL = chrome.runtime.getURL('data/cityFinance.json');
  const RIGHTS_URL = chrome.runtime.getURL('data/rights.json');
  const BENEFITS_URL = chrome.runtime.getURL('data/benefits.json');
  const INSIGHTS_URL = chrome.runtime.getURL('data/insights.json');

  let _cal, _zip, _city, _rights, _benefits, _insights;

  async function loadCal() { if (!_cal) _cal = await (await fetch(CAL_URL)).json(); return _cal; }
  async function loadZip() { if (!_zip) _zip = await (await fetch(ZIP_URL)).json(); return _zip; }
  async function loadCity() { if (!_city) _city = await (await fetch(CITY_URL)).json(); return _city; }
  async function loadRights() { if (!_rights) _rights = await (await fetch(RIGHTS_URL)).json(); return _rights; }
  async function loadBenefits() { if (!_benefits) _benefits = await (await fetch(BENEFITS_URL)).json(); return _benefits; }
  async function loadInsights() { if (!_insights) _insights = await (await fetch(INSIGHTS_URL)).json(); return _insights; }

  // Load a gzipped JSON packaged resource (compresses the 2.9 MB ZIP DB ~88%).
  // DecompressionStream is available in extension pages (Chrome 80+). Falls back to plain JSON.
  async function loadGzipJson(url) {
    const res = await fetch(chrome.runtime.getURL(url));
    if (!res.ok) throw new Error('fetch failed: ' + url + ' status ' + res.status);
    const buf = await res.arrayBuffer();
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('gzip');
      const stream = new Response(buf).body.pipeThrough(ds);
      const text = await new Response(stream).text();
      return JSON.parse(text);
    }
    return JSON.parse(new TextDecoder().decode(buf)); // dev/legacy fallback
  }

  // ---- Sponsored / third-party advertiser creatives (compliant delivery) ----
  // We act as the ad network. Creatives are STATIC JSON served from OUR own host — no remote
  // code, no injected scripts (MV3 CSP-safe). The creative CONTENT is third-party advertisers we
  // broker. Remote fetch is opt-in and OFF by default. Ads render ONLY in PennyPilot's own UI,
  // are clearly labeled, are generic (no per-user targeting), and are user-disableable.
  const ADS_ENABLED = false; // flip to true only after data.pennypilot.app/ads.json is hosted
  const ADS_URL = 'https://data.pennypilot.app/ads.json';
  async function loadAds() {
    // No real inventory yet — hide Sponsored surfaces entirely until a hosted
    // creative set is live (ADS_ENABLED flipped true). This keeps the launch clean:
    // no placeholder/sample ads ever reach users.
    if (!ADS_ENABLED) return [];
    try {
      const res = await fetch(ADS_URL, { cache: 'no-store' });
      if (res.ok) { const j = await res.json(); if (j && Array.isArray(j.ads)) return j.ads; }
    } catch (e) { /* fall through to bundled sample */ }
    try {
      const j = await (await fetch(chrome.runtime.getURL('data/ads.json'))).json();
      return Array.isArray(j.ads) ? j.ads : [];
    } catch (e) { return []; }
  }

  function daysUntil(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return Math.ceil((d - new Date()) / 86400000);
  }

  function resolveState(settings, zipMap) {
    if (settings.zip && zipMap && zipMap.map[settings.zip.slice(0, 3)]) {
      return zipMap.map[settings.zip.slice(0, 3)];
    }
    return settings.state || null;
  }

  // Normalize a resolver county string ("Cook" / "Cook County") to our JSON key form ("cook county").
  function countyKey(county) {
    if (!county) return null;
    let k = String(county).toLowerCase().trim();
    if (!/county$/.test(k)) k += ' county';
    return k;
  }

  // Returns upcoming DATED events for the user's location + life events.
  // snoozed: { [eventKey]: untilTimestamp } — events still inside their snooze window are hidden.
  async function buildEvents(settings, remoteAlerts, customReminders, snoozed) {
    const cal = await loadCal();
    const zip = await loadZip();
    const st = resolveState(settings, zip);
    const events = [];

    for (const f of cal.federalDates) {
      const d = daysUntil(f.date);
      if (d >= -1) {
        events.push({ ...f, days: d, scope: 'federal', key: f.id + '@' + f.date, penaltyNote: f.penaltyNote || null });
      }
    }
    if (st && cal.states[st]) {
      const s = cal.states[st];
      const td = daysUntil(s.taxDeadline);
      if (td >= -1) {
        events.push({
          id: 'tax-' + st, key: 'tax-' + st + '@' + s.taxDeadline,
          title: s.name + ' state tax deadline', date: s.taxDeadline, days: td,
          category: 'tax', scope: 'state', note: s.taxDeadlineNote,
          source: 'state DOR',
          penaltyNote: s.hasStateIncomeTax
            ? ('Late ' + s.name + ' filing or payment can trigger state penalties and interest.')
            : null
        });
      }
    }

    // Locality-level minimum-wage change event (forward-looking; only future effective dates surface).
    // Prefer the resolved CITY wage; fall back to COUNTY wage for unincorporated areas.
    const city = await loadCity();
    if (settings.locality) {
      const loc = settings.locality;
      const cityObj = (loc.cityKey && city.cities && city.cities[loc.cityKey]) ? city.cities[loc.cityKey] : null;
      const ck = countyKey(loc.county);
      const countyObj = (ck && city.counties && city.counties[ck]) ? city.counties[ck] : null;
      let w = null, wScope = null, wKey = null;
      if (cityObj && cityObj.minWage && cityObj.minWageEffective) { w = cityObj; wScope = 'city'; wKey = loc.cityKey; }
      else if (countyObj && countyObj.minWage && countyObj.minWageEffective) { w = countyObj; wScope = 'county'; wKey = ck; }
      if (w) {
        const cd = daysUntil(w.minWageEffective);
        if (cd >= 0) {
          events.push({
            id: 'wage-' + wScope + '-' + wKey,
            key: wScope + '-' + wKey + '@' + w.minWageEffective,
            title: w.label + ' minimum wage → $' + w.minWage + '/hr',
            date: w.minWageEffective, days: cd, category: 'wage', scope: wScope,
            note: w.minWageNote || null, source: w.source || 'official publication', penaltyNote: null
          });
        }
      }
    }

    // Life-event derived dated events.
    const life = await lifeEventEvents(settings.lifeEvents || []);
    for (const e of life.dated) {
      const d = daysUntil(e.date);
      if (d >= -1) events.push({ ...e, days: d, scope: 'life', key: 'life-' + e.id + '@' + e.date });
    }

    // Remote override/alert data (scam warnings, temporary extensions). Disabled until hosted.
    if (remoteAlerts && remoteAlerts.length) {
      for (const a of remoteAlerts) {
        const d = daysUntil(a.date);
        if (d >= -1) events.push({ id: 'remote-' + a.key, key: 'remote-' + a.key, title: a.title, date: a.date, days: d, category: a.category || 'alert', scope: 'alert', note: a.note || null, source: a.source || null, penaltyNote: null });
      }
    }
    // User-created custom reminders (name + due date + note). Stored in chrome.storage.sync.
    if (customReminders && customReminders.length) {
      for (const r of customReminders) {
        if (!r || !r.due) continue;
        const d = daysUntil(r.due);
        if (d >= -1) {
          events.push({
            id: 'custom-' + r.id, key: 'custom-' + r.id,
            title: r.name || 'Reminder', date: r.due, days: d,
            category: 'custom', scope: 'custom', note: r.note || null, source: null, penaltyNote: null
          });
        }
      }
    }

    // Keep the full set (pre-snooze) so callers can render a "Snoozed" bucket.
    const all = events.slice();

    // Hide events that are currently inside an active snooze window.
    if (snoozed && typeof snoozed === 'object') {
      const now = Date.now();
      const active = (k) => snoozed[k] && now < snoozed[k];
      for (let i = events.length - 1; i >= 0; i--) {
        if (active(events[i].key)) events.splice(i, 1);
      }
    }

    events.sort((a, b) => a.days - b.days);
    return { events, all, st, cal, zip, lifeNotes: life.notes };
  }

  // Life events → dated reminders + non-dated tips. All factual, no invented figures.
  function lifeEventEvents(lifeEvents) {
    const dated = [], notes = [];
    const has = (k) => lifeEvents.includes(k);
    const taxDay = '2027-04-15'; // federal Tax Day for 2026 returns (next filing season)

    if (has('baby')) {
      dated.push({ id: 'ctc', title: 'Claim Child Tax Credit — file by Tax Day', date: taxDay, category: 'tax', note: 'If you gained a dependent this year, the Child Tax Credit can cut your federal tax bill. File by Tax Day to claim it.' });
      notes.push('Set up or increase a Dependent Care FSA if you pay for childcare — contributions are pre-tax.');
    }
    if (has('self_employed')) {
      const quarters = [['q1', '2026-04-15'], ['q2', '2026-06-15'], ['q3', '2026-09-15'], ['q4', '2027-01-15']];
      for (const [q, date] of quarters) {
        dated.push({ id: 'est-' + q, title: 'Estimated tax due (self-employed)', date, category: 'tax', note: 'Quarterly estimated federal tax. Paying late accrues IRS interest + 0.5%/month failure-to-pay penalty.' });
      }
    }
    if (has('home')) {
      dated.push({ id: 'mortgage', title: 'Gather mortgage interest & property-tax docs', date: taxDay, category: 'tax', note: 'Mortgage interest and state/local property taxes are commonly deductible — collect Forms 1098 before filing.' });
    }
    if (has('moved')) notes.push('After a move, notify the IRS of your address change (Form 8822) and update your state DMV/registrations.');
    if (has('marriage')) notes.push('Update your W-4 and filing status; compare Married Filing Jointly vs Separately — the split can swing your tax by hundreds.');
    if (has('new_job')) notes.push('Submit a new Form W-4 in your first pay period so withholding matches your total household income.');
    if (has('student_loan')) notes.push('Up to $2,500 of student-loan interest may be deductible (phase-out by income) — keep Form 1098-E.');
    return { dated, notes };
  }

  // Locality card: city min wage, city income tax, property-tax note. Uses resolved locality.
  async function getLocality(settings) {
    const city = await loadCity();
    const loc = settings.locality; // {state, county, city, cityKey}
    if (!loc || !loc.cityKey) return null;
    const c = (city.cities && city.cities[loc.cityKey]) ? city.cities[loc.cityKey] : null;
    const co = (loc.county && city.counties) ? city.counties[countyKey(loc.county)] : null;
    // Minimum wage: prefer city, fall back to county (unincorporated areas).
    const w = (c && c.minWage) ? c : (co && co.minWage ? co : null);
    const out = { label: c ? c.label : (w ? w.label : (loc.city ? loc.city + (loc.state ? ', ' + loc.state : '') : null)), county: loc.county || null };
    if (w) { out.minWage = w.minWage; out.minWageEffective = w.minWageEffective; out.minWageNote = w.minWageNote; out.source = w.source; }
    // City income tax stays tied to the resolved city record (only when present).
    if (c && c.cityIncomeTax) out.cityIncomeTax = c.cityIncomeTax;
    if (loc.state && city.propertyTax && city.propertyTax[loc.state]) out.propertyTax = city.propertyTax[loc.state];
    return out;
  }

  async function getRights(state) {
    const r = await loadRights();
    const out = { federal: r.federal, state: (state && r.states[state]) ? r.states[state] : null };
    return out;
  }

  async function getBenefits(state) {
    const b = await loadBenefits();
    const out = { federal: b.federal, sites: b.stateSites };
    if (state && b.stateFood && b.stateFood[state]) out.stateFood = b.stateFood[state];
    return out;
  }

  function getInsight(date) {
    const now = date ? new Date(date) : new Date();
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][now.getMonth()];
    const key = 'insight-' + now.toISOString().slice(0, 10);
    const items = _insights ? _insights.items.filter(i => i.when === month) : [];
    const pick = items.length ? items[Math.abs(hash(key)) % items.length] : (items[0] || null);
    return pick ? pick.text : null;
  }

  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  async function loadInsightsForGet() { if (!_insights) _insights = await loadInsights(); }

  // Waiting-cost line: factual IRS penalty, plus an illustrative compounding note (clearly labeled).
  function waitingCost() {
    const iraCap = 7000, years = 30, rate = 0.07;
    const fv = Math.round(iraCap * Math.pow(1 + rate, years));
    return {
      penaltyFact: 'Missing an estimated-tax due date: IRS charges interest plus a failure-to-pay penalty of 0.5% of the unpaid tax per month.',
      compoundNote: `Illustrative only (assumes 7% avg annual return, not a guarantee): $7,000 invested 30 years early could grow to about $${fv.toLocaleString()} vs. less if delayed. Funding retirement on time compounds in your favor.`
    };
  }

  // Shield score: 100 minus weighted pending risk; never below 40, never above 100.
  function shield(events, doneMap) {
    let pendingUrgent = 0, pendingSoon = 0, secured = 0, total = 0;
    for (const e of events) {
      if (e.days < 0) continue;
      total++;
      if (doneMap && doneMap[e.key]) { secured++; continue; }
      if (e.days <= 14) pendingUrgent++;
      else if (e.days <= 60) pendingSoon++;
    }
    let score = 100 - pendingUrgent * 12 - pendingSoon * 4;
    score = Math.max(40, Math.min(100, score));
    let label = 'Protected';
    if (score < 60) label = 'At risk';
    else if (score < 85) label = 'Watchful';
    return { score, label, secured, total, pendingUrgent, pendingSoon };
  }

  function savings(events, doneMap) {
    let earlyDone = 0, taxDone = 0;
    for (const e of events) {
      const d = doneMap && doneMap[e.key];
      if (d && !d.ignored) {
        if (d.early) earlyDone++;
        if (e.category === 'tax') taxDone++;
      }
    }
    return { earlyDone, taxDone };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { loadCal, loadZip, loadCity, loadRights, loadBenefits, loadInsights: loadInsightsForGet,
    loadGzipJson, loadAds,
    daysUntil, resolveState, buildEvents, getLocality, getRights, getBenefits, getInsight, waitingCost,
    shield, savings, esc };
})();
