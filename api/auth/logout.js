// GET or POST /api/auth/logout
// Clears both sg_session AND sg_license cookies. GET redirects home; POST
// returns JSON.

const { clearCookie } = require("../../lib/cookies");

module.exports = async function handler(req, res) {
  clearCookie(res, "sg_session");
  clearCookie(res, "sg_license");

  if (req.method === "GET") {
    res.statusCode = 302;
    res.setHeader("Location", "/");
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  }

  res.statusCode = 200;
  res.setHeader("Content-Type",  "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ ok: true }));
};
