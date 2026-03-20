/**
 * Constants for the Promote (public event promoter) domain
 */

const PROMOTE_EVENT_CATEGORIES = [
  'Concert',
  'Festival',
  'Exhibition',
  'Workshop',
  'Seminar',
  'Other',
];

const PROMOTION_PACKAGES = [
  'featured placement',
  'email blast',
  'social synergy',
  'advanced analytics',
];

const PROMOTE_STATUS = {
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',  // platformFeePaid = false
  MANAGER_UNASSIGNED: 'MANAGER_UNASSIGNED', // paid, no manager
  IN_REVIEW: 'IN_REVIEW',                // paid + manager assigned
  LIVE: 'LIVE',                          // approved by manager
  COMPLETE: 'COMPLETE',                  // event ended, closed by manager
};

const PROMOTE_STATUS_VALUES = Object.values(PROMOTE_STATUS);

// Promote approval workflow (adminDecision.status)
const ADMIN_DECISION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

const ADMIN_DECISION_STATUS_VALUES = Object.values(ADMIN_DECISION_STATUS);

const TICKET_STATUS = {
  READY: 'READY',           // sale window not started yet
  LIVE: 'LIVE',             // currently on sale
  SOLD_OUT: 'SOLD_OUT',     // all tickets sold
  SALES_ENDED: 'SALES_ENDED', // sale window has closed
};

const SERVICE_CHARGE_RATE = 0.025; // 2.5%

module.exports = {
  PROMOTE_EVENT_CATEGORIES,
  PROMOTION_PACKAGES,
  PROMOTE_STATUS,
  PROMOTE_STATUS_VALUES,
  ADMIN_DECISION_STATUS,
  ADMIN_DECISION_STATUS_VALUES,
  TICKET_STATUS,
  SERVICE_CHARGE_RATE,
};
