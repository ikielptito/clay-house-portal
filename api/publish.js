const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

// Contract values from CV. Lina Jaya progress report (IDR)
// Used for value-weighted progress calculations to match contractor figures
const CONTRACT_VALUES = {
  'B1':            807424241,
  'B2':            807424241,
  'A1':            810369944,
  'A2':            834263427,
  'Swimming Pool': 264784325,
  'Ground Tank':   117294918,
  'Outdoor':       996908647,
  'Sanitary':       14904000
};

const BUILDING_ITEMS     = ['B1', 'B2', 'A1', 'A2'];
const CONSTRUCTION_ITEMS = [...BUILDING_ITEMS, 'Swimming Pool', 'Ground Tank', 'Outdoor', 'Sanitary'];
const ALL_ITEMS          = CONSTRUCTION_ITEMS;

function getPct(wp, item) { return parseFloat(wp?.[item] ?? 0) || 0; }

function weightedPct(wp, items) {
  let weightedSum = 0, totalWeight = 0;
  for (const item of items) {
    const w = CONTRACT_VALUES[item] || 1;
    weightedSum += getPct(wp, item) * w;
    totalWeight += w;
  }
  return totalWeight ? Math.round(weightedSum / totalWeight) : 0;
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
async function sendWhatsApp(phone, period, cPct, oPct) {
  const phoneId      = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token        = process.env.WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'clay_house_progress_update';

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
              { type: 'text', text: `${oPct}%` }
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

  const wp   = report.workPackages || {};
  const cPct = weightedPct(wp, CONSTRUCTION_ITEMS);
  const oPct = weightedPct(wp, ALL_ITEMS);

  await redis.set(`report:${report.id}`, report);
  await redis.lpush('report:index', JSON.stringify({
    id: report.id, period: report.period, cPct, oPct
  }));

  const buyers = (process.env.BUYER_WHATSAPP_NUMBERS || '').split(',').filter(Boolean);
  if (buyers.length) {
    await Promise.all(buyers.map(phone =>
      sendWhatsApp(phone, report.period, cPct, oPct)
    ));
  }

  return res.json({ success: true });
};
