const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { id } = req.query || {};

  // No id → return the full index list (id + period only, for the sidebar)
  if (!id) {
    const raw = await redis.lrange('report:index', 0, -1);
    const list = (raw || []).map(item =>
      typeof item === 'string' ? JSON.parse(item) : item
    );
    return res.json(list);
  }

  // id=latest → return the most recently published report
  if (id === 'latest') {
    const raw = await redis.lrange('report:index', 0, 0);
    if (!raw || !raw.length) return res.json(null);
    const { id: latestId } = typeof raw[0] === 'string' ? JSON.parse(raw[0]) : raw[0];
    const report = await redis.get(`report:${latestId}`);
    return res.json(report || null);
  }

  // id=<specific> → return that report
  const report = await redis.get(`report:${id}`);
  if (!report) return res.status(404).json({ error: 'Not found' });
  return res.json(report);
};
