const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password, report } = req.body || {};

  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!report || !report.id || !report.period) {
    return res.status(400).json({ error: 'Invalid report' });
  }

  // Store the full report object
  await redis.set(`report:${report.id}`, report);

  // Prepend to the index list (newest first)
  await redis.lpush('report:index', JSON.stringify({ id: report.id, period: report.period }));

  return res.json({ success: true });
};
