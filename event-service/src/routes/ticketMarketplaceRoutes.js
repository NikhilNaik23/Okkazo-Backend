const express = require('express');
const ticketMarketplaceController = require('../controllers/ticketMarketplaceController');
const { authorizeRoles } = require('../middleware/authorization');

const router = express.Router();

// GET /tickets/marketplace/events
// Public-event feed for user dashboard (planning public + promote)
router.get(
  '/tickets/marketplace/events',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  ticketMarketplaceController.getTicketMarketplaceEvents
);

router.get(
  '/tickets/my/interests',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  ticketMarketplaceController.getMyTicketInterests
);

module.exports = router;
