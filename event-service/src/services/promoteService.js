const Promote = require('../models/Promote');
const Planning = require('../models/Planning');
const createApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { PROMOTE_STATUS } = require('../utils/promoteConstants');
const { STATUS: PLANNING_STATUS } = require('../utils/planningConstants');
const promoteConfigService = require('./promoteConfigService');
const mongoose = require('mongoose');
const { fetchUserById } = require('./userServiceClient');

const DECISION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value));

const REQUIRED_PROMOTE_MANAGER_DEPARTMENT = 'Public Event';

const normalizeLoose = (value) => String(value || '').trim().toLowerCase();

const isEligibleManagerRole = (user) => normalizeLoose(user?.role) === 'manager';

const isDepartmentMatch = (userDepartment, requiredDepartment) => {
  if (!requiredDepartment) return true;
  return normalizeLoose(userDepartment) === normalizeLoose(requiredDepartment);
};

// Accept both junior/senior manager roles. If assignedRole is null, allow it.
const isAssignedRoleEligible = (assignedRole) => {
  if (!assignedRole) return false;
  const role = normalizeLoose(assignedRole);
  return role.includes('junior') || role.includes('senior');
};

const assertManagerEligibleForPromote = async ({ managerId } = {}) => {
  const user = await fetchUserById(managerId);
  if (!user) throw createApiError(404, 'Manager not found in user-service');

  if (!isEligibleManagerRole(user)) {
    throw createApiError(400, 'Provided user is not a MANAGER');
  }

  if (!isDepartmentMatch(user.department, REQUIRED_PROMOTE_MANAGER_DEPARTMENT)) {
    throw createApiError(400, `Manager department must be ${REQUIRED_PROMOTE_MANAGER_DEPARTMENT}`);
  }

  if (!isAssignedRoleEligible(user.assignedRole)) {
    throw createApiError(400, 'Manager assignedRole must be JUNIOR or SENIOR');
  }

  if (user.isActive === false) {
    throw createApiError(400, 'Manager is not active');
  }
};

const assertManagerAvailable = async ({ managerId, eventIdToExclude } = {}) => {
  if (!isValidObjectId(managerId)) {
    throw createApiError(400, 'managerId must be a valid id');
  }

  const activeAssignmentQuery = {
    assignedManagerId: managerId,
    eventStatus: { $ne: PROMOTE_STATUS.COMPLETE },
    'adminDecision.status': { $ne: DECISION_STATUS.REJECTED },
  };
  if (eventIdToExclude) {
    activeAssignmentQuery.eventId = { $ne: String(eventIdToExclude).trim() };
  }

  const existing = await Promote.findOne(activeAssignmentQuery).select('eventId').lean();
  if (existing) {
    throw createApiError(409, 'Manager is already assigned to another event');
  }

  const existingPlanning = await Planning.findOne({
    assignedManagerId: managerId,
    status: { $nin: [PLANNING_STATUS.COMPLETED, PLANNING_STATUS.REJECTED] },
  })
    .select('eventId')
    .lean();

  if (existingPlanning) {
    throw createApiError(409, 'Manager is already assigned to another event');
  }
};

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a new promote record.
 * The eventBanner and authenticityProofs Cloudinary results are merged in
 * by the controller BEFORE calling this function.
 */
const createPromote = async (payload) => {
  // Snapshot the current fees config onto the promote record
  if (
    payload.platformFee === undefined ||
    payload.platformFee === null ||
    payload.serviceChargePercent === undefined ||
    payload.serviceChargePercent === null
  ) {
    const cfg = await promoteConfigService.getFees();
    if (payload.platformFee === undefined || payload.platformFee === null) {
      payload.platformFee = cfg.platformFee;
    }
    if (payload.serviceChargePercent === undefined || payload.serviceChargePercent === null) {
      payload.serviceChargePercent = cfg.serviceChargePercent;
    }
  }

  const promote = new Promote(payload);
  const saved = await promote.save();

  return {
    promoteId: saved.promoteId,
    eventId: saved.eventId,
    eventTitle: saved.eventTitle,
    eventCategory: saved.eventCategory,
    eventStatus: saved.eventStatus,
    platformFeePaid: saved.platformFeePaid,
    platformFee: saved.platformFee,
    serviceChargePercent: saved.serviceChargePercent,
    totalAmount: saved.totalAmount,
    serviceCharge: saved.serviceCharge,
    estimatedNetRevenue: saved.estimatedNetRevenue,
    ticketAnalytics: saved.ticketAnalytics,
    schedule: saved.schedule,
  };
};

// ─── Read (own) ───────────────────────────────────────────────────────────────

const getMyPromotes = async (authId, page = 1, limit = 10) => {
  if (!authId?.trim()) throw createApiError(400, 'Auth ID is required');

  const skip = (page - 1) * limit;

  const [promotes, total, cfg] = await Promise.all([
    Promote.find({ authId: authId.trim() })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Promote.countDocuments({ authId: authId.trim() }),
    promoteConfigService.getFees(),
  ]);

  const platformFeeFallback = cfg.platformFee;
  const serviceChargePercentFallback = cfg.serviceChargePercent;
  const hydratedPromotes = (promotes || []).map((p) => ({
    ...p,
    platformFee: (p.platformFee === undefined || p.platformFee === null) ? platformFeeFallback : p.platformFee,
    serviceChargePercent: (p.serviceChargePercent === undefined || p.serviceChargePercent === null)
      ? serviceChargePercentFallback
      : p.serviceChargePercent,
  }));

  return {
    promotes: hydratedPromotes,
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      total,
      limit: Number(limit),
    },
  };
};

// ─── Read (single by promoteId or eventId) ────────────────────────────────────

const getPromoteByEventId = async (eventId) => {
  if (!eventId?.trim()) throw createApiError(400, 'Event ID is required');

  const [promote, cfg] = await Promise.all([
    Promote.findOne({ eventId: eventId.trim() }).lean(),
    promoteConfigService.getFees(),
  ]);
  if (!promote) throw createApiError(404, 'Promote record not found');

  return {
    ...promote,
    platformFee: (promote.platformFee === undefined || promote.platformFee === null) ? cfg.platformFee : promote.platformFee,
    serviceChargePercent: (promote.serviceChargePercent === undefined || promote.serviceChargePercent === null)
      ? cfg.serviceChargePercent
      : promote.serviceChargePercent,
  };
};

// ─── Read all (admin / manager) ──────────────────────────────────────────────

const getAllPromotes = async (filters = {}, page = 1, limit = 10) => {
  const query = {};

  if (filters.eventStatus) query.eventStatus = filters.eventStatus;
  if (filters.platformFeePaid !== undefined) {
    query.platformFeePaid = filters.platformFeePaid === 'true';
  }
  if (filters.authId) query.authId = filters.authId;
  if (filters.search?.trim()) {
    query.$or = [
      { eventTitle: new RegExp(filters.search, 'i') },
      { eventId: new RegExp(filters.search, 'i') },
    ];
  }

  const skip = (page - 1) * limit;

  const [promotes, total, cfg] = await Promise.all([
    Promote.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Promote.countDocuments(query),
    promoteConfigService.getFees(),
  ]);

  const platformFeeFallback = cfg.platformFee;
  const serviceChargePercentFallback = cfg.serviceChargePercent;
  const hydratedPromotes = (promotes || []).map((p) => ({
    ...p,
    platformFee: (p.platformFee === undefined || p.platformFee === null) ? platformFeeFallback : p.platformFee,
    serviceChargePercent: (p.serviceChargePercent === undefined || p.serviceChargePercent === null)
      ? serviceChargePercentFallback
      : p.serviceChargePercent,
  }));

  return {
    promotes: hydratedPromotes,
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      total,
      limit: Number(limit),
    },
  };
};

// ─── Mark as paid (called by Kafka payment_events consumer) ──────────────────

const markPromotePaid = async (eventId) => {
  if (!eventId?.trim()) throw createApiError(400, 'Event ID is required');

  const promote = await Promote.findOne({ eventId: eventId.trim() });
  if (!promote) throw createApiError(404, 'Promote record not found');

  if (!promote.platformFeePaid) {
    promote.platformFeePaid = true;
    await promote.save(); // pre-validate hook recalculates status
    logger.info(`Promote marked as paid: ${eventId}`);
  }

  return promote;
};

// ─── Update status (manager / admin) ─────────────────────────────────────────

const updatePromoteStatus = async (eventId, eventStatus, assignedManagerId = null) => {
  if (!eventId) throw createApiError(400, 'Event ID is required');

  const promote = await Promote.findOne({ eventId: eventId.trim() });
  if (!promote) throw createApiError(404, 'Promote record not found');

  const allowedTransitions = [PROMOTE_STATUS.LIVE, PROMOTE_STATUS.COMPLETE];
  if (!allowedTransitions.includes(eventStatus)) {
    throw createApiError(400, `eventStatus must be one of: ${allowedTransitions.join(', ')}`);
  }

  promote.eventStatus = eventStatus;
  if (assignedManagerId) {
    await assertManagerEligibleForPromote({ managerId: assignedManagerId });
    await assertManagerAvailable({ managerId: assignedManagerId, eventIdToExclude: promote.eventId });

    const now = new Date();
    promote.assignedManagerId = assignedManagerId;
    promote.managerAssignment = {
      assignedAt: now,
      assignedByAuthId: null,
      autoAssigned: false,
    };

    // Backward-compatible behavior: assigning a manager implies approval.
    if (promote.adminDecision?.status !== DECISION_STATUS.APPROVED) {
      promote.adminDecision = {
        status: DECISION_STATUS.APPROVED,
        decidedAt: now,
        decidedByAuthId: null,
        rejectionReason: null,
      };
    }
  }

  await promote.save();
  logger.info(`Promote status updated: ${eventId} → ${eventStatus}`);
  return promote;
};

// ─── Assign manager (admin only) ─────────────────────────────────────────────

const assignManager = async (eventId, managerId) => {
  return assignManagerWithMetadata(eventId, managerId, { assignedByAuthId: null, autoAssigned: false });
};

const assignManagerWithMetadata = async (
  eventId,
  managerId,
  { assignedByAuthId = null, autoAssigned = false } = {}
) => {
  if (!eventId) throw createApiError(400, 'Event ID is required');
  if (!managerId) throw createApiError(400, 'Manager ID is required');

  const promote = await Promote.findOne({ eventId: String(eventId).trim() });
  if (!promote) throw createApiError(404, 'Promote record not found');

  if (promote.adminDecision?.status === DECISION_STATUS.REJECTED) {
    throw createApiError(400, 'Cannot assign a manager to a rejected event');
  }

  await assertManagerEligibleForPromote({ managerId });

  await assertManagerAvailable({ managerId, eventIdToExclude: promote.eventId });

  const now = new Date();
  promote.assignedManagerId = managerId;
  promote.managerAssignment = {
    assignedAt: now,
    assignedByAuthId: assignedByAuthId || null,
    autoAssigned: Boolean(autoAssigned),
  };

  if (promote.adminDecision?.status !== DECISION_STATUS.APPROVED) {
    promote.adminDecision = {
      status: DECISION_STATUS.APPROVED,
      decidedAt: now,
      decidedByAuthId: assignedByAuthId || null,
      rejectionReason: null,
    };
  }

  await promote.save();
  logger.info(`Manager ${managerId} assigned to promote ${eventId} (auto=${Boolean(autoAssigned)})`);
  return promote;
};

/**
 * Auto-assign helper used by the background job.
 * - Idempotent: will NOT overwrite an existing assignment.
 * - Does NOT call user-service (eligibility is enforced by the job's manager cache).
 */
const tryAutoAssignManager = async (
  eventId,
  managerId,
  { assignedByAuthId = 'system:autoassign' } = {}
) => {
  if (!eventId) throw createApiError(400, 'Event ID is required');
  if (!managerId) throw createApiError(400, 'Manager ID is required');

  await assertManagerAvailable({ managerId, eventIdToExclude: String(eventId).trim() });

  const now = new Date();
  const updateResult = await Promote.updateOne(
    {
      eventId: String(eventId).trim(),
      assignedManagerId: null,
      eventStatus: { $ne: PROMOTE_STATUS.COMPLETE },
      'adminDecision.status': DECISION_STATUS.APPROVED,
      'adminDecision.decidedAt': { $ne: null },
    },
    {
      $set: {
        assignedManagerId: managerId,
        managerAssignment: {
          assignedAt: now,
          assignedByAuthId: assignedByAuthId || null,
          autoAssigned: true,
        },
      },
    }
  );

  return {
    assigned: updateResult?.modifiedCount === 1,
  };
};

const unassignPromoteManager = async (eventId, { unassignedByAuthId = null } = {}) => {
  if (!eventId?.trim()) throw createApiError(400, 'Event ID is required');

  const promote = await Promote.findOne({ eventId: String(eventId).trim() });
  if (!promote) throw createApiError(404, 'Promote record not found');

  promote.assignedManagerId = null;
  promote.managerAssignment = {
    assignedAt: null,
    assignedByAuthId: unassignedByAuthId || null,
    autoAssigned: false,
  };

  await promote.save();
  logger.info(`Promote manager unassigned: ${promote.eventId}`);
  return promote;
};

const decidePromote = async (
  eventId,
  {
    decision,
    rejectionReason = null,
    managerId = null,
    decidedByAuthId = null,
  } = {}
) => {
  if (!eventId?.trim()) throw createApiError(400, 'Event ID is required');
  if (!decision) throw createApiError(400, 'decision is required');

  const normalizedDecision = String(decision).trim().toUpperCase();
  const now = new Date();

  const promote = await Promote.findOne({ eventId: String(eventId).trim() });
  if (!promote) throw createApiError(404, 'Promote record not found');

  if (normalizedDecision === 'REJECT') {
    promote.adminDecision = {
      status: DECISION_STATUS.REJECTED,
      decidedAt: now,
      decidedByAuthId: decidedByAuthId || null,
      rejectionReason: rejectionReason ? String(rejectionReason).trim().slice(0, 500) : null,
    };
    promote.assignedManagerId = null;
    promote.managerAssignment = {
      assignedAt: null,
      assignedByAuthId: null,
      autoAssigned: false,
    };

    await promote.save();
    logger.info(`Promote ${eventId} rejected by ${decidedByAuthId || 'admin'}`);
    return promote;
  }

  if (normalizedDecision !== 'APPROVE') {
    throw createApiError(400, 'decision must be APPROVE or REJECT');
  }

  promote.adminDecision = {
    status: DECISION_STATUS.APPROVED,
    decidedAt: now,
    decidedByAuthId: decidedByAuthId || null,
    rejectionReason: null,
  };
  await promote.save();

  if (managerId) {
    return assignManagerWithMetadata(promote.eventId, managerId, {
      assignedByAuthId: decidedByAuthId || null,
      autoAssigned: false,
    });
  }

  logger.info(`Promote ${eventId} approved by ${decidedByAuthId || 'admin'}`);
  return promote;
};

const getUnavailableManagerIds = async () => {
  const [promoteIds, planningIds] = await Promise.all([
    Promote.distinct('assignedManagerId', {
      assignedManagerId: { $ne: null },
      eventStatus: { $ne: PROMOTE_STATUS.COMPLETE },
      'adminDecision.status': { $ne: DECISION_STATUS.REJECTED },
    }),
    Planning.distinct('assignedManagerId', {
      assignedManagerId: { $ne: null },
      status: { $nin: [PLANNING_STATUS.COMPLETED, PLANNING_STATUS.REJECTED] },
    }),
  ]);

  const merged = [...(promoteIds || []), ...(planningIds || [])]
    .filter(Boolean)
    .map((id) => String(id));

  return Array.from(new Set(merged));
};

const getAdminDashboard = async ({ limit = 200 } = {}) => {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));

  const baseSelect =
    'eventId eventTitle eventCategory customCategory eventField eventBanner schedule createdAt authId assignedManagerId adminDecision managerAssignment eventStatus platformFeePaid';

  const [assigned, applications, rejected] = await Promise.all([
    Promote.find({
      assignedManagerId: { $ne: null },
      'adminDecision.status': { $ne: DECISION_STATUS.REJECTED },
    })
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .select(baseSelect)
      .lean(),
    Promote.find({
      assignedManagerId: null,
      'adminDecision.status': { $ne: DECISION_STATUS.REJECTED },
    })
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .select(baseSelect)
      .lean(),
    Promote.find({
      'adminDecision.status': DECISION_STATUS.REJECTED,
    })
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .select(baseSelect)
      .lean(),
  ]);

  return {
    assigned: assigned || [],
    applications: applications || [],
    rejected: rejected || [],
  };
};

// ─── Delete ───────────────────────────────────────────────────────────────────

const deletePromote = async (eventId) => {
  if (!eventId) throw createApiError(400, 'Event ID is required');

  const promote = await Promote.findOneAndDelete({ eventId: eventId.trim() });
  if (!promote) throw createApiError(404, 'Promote record not found');

  logger.info(`Promote deleted: ${eventId}`);
  return { message: 'Promote record deleted successfully', promote };
};

module.exports = {
  createPromote,
  getMyPromotes,
  getPromoteByEventId,
  getAllPromotes,
  markPromotePaid,
  updatePromoteStatus,
  assignManager,
  assignManagerWithMetadata,
  tryAutoAssignManager,
  unassignPromoteManager,
  decidePromote,
  getUnavailableManagerIds,
  getAdminDashboard,
  deletePromote,
};
