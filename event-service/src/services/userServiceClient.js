const axios = require('axios');

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

module.exports = {
  getUserServiceUrl,
  buildSystemHeaders,
  fetchActiveManagers,
  fetchUserById,
};
