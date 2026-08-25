// gen-data.mjs — 从现有仓库抽取真实数据，生成 PennyPilot 扩展所需的静态数据。
// 运行：node --experimental-strip-types scripts/gen-data.mjs
// YMYL 原则：所有数字来自下方标注的权威源（DOL / IRS / Tax Foundation），绝不编造。
import { writeFileSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../data');

// ---- 1) 真实州最低工资（来源：U.S. DOL, 2026-07-01；检索 2026-08-09）----
const tipMod = await import('file:///D:/work/GitHub/tipfig/src/lib/tipLawByState.ts');
const tipLaws = tipMod.tipLaws;

// 无州所得税的 9 个辖区（公开稳定事实；NH 仅征利息/分红，此处标为无综合所得税）
const NO_STATE_INCOME_TAX = new Set(['AK','FL','NV','NH','SD','TN','TX','WA','WY']);

// ---- 2) 联邦财务关键日（来源：IRS 公开日历；稳定事实）----
// 以"当前日期 2026-08-25 之后"的 upcoming 视角组织；年份随报税季滚动。
const federalDates = [
  { id:'est-q3-2026', title:'Q3 2026 estimated tax due', date:'2026-09-15', category:'tax',
    note:'Third-quarter estimated federal tax payment (Form 1040-ES) for 2026.', source:'IRS',
    penaltyNote:'IRS late-payment penalty is 0.5% of unpaid tax per month (up to 25%). Paying on time avoids it.' },
  { id:'sep-ira-2025ext', title:'SEP IRA & extended 2025 return due', date:'2026-10-15', category:'tax',
    note:'Final deadline for SEP IRA contributions (for extended 2025 returns) and Oct-15 extended 2025 federal returns.', source:'IRS',
    penaltyNote:'Missed extended deadlines can trigger failure-to-file penalties (5% per month, up to 25%).' },
  { id:'aca-open-2027', title:'ACA open enrollment begins', date:'2026-11-01', category:'enrollment',
    note:'Healthcare.gov open enrollment for 2027 coverage typically starts Nov 1.', source:'HealthCare.gov' },
  { id:'est-q4-2026', title:'Q4 2026 estimated tax due', date:'2027-01-15', category:'tax',
    note:'Final 2026 estimated tax payment (also covers any remaining Q4).', source:'IRS',
    penaltyNote:'IRS late-payment penalty is 0.5% of unpaid tax per month (up to 25%).' },
  { id:'w2-1099-2027', title:'W-2 / 1099 forms sent by employers', date:'2027-01-31', category:'tax',
    note:'Employers must furnish W-2 and most 1099 forms by Jan 31.', source:'IRS' },
  { id:'aca-close-2027', title:'ACA open enrollment ends', date:'2027-01-15', category:'enrollment',
    note:'Open enrollment for 2027 coverage typically ends mid-January.', source:'HealthCare.gov' },
  { id:'tax-day-2027', title:'Tax Day (2026 federal return)', date:'2027-04-15', category:'tax',
    note:'Federal income tax filing deadline for most taxpayers. Most states align with this date; a few differ — verify your state DOR.', source:'IRS',
    penaltyNote:'IRS failure-to-file is 5% of unpaid tax per month (up to 25%); pay what you can by Apr 15 to limit penalties.' },
  { id:'fafsa-2027', title:'FAFSA deadline (federal)', date:'2027-06-30', category:'education',
    note:'Federal FAFSA deadline for the 2026-27 award year.', source:'StudentAid.gov' },
  { id:'free-credit-2027', title:'Order your free credit report', date:'2027-01-01', category:'credit',
    note:'You can pull a free report weekly from annualcreditreport.gov — stagger through the year.', source:'annualcreditreport.gov' },
];

// ---- 3) 组装 states ----
const states = {};
for (const s of tipLaws) {
  states[s.abbr] = {
    abbr: s.abbr,
    name: s.name,
    minWage: s.regularMinWage,
    tippedCashWage: s.tippedCashWage,
    noTipCredit: s.noTipCredit,
    minWageNote: s.note || null,
    minWageAsOf: '2026-07-01',
    minWageSource: 'U.S. Department of Labor — Wage and Hour Division (retrieved 2026-08-09)',
    hasStateIncomeTax: !NO_STATE_INCOME_TAX.has(s.abbr),
    taxDeadline: '2027-04-15',
    taxDeadlineNote: NO_STATE_INCOME_TAX.has(s.abbr)
      ? 'This state has no general state individual income tax.'
      : 'Most states align their individual income-tax deadline with the federal April 15 date; a few differ — verify your state DOR.',
  };
}

const calendar = {
  meta: {
    product: 'PennyPilot',
    version: '1.0.0',
    generated: '2026-08-25',
    scope: 'Federal key dates + 51 jurisdictions (50 states + DC) minimum-wage & state-income-tax baseline.',
    ymyl: 'All figures sourced from authoritative public data (DOL, IRS, state DOR). State-specific local items (city wage, city income tax, county property tax) arrive in later builds.',
    sources: [
      'U.S. DOL Wage & Hour Division — Minimum Wages for Tipped Employees (table 2026-07-01, retrieved 2026-08-09)',
      'IRS federal tax calendar (tax-year 2026/2027)',
      'Tax Foundation — State Individual Income Tax Rates and Brackets, 2026 (retrieved 2026-08-09)'
    ]
  },
  federalDates,
  states
};

// ---- 4) ZIP -> state（前缀） + ZIP -> 县/市（完整，v0.3 精度层）----
// 来源：us_zips.csv（GardenFig 数据层），列：zipcode,city,state_name,state,county,...
const csv = readFileSync('D:/work/GitHub/GardenFig/data/us_zips.csv', 'utf8');
const lines = csv.split('\n').slice(1); // skip header
const zip3 = {};
const locality = {};
let count3 = 0, countFull = 0;
for (const line of lines) {
  if (!line.trim()) continue;
  const cols = line.split(',');
  const zip = cols[0];
  const city = cols[1];
  const st = cols[3];
  const county = cols[4];
  if (!zip || !st || st.length !== 2) continue;
  const prefix = zip.slice(0, 3);
  if (!zip3[prefix]) { zip3[prefix] = st; count3++; }
  if (!locality[zip]) { locality[zip] = [st, county || '', city || '']; countFull++; }
}
const zipMap = { meta: { generated:'2026-08-25', source:'GardenFig us_zips.csv', note:'ZIP prefix (first 3 digits) -> state. County/city precision (v0.3) uses full ZIP.' }, map: zip3 };
const locMap = { meta: { generated:'2026-08-25', source:'GardenFig us_zips.csv', note:'Full ZIP -> [state, county, city]. Used for v0.3 county/city-level reminders. Privacy: bundled locally, never uploaded.' }, map: locality };

writeFileSync(resolve(OUT, 'calendar.json'), JSON.stringify(calendar, null, 2));
writeFileSync(resolve(OUT, 'zip3-to-state.json'), JSON.stringify(zipMap, null, 2));
// Compress the large ZIP DB (~2.9 MB → ~360 KB) to keep the extension package small.
writeFileSync(resolve(OUT, 'zip-to-locality.json.gz'), gzipSync(JSON.stringify(locMap, null, 2), { level: 9 }));
console.log('calendar.json states:', Object.keys(states).length, '| federalDates:', federalDates.length, '| zip3:', count3, '| full ZIP:', countFull);
