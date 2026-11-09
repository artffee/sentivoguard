const crypto = require('node:crypto');
const { promisify } = require('node:util');
const store = require('./store');
const scrypt = promisify(crypto.scrypt);
const SESSION_LIFETIME = 30 * 86400;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = email => typeof email === 'string' ? email.trim().toLowerCase() : '';
const userKey = email => 'user:' + normalize(email);
const validateEmail = email => typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validatePassword = value => typeof value === 'string' && value.length >= 8 && value.length <= 200;
const hashPassword = async (password, salt) => (await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 })).toString('hex');
const findUserInStore = email => store.get(userKey(email));
const updateUser = (email, fields) => store.patch(userKey(email), fields);
async function signup(email, password) {
  email = normalize(email);
  if (!validateEmail(email) || !validatePassword(password)) throw new Error('invalid_credentials');
  const salt = crypto.randomBytes(16).toString('hex');
  const user = { email, salt, passwordHash: await hashPassword(password, salt), createdAt: new Date().toISOString(), sessionVersion: crypto.randomUUID(), emailVerified: false };
  if (!await store.create(userKey(email), user)) throw new Error('user_exists');
  return user;
}
async function login(email, password) {
  if (!validateEmail(normalize(email)) || !validatePassword(password)) return null;
  const user = await findUserInStore(email);
  const actual = await hashPassword(password, user?.salt || 'sentivoguard-no-account');
  const expected = user?.passwordHash || '0'.repeat(128);
  if (!/^[0-9a-f]{128}$/i.test(expected) || !crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) return null;
  return user;
}
async function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.set('session:' + digest(token), { email: user.email, version: user.sessionVersion || 0 }, SESSION_LIFETIME);
  return token;
}
async function readSession(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  const session = await store.get('session:' + digest(token));
  if (!session) return null;
  const user = await findUserInStore(session.email);
  return user && (user.sessionVersion || 0) === session.version ? user : null;
}
async function revokeSession(token) {
  if (typeof token === 'string' && /^[0-9a-f]{64}$/.test(token)) await store.del('session:' + digest(token));
}
async function issueAction(user, purpose) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.set('action:' + digest(token), { email: user.email, purpose, version: user.sessionVersion || 0 }, 1800);
  return token;
}
async function completeAction(token, purpose, password) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw new Error('invalid_or_expired_link');
  if (purpose === 'reset' && !validatePassword(password)) throw new Error('invalid_password');
  const action = await store.take('action:' + digest(token));
  if (!action || action.purpose !== purpose) throw new Error('invalid_or_expired_link');
  const user = await findUserInStore(action.email);
  if (!user || (user.sessionVersion || 0) !== action.version) throw new Error('invalid_or_expired_link');
  const fields = { emailVerified: true };
  if (purpose === 'reset') {
    fields.salt = crypto.randomBytes(16).toString('hex');
    fields.passwordHash = await hashPassword(password, fields.salt);
    fields.sessionVersion = crypto.randomUUID();
  }
  const updated = await store.patchVersion(userKey(user.email), fields, action.version);
  if (!updated) throw new Error('invalid_or_expired_link');
  return updated;
}
module.exports = { signup, login, createSession, readSession, revokeSession, findUserInStore, updateUser, issueAction, completeAction,
  validateEmail, validatePassword, normalize, digest, SESSION_LIFETIME, storeConfigured: store.configured };
