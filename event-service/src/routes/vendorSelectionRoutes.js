const express = require('express');
const vendorSelectionController = require('../controllers/vendorSelectionController');
const { authorizeRoles } = require('../middleware/authorization');

const router = express.Router();

// GET /vendor-selection/:eventId - Get or create vendor selection for planning
router.get(
  '/vendor-selection/:eventId',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  vendorSelectionController.getOrCreateForPlanning
);

// PATCH /vendor-selection/:eventId/services - Update selected services
router.patch(
  '/vendor-selection/:eventId/services',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  vendorSelectionController.updateSelectedServices
);

// PATCH /vendor-selection/:eventId/vendors - Upsert vendor selection info for a service
router.patch(
  '/vendor-selection/:eventId/vendors',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  vendorSelectionController.upsertVendor
);

module.exports = router;
