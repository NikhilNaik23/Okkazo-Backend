const axios = require('axios');

const AUTH_ID_CACHE_TTL_MS = 5 * 60 * 1000;
const authIdToUserIdCache = new Map();

const getUserServiceUrl = () => {
  const defaultUserServiceUrl = process.env.SERVICE_HOST ? 'http://user-service:8082' : 'http://localhost:8082';
  return process.env.USER_SERVICE_URL || defaultUserServiceUrl;
};

const buildSystemHeaders = () => {
  const authId = process.env.MANAGER_AUTOASSIGN_AUTH_ID || 'system:autoassign';

  return {
    'x-auth-id': authId,
    'x-user-id': authId,
    'x-user-email': 'system@okkazo.local',
    'x-user-username': 'system',
    'x-user-role': 'ADMIN',
  };
};

const fetchActiveManagers = async ({ limit = 500 } = {}) => {
  const userServiceUrl = getUserServiceUrl();
  const params = new URLSearchParams();
  params.set('role', 'MANAGER');
  params.set('page', '1');
  params.set('limit', String(limit));

  const url = `${userServiceUrl}/?${params.toString()}`;
  const response = await axios.get(url, {
    headers: buildSystemHeaders(),
    timeout: 10_000,
  });

  const users = response?.data?.data;
  return Array.isArray(users) ? users : [];
};

const fetchUserById = async (userId) => {
  const userServiceUrl = getUserServiceUrl();
  const url = `${userServiceUrl}/${encodeURIComponent(String(userId))}`;
  const response = await axios.get(url, {
    headers: buildSystemHeaders(),
    timeout: 10_000,
  });

  return response?.data?.data || null;
};

const fetchUserByAuthId = async (authId) => {
  const userServiceUrl = getUserServiceUrl();
  const url = `${userServiceUrl}/auth/${encodeURIComponent(String(authId))}`;
  const response = await axios.get(url, {
    headers: buildSystemHeaders(),
    timeout: 10_000,
  });

  return response?.data?.data || null;
};

const resolveUserServiceIdFromAuthId = async (authId) => {
  const normalizedAuthId = String(authId || '').trim();
  if (!normalizedAuthId) return null;

  const now = Date.now();
  const cached = authIdToUserIdCache.get(normalizedAuthId);
  if (cached?.expiresAt && cached.expiresAt > now && cached.userId) {
    return cached.userId;
  }

  let user;
  try {
    user = await fetchUserByAuthId(normalizedAuthId);
  } catch (error) {
    const status = error?.response?.status;
    if (status === 404) return null;

    const err = new Error(`Failed to resolve user for authId ${normalizedAuthId}`);
    err.statusCode = 502;
    err.details = {
      upstreamStatus: status,
      upstreamMessage: error?.message,
    };
    throw err;
  }
  const userId = String(user?._id || user?.id || '').trim();
  if (!userId) return null;

  authIdToUserIdCache.set(normalizedAuthId, {
    userId,
    expiresAt: now + AUTH_ID_CACHE_TTL_MS,
  });

  return userId;
};

module.exports = {
  getUserServiceUrl,
  buildSystemHeaders,
  fetchActiveManagers,
  fetchUserById,
  fetchUserByAuthId,
  resolveUserServiceIdFromAuthId,
};
