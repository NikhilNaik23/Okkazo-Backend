const express = require('express');
const multer = require('multer');
const path = require('path');

const { requireUser } = require('../middleware/requireUser');
const chatController = require('../controllers/chatController');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(process.cwd(), 'uploads')),
    filename: (req, file, cb) => {
      const safe = String(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      const unique = `${Date.now()}_${Math.round(Math.random() * 1e9)}_${safe}`;
      cb(null, unique);
    },
  }),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 5,
  },
});

router.post('/api/chat/conversations/event/:eventId/ensure', requireUser, chatController.ensureConversationForEvent);
router.post('/api/chat/conversations/event/:eventId/dm/:otherAuthId/ensure', requireUser, chatController.ensureDmConversationForEvent);
router.get('/api/chat/conversations/:conversationId/messages', requireUser, chatController.listMessages);
router.post('/api/chat/conversations/:conversationId/messages', requireUser, upload.array('files', 5), chatController.sendMessage);
router.post('/api/chat/conversations/:conversationId/read', requireUser, chatController.markConversationRead);

module.exports = router;
