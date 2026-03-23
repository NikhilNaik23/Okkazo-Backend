const path = require('path');
const fs = require('fs/promises');
const ApiError = require('../utils/ApiError');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { emitToConversation } = require('../socket');
const { isCloudinaryEnabled, uploadLocalFileToCloudinary } = require('../services/cloudinaryService');

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
  listMessages,
  sendMessage,
  markConversationRead,
};
