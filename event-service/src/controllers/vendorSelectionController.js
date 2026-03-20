const Planning = require('../models/Planning');
const vendorSelectionService = require('../services/vendorSelectionService');
const createApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const axios = require('axios');
const { STATUS: PLANNING_STATUS } = require('../utils/planningConstants');
const { VENDOR_STATUS } = require('../utils/vendorSelectionConstants');
const vendorReservationService = require('../services/vendorReservationService');
const { fetchUserById } = require('../services/userServiceClient');

const defaultVendorServiceUrl = process.env.SERVICE_HOST
  ? 'http://vendor-service:8084' // docker-compose service name
  : 'http://localhost:8084';
const vendorServiceUrl = process.env.VENDOR_SERVICE_URL || defaultVendorServiceUrl;
const upstreamTimeoutMs = parseInt(process.env.UPSTREAM_HTTP_TIMEOUT_MS || '10000', 10);

const fetchPublicVendorsByAuthIds = async (authIds) => {
  if (!Array.isArray(authIds) || authIds.length === 0) return [];

  const response = await axios.get(`${vendorServiceUrl}/api/vendor/public/vendors`, {
    timeout: upstreamTimeoutMs,
    params: {
      authIds: authIds.join(','),
    },
  });

  const vendors = response.data?.data?.vendors;
  return Array.isArray(vendors) ? vendors : [];
};

const fetchPublicServiceById = async (serviceId) => {
  const id = String(serviceId || '').trim();
  if (!id) return null;

  const response = await axios.get(`${vendorServiceUrl}/api/vendor/public/services/${encodeURIComponent(id)}`,
    {
      timeout: upstreamTimeoutMs,
    }
  );

  return response.data?.data?.service || null;
};

const toFiniteNumberOrNull = (value) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const computeVenueLocationFromService = (service) => {
  if (!service || typeof service !== 'object') return null;

  const details = service.details && typeof service.details === 'object' ? service.details : {};

  // IMPORTANT: use per-venue coordinates only (a vendor can have many venues).
  // Do NOT fall back to vendor application lat/lng.
  const lat =
    toFiniteNumberOrNull(details.locationLat) ??
    toFiniteNumberOrNull(details.lat);
  const lng =
    toFiniteNumberOrNull(details.locationLng) ??
    toFiniteNumberOrNull(details.lng);

  if (lat == null || lng == null) return null;

  const nameCandidates = [
    details.locationAreaName,
    details.location,
    details.mapsUrl,
    details.address,
    service.name,
    service.businessName,
  ];
  const name = nameCandidates
    .map((v) => (v == null ? '' : String(v).trim()))
    .find((v) => v.length > 0);

  if (!name) return null;

  return { name, latitude: lat, longitude: lng };
};

const ensureAccessToPlanning = async ({ eventId, user }) => {
  if (!eventId?.trim()) throw createApiError(400, 'Event ID is required');

  const planning = await Planning.findOne({ eventId: eventId.trim() });
  if (!planning) throw createApiError(404, 'Planning not found');

  if (
    user?.role !== 'ADMIN' &&
    user?.role !== 'MANAGER' &&
    planning.authId !== user?.authId
  ) {
    throw createApiError(403, 'Access denied');
  }

  return planning;
};

const normalizeVendorAuthId = (req) => {
  const vendorAuthId = String(req?.user?.authId || '').trim();
  if (!vendorAuthId) {
    const err = createApiError(401, 'Authentication required');
    err.statusCode = 401;
    throw err;
  }
  if (req?.user?.role !== 'VENDOR') {
    throw createApiError(403, 'Access denied');
  }
  return vendorAuthId;
};

const normalizeEventIdParam = (eventId) => {
  const eid = String(eventId || '').trim();
  if (!eid) throw createApiError(400, 'Event ID is required');
  return eid;
};

const summarizeVendorItems = (items = []) => {
  const pending = items.filter((i) => i?.status === VENDOR_STATUS.YET_TO_SELECT).length;
  const accepted = items.filter((i) => i?.status === VENDOR_STATUS.ACCEPTED).length;
  const rejected = items.filter((i) => i?.status === VENDOR_STATUS.REJECTED).length;
  const total = items.length;

  let summaryStatus = 'PENDING';
  if (total === 0) summaryStatus = 'UNKNOWN';
  else if (pending > 0) summaryStatus = 'PENDING';
  else if (rejected > 0) summaryStatus = 'REJECTED';
  else summaryStatus = 'ACCEPTED';

  return { pending, accepted, rejected, total, summaryStatus };
};

/**
 * GET /vendor/requests
 * Vendor-facing: list this vendor's event requests (grouped by eventId).
 */
const listVendorRequests = async (req, res) => {
  try {
    const vendorAuthId = normalizeVendorAuthId(req);

    const selections = await vendorSelectionService.listSelectionsForVendor({ vendorAuthId });
    const eventIds = selections.map((s) => s.eventId).filter(Boolean);
    const plannings = await Planning.find({ eventId: { $in: eventIds } })
      .select(
        'eventId authId eventTitle category eventType customEventType eventField eventDescription eventBanner schedule eventDate eventTime guestCount location assignedManagerId status'
      )
      .lean();

    const planningByEventId = new Map(plannings.map((p) => [String(p.eventId), p]));

    const rows = selections
      .map((sel) => {
        const planning = planningByEventId.get(String(sel.eventId)) || null;
        const vendorItems = (sel.vendorItems || []).map((v) => ({
          service: v.service,
          status: v.status,
          rejectionReason: v.rejectionReason || null,
          alternativeNeeded: Boolean(v.alternativeNeeded),
          serviceId: v.serviceId || null,
          servicePrice: v.servicePrice || { min: 0, max: 0 },
        }));

        const summary = summarizeVendorItems(vendorItems);
        const eventDate = planning?.eventDate || planning?.schedule?.startAt || null;
        return {
          eventId: sel.eventId,
          planningStatus: planning?.status || null,
          vendorSelectionId: sel._id,
          vendorSelectionStatus: sel.status,
          vendorsAccepted: Boolean(sel.vendorsAccepted),
          managerId: sel.managerId || planning?.assignedManagerId || null,
          managerAssigned: Boolean(sel.managerId || planning?.assignedManagerId),
          eventTitle: planning?.eventTitle || null,
          category: planning?.category || null,
          eventType: planning?.eventType || null,
          eventField: planning?.eventField || null,
          eventDescription: planning?.eventDescription || null,
          locationName: planning?.location?.name || null,
          eventDate,
          eventTime: planning?.eventTime || null,
          guestCount: planning?.guestCount ?? null,
          eventBannerUrl: planning?.eventBanner?.url || null,
          vendorItems,
          summary,
        };
      })
      .filter((row) => row.eventId);

    return res.status(200).json({
      success: true,
      data: {
        requests: rows,
      },
    });
  } catch (error) {
    logger.error('Error in listVendorRequests:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * GET /vendor/requests/:eventId
 * Vendor-facing: detailed view for this vendor for a given eventId.
 */
const getVendorRequestDetails = async (req, res) => {
  try {
    const vendorAuthId = normalizeVendorAuthId(req);
    const eventId = normalizeEventIdParam(req.params.eventId);

    const selection = await vendorSelectionService.getSelectionForVendorEvent({ eventId, vendorAuthId });
    const planning = await Planning.findOne({ eventId })
      .select(
        'eventId authId eventTitle category eventType customEventType eventField eventDescription eventBanner schedule eventDate eventTime guestCount location assignedManagerId status'
      )
      .lean();

    let managerProfile = null;
    const managerId = selection?.managerId || planning?.assignedManagerId || null;
    if (managerId) {
      try {
        managerProfile = await fetchUserById(managerId);
      } catch (e) {
        logger.warn('Failed to fetch manager profile for vendor request', { eventId, managerId: String(managerId) });
      }
    }

    const vendorItems = (selection.vendorItems || []).map((v) => ({
      service: v.service,
      status: v.status,
      rejectionReason: v.rejectionReason || null,
      alternativeNeeded: Boolean(v.alternativeNeeded),
      serviceId: v.serviceId || null,
      servicePrice: v.servicePrice || { min: 0, max: 0 },
    }));

    return res.status(200).json({
      success: true,
      data: {
        eventId,
        planning: planning || null,
        vendorSelection: {
          _id: selection._id,
          status: selection.status,
          vendorsAccepted: Boolean(selection.vendorsAccepted),
          managerId: selection.managerId || null,
          managerAssigned: Boolean(selection.managerId),
        },
        managerProfile,
        vendorItems,
        summary: summarizeVendorItems(vendorItems),
      },
    });
  } catch (error) {
    logger.error('Error in getVendorRequestDetails:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

const acceptVendorRequest = async (req, res) => {
  try {
    const vendorAuthId = normalizeVendorAuthId(req);
    const eventId = normalizeEventIdParam(req.params.eventId);

    const { service } = req.body || {};
    const { selection } = await vendorSelectionService.respondForVendor({
      eventId,
      vendorAuthId,
      action: 'accept',
      service,
    });

    // Business rule: if Venue vendor accepts and a concrete venue serviceId was selected,
    // update Planning.location to the venue's location (best-effort).
    try {
      const venueItem = (selection?.vendors || []).find(
        (v) =>
          v?.service === 'Venue' &&
          String(v?.vendorAuthId || '').trim() === vendorAuthId &&
          v?.status === VENDOR_STATUS.ACCEPTED &&
          v?.serviceId
      );

      if (venueItem?.serviceId) {
        const venueService = await fetchPublicServiceById(venueItem.serviceId);
        const venueLocation = computeVenueLocationFromService(venueService);
        if (venueLocation) {
          await Planning.updateOne(
            { eventId },
            {
              $set: {
                location: venueLocation,
              },
            }
          );
        }
      }
    } catch (e) {
      logger.warn('Failed to update planning location from accepted venue service', {
        eventId,
        vendorAuthId,
        error: e?.message,
      });
    }

    const planning = await Planning.findOne({ eventId }).select('status eventId').lean();
    let planningStatusUpdated = false;
    let nextPlanningStatus = planning?.status || null;

    if (selection?.vendorsAccepted && planning?.status !== PLANNING_STATUS.APPROVED) {
      await Planning.updateOne({ eventId }, { $set: { status: PLANNING_STATUS.APPROVED } });
      planningStatusUpdated = true;
      nextPlanningStatus = PLANNING_STATUS.APPROVED;
    }

    return res.status(200).json({
      success: true,
      message: 'Request accepted',
      data: {
        eventId,
        vendorsAccepted: Boolean(selection?.vendorsAccepted),
        vendorSelectionStatus: selection?.status,
        planningStatus: nextPlanningStatus,
        planningStatusUpdated,
      },
    });
  } catch (error) {
    logger.error('Error in acceptVendorRequest:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

const rejectVendorRequest = async (req, res) => {
  try {
    const vendorAuthId = normalizeVendorAuthId(req);
    const eventId = normalizeEventIdParam(req.params.eventId);

    const { service, reason } = req.body || {};
    const rejectionReason = reason != null ? String(reason).trim() : '';
    if (!rejectionReason) {
      throw createApiError(400, 'reason is required');
    }

    const planning = await Planning.findOne({ eventId }).lean();
    const planningDay = vendorReservationService.planningToDay(planning);

    const { selection, vendorAcceptedAnyServiceAfter } = await vendorSelectionService.respondForVendor({
      eventId,
      vendorAuthId,
      action: 'reject',
      service,
      rejectionReason,
    });

    // If vendor is no longer participating in any service for this event, release reservation (best-effort)
    if (!vendorAcceptedAnyServiceAfter && planningDay) {
      vendorReservationService
        .release({ vendorAuthId, day: planningDay, eventId })
        .catch((e) => logger.warn('Failed to release vendor reservation after rejection', { eventId, vendorAuthId, error: e.message }));
    }

    return res.status(200).json({
      success: true,
      message: 'Request rejected',
      data: {
        eventId,
        vendorsAccepted: Boolean(selection?.vendorsAccepted),
        vendorSelectionStatus: selection?.status,
      },
    });
  } catch (error) {
    logger.error('Error in rejectVendorRequest:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * GET /vendor-selection/:eventId
 * Ensures a VendorSelection exists for the planning and returns it.
 */
const getOrCreateForPlanning = async (req, res) => {
  try {
    const { eventId } = req.params;
    const planning = await ensureAccessToPlanning({ eventId, user: req.user });

    const selection = await vendorSelectionService.ensureForPlanning(planning);

    const includeVendors = String(req.query.includeVendors || '').toLowerCase() === 'true';
    if (includeVendors) {
      const vendorAuthIds = Array.from(
        new Set(
          (selection?.vendors || [])
            .map((v) => (v?.vendorAuthId != null ? String(v.vendorAuthId).trim() : ''))
            .filter(Boolean)
        )
      );

      const vendorProfiles = await fetchPublicVendorsByAuthIds(vendorAuthIds);
      return res.status(200).json({
        success: true,
        data: {
          ...(selection?.toObject ? selection.toObject() : selection),
          vendorProfiles,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: selection,
    });
  } catch (error) {
    logger.error('Error in getOrCreateForPlanning:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * PATCH /vendor-selection/:eventId/services
 * Body: { selectedServices: string[] }
 * Updates VendorSelection.selectedServices and keeps Planning.selectedServices in sync.
 */
const updateSelectedServices = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { selectedServices } = req.body;

    if (!req.user?.authId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Ownership check via planning
    await ensureAccessToPlanning({ eventId, user: req.user });

    const selection = await vendorSelectionService.updateSelectedServices({
      eventId,
      authId: req.user.authId,
      selectedServices,
    });

    return res.status(200).json({
      success: true,
      message: 'Selected services updated successfully',
      data: selection,
    });
  } catch (error) {
    logger.error('Error in updateSelectedServices:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * PATCH /vendor-selection/:eventId/vendors
 * Body: { service, vendorAuthId?, status?, rejectionReason?, alternativeNeeded?, servicePrice?: {min,max} }
 */
const upsertVendor = async (req, res) => {
  try {
    const { eventId } = req.params;

    if (!req.user?.authId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    await ensureAccessToPlanning({ eventId, user: req.user });

    const selection = await vendorSelectionService.upsertVendor({
      eventId,
      authId: req.user.authId,
      vendorUpdate: req.body,
    });

    return res.status(200).json({
      success: true,
      message: 'Vendor updated successfully',
      data: selection,
    });
  } catch (error) {
    logger.error('Error in upsertVendor:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getOrCreateForPlanning,
  updateSelectedServices,
  upsertVendor,
  listVendorRequests,
  getVendorRequestDetails,
  acceptVendorRequest,
  rejectVendorRequest,
};
