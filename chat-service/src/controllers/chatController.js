const path = require('path');
const fs = require('fs/promises');
const ApiError = require('../utils/ApiError');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { emitToConversation } = require('../socket');
const { isCloudinaryEnabled, uploadLocalFileToCloudinary, deleteCloudinaryAsset } = require('../services/cloudinaryService');

const USER_SERVICE_BASE_URLS = (() => {
  const explicit = String(process.env.USER_SERVICE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return [explicit];
  return ['http://localhost:8082', 'http://user-service:8082'];
})();

const STAFF_ALLOWED_ROLES = new Set(['ADMIN', 'MANAGER']);

const normalizeDepartmentLabel = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'CORE OPERATIONS';
  if (raw === 'private event') return 'PRIVATE EVENT';
  if (raw === 'public event') return 'PUBLIC EVENT';
  if (raw === 'core operation' || raw === 'core operations') return 'CORE OPERATIONS';
  return 'CORE OPERATIONS';
};

const assertStaffRole = (req) => {
  const role = String(req.user?.role || '').trim().toUpperCase();
  if (!STAFF_ALLOWED_ROLES.has(role)) {
    throw new ApiError(403, 'Only admin and manager users can access staff chat');
  }
  return role;
};

const buildUserHeaders = (req) => ({
  'Content-Type': 'application/json',
  'x-auth-id': String(req.user?.authId || ''),
  'x-user-id': String(req.user?.userId || ''),
  'x-user-email': String(req.user?.email || ''),
  'x-user-username': String(req.user?.username || ''),
  'x-user-role': String(req.user?.role || ''),
});

const fetchJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, json?.message || `Failed upstream request: ${url}`);
    }
    return json;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ApiError(504, 'Upstream user-service request timed out');
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, error?.message || 'Unable to reach user-service');
  } finally {
    clearTimeout(timeout);
  }
};

const fetchUserServiceJson = async (path, options = {}) => {
  let lastError = null;

  for (const baseUrl of USER_SERVICE_BASE_URLS) {
    try {
      return await fetchJson(`${baseUrl}${path}`, options);
    } catch (error) {
      lastError = error;
      // Retry next base URL only for upstream connectivity/timeouts.
      const isUpstreamConnectivityIssue =
        error instanceof ApiError && (error.statusCode === 502 || error.statusCode === 504);
      if (!isUpstreamConnectivityIssue) throw error;
    }
  }

  throw lastError || new ApiError(502, 'Unable to reach user-service');
};

const fetchUsersByRole = async (req, role) => {
  const qs = new URLSearchParams({ role, page: '1', limit: '100' });
  const json = await fetchUserServiceJson(`/?${qs.toString()}`, {
    method: 'GET',
    headers: buildUserHeaders(req),
  });
  return Array.isArray(json?.data) ? json.data : [];
};

const fetchUserByAuthId = async (req, authId) => {
  const json = await fetchUserServiceJson(`/auth/${encodeURIComponent(String(authId))}`, {
    method: 'GET',
    headers: buildUserHeaders(req),
  });
  return json?.data || null;
};

const ensureConversationForEvent = async (req, res) => {
  const eventId = String(req.params.eventId || '').trim();
  if (!eventId) throw new ApiError(400, 'eventId is required');

  const meAuthId = String(req.user?.authId || '').trim();
  const meRole = String(req.user?.role || '').trim();

  const meParticipant = { authId: meAuthId, role: meRole };

  const convo = await Conversation.findOneAndUpdate(
    { eventId, kind: 'EVENT' },
    {
      $setOnInsert: { eventId, kind: 'EVENT' },
      $addToSet: { participants: meParticipant },
    },
    { new: true, upsert: true }
  ).lean();

  return res.status(200).json({ success: true, data: convo });
};

const ensureDmConversationForEvent = async (req, res) => {
  const eventId = String(req.params.eventId || '').trim();
  if (!eventId) throw new ApiError(400, 'eventId is required');

  const meAuthId = String(req.user?.authId || '').trim();
  const meRole = String(req.user?.role || '').trim();
  if (!meAuthId) throw new ApiError(401, 'Authentication required');

  const otherAuthId = String(req.params.otherAuthId || '').trim();
  if (!otherAuthId) throw new ApiError(400, 'otherAuthId is required');
  if (otherAuthId === meAuthId) throw new ApiError(400, 'Cannot create DM with self');

  const pairKey = [meAuthId, otherAuthId].sort().join(':');
  const kind = `EVENT_DM:${pairKey}`;

  const meParticipant = { authId: meAuthId, role: meRole };
  const otherParticipant = { authId: otherAuthId, role: '' };

  const convo = await Conversation.findOneAndUpdate(
    { eventId, kind },
    {
      $setOnInsert: { eventId, kind },
      $addToSet: { participants: { $each: [meParticipant, otherParticipant] } },
    },
    { new: true, upsert: true }
  ).lean();

  return res.status(200).json({ success: true, data: convo });
};

const listStaffContacts = async (req, res) => {
  assertStaffRole(req);

  const meAuthId = String(req.user?.authId || '').trim();
  if (!meAuthId) throw new ApiError(401, 'Authentication required');

  const [managerUsers, adminUsers] = await Promise.all([
    fetchUsersByRole(req, 'MANAGER'),
    fetchUsersByRole(req, 'ADMIN'),
  ]);

  const managerGroups = new Map([
    ['PRIVATE EVENT', []],
    ['PUBLIC EVENT', []],
    ['CORE OPERATIONS', []],
  ]);

  for (const user of managerUsers) {
    const authId = String(user?.authId || '').trim();
    if (!authId || authId === meAuthId) continue;

    const departmentLabel = normalizeDepartmentLabel(user?.department);
    const group = managerGroups.get(departmentLabel) || managerGroups.get('CORE OPERATIONS');

    group.push({
      authId,
      name: String(user?.name || user?.fullName || user?.email || 'Manager').trim(),
      role: 'MANAGER',
      department: departmentLabel,
      assignedRole: String(user?.assignedRole || '').trim(),
      email: String(user?.email || '').trim(),
    });
  }

  const administration = [];
  for (const user of adminUsers) {
    const authId = String(user?.authId || '').trim();
    if (!authId || authId === meAuthId) continue;
    administration.push({
      authId,
      name: String(user?.name || user?.fullName || user?.email || 'Administrator').trim(),
      role: 'ADMIN',
      department: 'ADMINISTRATION',
      assignedRole: 'ADMIN',
      email: String(user?.email || '').trim(),
    });
  }

  const groups = [
    {
      key: 'PRIVATE_EVENT',
      label: 'PRIVATE EVENT',
      contacts: managerGroups.get('PRIVATE EVENT') || [],
    },
    {
      key: 'PUBLIC_EVENT',
      label: 'PUBLIC EVENT',
      contacts: managerGroups.get('PUBLIC EVENT') || [],
    },
    {
      key: 'CORE_OPERATIONS',
      label: 'CORE OPERATIONS',
      contacts: managerGroups.get('CORE OPERATIONS') || [],
    },
    {
      key: 'ADMINISTRATION',
      label: 'ADMINISTRATION',
      contacts: administration,
    },
  ];

  return res.status(200).json({ success: true, data: { groups } });
};

const ensureStaffDmConversation = async (req, res) => {
  assertStaffRole(req);

  const meAuthId = String(req.user?.authId || '').trim();
  const meRole = String(req.user?.role || '').trim().toUpperCase();
  if (!meAuthId) throw new ApiError(401, 'Authentication required');

  const otherAuthId = String(req.params.otherAuthId || '').trim();
  if (!otherAuthId) throw new ApiError(400, 'otherAuthId is required');
  if (otherAuthId === meAuthId) throw new ApiError(400, 'Cannot create DM with self');

  const otherUser = await fetchUserByAuthId(req, otherAuthId);
  const otherRole = String(otherUser?.role || '').trim().toUpperCase();
  if (!STAFF_ALLOWED_ROLES.has(otherRole)) {
    throw new ApiError(403, 'Staff chat supports only admin and manager users');
  }

  const pairKey = [meAuthId, otherAuthId].sort().join(':');
  const kind = `STAFF_DM:${pairKey}`;

  const meParticipant = { authId: meAuthId, role: meRole };
  const otherParticipant = { authId: otherAuthId, role: otherRole };

  const convo = await Conversation.findOneAndUpdate(
    { eventId: 'STAFF_DM', kind },
    {
      $setOnInsert: { eventId: 'STAFF_DM', kind },
      $addToSet: { participants: { $each: [meParticipant, otherParticipant] } },
    },
    { new: true, upsert: true }
  ).lean();

  return res.status(200).json({ success: true, data: convo });
};

const listMessages = async (req, res) => {
  const conversationId = String(req.params.conversationId || '').trim();
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const convo = await Conversation.findById(conversationId).lean();
  if (!convo) throw new ApiError(404, 'Conversation not found');

  const messages = await Message.find({ conversationId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return res.status(200).json({ success: true, data: messages.reverse() });
};

const sendMessage = async (req, res) => {
  const conversationId = String(req.params.conversationId || '').trim();
  const convo = await Conversation.findById(conversationId).lean();
  if (!convo) throw new ApiError(404, 'Conversation not found');

  const text = req.body?.text != null ? String(req.body.text) : '';
  const trimmed = text.trim();

  const files = Array.isArray(req.files) ? req.files : [];

  if (!trimmed && files.length === 0) {
    throw new ApiError(400, 'Message text or attachments are required');
  }

  const attachments = [];
  const cloudinaryEnabled = isCloudinaryEnabled();

  for (const f of files) {
    if (cloudinaryEnabled && f?.path) {
      try {
        const uploaded = await uploadLocalFileToCloudinary({
          filePath: f.path,
          folder: process.env.CLOUDINARY_FOLDER,
          originalName: f.originalname,
        });

        if (!uploaded?.url) {
          throw new Error('Cloudinary did not return a URL');
        }

        attachments.push({
          url: uploaded.url,
          publicId: String(uploaded.publicId || ''),
          filename: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
        });
      } catch (e) {
        throw new ApiError(500, e?.message || 'Failed to upload attachment');
      } finally {
        // best-effort cleanup for local temp file
        try {
          await fs.unlink(f.path);
        } catch {
          // ignore
        }
      }
    } else {
      attachments.push({
        url: `/api/chat/uploads/${encodeURIComponent(f.filename)}`,
        publicId: '',
        filename: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      });
    }
  }

  const senderAuthId = String(req.user?.authId || '').trim();
  const senderRole = String(req.user?.role || '').trim();

  const msg = await Message.create({
    conversationId,
    eventId: convo.eventId,
    senderAuthId,
    senderRole,
    text: trimmed,
    attachments,
    readBy: [senderAuthId],
  });

  await Conversation.updateOne(
    { _id: conversationId },
    { $set: { lastMessageAt: new Date() } }
  );

  const payload = msg.toObject ? msg.toObject() : msg;
  emitToConversation(conversationId, 'message:new', payload);

  return res.status(201).json({ success: true, data: payload });
};

const updateMessage = async (req, res) => {
  const conversationId = String(req.params.conversationId || '').trim();
  const messageId = String(req.params.messageId || '').trim();
  if (!conversationId) throw new ApiError(400, 'conversationId is required');
  if (!messageId) throw new ApiError(400, 'messageId is required');

  const convo = await Conversation.findById(conversationId).lean();
  if (!convo) throw new ApiError(404, 'Conversation not found');

  const meAuthId = String(req.user?.authId || '').trim();
  if (!meAuthId) throw new ApiError(401, 'Authentication required');

  const meRole = String(req.user?.role || '').trim().toUpperCase();
  const msg = await Message.findOne({ _id: messageId, conversationId });
  if (!msg) throw new ApiError(404, 'Message not found');

  const senderAuthId = String(msg?.senderAuthId || '').trim();
  const canEdit = senderAuthId === meAuthId || meRole === 'ADMIN';
  if (!canEdit) throw new ApiError(403, 'Not allowed to edit this message');

  const text = String(req.body?.text || '').trim();
  if (!text) throw new ApiError(400, 'Message text is required');

  msg.text = text;
  msg.editedAt = new Date();
  await msg.save();

  const payload = msg.toObject ? msg.toObject() : msg;
  emitToConversation(conversationId, 'message:updated', payload);

  return res.status(200).json({ success: true, data: payload });
};

const deleteMessage = async (req, res) => {
  const conversationId = String(req.params.conversationId || '').trim();
  const messageId = String(req.params.messageId || '').trim();
  if (!conversationId) throw new ApiError(400, 'conversationId is required');
  if (!messageId) throw new ApiError(400, 'messageId is required');

  const convo = await Conversation.findById(conversationId).lean();
  if (!convo) throw new ApiError(404, 'Conversation not found');

  const meAuthId = String(req.user?.authId || '').trim();
  if (!meAuthId) throw new ApiError(401, 'Authentication required');

  const meRole = String(req.user?.role || '').trim().toUpperCase();

  const msg = await Message.findOne({ _id: messageId, conversationId }).lean();
  if (!msg) throw new ApiError(404, 'Message not found');

  const senderAuthId = String(msg?.senderAuthId || '').trim();
  const canDelete = senderAuthId === meAuthId || meRole === 'ADMIN';
  if (!canDelete) throw new ApiError(403, 'Not allowed to delete this message');

  const attachments = Array.isArray(msg?.attachments) ? msg.attachments : [];

  await Promise.allSettled(
    attachments.map(async (attachment) => {
      const url = String(attachment?.url || '').trim();
      if (!url) return;

      if (url.startsWith('http')) {
        await deleteCloudinaryAsset({ publicId: attachment?.publicId, url });
        return;
      }

      const prefix = '/api/chat/uploads/';
      if (!url.startsWith(prefix)) return;

      const filename = decodeURIComponent(url.slice(prefix.length));
      const safeName = path.basename(filename);
      if (!safeName) return;

      try {
        await fs.unlink(path.join(process.cwd(), 'uploads', safeName));
      } catch {
        // Ignore missing local files during cleanup
      }
    })
  );

  await Message.deleteOne({ _id: messageId, conversationId });

  emitToConversation(conversationId, 'message:deleted', { conversationId, messageId });
  return res.status(200).json({ success: true, data: { messageId } });
};

const markConversationRead = async (req, res) => {
  const conversationId = String(req.params.conversationId || '').trim();
  const convo = await Conversation.findById(conversationId).lean();
  if (!convo) throw new ApiError(404, 'Conversation not found');

  const meAuthId = String(req.user?.authId || '').trim();
  if (!meAuthId) throw new ApiError(401, 'Authentication required');

  await Message.updateMany(
    { conversationId, readBy: { $ne: meAuthId } },
    { $addToSet: { readBy: meAuthId } }
  );

  // Notify other participants in realtime (mirrors socket handler behaviour)
  emitToConversation(conversationId, 'messages:read', { conversationId, authId: meAuthId });

  return res.status(200).json({ success: true });
};

module.exports = {
  ensureConversationForEvent,
  ensureDmConversationForEvent,
  listStaffContacts,
  ensureStaffDmConversation,
  listMessages,
  sendMessage,
  updateMessage,
  deleteMessage,
  markConversationRead,
};
