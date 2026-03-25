const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { USER_TICKET_STATUS_VALUES, USER_TICKET_STATUS } = require('../utils/ticketConstants');

const TicketTierSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    noOfTickets: { type: Number, min: 1, required: true },
    price: { type: Number, min: 0, required: true },
  },
  { _id: false }
);

const EventBannerSnapshotSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true, default: null },
    publicId: { type: String, trim: true, default: null },
    mimeType: { type: String, trim: true, default: null },
    sizeBytes: { type: Number, min: 0, default: null },
  },
  { _id: false }
);

const UserEventTicketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    eventId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    eventSource: {
      type: String,
      enum: ['planning-public', 'promote'],
      required: true,
      index: true,
    },
    userId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    userAuthId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    eventTitle: { type: String, trim: true, required: true },
    eventDescription: { type: String, trim: true, default: '' },
    eventField: { type: String, trim: true, default: null },
    eventBanner: { type: EventBannerSnapshotSchema, default: null },

    venue: {
      locationName: { type: String, trim: true, required: true },
      latitude: { type: Number, min: -90, max: 90, default: null },
      longitude: { type: Number, min: -180, max: 180, default: null },
    },

    schedule: {
      startAt: { type: Date, required: true },
      endAt: { type: Date, required: true },
    },

    ticketAvailability: {
      startAt: { type: Date, required: true },
      endAt: { type: Date, required: true },
    },

    tickets: {
      noOfTickets: { type: Number, min: 1, required: true },
      ticketType: { type: String, enum: ['free', 'paid'], required: true },
      tiers: { type: [TicketTierSnapshotSchema], default: [] },
      unitPrice: { type: Number, min: 0, default: 0 },
      totalAmount: { type: Number, min: 0, default: 0 },
      currency: { type: String, trim: true, default: 'INR' },
    },

    isPaid: {
      type: Boolean,
      default: false,
      index: true,
    },
    ticketStatus: {
      type: String,
      enum: USER_TICKET_STATUS_VALUES,
      default: USER_TICKET_STATUS.PAYMENT_REQUIRED,
      index: true,
    },

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'user_event_tickets',
  }
);

UserEventTicketSchema.index({ eventId: 1, userAuthId: 1, createdAt: -1 });

module.exports = mongoose.model('UserEventTicket', UserEventTicketSchema);
