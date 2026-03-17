const express = require('express');
const planningController = require('../controllers/planningController');
const { authorizeRoles, isAdminOrManager } = require('../middleware/authorization');
const { validateCreatePlanning } = require('../middleware/planningValidation');
const { upload } = require('../middleware/upload');

const router = express.Router();

// All routes require at least USER role (gateway already enforces auth)

// POST /planning - Create a new planning
// Uses multer to handle optional eventBanner file upload (public events)
// The banner field name is 'eventBanner'
router.post(
  '/planning',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  upload.single('eventBanner'),
  validateCreatePlanning,
  planningController.createPlanning
);

// GET /planning/stats - Get planning statistics (Admin/Manager only)
router.get(
  '/planning/stats',
  isAdminOrManager,
  planningController.getPlanningStats
);

// GET /planning/me - Get current user's plannings
router.get(
  '/planning/me',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  planningController.getMyPlannings
);

// GET /planning - Get all plannings with filters (Admin/Manager only)
router.get(
  '/planning',
  isAdminOrManager,
  planningController.getAllPlannings
);

// GET /planning/:eventId - Get a single planning by eventId
router.get(
  '/planning/:eventId',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  planningController.getPlanningByEventId
);

// GET /planning/:eventId/vendors - Fetch vendors for a service category
router.get(
  '/planning/:eventId/vendors',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  planningController.getVendorsForPlanning
);

// POST /planning/:eventId/confirm - Confirm finalized selection (Owner)
router.post(
  '/planning/:eventId/confirm',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  planningController.confirmPlanning
);

// PATCH /planning/:eventId/status - Update planning status (Admin/Manager only)
router.patch(
  '/planning/:eventId/status',
  isAdminOrManager,
  planningController.updatePlanningStatus
);

// DELETE /planning/:eventId - Delete a planning
router.delete(
  '/planning/:eventId',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  planningController.deletePlanning
);

module.exports = router;
