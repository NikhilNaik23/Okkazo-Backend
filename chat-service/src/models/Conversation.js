const mongoose = require('mongoose');

const ParticipantSchema = new mongoose.Schema(
  {
    authId: { type: String, required: true, index: true },
    role: { type: String, default: '' },
    name: { type: String, default: '' },
  },
  { _id: false }
);

const ConversationSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, index: true },
    kind: { type: String, default: 'EVENT', index: true },
    participants: { type: [ParticipantSchema], default: [] },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ConversationSchema.index({ eventId: 1, kind: 1 }, { unique: true });

module.exports = mongoose.model('Conversation', ConversationSchema);
