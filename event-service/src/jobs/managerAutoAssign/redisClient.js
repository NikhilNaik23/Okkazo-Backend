'use strict';

const logger = require('../../utils/logger');

let clientSingleton = null;
let connecting = null;
let lastErrorAtMs = 0;

const getRedisClient = async ({ redisUrl } = {}) => {
  const url = redisUrl || process.env.REDIS_URL;
  if (!url) return null;

  if (clientSingleton?.isOpen) return clientSingleton;

  const now = Date.now();
  // Avoid tight reconnect loops.
  if (now - lastErrorAtMs < 10_000) return null;

  if (connecting) {
    try {
      return await connecting;
    } catch (_) {
      return null;
    }
  }

  connecting = (async () => {
    try {
      const { createClient } = require('redis');
      const client = createClient({ url });

      client.on('error', (err) => {
        lastErrorAtMs = Date.now();
        logger.warn(`Redis client error: ${err?.message || String(err)}`);
      });

      await client.connect();
      clientSingleton = client;
      logger.info('Redis client connected (manager auto-assign)');
      return clientSingleton;
    } catch (err) {
      lastErrorAtMs = Date.now();
      logger.warn(`Redis connection failed (manager auto-assign): ${err.message}`);
      clientSingleton = null;
      throw err;
    } finally {
      connecting = null;
    }
  })();

  try {
    return await connecting;
  } catch (_) {
    return null;
  }
};

module.exports = {
  getRedisClient,
};
