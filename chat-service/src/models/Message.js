const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    filename: { type: String, required: true },
    mimetype: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const MessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    eventId: { type: String, required: true, index: true },
    senderAuthId: { type: String, required: true, index: true },
    senderRole: { type: String, default: '' },
    text: { type: String, default: '' },
    attachments: { type: [AttachmentSchema], default: [] },
    readBy: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', MessageSchema);
