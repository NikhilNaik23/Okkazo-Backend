const notificationService = require('../services/notificationService');
const { fetchUsersByRole } = require('../services/userDirectoryService');
const createApiError = require('../utils/ApiError');
const crypto = require('crypto');

const ALLOWED_BROADCAST_ROLES = ['USER', 'VENDOR', 'ADMIN', 'MANAGER'];

const normalizeBroadcastRoles = (rolesInput) => {
  const rawRoles = Array.isArray(rolesInput) ? rolesInput : [];
  const cleanedRoles = rawRoles
    .map((role) => String(role || '').trim().toUpperCase())
    .filter(Boolean);

  if (cleanedRoles.includes('ALL')) {
    return [...ALLOWED_BROADCAST_ROLES];
  }

  const filtered = cleanedRoles.filter((role) => ALLOWED_BROADCAST_ROLES.includes(role));
  if (filtered.length === 0) {
    return ['USER'];
  }

  return Array.from(new Set(filtered));
};

const healthCheck = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Notification service is running',
    timestamp: new Date().toISOString(),
  });
};

const requireAuthUser = (req) => {
  const authId = String(req?.user?.authId || '').trim();
  const role = String(req?.user?.role || '').trim().toUpperCase();

  if (!authId || !role) {
    throw createApiError(401, 'Authentication required');
  }

  return { authId, role };
};

const getNotifications = async (req, res) => {
  const { authId } = requireAuthUser(req);

  const result = await notificationService.listNotificationsForUser({
    authId,
    tab: req.query?.tab || 'all',
    search: req.query?.search || '',
    page: req.query?.page || 1,
    limit: req.query?.limit || 50,
  });

  return res.status(200).json({
    success: true,
    data: result.notifications,
    pagination: result.pagination,
  });
};

const getUnreadCount = async (req, res) => {
  const { authId } = requireAuthUser(req);
  const result = await notificationService.getUnreadCount({ authId });

  return res.status(200).json({
    success: true,
    data: result,
  });
};

const markNotificationRead = async (req, res) => {
  const { authId } = requireAuthUser(req);
  const notificationId = String(req.params.notificationId || '').trim();

  const result = await notificationService.markNotificationAsRead({
    authId,
    notificationId,
  });

  return res.status(200).json({
    success: true,
    message: 'Notification marked as read',
    data: result,
  });
};

const markAllRead = async (req, res) => {
  const { authId } = requireAuthUser(req);

  const result = await notificationService.markAllNotificationsAsRead({
    authId,
  });

  return res.status(200).json({
    success: true,
    message: 'All notifications marked as read',
    data: result,
  });
};

const broadcastSystemNotification = async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const message = String(req.body?.message || '').trim();
  const actionUrl = req.body?.actionUrl ? String(req.body.actionUrl).trim() : null;
  const category = String(req.body?.category || 'SYSTEM').trim().toUpperCase();
  const type = String(req.body?.type || 'SYSTEM_ANNOUNCEMENT').trim().toUpperCase();
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};

  const uniqueRoles = normalizeBroadcastRoles(req.body?.roles);

  if (!title || !message) {
    throw createApiError(400, 'title and message are required');
  }

  const contentFingerprint = crypto
    .createHash('sha1')
    .update(JSON.stringify({ type, category, title, message, actionUrl, metadata }))
    .digest('hex');

  const users = [];
  for (const role of uniqueRoles) {
    const rows = await fetchUsersByRole(role);
    users.push(...rows.map((user) => ({ ...user, role })));
  }

  const uniqueByAuthId = new Map();
  for (const user of users) {
    const authId = String(user?.authId || '').trim();
    if (!authId) continue;
    if (!uniqueByAuthId.has(authId)) {
      uniqueByAuthId.set(authId, user);
    }
  }

  const notifications = Array.from(uniqueByAuthId.values()).map((user) => ({
    recipientAuthId: String(user.authId).trim(),
    recipientRole: String(user.role || user?.accountStatus || 'USER').trim().toUpperCase(),
    type,
    category,
    title,
    message,
    actionUrl,
    metadata,
    dedupeKey: `SYSTEM_BROADCAST:${contentFingerprint}:${String(user.authId).trim()}`,
  }));

  const created = await notificationService.createNotificationsBulk(notifications);

  return res.status(201).json({
    success: true,
    message: 'System notification broadcast queued',
    data: {
      targetedUsers: notifications.length,
      created: created.length,
      roles: uniqueRoles,
    },
  });
};

const sendNotificationToUser = async (req, res) => {
  const recipientAuthId = String(req.body?.recipientAuthId || '').trim();
  const recipientRole = String(req.body?.recipientRole || 'USER').trim().toUpperCase();
  const title = String(req.body?.title || '').trim();
  const message = String(req.body?.message || '').trim();
  const actionUrl = req.body?.actionUrl ? String(req.body.actionUrl).trim() : null;
  const category = String(req.body?.category || 'SYSTEM').trim().toUpperCase();
  const type = String(req.body?.type || 'SYSTEM_ANNOUNCEMENT').trim().toUpperCase();
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};

  if (!recipientAuthId) {
    throw createApiError(400, 'recipientAuthId is required');
  }

  if (!title || !message) {
    throw createApiError(400, 'title and message are required');
  }

  const contentFingerprint = crypto
    .createHash('sha1')
    .update(JSON.stringify({ type, category, title, message, actionUrl, metadata }))
    .digest('hex');

  const dedupeKey = `DIRECT:${contentFingerprint}:${recipientAuthId}`;

  const created = await notificationService.createNotification({
    recipientAuthId,
    recipientRole,
    type,
    category,
    title,
    message,
    actionUrl,
    metadata,
    dedupeKey,
  });

  return res.status(201).json({
    success: true,
    message: 'Notification sent successfully',
    data: created,
  });
};

module.exports = {
  healthCheck,
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllRead,
  broadcastSystemNotification,
  sendNotificationToUser,
};
