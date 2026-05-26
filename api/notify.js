const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

async function sendWhatsApp(phone, period, cPct, oPct) {
  const phoneId      = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token        = process.env.WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'clay_house_progress_update';

  const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
  if (!cleanPhone) return { phone, ok: false, error: 'Invalid number' };

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
              { type: 'text', text: `${oPct}%` }
            ]
          }]
        }
      })
    });
    const body = await res.json();
    if (!res.ok) return { phone: cleanPhone, ok: false, error: body?.error?.message || 'Failed' };
    return { phone: cleanPhone, ok: true };
  } catch (err) {
    return { phone: cleanPhone, ok: false, error: err.message };
  }
}

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body || {};
  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'WhatsApp credentials not configured' });
  }

  const buyers = (process.env.BUYER_WHATSAPP_NUMBERS || '').split(',').filter(Boolean);
  if (!buyers.length) {
    return res.status(400).json({ error: 'No buyer numbers configured' });
  }

  // Fetch latest report
  const raw = await redis.lrange('report:index', 0, 0);
  if (!raw?.length) return res.status(404).json({ error: 'No reports found' });

  const { id, period, cPct: indexCPct, oPct: indexOPct } =
    typeof raw[0] === 'string' ? JSON.parse(raw[0]) : raw[0];

  let cPct = indexCPct;
  let oPct = indexOPct;

  // If old report without stored percentages, fetch full report to calculate
  if (cPct === undefined || oPct === undefined) {
    const report = await redis.get(`report:${id}`);
    if (report) {
      cPct = calcConstructionPct(report.workPackages);
      oPct = calcOverallPct(report.workPackages);
    }
  }

  const results = await Promise.all(
    buyers.map(phone => sendWhatsApp(phone, period, cPct ?? 0, oPct ?? 0))
  );

  const sent    = results.filter(r => r.ok).length;
  const failed  = results.filter(r => !r.ok);

  return res.json({ period, sent, failed, total: buyers.length });
};
