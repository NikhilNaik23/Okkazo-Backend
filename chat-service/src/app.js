require('dotenv').config();
require('express-async-errors');

const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const connectDB = require('./config/database');
const eurekaClient = require('./config/eureka');
const logger = require('./utils/logger');
const ApiError = require('./utils/ApiError');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { extractUser } = require('./middleware/extractUser');

const chatRoutes = require('./routes/chatRoutes');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const { setIO } = require('./socket');

const app = express();

app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (message) => logger.http(message.trim()) } }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Chat service is running',
    timestamp: new Date().toISOString(),
  });
});

// Serve uploaded files
app.use('/api/chat/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Extract user from API Gateway headers
app.use(extractUser);

// Routes
app.use('/', chatRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 8089;
const NODE_ENV = process.env.NODE_ENV || 'development';
const normalizeOrigin = (value, fallback) => String(value || fallback || '').replace(/\/+$/, '');
const frontendUrl = normalizeOrigin(process.env.FRONTEND_URL, 'http://localhost:5173');
const frontendUrlFallback = normalizeOrigin(process.env.FRONTEND_URL_FALLBACK, 'http://localhost:3000');

const server = http.createServer(app);

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: [
      frontendUrl,
      frontendUrlFallback,
    ],
    credentials: true,
  },
});

setIO(io);

const verifySocketUser = (socket) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new ApiError(500, 'JWT_SECRET is not configured');

  const token = socket.handshake.auth?.token;
  if (!token) throw new ApiError(401, 'Authentication required');

  const payload = jwt.verify(token, secret);
  const authId = payload?.authId || payload?.sub || payload?.userId;
  if (!authId) throw new ApiError(401, 'Invalid token');

  return {
    authId: String(authId),
    role: payload?.role ? String(payload.role) : '',
  };
};

// In-memory presence tracking (single-instance). If you scale horizontally,
// replace this with a shared store (Redis) and a socket adapter.
const presenceRoomFor = (authId) => `presence:${String(authId)}`;
const authSocketIds = new Map(); // authId -> Set(socketId)

const isOnline = (authId) => {
  const set = authSocketIds.get(String(authId));
  return Boolean(set && set.size > 0);
};

const setSocketOnline = (authId, socketId) => {
  const key = String(authId);
  const prevOnline = isOnline(key);
  const set = authSocketIds.get(key) || new Set();
  set.add(String(socketId));
  authSocketIds.set(key, set);
  const nextOnline = true;
  if (!prevOnline && nextOnline) {
    io.to(presenceRoomFor(key)).emit('presence:update', { authId: key, online: true });
  }
};

const setSocketOffline = (authId, socketId) => {
  const key = String(authId);
  const set = authSocketIds.get(key);
  if (!set) return;
  const prevOnline = set.size > 0;
  set.delete(String(socketId));
  if (set.size === 0) authSocketIds.delete(key);
  const nextOnline = isOnline(key);
  if (prevOnline && !nextOnline) {
    io.to(presenceRoomFor(key)).emit('presence:update', { authId: key, online: false });
  }
};

io.use((socket, next) => {
  try {
    socket.user = verifySocketUser(socket);
    next();
  } catch (e) {
    next(e);
  }
});

io.on('connection', (socket) => {
  const me = socket.user;
  logger.info('Socket connected', { authId: me?.authId });

  // Track presence for this authenticated user
  setSocketOnline(me.authId, socket.id);

  socket.data.watchedPresence = new Set();

  socket.on('presence:watch', ({ authIds } = {}, ack) => {
    try {
      const next = Array.isArray(authIds) ? authIds : [];
      const cleaned = [];
      const seen = new Set();
      for (const raw of next) {
        const id = String(raw || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        cleaned.push(id);
        if (cleaned.length >= 200) break;
      }

      const prev = socket.data.watchedPresence instanceof Set ? socket.data.watchedPresence : new Set();

      // Leave rooms no longer watched
      for (const id of prev) {
        if (!seen.has(id)) socket.leave(presenceRoomFor(id));
      }

      // Join new watched rooms
      for (const id of cleaned) {
        if (!prev.has(id)) socket.join(presenceRoomFor(id));
      }

      socket.data.watchedPresence = new Set(cleaned);

      // Emit current state immediately
      for (const id of cleaned) {
        socket.emit('presence:update', { authId: id, online: isOnline(id) });
      }

      if (typeof ack === 'function') ack({ success: true });
    } catch (e) {
      if (typeof ack === 'function') ack({ success: false, message: e.message });
    }
  });

  socket.on('conversation:join', async ({ conversationId, eventId } = {}) => {
    try {
      let convo = null;

      if (conversationId) {
        convo = await Conversation.findById(String(conversationId)).lean();
      } else if (eventId) {
        const safeEventId = String(eventId).trim();
        convo = await Conversation.findOneAndUpdate(
          { eventId: safeEventId, kind: 'EVENT' },
          {
            $setOnInsert: { eventId: safeEventId, kind: 'EVENT' },
            $addToSet: { participants: { authId: me.authId, role: me.role } },
          },
          { new: true, upsert: true }
        ).lean();
      }

      if (!convo) throw new ApiError(404, 'Conversation not found');

      socket.join(String(convo._id));
      socket.emit('conversation:joined', { conversationId: String(convo._id), eventId: convo.eventId });
    } catch (e) {
      socket.emit('error', { message: e.message || 'Failed to join conversation' });
    }
  });

  socket.on('message:send', async ({ conversationId, text } = {}) => {
    try {
      const convoId = String(conversationId || '').trim();
      const convo = await Conversation.findById(convoId).lean();
      if (!convo) throw new ApiError(404, 'Conversation not found');

      const trimmed = String(text || '').trim();
      if (!trimmed) throw new ApiError(400, 'text is required');

      const msg = await Message.create({
        conversationId: convoId,
        eventId: convo.eventId,
        senderAuthId: me.authId,
        senderRole: me.role,
        text: trimmed,
        attachments: [],
        readBy: [me.authId],
      });

      await Conversation.updateOne(
        { _id: convoId },
        { $set: { lastMessageAt: new Date() } }
      );

      const payload = msg.toObject ? msg.toObject() : msg;
      io.to(convoId).emit('message:new', payload);
    } catch (e) {
      socket.emit('error', { message: e.message || 'Failed to send message' });
    }
  });

  socket.on('messages:read', async ({ conversationId } = {}) => {
    try {
      const convoId = String(conversationId || '').trim();
      if (!convoId) throw new ApiError(400, 'conversationId is required');

      await Message.updateMany(
        { conversationId: convoId, readBy: { $ne: me.authId } },
        { $addToSet: { readBy: me.authId } }
      );

      io.to(convoId).emit('messages:read', { conversationId: convoId, authId: me.authId });
    } catch (e) {
      socket.emit('error', { message: e.message || 'Failed to mark read' });
    }
  });

  socket.on('disconnect', () => {
    logger.info('Socket disconnected', { authId: me?.authId });

    // Update presence
    setSocketOffline(me.authId, socket.id);
  });
});

const startServer = async () => {
  await connectDB();
  logger.info('MongoDB connection established');

  if (process.env.EUREKA_REGISTER_WITH_EUREKA !== 'false') {
    eurekaClient.start();
    logger.info('Eureka client started');
  }

  server.listen(PORT, () => {
    logger.info(`Server running in ${NODE_ENV} mode on port ${PORT}`);
    logger.info(`Service: ${process.env.SERVICE_NAME || 'chat-service'}`);
  });

  const gracefulShutdown = async (signal) => {
    logger.info(`${signal} received. Starting graceful shutdown...`);

    server.close(async () => {
      logger.info('HTTP server closed');
      try {
        eurekaClient.stop();
        logger.info('Eureka client stopped');
        const mongoose = require('mongoose');
        await mongoose.connection.close();
        logger.info('MongoDB connection closed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
};

startServer().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
