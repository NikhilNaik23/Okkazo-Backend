const express = require('express');
const configController = require('../controllers/configController');
const { authorizeRoles, isAdmin } = require('../middleware/authorization');

const router = express.Router();

// GET /config/fees — all authenticated roles
router.get(
  '/config/fees',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  configController.getFees
);

// PATCH /config/fees — admin only
router.patch(
  '/config/fees',
  isAdmin,
  configController.updateFees
);

// GET /config/promotions — all authenticated roles
router.get(
  '/config/promotions',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  configController.getPromotions
);

// PATCH /config/promotions — admin only
router.patch(
  '/config/promotions',
  isAdmin,
  configController.updatePromotions
);

// GET /config/refund-policy — all authenticated roles
router.get(
  '/config/refund-policy',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  configController.getRefundPolicy
);

// PATCH /config/refund-policy — Revenue Ops specialist manager or admin
router.patch(
  '/config/refund-policy',
  authorizeRoles(['ADMIN', 'MANAGER']),
  configController.updateRefundPolicy
);

// GET /config/ticket-refund-policy — all authenticated roles
router.get(
  '/config/ticket-refund-policy',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  configController.getTicketRefundPolicy
);

// PATCH /config/ticket-refund-policy — Revenue Ops specialist manager or admin
router.patch(
  '/config/ticket-refund-policy',
  authorizeRoles(['ADMIN', 'MANAGER']),
  configController.updateTicketRefundPolicy
);

// GET /config/manager-autoassign — admin only
router.get(
  '/config/manager-autoassign',
  isAdmin,
  configController.getManagerAutoAssign
);

// PATCH /config/manager-autoassign — admin only
router.patch(
  '/config/manager-autoassign',
  isAdmin,
  configController.updateManagerAutoAssign
);

module.exports = router;
