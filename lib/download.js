// An old URL alone must never publish an unverified installer after a website update.
function ready() {
  if (process.env.SG_DOWNLOAD_ENABLED !== 'true') return false;
  try {
    const url = new URL(process.env.SG_DOWNLOAD_URL);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}
module.exports = { ready };
