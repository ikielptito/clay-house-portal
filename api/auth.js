module.exports = function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { password } = req.body || {};
  if (password && password === process.env.APP_PASSWORD) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false });
};
