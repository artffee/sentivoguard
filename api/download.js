const H = require('../lib/http');
module.exports = H.endpoint(async (req, res) => {
  if (req.method !== 'GET') return H.json(res, 405, { ok: false });
  await H.requireUser(req);
  if (!process.env.SG_DOWNLOAD_URL || new URL(process.env.SG_DOWNLOAD_URL).protocol !== 'https:') return H.json(res, 503, { ok: false, error: 'download_unavailable' });
  res.statusCode = 302;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Location', process.env.SG_DOWNLOAD_URL);
  res.end();
});
