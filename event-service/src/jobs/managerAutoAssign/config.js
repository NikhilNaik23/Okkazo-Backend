'use strict';

const DEFAULTS = {
  intervalMs: 60 * 1000,
  queryLimitPerType: 30,
  maxAssignmentsPerRun: 40,
  managerFetchLimit: 500,
  managerCacheTtlMs: 5 * 60 * 1000,
  distributedLockTtlMs: 55 * 1000,
  strategy: 'least_loaded', // least_loaded | round_robin
};

const clampInt = (value, { min, max, fallback }) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return Math.max(min, Math.min(max, rounded));
};

const normalizeLoose = (value) => String(value || '').trim().toLowerCase();

const parseStrategy = (raw) => {
  const normalized = normalizeLoose(raw);
  if (normalized === 'round_robin' || normalized === 'round-robin' || normalized === 'rr') return 'round_robin';
  if (normalized === 'least_loaded' || normalized === 'least-loaded' || normalized === 'least') return 'least_loaded';
  return DEFAULTS.strategy;
};

const getManagerAutoAssignConfig = () => {
  const enabled = normalizeLoose(process.env.ENABLE_MANAGER_AUTOASSIGN || 'true') !== 'false';

  const intervalMs = Math.max(10_000, Number(process.env.MANAGER_AUTOASSIGN_INTERVAL_MS || DEFAULTS.intervalMs));

  const queryLimitPerType = clampInt(process.env.MANAGER_AUTOASSIGN_QUERY_LIMIT, {
    min: 1,
    max: 200,
    fallback: DEFAULTS.queryLimitPerType,
  });

  const maxAssignmentsPerRun = clampInt(process.env.MANAGER_AUTOASSIGN_MAX_ASSIGNMENTS_PER_RUN, {
    min: 1,
    max: 200,
    fallback: DEFAULTS.maxAssignmentsPerRun,
  });

  const managerFetchLimit = clampInt(process.env.MANAGER_AUTOASSIGN_MANAGER_FETCH_LIMIT, {
    min: 1,
    max: 2000,
    fallback: DEFAULTS.managerFetchLimit,
  });

  const managerCacheTtlMs = clampInt(process.env.MANAGER_AUTOASSIGN_MANAGER_CACHE_TTL_MS, {
    min: 10_000,
    max: 60 * 60 * 1000,
    fallback: DEFAULTS.managerCacheTtlMs,
  });

  const distributedLockEnabled = normalizeLoose(process.env.MANAGER_AUTOASSIGN_DISTRIBUTED_LOCK || 'true') !== 'false';
  const redisUrl = process.env.REDIS_URL || process.env.MANAGER_AUTOASSIGN_REDIS_URL || null;

  const distributedLockKey = String(
    process.env.MANAGER_AUTOASSIGN_LOCK_KEY || 'event-service:manager-autoassign:lock'
  ).trim();

  const distributedLockTtlMs = clampInt(process.env.MANAGER_AUTOASSIGN_LOCK_TTL_MS, {
    min: 5_000,
    max: 10 * 60 * 1000,
    fallback: Math.min(DEFAULTS.distributedLockTtlMs, Math.max(5_000, intervalMs - 2_000)),
  });

  const roundRobinCursorKeyPrefix = String(
    process.env.MANAGER_AUTOASSIGN_RR_CURSOR_KEY_PREFIX || 'event-service:manager-autoassign:rr'
  ).trim();

  const strategy = parseStrategy(process.env.MANAGER_AUTOASSIGN_STRATEGY);

  const assignedByAuthId = String(process.env.MANAGER_AUTOASSIGN_AUTH_ID || 'system:autoassign').trim();

  const logSummary = normalizeLoose(process.env.MANAGER_AUTOASSIGN_LOG_SUMMARY || 'true') !== 'false';

  return {
    enabled,
    intervalMs,
    queryLimitPerType,
    maxAssignmentsPerRun,
    managerFetchLimit,
    managerCacheTtlMs,
    strategy,
    assignedByAuthId,
    logSummary,
    distributedLock: {
      enabled: distributedLockEnabled,
      redisUrl,
      key: distributedLockKey,
      ttlMs: distributedLockTtlMs,
    },
    roundRobin: {
      cursorKeyPrefix: roundRobinCursorKeyPrefix,
    },
  };
};

module.exports = {
  getManagerAutoAssignConfig,
};
