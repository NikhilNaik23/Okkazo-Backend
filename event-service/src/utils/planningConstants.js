const CATEGORY = {
  PUBLIC: 'public',
  PRIVATE: 'private',
};

const PRIVATE_EVENT_TYPES = [
  'Birthday',
  'Wedding',
  'Anniversary',
  'Party',
  'Dinner',
  'Other',
];

const PUBLIC_EVENT_TYPES = [
  'Concert',
  'Festival',
  'Exhibition',
  'Workshop',
  'Seminar',
  'Other',
];

const SERVICE_OPTIONS = [
  'Venue',
  'Catering & Drinks',
  'Photography',
  'Videography',
  'Decor & Styling',
  'Entertainment & Artists',
  'Makeup & Grooming',
  'Invitations & Printing',
  'Sound & Lighting',
  'Equipment Rental',
  'Security & Safety',
  'Transportation',
  'Live Streaming & Media',
  'Cake & Desserts',
  'Other',
];

const PUBLIC_PROMOTION_OPTIONS = [
  'featured placement',
  'email blast',
  'advance analysis',
  'Social Synergy',
];

const STATUS = {
  IMMEDIATE_ACTION: 'IMMEDIATE ACTION',
  PENDING_APPROVAL: 'PENDING APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
};

const STATUS_VALUES = Object.values(STATUS);

module.exports = {
  CATEGORY,
  PRIVATE_EVENT_TYPES,
  PUBLIC_EVENT_TYPES,
  SERVICE_OPTIONS,
  PUBLIC_PROMOTION_OPTIONS,
  STATUS,
  STATUS_VALUES,
};
