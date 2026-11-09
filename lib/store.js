// Redis errors must never be confused with a missing account.
const configured = () => !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
async function exec(...args) {
  if (!configured()) throw new Error('storage_unavailable');
  const response = await fetch(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { Authorization: 'Bearer ' + (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify(args)
  });
  if (!response.ok) throw new Error('storage_unavailable');
  const data = await response.json();
  if (data.error) throw new Error('storage_unavailable');
  return data.result;
}
const decode = value => value == null ? null : JSON.parse(value);
const get = async key => decode(await exec('GET', key));
const take = async key => decode(await exec('GETDEL', key));
async function set(key, value, ttl) {
  const args = ['SET', key, JSON.stringify(value)];
  if (ttl) args.push('EX', String(ttl));
  if (await exec(...args) !== 'OK') throw new Error('storage_unavailable');
  return true;
}
async function create(key, value, ttl) {
  const args = ['SET', key, JSON.stringify(value), 'NX'];
  if (ttl) args.push('EX', String(ttl));
  return await exec(...args) === 'OK';
}
async function patch(key, fields) {
  return decode(await exec('EVAL', `local s=redis.call('GET',KEYS[1]); if not s then return nil end; local v=cjson.decode(s); local p=cjson.decode(ARGV[1]); for k,x in pairs(p) do v[k]=x end; local out=cjson.encode(v); redis.call('SET',KEYS[1],out); return out`, 1, key, JSON.stringify(fields)));
}
async function limit(key, maximum, seconds) {
  const count = await exec('EVAL', `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`, 1, key, String(seconds));
  return count <= maximum;
}
module.exports = { configured, exec, get, take, set, create, patch, limit, del: key => exec('DEL', key) };

async function patchVersion(key, fields, version) {
  return decode(await exec('EVAL', `local s=redis.call('GET',KEYS[1]); if not s then return nil end; local v=cjson.decode(s); if (v.sessionVersion or 0)~=cjson.decode(ARGV[2]) then return nil end; local p=cjson.decode(ARGV[1]); for k,x in pairs(p) do v[k]=x end; local out=cjson.encode(v); redis.call('SET',KEYS[1],out); return out`, 1, key, JSON.stringify(fields), JSON.stringify(version)));
}
module.exports.patchVersion = patchVersion;

// Release only our own lease: an expired worker must not delete a newer lock.
module.exports.release = (key, owner) => exec('EVAL', `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0`, 1, key, JSON.stringify(owner));
