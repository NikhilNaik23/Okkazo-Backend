const mongoose = require('mongoose');

const PRIORITY_VALUES = ['high', 'medium', 'low'];

const EventTodoSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: ['planning', 'promote'],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 240,
    },
    priority: {
      type: String,
      enum: PRIORITY_VALUES,
      default: 'medium',
      index: true,
    },
    done: {
      type: Boolean,
      default: false,
      index: true,
    },
    dueAt: {
      type: Date,
      default: null,
      index: true,
    },
    createdByAuthId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    createdByName: {
      type: String,
      trim: true,
      default: null,
    },
    updatedByAuthId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    updatedByName: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'eventtodos',
  }
);

EventTodoSchema.index({ eventId: 1, createdAt: -1 });
EventTodoSchema.index({ eventId: 1, done: 1, priority: 1 });

module.exports = mongoose.model('EventTodo', EventTodoSchema);