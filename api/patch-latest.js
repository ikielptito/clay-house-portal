const { Redis } = require('@upstash/redis');
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const CONTRACT_VALUES = {
  'B1': 807424241, 'B2': 807424241, 'A1': 810369944, 'A2': 834263427,
  'Swimming Pool': 264784325, 'Ground Tank': 117294918, 'Outdoor': 996908647,
  'Sanitary': 14904000
};
const CONSTRUCTION_ITEMS = ['B1','B2','A1','A2','Swimming Pool','Ground Tank','Outdoor','Sanitary'];

function weightedPct(wp, items) {
  let ws = 0, tw = 0;
  for (const item of items) {
    const w = CONTRACT_VALUES[item] || 1;
    ws += (parseFloat(wp?.[item] ?? 0) || 0) * w;
    tw += w;
  }
  return tw ? Math.round(ws / tw * 10) / 10 : 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { password, workPackages } = req.body || {};
  if (!password || password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  if (!workPackages) return res.status(400).json({ error: 'workPackages required' });

  const raw = await redis.lrange('report:index', 0, 0);
  if (!raw?.length) return res.status(404).json({ error: 'No reports found' });
  const { id, period } = typeof raw[0] === 'string' ? JSON.parse(raw[0]) : raw[0];

  const report = await redis.get(`report:${id}`);
  if (!report) return res.status(404).json({ error: 'Report not found' });

  const patched = { ...report, workPackages };
  await redis.set(`report:${id}`, patched);

  const cPct = weightedPct(workPackages, CONSTRUCTION_ITEMS);
  const oPct = cPct;
  await redis.lset('report:index', 0, JSON.stringify({ id, period, cPct, oPct }));

  return res.json({ success: true, id, period, cPct, oPct });
};
