const Promote = require('../models/Promote');
const Planning = require('../models/Planning');
const logger = require('../utils/logger');
const promoteService = require('../services/promoteService');
const planningService = require('../services/planningService');
const { CATEGORY, STATUS } = require('../utils/planningConstants');
const { PROMOTE_STATUS } = require('../utils/promoteConstants');

const { getManagerAutoAssignConfig } = require('./managerAutoAssign/config');
const { createJobMetrics } = require('./managerAutoAssign/metrics');
const { ManagerCache } = require('./managerAutoAssign/managerCache');
const { getRedisClient } = require('./managerAutoAssign/redisClient');
const { acquireDistributedLock } = require('./managerAutoAssign/distributedLock');
const { RoundRobinCursorStore } = require('./managerAutoAssign/roundRobinCursorStore');
const { pickLeastLoadedManagerId, pickRoundRobinManagerId } = require('./managerAutoAssign/strategy');
const { buildActiveLoadByManagerId } = require('./managerAutoAssign/loadTracker');

const DEPARTMENT_PUBLIC = 'Public Event';
const DEPARTMENT_PRIVATE = 'Private Event';

const REQUIRED_DEPARTMENT_BY_PLANNING_CATEGORY = {
  [CATEGORY.PUBLIC]: DEPARTMENT_PUBLIC,
  [CATEGORY.PRIVATE]: DEPARTMENT_PRIVATE,
};

const normalizeLoose = (value) => String(value || '').trim().toLowerCase();

const promoteCandidateFilter = {
  assignedManagerId: null,
  eventStatus: { $ne: PROMOTE_STATUS.COMPLETE },
  'adminDecision.status': 'APPROVED',
  'adminDecision.decidedAt': { $ne: null },
};

const planningCandidateFilter = {
  assignedManagerId: null,
  status: { $nin: [STATUS.COMPLETED, STATUS.REJECTED] },
  $or: [{ vendorSelectionId: { $ne: null } }, { isPaid: true }],
};

const managerCacheSingleton = new ManagerCache({ ttlMs: 5 * 60 * 1000, fetchLimit: 500 });

let intervalHandle = null;
let running = false;

const runOnce = async () => {
  if (running) return;
  running = true;

  const config = getManagerAutoAssignConfig();
  const metrics = createJobMetrics();

  let releaseLock = async () => {};

  try {
    if (!config.enabled) return;

    // Fast pre-check: avoid external calls and heavy queries if there's nothing to do.
    const [hasPromote, hasPlanning] = await Promise.all([
      Promote.exists(promoteCandidateFilter),
      Planning.exists(planningCandidateFilter),
    ]);

    if (!hasPromote && !hasPlanning) return;

    // Optional distributed lock (Redis). If configured and lock is held by another instance, skip.
    let redis = null;
    if (config.distributedLock.enabled && config.distributedLock.redisUrl) {
      redis = await getRedisClient({ redisUrl: config.distributedLock.redisUrl });
    }

    if (config.distributedLock.enabled && config.distributedLock.redisUrl) {
      if (!redis) {
        logger.warn('Manager auto-assign: Redis configured but unavailable; continuing without distributed lock');
      } else {
        const lock = await acquireDistributedLock({
          redis,
          key: config.distributedLock.key,
          ttlMs: config.distributedLock.ttlMs,
          metrics,
        });
        releaseLock = lock.release;
        if (!lock.acquired) return;
      }
    }

    // Manager cache (5 min TTL) to reduce user-service load.
    managerCacheSingleton.ttlMs = config.managerCacheTtlMs;
    managerCacheSingleton.fetchLimit = config.managerFetchLimit;

    let managerBuckets;
    try {
      const { buckets, fromCache } = await managerCacheSingleton.getEligibleManagerBuckets();
      managerBuckets = buckets;
      metrics.counters.managerCache.hit = fromCache;
      metrics.counters.managerCache.miss = !fromCache;
    } catch (err) {
      metrics.counters.managerCache.errors += 1;
      logger.warn(`Manager auto-assign: manager cache unavailable: ${err.message}`);
      return;
    }

    const eligibleManagerIds = Array.from(managerBuckets.values()).flat();
    const unavailableIds = new Set(await promoteService.getUnavailableManagerIds());
    const assignedThisRunById = new Map();

    const cursorStore = new RoundRobinCursorStore({
      redis: redis || null,
      keyPrefix: config.roundRobin.cursorKeyPrefix,
    });

    const loadById =
      config.strategy === 'least_loaded'
        ? await buildActiveLoadByManagerId({ eligibleManagerIds })
        : new Map();

    const pickManagerId = async ({ deptKey, managerIds }) => {
      if (config.strategy === 'round_robin') {
        const { managerId } = await pickRoundRobinManagerId({
          deptKey,
          managerIds,
          unavailableIds,
          cursorStore,
        });
        return managerId;
      }

      return pickLeastLoadedManagerId({
        managerIds,
        unavailableIds,
        loadById,
        assignedThisRunById,
      });
    };

    const bumpAssignedLoad = (managerId) => {
      const key = String(managerId);
      assignedThisRunById.set(key, (assignedThisRunById.get(key) || 0) + 1);
      unavailableIds.add(key);
    };

    let assignedTotal = 0;

    // 1) Promote (Public Event)
    if (hasPromote && assignedTotal < config.maxAssignmentsPerRun) {
      const candidates = await Promote.find(promoteCandidateFilter)
        .sort({ 'adminDecision.decidedAt': 1 })
        .limit(config.queryLimitPerType)
        .select('eventId')
        .lean();

      metrics.counters.promote.candidatesFetched = candidates?.length || 0;

      const deptKey = normalizeLoose(DEPARTMENT_PUBLIC);
      const managerIds = managerBuckets.get(deptKey) || [];

      for (const candidate of candidates || []) {
        if (assignedTotal >= config.maxAssignmentsPerRun) break;

        const managerId = await pickManagerId({ deptKey, managerIds });
        if (!managerId) {
          metrics.counters.promote.skippedNoManager += 1;
          logger.warn('Auto-assign (promote): no available managers');
          break;
        }

        try {
          const result = await promoteService.tryAutoAssignManager(candidate.eventId, managerId, {
            assignedByAuthId: config.assignedByAuthId,
          });

          if (result?.assigned) {
            bumpAssignedLoad(managerId);
            assignedTotal += 1;
            metrics.counters.promote.assigned += 1;
            logger.info(`Auto-assigned manager ${managerId} to promote ${candidate.eventId}`);
          } else {
            metrics.counters.promote.skippedAlreadyAssigned += 1;
          }
        } catch (error) {
          metrics.counters.promote.failed += 1;
          logger.warn(`Auto-assign (promote) failed for ${candidate.eventId}: ${error.message}`);
        }
      }
    }

    // 2) Planning (Public vs Private)
    if (hasPlanning && assignedTotal < config.maxAssignmentsPerRun) {
      const candidates = await Planning.find(planningCandidateFilter)
        .sort({ createdAt: 1 })
        .limit(config.queryLimitPerType)
        .select('eventId category')
        .lean();

      metrics.counters.planning.candidatesFetched = candidates?.length || 0;

      for (const candidate of candidates || []) {
        if (assignedTotal >= config.maxAssignmentsPerRun) break;

        const requiredDepartment = REQUIRED_DEPARTMENT_BY_PLANNING_CATEGORY[candidate?.category] || null;
        if (!requiredDepartment) continue;

        const deptKey = normalizeLoose(requiredDepartment);
        const managerIds = managerBuckets.get(deptKey) || [];

        const managerId = await pickManagerId({ deptKey, managerIds });
        if (!managerId) {
          metrics.counters.planning.skippedNoManager += 1;
          logger.warn(`Auto-assign (planning): no available managers for department ${requiredDepartment}`);
          continue;
        }

        try {
          const result = await planningService.tryAutoAssignPlanningManager(candidate.eventId, managerId);
          if (result?.assigned) {
            bumpAssignedLoad(managerId);
            assignedTotal += 1;
            metrics.counters.planning.assigned += 1;
            logger.info(`Auto-assigned manager ${managerId} to planning ${candidate.eventId}`);
          } else {
            metrics.counters.planning.skippedAlreadyAssigned += 1;
          }
        } catch (error) {
          metrics.counters.planning.failed += 1;
          logger.warn(`Auto-assign (planning) failed for ${candidate.eventId}: ${error.message}`);
        }
      }
    }

    if (config.logSummary) {
      const summary = metrics.finish();
      logger.info('Manager auto-assign summary', summary);
    }
  } catch (error) {
    logger.error('Manager auto-assign job failed:', error);
  } finally {
    try {
      await releaseLock();
    } catch (_) {
      // ignore
    }
    running = false;
  }
};

const startManagerAutoAssignJob = () => {
  const config = getManagerAutoAssignConfig();
  if (!config.enabled) {
    logger.info('Manager auto-assign job disabled');
    return;
  }

  if (intervalHandle) return;

  logger.info(
    `Manager auto-assign job started (interval=${config.intervalMs}ms, strategy=${config.strategy}, maxPerRun=${config.maxAssignmentsPerRun})`
  );

  intervalHandle = setInterval(() => {
    runOnce().catch((err) => logger.error('Manager auto-assign tick failed:', err));
  }, config.intervalMs);

  // Run soon after startup.
  setTimeout(() => {
    runOnce().catch(() => null);
  }, 5_000);
};

const stopManagerAutoAssignJob = () => {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('Manager auto-assign job stopped');
};

module.exports = {
  startManagerAutoAssignJob,
  stopManagerAutoAssignJob,
  runOnce,
};
