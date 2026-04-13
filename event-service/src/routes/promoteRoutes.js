const express = require('express');
const promoteController = require('../controllers/promoteController');
const { authorizeRoles, isAdminOrManager, isAdmin } = require('../middleware/authorization');
const { validateCreatePromote } = require('../middleware/promoteValidation');
const { promoteUpload } = require('../middleware/upload');

const router = express.Router();

// POST /promote — Create a new promote record (multipart/form-data)
router.post(
  '/promote',
  authorizeRoles(['USER', 'ADMIN', 'MANAGER']),
  promoteUpload,
  validateCreatePromote,
  promoteController.createPromote
);

// GET /promote/me — Get current user's own promote records
router.get(
  '/promote/me',
  authorizeRoles(['USER', 'ADMIN', 'MANAGER']),
  promoteController.getMyPromotes
);

// GET /promote/platform-fee — Get current platform fee (all authenticated users)
router.get(
  '/promote/platform-fee',
  authorizeRoles(['USER', 'ADMIN', 'MANAGER']),
  promoteController.getPlatformFee
);

// PATCH /promote/platform-fee — Update platform fee (Admin only)
router.patch(
  '/promote/platform-fee',
  isAdmin,
  promoteController.updatePlatformFee
);

// GET /promote — Get all promotes (Admin/Manager only)
router.get(
  '/promote',
  isAdminOrManager,
  promoteController.getAllPromotes
);

// GET /promote/admin/dashboard — Admin dashboard lists (Admin only)
router.get(
  '/promote/admin/dashboard',
  isAdmin,
  promoteController.getAdminDashboard
);

// GET /promote/admin/unavailable-managers — Manager ids currently assigned (Admin only)
router.get(
  '/promote/admin/unavailable-managers',
  isAdmin,
  promoteController.getUnavailableManagers
);

// GET /promote/manager/events - Manager's assigned promote events (Manager/Admin)
router.get(
  '/promote/manager/events',
  isAdminOrManager,
  promoteController.getManagerPromoteEvents
);

// GET /promote/manager/refund-requests - Revenue Operations Specialist refund queue (Manager/Admin)
router.get(
  '/promote/manager/refund-requests',
  isAdminOrManager,
  promoteController.getManagerPromoteRefundRequests
);

// PATCH /promote/:eventId/decision — Approve/Reject application (Admin only)
router.patch(
  '/promote/:eventId/decision',
  isAdmin,
  promoteController.decidePromote
);

// GET /promote/:eventId/refund-request - Get cancellation refund request
router.get(
  '/promote/:eventId/refund-request',
  authorizeRoles(['USER', 'ADMIN', 'MANAGER']),
  promoteController.getPromoteRefundRequest
);

// POST /promote/:eventId/refund-request - Create cancellation refund request (Owner)
router.post(
  '/promote/:eventId/refund-request',
  authorizeRoles(['USER', 'ADMIN', 'MANAGER']),
  promoteController.createPromoteRefundRequest
);

// PATCH /promote/:eventId/refund-request - Review cancellation refund request (Revenue Ops/Admin)
router.patch(
  '/promote/:eventId/refund-request',
  isAdminOrManager,
  promoteController.reviewPromoteRefundRequest
);

// GET /promote/:eventId — Get a single promote record
router.get(
  '/promote/:eventId',
  authorizeRoles(['USER', 'ADMIN', 'MANAGER']),
  promoteController.getPromoteByEventId
);

// PATCH /promote/:eventId — Update promote details (Manager/Admin)
router.patch(
  '/promote/:eventId',
  isAdminOrManager,
  promoteController.updatePromoteDetails
);

// POST /promote/:eventId/core-staff - Assign a CORE staff member (Manager/Admin)
router.post(
  '/promote/:eventId/core-staff',
  authorizeRoles(['MANAGER']),
  promoteController.addPromoteCoreStaff
);

// DELETE /promote/:eventId/core-staff/:staffId - Unassign a CORE staff member (Manager/Admin)
router.delete(
  '/promote/:eventId/core-staff/:staffId',
  authorizeRoles(['MANAGER']),
  promoteController.removePromoteCoreStaff
);

// PATCH /promote/:eventId/generated-revenue-payout - Release generated revenue to user (demo)
router.patch(
  '/promote/:eventId/generated-revenue-payout',
  authorizeRoles(['MANAGER', 'ADMIN']),
  promoteController.releasePromoteGeneratedRevenuePayout
);

// PATCH /promote/:eventId/liability-recovery - Initiate creator liability recovery for cancelled promote events
router.patch(
  '/promote/:eventId/liability-recovery',
  authorizeRoles(['MANAGER', 'ADMIN']),
  promoteController.recoverPromoteCancellationLiability
);

// POST /promote/:eventId/promotion-actions/email-blast - Trigger email blast promotion
router.post(
  '/promote/:eventId/promotion-actions/email-blast',
  authorizeRoles(['MANAGER', 'ADMIN']),
  promoteController.triggerPromoteEmailBlastPromotionAction
);

// PATCH /promote/:eventId/status — Update event status (Manager/Admin)
router.patch(
  '/promote/:eventId/status',
  isAdminOrManager,
  promoteController.updatePromoteStatus
);

// PATCH /promote/:eventId/assign — Assign a manager (Admin only)
router.patch(
  '/promote/:eventId/assign',
  isAdmin,
  promoteController.assignManager
);

// PATCH /promote/:eventId/unassign-manager — Unassign a manager (Admin only)
router.patch(
  '/promote/:eventId/unassign-manager',
  isAdmin,
  promoteController.unassignManager
);

// DELETE /promote/:eventId — Delete a promote record (Owner or Admin)
router.delete(
  '/promote/:eventId',
  authorizeRoles(['USER', 'ADMIN', 'MANAGER']),
  promoteController.deletePromote
);

module.exports = router;
