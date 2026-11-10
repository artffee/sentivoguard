// Prepare a separate source tree; never edit the production key or deploy.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validate } = require('../server/release-config');

// Also works from the downloadable source ZIP. Copy only known source paths;
// local settings, signing keys, node_modules and existing builds stay behind.
function sourceFiles(root) {
  const directories = new Set(['.github', 'api', 'assets', 'desktop', 'docs', 'js', 'lib', 'server', 'styles', 'tests', 'tools', 'web']);
  const topLevel = new Set(['LICENSE', 'README.md', '.gitignore', '.vercelignore', '.server.js', 'main.js', 'preload.js', 'desktop-release.json', 'package.json', 'package-lock.json', 'vercel.json']);
  const files = [];
  function visit(relative) {
    const stat = fs.lstatSync(path.join(root, relative));
    if (stat.isSymbolicLink()) throw new Error('sandbox_source_must_be_regular_file');
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(path.join(root, relative))) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        visit(path.join(relative, entry));
      }
    } else if (stat.isFile() && (topLevel.has(relative) || relative === path.join('server', 'license-public.pem') || /\.(?:js|json|md|html|css|png|ico|svg|ya?ml)$/.test(relative))) {
      files.push(relative);
    }
  }
  for (const entry of fs.readdirSync(root)) {
    if (directories.has(entry) || topLevel.has(entry) || /\.(html|css)$/.test(entry)) visit(entry);
  }
  return files;
}

function publicKey(pem) {
  if (typeof pem !== 'string' || !pem.trim().startsWith('-----BEGIN PUBLIC KEY-----') || pem.includes('PRIVATE KEY')) throw new Error('public_key_required');
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('ed25519_public_key_required');
  return key;
}
function stage({ root, destination, origin, publicPem }) {
  const config = validate({ channel: 'sandbox', licenseOrigin: origin });
  const key = publicKey(publicPem);
  const productionKey = publicKey(fs.readFileSync(path.join(root, 'server/license-public.pem'), 'utf8'));
  if (key.equals(productionKey)) throw new Error('sandbox_requires_separate_public_key');
  if (fs.existsSync(destination)) throw new Error('sandbox_destination_already_exists');
  const files = sourceFiles(root);
  fs.mkdirSync(destination, { recursive: true });
  for (const file of files) {
    if (/(^|\/)\.env(?:\.|$)/.test(file)) continue;
    const source = path.join(root, file);
    if (!fs.lstatSync(source).isFile()) throw new Error('sandbox_source_must_be_regular_file');
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  fs.writeFileSync(path.join(destination, 'desktop-release.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'server/license-public.pem'), key.export({ type: 'spki', format: 'pem' }));
  const pkg = JSON.parse(fs.readFileSync(path.join(destination, 'package.json')));
  pkg.name = 'sentivoguard-sandbox';
  pkg.version = pkg.version.split('-')[0] + '-sandbox';
  pkg.build.appId = 'com.sentivoguard.sandbox';
  pkg.build.productName = 'SentivoGuard Sandbox';
  pkg.build.nsis.shortcutName = 'SentivoGuard Sandbox';
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const lockPath = path.join(destination, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath));
    lock.name = pkg.name; lock.version = pkg.version;
    if (lock.packages?.['']) { lock.packages[''].name = pkg.name; lock.packages[''].version = pkg.version; }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  }
  return destination;
}
if (require.main === module) {
  try {
    const [origin, keyPath] = process.argv.slice(2);
    if (!origin || !keyPath) throw new Error('Usage: npm run stage:sandbox -- https://TEST-HOST /absolute/path/test-public.pem');
    const root = path.resolve(__dirname, '..');
    const result = stage({ root, destination: path.join(root, 'out', 'sandbox-source'), origin, publicPem: fs.readFileSync(keyPath, 'utf8') });
    console.log('Sandbox source prepared at ' + result + '. No deployment or installer publication performed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { stage, publicKey };
