const planningService = require('../services/planningService');
const bannerUploadService = require('../services/bannerUploadService');
const { publishEvent } = require('../kafka/eventProducer');
const logger = require('../utils/logger');

/**
 * Create a new planning event
 * POST /planning
 *
 * For public events, the request is multipart/form-data so that
 * the eventBanner image file can be uploaded alongside JSON fields.
 * For private events, plain JSON works fine (no banner).
 */
const createPlanning = async (req, res) => {
  try {
    if (!req.user || !req.user.authId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication information missing',
      });
    }

    const payload = {
      ...req.body,
      authId: req.user.authId,
    };

    // Handle event banner upload (public events - file comes via multer)
    if (req.file) {
      const uploadResult = await bannerUploadService.uploadBanner(
        req.file,
        `event-banners`
      );

      payload.eventBanner = {
        url: uploadResult.url,
        publicId: uploadResult.publicId,
        mimeType: uploadResult.mimeType,
        sizeBytes: uploadResult.sizeBytes,
      };
    }

    const result = await planningService.createPlanning(payload);

    // Publish Kafka event
    try {
      await publishEvent('PLANNING_CREATED', {
        eventId: result.eventId,
        authId: req.user.authId,
        title: result.title,
        category: req.body.category,
        eventScheduleDate: result.eventScheduleDate,
        selectedServices: result.selectedServices,
      });
    } catch (kafkaError) {
      logger.error('Failed to publish PLANNING_CREATED event:', kafkaError);
      // Don't fail the request if Kafka publish fails
    }

    res.status(201).json({
      success: true,
      message: 'Planning event created successfully',
      data: result,
    });
  } catch (error) {
    logger.error('Error in createPlanning:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get current user's plannings
 * GET /planning/me
 */
const getMyPlannings = async (req, res) => {
  try {
    if (!req.user || !req.user.authId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication information missing',
      });
    }

    let { page = 1, limit = 10 } = req.query;
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 100) limit = 100;

    const result = await planningService.getPlanningsByAuthId(req.user.authId, page, limit);

    res.status(200).json({
      success: true,
      data: result.plannings,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error('Error in getMyPlannings:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get a single planning by eventId
 * GET /planning/:eventId
 */
const getPlanningByEventId = async (req, res) => {
  try {
    const { eventId } = req.params;

    if (!eventId || eventId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Event ID is required',
      });
    }

    const planning = await planningService.getPlanningByEventId(eventId);

    // Regular users can only access their own plannings
    if (
      req.user.role !== 'ADMIN' &&
      req.user.role !== 'MANAGER' &&
      planning.authId !== req.user.authId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own plannings.',
      });
    }

    res.status(200).json({
      success: true,
      data: planning,
    });
  } catch (error) {
    logger.error('Error in getPlanningByEventId:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get all plannings with pagination and filters (Admin/Manager)
 * GET /planning
 */
const getAllPlannings = async (req, res) => {
  try {
    let { page = 1, limit = 10, category, status, isUrgent, search } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 100) limit = 100;

    const filters = {};
    if (category) filters.category = category;
    if (status) filters.status = status;
    if (isUrgent !== undefined) filters.isUrgent = isUrgent;
    if (search && search.trim() !== '') filters.search = search.trim();

    const result = await planningService.getAllPlannings(filters, page, limit);

    res.status(200).json({
      success: true,
      data: result.plannings,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error('Error in getAllPlannings:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Update planning status (Admin/Manager)
 * PATCH /planning/:eventId/status
 */
const updatePlanningStatus = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, assignedManagerId } = req.body;

    if (!eventId || eventId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Event ID is required',
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
      });
    }

    const planning = await planningService.updatePlanningStatus(eventId, status, assignedManagerId);

    // Publish Kafka event
    try {
      await publishEvent('PLANNING_STATUS_UPDATED', {
        eventId: planning.eventId,
        authId: planning.authId,
        status: planning.status,
        assignedManagerId: planning.assignedManagerId,
        updatedBy: req.user.authId,
      });
    } catch (kafkaError) {
      logger.error('Failed to publish PLANNING_STATUS_UPDATED event:', kafkaError);
    }

    res.status(200).json({
      success: true,
      message: 'Planning status updated successfully',
      data: planning,
    });
  } catch (error) {
    logger.error('Error in updatePlanningStatus:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Delete a planning
 * DELETE /planning/:eventId
 */
const deletePlanning = async (req, res) => {
  try {
    const { eventId } = req.params;

    if (!eventId || eventId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Event ID is required',
      });
    }

    // Fetch planning first (for ownership check + banner cleanup)
    const planning = await planningService.getPlanningByEventId(eventId);

    // Check ownership (unless admin)
    if (req.user.role !== 'ADMIN' && planning.authId !== req.user.authId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own plannings.',
      });
    }

    // Delete banner from Cloudinary if present
    if (planning.eventBanner?.publicId) {
      try {
        await bannerUploadService.deleteBanner(planning.eventBanner.publicId);
      } catch (bannerError) {
        logger.error('Failed to delete banner from Cloudinary:', bannerError);
        // Don't block deletion if banner cleanup fails
      }
    }

    const result = await planningService.deletePlanning(eventId);

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error('Error in deletePlanning:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get planning statistics (Admin/Manager)
 * GET /planning/stats
 */
const getPlanningStats = async (req, res) => {
  try {
    const stats = await planningService.getPlanningStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Error in getPlanningStats:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createPlanning,
  getMyPlannings,
  getPlanningByEventId,
  getAllPlannings,
  updatePlanningStatus,
  deletePlanning,
  getPlanningStats,
};
