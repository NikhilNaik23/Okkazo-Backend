const Planning = require('../models/Planning');
const vendorSelectionService = require('../services/vendorSelectionService');
const createApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

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

/**
 * GET /vendor-selection/:eventId
 * Ensures a VendorSelection exists for the planning and returns it.
 */
const getOrCreateForPlanning = async (req, res) => {
  try {
    const { eventId } = req.params;
    const planning = await ensureAccessToPlanning({ eventId, user: req.user });

    const selection = await vendorSelectionService.ensureForPlanning(planning);

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
};
