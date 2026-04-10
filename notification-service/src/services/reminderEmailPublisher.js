const kafkaConfig = require('../config/kafka');
const logger = require('../utils/logger');

const EVENT_TOPIC = process.env.KAFKA_EVENT_TOPIC || 'event_events';

const publishTicketReminderEmailRequested = async ({
  recipientAuthId,
  eventId,
  eventTitle,
  eventStartAt,
  offsetHours,
  actionUrl = null,
  metadata = {},
  dedupeKey,
} = {}) => {
  const authId = String(recipientAuthId || '').trim();
  const normalizedEventId = String(eventId || '').trim();
  const normalizedDedupeKey = String(dedupeKey || '').trim();
  const safeOffsetHours = Number(offsetHours || 0);

  if (!authId || !normalizedEventId || !eventStartAt || !normalizedDedupeKey) {
    return;
  }

  const payload = {
    type: 'TICKET_EVENT_REMINDER_EMAIL_REQUESTED',
    eventId: normalizedEventId,
    authId,
    eventTitle: String(eventTitle || '').trim() || 'Your event',
    eventStartAt,
    reminderOffsetHours: safeOffsetHours,
    actionUrl: actionUrl ? String(actionUrl).trim() : null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    dedupeKey: `${normalizedDedupeKey}:EMAIL`,
    requestedAt: new Date().toISOString(),
  };

  try {
    await kafkaConfig.sendEvent({
      topic: EVENT_TOPIC,
      key: authId,
      payload,
    });
  } catch (error) {
    logger.warn('Failed to publish 48-hour reminder email request', {
      eventId: normalizedEventId,
      authId,
      message: error?.message || String(error),
    });
  }
};

module.exports = {
  publishTicketReminderEmailRequested,
};
