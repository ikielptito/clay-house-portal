const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

// Contract values from CV. Lina Jaya progress report (IDR) — for weighted avg
const CONTRACT_VALUES = {
  'B1':            807424241,
  'B2':            807424241,
  'A1':            810369944,
  'A2':            834263427,
  'Swimming Pool': 264784325,
  'Ground Tank':   117294918,
  'Outdoor':       996908647
};

const BUILDING_ITEMS = ['B1', 'B2', 'A1', 'A2'];
const ALL_ITEMS = [...BUILDING_ITEMS, 'Swimming Pool', 'Ground Tank', 'Outdoor'];

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
  if (!buyers.length) return res.status(400).json({ error: 'No buyer numbers configured' });

  const raw = await redis.lrange('report:index', 0, 0);
  if (!raw?.length) return res.status(404).json({ error: 'No reports found' });

  const { id, period, cPct: indexCPct, oPct: indexOPct } =
    typeof raw[0] === 'string' ? JSON.parse(raw[0]) : raw[0];

  let cPct = indexCPct;
  let oPct = indexOPct;

  if (cPct === undefined || oPct === undefined) {
    const report = await redis.get(`report:${id}`);
    if (report) {
      cPct = weightedPct(report.workPackages, BUILDING_ITEMS);
      oPct = weightedPct(report.workPackages, ALL_ITEMS);
    }
  }

  const results = await Promise.all(
    buyers.map(phone => sendWhatsApp(phone, period, cPct ?? 0, oPct ?? 0))
  );

  const sent   = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);

  return res.json({ period, sent, failed, total: buyers.length });
};
