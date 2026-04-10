const mongoose = require('mongoose');
const createApiError = require('../utils/ApiError');
const Planning = require('../models/Planning');
const Promote = require('../models/Promote');
const EventTodo = require('../models/EventTodo');
const { resolveUserServiceIdFromAuthId } = require('./userServiceClient');

const ALLOWED_PRIORITIES = new Set(['high', 'medium', 'low']);

const normalizeEventId = (value) => String(value || '').trim();

const normalizeActorAuthId = (user) => {
  const authId = String(user?.authId || '').trim();
  if (!authId) {
    throw createApiError(401, 'Authentication required');
  }
  return authId;
};

const normalizeActorName = (user) => {
  const username = String(user?.username || '').trim();
  if (username) return username;

  const email = String(user?.email || '').trim();
  if (email) return email;

  return 'Team Member';
};

const normalizePriority = (value, fallback = 'medium') => {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!ALLOWED_PRIORITIES.has(normalized)) {
    throw createApiError(400, 'priority must be one of: high, medium, low');
  }
  return normalized;
};

const normalizeBoolean = (value, fieldName) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  throw createApiError(400, `${fieldName} must be a boolean`);
};

const normalizeDueAt = (value) => {
  if (value == null || value === '') return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createApiError(400, 'dueAt must be a valid date');
  }

  return parsed;
};

const getEventAssignment = async (eventId) => {
  const normalizedEventId = normalizeEventId(eventId);
  if (!normalizedEventId) {
    throw createApiError(400, 'eventId is required');
  }

  const [planning, promote] = await Promise.all([
    Planning.findOne({ eventId: normalizedEventId }).select('eventId assignedManagerId coreStaffIds').lean(),
    Promote.findOne({ eventId: normalizedEventId }).select('eventId assignedManagerId coreStaffIds').lean(),
  ]);

  if (planning) {
    return {
      eventId: normalizedEventId,
      eventType: 'planning',
      assignedManagerId: String(planning.assignedManagerId || '').trim() || null,
      coreStaffIds: Array.isArray(planning.coreStaffIds)
        ? planning.coreStaffIds.map((value) => String(value || '').trim()).filter(Boolean)
        : [],
    };
  }

  if (promote) {
    return {
      eventId: normalizedEventId,
      eventType: 'promote',
      assignedManagerId: String(promote.assignedManagerId || '').trim() || null,
      coreStaffIds: Array.isArray(promote.coreStaffIds)
        ? promote.coreStaffIds.map((value) => String(value || '').trim()).filter(Boolean)
        : [],
    };
  }

  throw createApiError(404, 'Event not found');
};

const assertEventTodoAccess = async ({ eventId, user } = {}) => {
  const [eventAssignment, actorUserId] = await Promise.all([
    getEventAssignment(eventId),
    resolveUserServiceIdFromAuthId(normalizeActorAuthId(user)),
  ]);

  const actorAuthId = normalizeActorAuthId(user);

  const assignmentIds = new Set(
    [
      eventAssignment.assignedManagerId,
      ...(eventAssignment.coreStaffIds || []),
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );

  const isAssignedByUserId = actorUserId && assignmentIds.has(String(actorUserId).trim());
  const isAssignedByAuthId = assignmentIds.has(actorAuthId);

  if (!isAssignedByUserId && !isAssignedByAuthId) {
    throw createApiError(403, 'Only assigned manager and team members can access event to-do items');
  }

  return {
    eventAssignment,
    actorAuthId,
    actorName: normalizeActorName(user),
  };
};

const listEventTodos = async ({ eventId, user } = {}) => {
  const { eventAssignment } = await assertEventTodoAccess({ eventId, user });

  const tasks = await EventTodo.find({ eventId: eventAssignment.eventId })
    .sort({ done: 1, createdAt: -1 })
    .lean();

  return {
    eventId: eventAssignment.eventId,
    eventType: eventAssignment.eventType,
    tasks,
  };
};

const createEventTodo = async ({ eventId, user, payload = {} } = {}) => {
  const { eventAssignment, actorAuthId, actorName } = await assertEventTodoAccess({ eventId, user });

  const title = String(payload.title || '').trim();
  if (!title) {
    throw createApiError(400, 'title is required');
  }

  const task = await EventTodo.create({
    eventId: eventAssignment.eventId,
    eventType: eventAssignment.eventType,
    title,
    priority: normalizePriority(payload.priority, 'medium'),
    done: false,
    dueAt: normalizeDueAt(payload.dueAt),
    createdByAuthId: actorAuthId,
    createdByName: actorName,
    updatedByAuthId: actorAuthId,
    updatedByName: actorName,
  });

  return task.toObject();
};

const updateEventTodo = async ({ eventId, todoId, user, payload = {} } = {}) => {
  const { eventAssignment, actorAuthId, actorName } = await assertEventTodoAccess({ eventId, user });

  const normalizedTodoId = String(todoId || '').trim();
  if (!normalizedTodoId || !mongoose.Types.ObjectId.isValid(normalizedTodoId)) {
    throw createApiError(400, 'todoId is invalid');
  }

  const updates = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    const title = String(payload.title || '').trim();
    if (!title) {
      throw createApiError(400, 'title cannot be empty');
    }
    updates.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'priority')) {
    updates.priority = normalizePriority(payload.priority);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'done')) {
    updates.done = normalizeBoolean(payload.done, 'done');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'dueAt')) {
    updates.dueAt = normalizeDueAt(payload.dueAt);
  }

  if (Object.keys(updates).length === 0) {
    throw createApiError(400, 'At least one updatable field is required');
  }

  updates.updatedByAuthId = actorAuthId;
  updates.updatedByName = actorName;

  const updatedTask = await EventTodo.findOneAndUpdate(
    { _id: normalizedTodoId, eventId: eventAssignment.eventId },
    { $set: updates },
    { new: true }
  ).lean();

  if (!updatedTask) {
    throw createApiError(404, 'To-do item not found');
  }

  return updatedTask;
};

const deleteEventTodo = async ({ eventId, todoId, user } = {}) => {
  const { eventAssignment } = await assertEventTodoAccess({ eventId, user });

  const normalizedTodoId = String(todoId || '').trim();
  if (!normalizedTodoId || !mongoose.Types.ObjectId.isValid(normalizedTodoId)) {
    throw createApiError(400, 'todoId is invalid');
  }

  const deletedTask = await EventTodo.findOneAndDelete({
    _id: normalizedTodoId,
    eventId: eventAssignment.eventId,
  }).lean();

  if (!deletedTask) {
    throw createApiError(404, 'To-do item not found');
  }

  return deletedTask;
};

module.exports = {
  listEventTodos,
  createEventTodo,
  updateEventTodo,
  deleteEventTodo,
};