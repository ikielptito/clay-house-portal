const { Redis } = require('@upstash/redis');
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const CONTRACT_VALUES = {
  'B1': 807424241, 'B2': 807424241, 'A1': 810369944, 'A2': 834263427,
  'Swimming Pool': 264784325, 'Ground Tank': 117294918,
  'Outdoor': 996908647, 'Sanitary': 14904000
};
const CONSTRUCTION_ITEMS = ['B1','B2','A1','A2','Swimming Pool','Ground Tank','Outdoor','Sanitary'];
const FF_UNITS = ['Unit 1','Unit 2','Unit 3','Unit 4','Unit 5','Unit 6','Unit 8'];

function getPct(wp, k) { return parseFloat(wp?.[k] ?? 0) || 0; }

function weightedPct(wp, items) {
  let ws = 0, tw = 0;
  for (const item of items) {
    const w = CONTRACT_VALUES[item] || 1;
    ws += getPct(wp, item) * w; tw += w;
  }
  return tw ? Math.round(ws / tw * 100) / 100 : 0;
}

function calcOverall(wp) {
  const hasFf = FF_UNITS.some(u => getPct(wp, `${u} FF`) > 0);
  const cPct  = weightedPct(wp, CONSTRUCTION_ITEMS);
  if (!hasFf) return cPct;
  const ffAvg = FF_UNITS.reduce((s, u) => s + getPct(wp, `${u} FF`), 0) / FF_UNITS.length;
  return Math.round((cPct * 0.75 + ffAvg * 0.25) * 100) / 100;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password, id, workPackages } = req.body || {};
  if (!password || password !== process.env.APP_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' });
  if (!id || !workPackages)
    return res.status(400).json({ error: 'id and workPackages required' });

  const report = await redis.get(`report:${id}`);
  if (!report) return res.status(404).json({ error: 'Report not found' });

  const updated = { ...report, workPackages };
  await redis.set(`report:${id}`, updated);

  // Update index entry with recalculated percentages
  const raw = await redis.lrange('report:index', 0, -1);
  const entries = (raw || []).map(e => typeof e === 'string' ? JSON.parse(e) : e);
  const idx = entries.findIndex(e => e.id === id);
  if (idx !== -1) {
    entries[idx] = {
      ...entries[idx],
      cPct: weightedPct(workPackages, CONSTRUCTION_ITEMS),
      oPct: calcOverall(workPackages)
    };
    await redis.lset('report:index', idx, JSON.stringify(entries[idx]));
  }

  return res.json({ success: true, id, workPackages });
};
