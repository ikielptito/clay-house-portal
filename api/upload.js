const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const password = req.headers['x-password'];
  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const filename = decodeURIComponent(req.headers['x-filename'] || 'photo.jpg');
  const contentType = req.headers['content-type'] || 'application/octet-stream';

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const buffer = Buffer.concat(chunks);

  const blob = await put(`site-photos/${Date.now()}-${filename}`, buffer, {
    access: 'public',
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  return res.json({ url: blob.url });
};
