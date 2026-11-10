const H = require('../lib/http');
const download = require('../lib/download');
module.exports = H.endpoint(async (req, res) => {
  if (req.method !== 'GET') return H.json(res, 405, { ok: false });
  await H.requireUser(req);
  if (!download.ready()) return H.json(res, 503, { ok: false, error: 'download_unavailable' });
  res.statusCode = 302;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Location', process.env.SG_DOWNLOAD_URL);
  res.end();
});
