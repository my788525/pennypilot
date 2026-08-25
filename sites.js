// sites.js — 合规回链 / 联盟披露 / 订阅配置（classic script，popup/options 通过 window 读取）
// 注意：以下域名为你站群已知根域；具体落地页 slug 由你后续细化。
// 联盟链接必须显著披露 + 用户点击触发（Chrome 政策 + FTC 要求）。
window.PP_SITES = {
  tax:  { label: 'Tax tools & guides', url: 'https://fisctalk.com' },
  wage: { label: 'Pay & tip-law tools', url: 'https://tipfig.com' },
  loan: { label: 'Mortgage & loan tools', url: 'https://ratefig.com' },
  health: { label: 'Insurance guides', url: 'https://insurtool.com' }
};
window.PP_DISCLOSURE =
  'Some links are recommendations from our publishing partners. They do not affect your reminders and may earn us a commission at no extra cost to you.';

// Stripe / Paddle 订阅结账链接（需你填入真实 URL；留空则 Premium 按钮置灰并提示待配置）
window.PP_STRIPE_URL = '';
