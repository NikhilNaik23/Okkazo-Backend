const Promote = require('../models/Promote');
const { publishEvent } = require('../kafka/eventProducer');
const logger = require('../utils/logger');
const { PROMOTE_STATUS } = require('../utils/promoteConstants');

let intervalHandle = null;
let startupTimeoutHandle = null;
let running = false;

const normalizeString = (value) => String(value || '').trim() || null;

const getConfig = () => {
  const enabled = String(process.env.PROMOTE_AUTO_LIVE_ENABLED || 'true').trim().toLowerCase() !== 'false';
  const intervalMs = Math.max(10_000, Number(process.env.PROMOTE_AUTO_LIVE_INTERVAL_MS || 60_000));
  const queryLimit = Math.min(500, Math.max(1, Number(process.env.PROMOTE_AUTO_LIVE_QUERY_LIMIT || 100)));
  const maxTransitionsPerRun = Math.min(500, Math.max(1, Number(process.env.PROMOTE_AUTO_LIVE_MAX_TRANSITIONS_PER_RUN || 100)));
  const updatedBy = normalizeString(process.env.PROMOTE_AUTO_LIVE_UPDATED_BY) || 'system:auto-live';

  return {
    enabled,
    intervalMs,
    queryLimit,
    maxTransitionsPerRun,
    updatedBy,
  };
};

const publishPromoteStatusEvents = async ({ promote, updatedBy }) => {
  const eventId = normalizeString(promote?.eventId);
  if (!eventId) return;

  const payloadBase = {
    eventId,
    authId: normalizeString(promote?.authId),
    eventStatus: PROMOTE_STATUS.LIVE,
    assignedManagerId: normalizeString(promote?.assignedManagerId),
    eventTitle: normalizeString(promote?.eventTitle),
    updatedBy: normalizeString(updatedBy),
  };

  try {
    await publishEvent('PROMOTE_STATUS_UPDATED', payloadBase);
  } catch (error) {
    logger.error(`Failed to publish PROMOTE_STATUS_UPDATED for ${eventId}: ${error.message}`);
  }

  try {
    await publishEvent('EVENT_LIFECYCLE_STATUS_UPDATED', {
      eventId,
      authId: payloadBase.authId,
      status: PROMOTE_STATUS.LIVE,
      eventType: 'promote',
      assignedManagerId: payloadBase.assignedManagerId,
      vendorAuthIds: [],
      eventTitle: payloadBase.eventTitle,
      updatedBy: payloadBase.updatedBy,
      occurredAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`Failed to publish EVENT_LIFECYCLE_STATUS_UPDATED for ${eventId}: ${error.message}`);
  }
};

const runOnce = async () => {
  if (running) return;
  running = true;

  const config = getConfig();

  try {
    if (!config.enabled) return;

    const now = new Date();
    const candidates = await Promote.find({
      eventStatus: PROMOTE_STATUS.CONFIRMED,
      platformFeePaid: true,
      assignedManagerId: { $ne: null },
      'adminDecision.status': 'APPROVED',
      'ticketAvailability.startAt': { $ne: null, $lte: now },
    })
      .sort({ 'ticketAvailability.startAt': 1 })
      .limit(config.queryLimit)
      .select('eventId authId assignedManagerId eventTitle ticketAvailability.startAt')
      .lean();

    let transitioned = 0;

    for (const candidate of candidates || []) {
      if (transitioned >= config.maxTransitionsPerRun) break;

      const eventId = normalizeString(candidate?.eventId);
      if (!eventId) continue;

      try {
        const updateResult = await Promote.updateOne(
          {
            eventId,
            eventStatus: PROMOTE_STATUS.CONFIRMED,
            platformFeePaid: true,
            assignedManagerId: { $ne: null },
            'adminDecision.status': 'APPROVED',
            'ticketAvailability.startAt': { $ne: null, $lte: now },
          },
          {
            $set: {
              eventStatus: PROMOTE_STATUS.LIVE,
            },
          }
        );

        if (updateResult?.modifiedCount !== 1) continue;

        transitioned += 1;
        await publishPromoteStatusEvents({
          promote: candidate,
          updatedBy: config.updatedBy,
        });

        logger.info(`Auto-transitioned promote ${eventId} to LIVE`);
      } catch (error) {
        logger.warn(`Auto-transition to LIVE failed for promote ${eventId}: ${error.message}`);
      }
    }

    if (transitioned > 0) {
      logger.info(`Promote auto-LIVE job transitioned ${transitioned} event(s)`);
    }
  } catch (error) {
    logger.error('Promote auto-LIVE job failed:', error);
  } finally {
    running = false;
  }
};

const startPromoteAutoLiveJob = () => {
  const config = getConfig();
  if (!config.enabled) {
    logger.info('Promote auto-LIVE job disabled');
    return;
  }

  if (intervalHandle) return;

  logger.info(
    `Promote auto-LIVE job started (interval=${config.intervalMs}ms, maxTransitionsPerRun=${config.maxTransitionsPerRun})`
  );

  intervalHandle = setInterval(() => {
    runOnce().catch((err) => logger.error('Promote auto-LIVE tick failed:', err));
  }, config.intervalMs);

  startupTimeoutHandle = setTimeout(() => {
    runOnce().catch(() => null);
  }, 5_000);
};

const stopPromoteAutoLiveJob = () => {
  if (!intervalHandle && !startupTimeoutHandle) return;
  if (startupTimeoutHandle) {
    clearTimeout(startupTimeoutHandle);
    startupTimeoutHandle = null;
  }
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('Promote auto-LIVE job stopped');
};

module.exports = {
  startPromoteAutoLiveJob,
  stopPromoteAutoLiveJob,
  runOnce,
};
