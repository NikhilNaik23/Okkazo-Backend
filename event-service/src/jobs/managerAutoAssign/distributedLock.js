'use strict';

const crypto = require('crypto');
const logger = require('../../utils/logger');

const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

const acquireDistributedLock = async ({ redis, key, ttlMs, metrics } = {}) => {
  if (!redis) {
    return { acquired: false, release: async () => {} };
  }

  const token = crypto.randomBytes(16).toString('hex');

  try {
    const result = await redis.set(key, token, { NX: true, PX: ttlMs });
    if (result !== 'OK') {
      if (metrics) metrics.counters.lock.skipped = true;
      return { acquired: false, release: async () => {} };
    }

    if (metrics) metrics.counters.lock.acquired = true;

    const release = async () => {
      try {
        await redis.eval(RELEASE_LUA, { keys: [key], arguments: [token] });
      } catch (err) {
        logger.warn(`Redis lock release failed: ${err.message}`);
      }
    };

    return { acquired: true, release };
  } catch (err) {
    if (metrics) metrics.counters.lock.errors += 1;
    logger.warn(`Redis lock acquire failed: ${err.message}`);
    return { acquired: false, release: async () => {} };
  }
};

module.exports = {
  acquireDistributedLock,
};
