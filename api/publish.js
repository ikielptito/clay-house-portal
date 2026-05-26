const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

// ─── Percentage helpers (mirrors index.html logic) ───────────────────────────
const WORK_PACKAGES = [
  { category: 'Foundation',           items: ['Preparation', 'Soil Work', 'Stonework'] },
  { category: 'Structure',            items: ['Concrete Work Structure', 'Pool Structure', 'Ground Tank & Deep-well'] },
  { category: 'Finishing',            items: ['Wall Finishing', 'Floor Finishing', 'Door & Window Installation', 'Plumbing Installation', 'Sanitary Installation', 'Electrical Work'] },
  { category: 'Furnishing & Fit-Out', items: ['Fit-Out', 'Furnishing'] }
];
const CONSTRUCTION_CATS = ['Foundation', 'Structure', 'Finishing'];

function getPct(wp, item) { return parseInt(wp?.[item] ?? 0) || 0; }

function calcConstructionPct(wp) {
  let sum = 0, n = 0;
  for (const cat of WORK_PACKAGES) {
    if (!CONSTRUCTION_CATS.includes(cat.category)) continue;
    for (const item of cat.items) { sum += getPct(wp, item); n++; }
  }
  return n ? Math.round(sum / n) : 0;
}

function calcOverallPct(wp) {
  let sum = 0, n = 0;
  for (const cat of WORK_PACKAGES)
    for (const item of cat.items) { sum += getPct(wp, item); n++; }
  return n ? Math.round(sum / n) : 0;
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
async function sendWhatsApp(phone, period, cPct, oPct) {
  const phoneId      = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token        = process.env.WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'clay_house_progress_update';
  const portalUrl    = process.env.PORTAL_URL || 'https://clay-house-portal.vercel.app';

  if (!phoneId || !token) return;

  const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
  if (!cleanPhone) return;

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: period },
              { type: 'text', text: `${cPct}%` },
              { type: 'text', text: `${oPct}%` },
              { type: 'text', text: portalUrl }
            ]
          }]
        }
      })
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`WhatsApp failed for ${cleanPhone}:`, body);
    }
  } catch (err) {
    console.error(`WhatsApp error for ${cleanPhone}:`, err.message);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password, report } = req.body || {};

  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!report || !report.id || !report.period) {
    return res.status(400).json({ error: 'Invalid report' });
  }

  const cPct = calcConstructionPct(report.workPackages);
  const oPct = calcOverallPct(report.workPackages);

  // Store full report
  await redis.set(`report:${report.id}`, report);

  // Prepend to index — include percentages so the trend chart doesn't
  // need to fetch every full report individually
  await redis.lpush('report:index', JSON.stringify({
    id:     report.id,
    period: report.period,
    cPct,
    oPct
  }));

  // Fire WhatsApp notifications (failures logged, never thrown)
  const buyers = (process.env.BUYER_WHATSAPP_NUMBERS || '')
    .split(',')
    .filter(Boolean);

  if (buyers.length) {
    await Promise.all(buyers.map(phone =>
      sendWhatsApp(phone, report.period, cPct, oPct)
    ));
  }

  return res.json({ success: true });
};
