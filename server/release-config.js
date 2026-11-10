// Build-time configuration, never supplied by the renderer or a license token.
function validate(config) {
  if (!config || !['production', 'sandbox'].includes(config.channel)) throw new Error('invalid_release_channel');
  const url = new URL(config.licenseOrigin);
  if (url.protocol !== 'https:' || url.origin !== config.licenseOrigin || url.username || url.password) throw new Error('invalid_license_origin');
  if (config.channel === 'production' && url.origin !== 'https://sentivoguard.com') throw new Error('production_origin_mismatch');
  if (config.channel === 'sandbox' && ['sentivoguard.com', 'www.sentivoguard.com'].includes(url.hostname)) throw new Error('sandbox_requires_separate_origin');
  return Object.freeze({ channel: config.channel, licenseOrigin: url.origin });
}
module.exports = { validate, load: () => validate(require('../desktop-release.json')) };
