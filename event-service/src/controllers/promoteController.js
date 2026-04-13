const promoteService = require('../services/promoteService');
const { resolveUserServiceIdFromAuthId, fetchUserById } = require('../services/userServiceClient');
const bannerUploadService = require('../services/bannerUploadService');
const { publishEvent } = require('../kafka/eventProducer');
const logger = require('../utils/logger');
const promoteConfigService = require('../services/promoteConfigService');
const PROMOTE_LIFECYCLE_STATUSES = new Set(['CONFIRMED', 'LIVE', 'COMPLETE', 'COMPLETED', 'CLOSED']);

const publishPromoteLifecycleEventIfNeeded = async ({ promote, updatedBy = null }) => {
  const status = String(promote?.eventStatus || '').trim().toUpperCase();
  if (!PROMOTE_LIFECYCLE_STATUSES.has(status)) return;

  await publishEvent('EVENT_LIFECYCLE_STATUS_UPDATED', {
    eventId: String(promote?.eventId || '').trim() || null,
    authId: String(promote?.authId || '').trim() || null,
    status,
    eventType: 'promote',
    assignedManagerId: String(promote?.assignedManagerId || '').trim() || null,
    vendorAuthIds: [],
    eventTitle: String(promote?.eventTitle || '').trim() || null,
    updatedBy: updatedBy ? String(updatedBy).trim() : null,
    occurredAt: new Date().toISOString(),
  });
};

const buildManagerProfile = (user) => {
  if (!user || typeof user !== 'object') return null;
  return {
    id: user._id || user.id || null,
    authId: user.authId || null,
    name: user.name || user.fullName || null,
    fullName: user.fullName || null,
    avatar: user.avatar || null,
    assignedRole: user.assignedRole || null,
    department: user.department || null,
    role: user.role || null,
    isActive: Boolean(user.isActive),
    lastLogin: user.lastLogin || null,
  };
};

const enrichPromoteWithManagerProfile = async (promote) => {
  if (!promote || typeof promote !== 'object') return promote;

  const assignedManagerId = String(promote.assignedManagerId || '').trim();
  if (!assignedManagerId) {
    return {
      ...promote,
      managerProfile: null,
    };
  }

  try {
    const manager = await fetchUserById(assignedManagerId);
    return {
      ...promote,
      managerProfile: buildManagerProfile(manager),
    };
  } catch (error) {
    logger.warn('Failed to enrich promote with manager profile', {
      eventId: promote.eventId,
      assignedManagerId,
      error: error?.message,
    });
    return {
      ...promote,
      managerProfile: null,
    };
  }
};

// ─── Create a new promote record ──────────────────────────────────────────────
/**
 * POST /promote
 *
 * Accepts multipart/form-data:
 *   - eventBanner   : single image file (required)
 *   - authProofs    : up to 10 image files (optional)
 *   - all other fields as JSON strings (parsed by validateCreatePromote)
 */
const createPromote = async (req, res) => {
  try {
    if (!req.user?.authId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const payload = {
      ...req.body,
      authId: req.user.authId,
    };

    // ── Upload event banner (required) ────────────────────────────────────────
    const bannerFile = req.files?.eventBanner?.[0];
    if (!bannerFile) {
      return res.status(400).json({ success: false, message: 'eventBanner image is required' });
    }

    const bannerResult = await bannerUploadService.uploadBanner(
      bannerFile,
      'promote-banners'
    );
    payload.eventBanner = {
      url: bannerResult.url,
      publicId: bannerResult.publicId,
      mimeType: bannerResult.mimeType,
      sizeBytes: bannerResult.sizeBytes,
    };

    // ── Upload authenticity proof images ──────────────────────────────────────
    const proofFiles = req.files?.authProofs || [];
    const uploadedProofs = [];

    for (const file of proofFiles) {
      try {
        const result = await bannerUploadService.uploadBanner(file, 'promote-proofs');
        uploadedProofs.push({
          url: result.url,
          publicId: result.publicId,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
        });
      } catch (err) {
        logger.error('Failed to upload auth proof:', err.message);
        // Non-blocking: continue with other files
      }
    }

    payload.authenticityProofs = uploadedProofs;

    const result = await promoteService.createPromote(payload);

    // ── Publish Kafka event ───────────────────────────────────────────────────
    try {
      await publishEvent('PROMOTE_CREATED', {
        eventId: result.eventId,
        promoteId: result.promoteId,
        authId: req.user.authId,
        eventTitle: result.eventTitle,
        eventStatus: result.eventStatus,
        schedule: result.schedule,
      });
    } catch (kafkaError) {
      logger.error('Failed to publish PROMOTE_CREATED:', kafkaError.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Promote record created successfully',
      data: result,
    });
  } catch (error) {
    logger.error('Error in createPromote controller:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─── Get own promote records ──────────────────────────────────────────────────
/**
 * GET /promote/me
 */
const getMyPromotes = async (req, res) => {
  try {
    if (!req.user?.authId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    let { page = 1, limit = 10 } = req.query;
    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

    const result = await promoteService.getMyPromotes(req.user.authId, page, limit);

    const promotes = Array.isArray(result?.promotes) ? result.promotes : [];
    const enrichedPromotes = await Promise.all(promotes.map(enrichPromoteWithManagerProfile));

    return res.status(200).json({
      success: true,
      ...result,
      promotes: enrichedPromotes,
    });
  } catch (error) {
    logger.error('Error in getMyPromotes:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// ─── Get single promote by eventId ───────────────────────────────────────────
/**
 * GET /promote/:eventId
 */
const getPromoteByEventId = async (req, res) => {
  try {
    const { eventId } = req.params;

    const promote = await promoteService.getPromoteByEventId(eventId);

    // Regular users can only access their own records
    if (
      req.user.role !== 'ADMIN' &&
      req.user.role !== 'MANAGER' &&
      promote.authId !== req.user.authId
    ) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const enrichedPromote = await enrichPromoteWithManagerProfile(promote);
    return res.status(200).json({ success: true, data: enrichedPromote });
  } catch (error) {
    logger.error('Error in getPromoteByEventId:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// ─── Get all promotes (admin / manager) ──────────────────────────────────────
/**
 * GET /promote
 */
const getAllPromotes = async (req, res) => {
  try {
    let { page = 1, limit = 10, eventStatus, platformFeePaid, authId, search } = req.query;
    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

    const filters = {};
    if (eventStatus) filters.eventStatus = eventStatus;
    if (platformFeePaid !== undefined) filters.platformFeePaid = platformFeePaid;
    if (authId) filters.authId = authId;
    if (search?.trim()) filters.search = search.trim();

    const result = await promoteService.getAllPromotes(filters, page, limit);

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Error in getAllPromotes:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * Manager events list
 * GET /promote/manager/events
 */
const getManagerPromoteEvents = async (req, res) => {
  try {
    const limit = Number(req.query?.limit || 200);

    // Manager should fetch their own events by default.
    // Admin may optionally supply ?managerId=... to inspect a specific manager.
    const isAdminOverride = req.user?.role === 'ADMIN' && req.query?.managerId;
    const managerId = isAdminOverride
      ? String(req.query.managerId).trim()
      : await resolveUserServiceIdFromAuthId(req.user?.authId);

    if (!managerId) {
      return res
        .status(isAdminOverride ? 400 : 404)
        .json({ success: false, message: isAdminOverride ? 'managerId is required' : 'Manager not found' });
    }

    const events = await promoteService.getPromotesForManager({ managerId, limit });
    return res.status(200).json({
      success: true,
      data: { events },
    });
  } catch (error) {
    logger.error('Error in getManagerPromoteEvents:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch manager promote events',
    });
  }
};

/**
 * Create promote cancellation refund request (Owner)
 * POST /promote/:eventId/refund-request
 */
const createPromoteRefundRequest = async (req, res) => {
  try {
    const { eventId } = req.params;

    if (!req.user?.authId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const promote = await promoteService.createPromoteRefundRequest({
      eventId,
      authId: req.user.authId,
      cancellationReason: req.body?.cancellationReason,
      reasonCode: req.body?.reasonCode,
    });

    return res.status(200).json({
      success: true,
      message: 'Cancellation processed successfully',
      data: promote,
    });
  } catch (error) {
    logger.error('Error in createPromoteRefundRequest:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to create refund request',
    });
  }
};

/**
 * Get promote refund request by eventId
 * GET /promote/:eventId/refund-request
 */
const getPromoteRefundRequest = async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!eventId || eventId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Event ID is required',
      });
    }

    const promote = await promoteService.getPromoteRefundRequestByEventId({ eventId });

    if (
      req.user?.role !== 'ADMIN'
      && req.user?.role !== 'MANAGER'
      && String(promote?.authId || '').trim() !== String(req.user?.authId || '').trim()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own refund request.',
      });
    }

    return res.status(200).json({
      success: true,
      data: promote,
    });
  } catch (error) {
    logger.error('Error in getPromoteRefundRequest:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch refund request',
    });
  }
};

/**
 * Revenue Operations Specialist queue for promote refund requests
 * GET /promote/manager/refund-requests
 */
const getManagerPromoteRefundRequests = async (req, res) => {
  try {
    const limit = Number(req.query?.limit || 200);
    const statuses = String(req.query?.statuses || '')
      .split(',')
      .map((status) => String(status || '').trim())
      .filter(Boolean);

    const context = await promoteService.resolveRevenueOpsManagerContext({
      authId: req.user?.authId,
      role: req.user?.role,
    });

    const managerId = context.isAdmin && req.query?.managerId
      ? String(req.query.managerId).trim()
      : context.managerId;

    const requests = await promoteService.getPromoteRefundRequestsForManager({
      managerId,
      limit,
      statuses,
    });

    return res.status(200).json({
      success: true,
      data: { requests },
    });
  } catch (error) {
    logger.error('Error in getManagerPromoteRefundRequests:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch refund requests',
    });
  }
};

/**
 * Review promote refund request
 * PATCH /promote/:eventId/refund-request
 */
const reviewPromoteRefundRequest = async (req, res) => {
  try {
    const { eventId } = req.params;

    const context = await promoteService.resolveRevenueOpsManagerContext({
      authId: req.user?.authId,
      role: req.user?.role,
    });

    const updated = await promoteService.reviewPromoteRefundRequest({
      eventId,
      managerId: context.managerId,
      managerAuthId: req.user?.authId,
      nextStatus: req.body?.status,
      managerNotes: req.body?.managerNotes,
      refundTransactionRef: req.body?.refundTransactionRef,
      isAdmin: context.isAdmin,
    });

    return res.status(200).json({
      success: true,
      message: 'Refund request updated successfully',
      data: updated,
    });
  } catch (error) {
    logger.error('Error in reviewPromoteRefundRequest:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to review refund request',
    });
  }
};

/**
 * Update promote core details (Manager/Admin)
 * PATCH /promote/:eventId
 */
const updatePromoteDetails = async (req, res) => {
  try {
    const { eventId } = req.params;

    const updated = await promoteService.updatePromoteDetails({
      eventId,
      updates: {
        eventTitle: req.body?.eventTitle,
        eventDescription: req.body?.eventDescription,
        locationName: req.body?.locationName,
      },
      actorRole: req.user?.role,
      actorManagerId: req.user?.role === 'ADMIN' ? null : await resolveUserServiceIdFromAuthId(req.user?.authId),
    });

    return res.status(200).json({
      success: true,
      message: 'Promote updated successfully',
      data: updated,
    });
  } catch (error) {
    logger.error('Error in updatePromoteDetails:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to update promote',
    });
  }
};

/**
 * Add CORE staff to promote event (Manager/Admin)
 * POST /promote/:eventId/core-staff
 */
const addPromoteCoreStaff = async (req, res) => {
  try {
    const { eventId } = req.params;
    const staffId = req.body?.staffId;

    const updated = await promoteService.addPromoteCoreStaff({
      eventId,
      staffId,
      actorRole: req.user?.role,
      actorManagerId: req.user?.role === 'ADMIN' ? null : await resolveUserServiceIdFromAuthId(req.user?.authId),
    });

    return res.status(200).json({
      success: true,
      message: 'Staff assigned successfully',
      data: updated,
    });
  } catch (error) {
    logger.error('Error in addPromoteCoreStaff:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to assign staff',
    });
  }
};

/**
 * Remove CORE staff from promote event (Manager/Admin)
 * DELETE /promote/:eventId/core-staff/:staffId
 */
const removePromoteCoreStaff = async (req, res) => {
  try {
    const { eventId, staffId } = req.params;

    const updated = await promoteService.removePromoteCoreStaff({
      eventId,
      staffId,
      actorRole: req.user?.role,
      actorManagerId: req.user?.role === 'ADMIN' ? null : await resolveUserServiceIdFromAuthId(req.user?.authId),
    });

    return res.status(200).json({
      success: true,
      message: 'Staff removed successfully',
      data: updated,
    });
  } catch (error) {
    logger.error('Error in removePromoteCoreStaff:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to remove staff',
    });
  }
};

/**
 * Release generated revenue payout to user for promote event (Manager/Admin)
 * PATCH /promote/:eventId/generated-revenue-payout
 */
const releasePromoteGeneratedRevenuePayout = async (req, res) => {
  try {
    const { eventId } = req.params;

    const updated = await promoteService.releasePromoteGeneratedRevenuePayout({
      eventId,
      actorRole: req.user?.role,
      actorAuthId: req.user?.authId,
      actorManagerId: req.user?.role === 'ADMIN' ? null : await resolveUserServiceIdFromAuthId(req.user?.authId),
      mode: req.body?.mode || 'DEMO',
    });

    return res.status(200).json({
      success: true,
      message: updated?.generatedRevenuePayoutSummary?.alreadyProcessed
        ? 'Generated revenue payout already sent to user'
        : 'Generated revenue payout sent to user',
      data: updated,
    });
  } catch (error) {
    logger.error('Error in releasePromoteGeneratedRevenuePayout:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to release generated revenue payout',
    });
  }
};

/**
 * Recover cancellation liability from event creator (Manager/Admin)
 * PATCH /promote/:eventId/liability-recovery
 */
const recoverPromoteCancellationLiability = async (req, res) => {
  try {
    const { eventId } = req.params;

    const updated = await promoteService.recoverPromoteCancellationLiability({
      eventId,
      actorRole: req.user?.role,
      actorAuthId: req.user?.authId,
      actorManagerId: req.user?.role === 'ADMIN' ? null : await resolveUserServiceIdFromAuthId(req.user?.authId),
    });

    return res.status(200).json({
      success: true,
      message: updated?.liabilityRecoverySummary?.alreadyRecovered
        ? 'Creator liability is already recovered'
        : updated?.liabilityRecoverySummary?.alreadyPending
          ? 'Creator liability recovery is already pending payment'
          : updated?.liabilityRecoverySummary?.notRequired
            ? 'No creator liability is due for this event'
            : 'Creator liability recovery initiated',
      data: updated,
    });
  } catch (error) {
    logger.error('Error in recoverPromoteCancellationLiability:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to recover promote cancellation liability',
    });
  }
};

/**
 * Trigger EMAIL BLAST promotion action (Manager/Admin)
 * POST /promote/:eventId/promotion-actions/email-blast
 */
const triggerPromoteEmailBlastPromotionAction = async (req, res) => {
  try {
    const { eventId } = req.params;

    const result = await promoteService.triggerPromoteEmailBlastPromotionAction({
      eventId,
      actorRole: req.user?.role,
      actorAuthId: req.user?.authId,
      actorManagerId: req.user?.role === 'ADMIN' ? null : await resolveUserServiceIdFromAuthId(req.user?.authId),
    });

    return res.status(200).json({
      success: true,
      message: 'Email blast request submitted successfully',
      data: result,
    });
  } catch (error) {
    logger.error('Error in triggerPromoteEmailBlastPromotionAction:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to trigger email blast',
    });
  }
};

// ─── Update promote status (manager / admin) ──────────────────────────────────
/**
 * PATCH /promote/:eventId/status
 */
const updatePromoteStatus = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { eventStatus, assignedManagerId } = req.body;

    if (!eventStatus) {
      return res.status(400).json({ success: false, message: 'eventStatus is required' });
    }

    const promote = await promoteService.updatePromoteStatus(eventId, eventStatus, assignedManagerId, {
      updatedByAuthId: req.user?.authId || null,
      updatedByRole: req.user?.role || null,
      updatedByManagerId: req.user?.role === 'ADMIN' ? null : await resolveUserServiceIdFromAuthId(req.user?.authId),
    });

    // Publish Kafka
    try {
      await publishEvent('PROMOTE_STATUS_UPDATED', {
        eventId: promote.eventId,
        authId: promote.authId,
        eventStatus: promote.eventStatus,
        assignedManagerId: promote.assignedManagerId,
        eventTitle: promote.eventTitle,
        updatedBy: req.user.authId,
      });

      await publishPromoteLifecycleEventIfNeeded({
        promote,
        updatedBy: req.user?.authId || null,
      });
    } catch (kafkaError) {
      logger.error('Failed to publish PROMOTE_STATUS_UPDATED:', kafkaError.message);
    }

    return res.status(200).json({ success: true, message: 'Status updated', data: promote });
  } catch (error) {
    logger.error('Error in updatePromoteStatus:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// ─── Assign manager (admin only) ─────────────────────────────────────────────
/**
 * PATCH /promote/:eventId/assign
 */
const assignManager = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { managerId } = req.body;

    if (!managerId) {
      return res.status(400).json({ success: false, message: 'managerId is required' });
    }

    const promote = await promoteService.assignManagerWithMetadata(eventId, managerId, {
      assignedByAuthId: req.user?.authId || null,
      autoAssigned: false,
    });

    return res.status(200).json({ success: true, message: 'Manager assigned', data: promote });
  } catch (error) {
    logger.error('Error in assignManager:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// ─── Unassign manager (admin only) ──────────────────────────────────────────
/**
 * PATCH /promote/:eventId/unassign-manager
 */
const unassignManager = async (req, res) => {
  try {
    const { eventId } = req.params;

    const promote = await promoteService.unassignPromoteManager(eventId, {
      unassignedByAuthId: req.user?.authId || null,
    });

    // Publish Kafka (best-effort)
    try {
      await publishEvent('PROMOTE_STATUS_UPDATED', {
        eventId: promote.eventId,
        authId: promote.authId,
        eventStatus: promote.eventStatus,
        assignedManagerId: promote.assignedManagerId,
        eventTitle: promote.eventTitle,
        updatedBy: req.user?.authId || null,
      });

      await publishPromoteLifecycleEventIfNeeded({
        promote,
        updatedBy: req.user?.authId || null,
      });
    } catch (kafkaError) {
      logger.error('Failed to publish PROMOTE_STATUS_UPDATED:', kafkaError.message);
    }

    return res.status(200).json({ success: true, message: 'Manager unassigned', data: promote });
  } catch (error) {
    logger.error('Error in unassignManager:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// ─── Admin dashboard (assigned / applications / rejected) ───────────────────
/**
 * GET /promote/admin/dashboard
 */
const getAdminDashboard = async (req, res) => {
  try {
    const { limit } = req.query;
    const data = await promoteService.getAdminDashboard({ limit });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Error in getAdminDashboard:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// ─── Admin decision (approve / reject) ──────────────────────────────────────
/**
 * PATCH /promote/:eventId/decision
 * Body: { decision: 'APPROVE'|'REJECT', rejectionReason?, managerId? }
 */
const decidePromote = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { decision, rejectionReason, managerId } = req.body || {};

    const promote = await promoteService.decidePromote(eventId, {
      decision,
      rejectionReason,
      managerId,
      decidedByAuthId: req.user?.authId || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Decision updated',
      data: promote,
    });
  } catch (error) {
    logger.error('Error in decidePromote:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * GET /promote/admin/unavailable-managers
 */
const getUnavailableManagers = async (req, res) => {
  try {
    const eventId = String(req.query?.eventId || '').trim() || null;
    const managerIds = await promoteService.getUnavailableManagerIds({ eventId });
    return res.status(200).json({ success: true, data: { managerIds } });
  } catch (error) {
    logger.error('Error in getUnavailableManagers:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// ─── Delete promote (owner or admin) ─────────────────────────────────────────
/**
 * DELETE /promote/:eventId
 */
const deletePromote = async (req, res) => {
  try {
    const { eventId } = req.params;

    const promote = await promoteService.getPromoteByEventId(eventId);

    // Ownership check
    if (req.user.role !== 'ADMIN' && promote.authId !== req.user.authId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Clean up Cloudinary assets
    const cleanupJobs = [];

    if (promote.eventBanner?.publicId) {
      cleanupJobs.push(
        bannerUploadService.deleteBanner(promote.eventBanner.publicId).catch((e) =>
          logger.error('Banner cleanup failed:', e.message)
        )
      );
    }

    for (const proof of promote.authenticityProofs || []) {
      if (proof.publicId) {
        cleanupJobs.push(
          bannerUploadService.deleteBanner(proof.publicId).catch((e) =>
            logger.error('Proof cleanup failed:', e.message)
          )
        );
      }
    }

    await Promise.allSettled(cleanupJobs);

    const result = await promoteService.deletePromote(eventId);

    return res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    logger.error('Error in deletePromote:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createPromote,
  getPlatformFee: async (req, res) => {
    try {
      const result = await promoteConfigService.getPlatformFee();
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Error in getPlatformFee:', error);
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  },
  updatePlatformFee: async (req, res) => {
    try {
      const { platformFee } = req.body;
      const result = await promoteConfigService.updatePlatformFee({
        platformFee,
        updatedByAuthId: req.user?.authId || null,
      });
      return res.status(200).json({ success: true, message: 'Platform fee updated', data: result });
    } catch (error) {
      logger.error('Error in updatePlatformFee:', error);
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  },
  getMyPromotes,
  getPromoteByEventId,
  updatePromoteDetails,
  addPromoteCoreStaff,
  removePromoteCoreStaff,
  releasePromoteGeneratedRevenuePayout,
  recoverPromoteCancellationLiability,
  triggerPromoteEmailBlastPromotionAction,
  getAllPromotes,
  getManagerPromoteEvents,
  createPromoteRefundRequest,
  getPromoteRefundRequest,
  getManagerPromoteRefundRequests,
  reviewPromoteRefundRequest,
  updatePromoteStatus,
  assignManager,
  unassignManager,
  getAdminDashboard,
  decidePromote,
  getUnavailableManagers,
  deletePromote,
};
