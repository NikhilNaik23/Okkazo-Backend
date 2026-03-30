const PromoteConfig = require('../models/PromoteConfig');
const createApiError = require('../utils/ApiError');

const CONFIG_KEY = 'default';

const getDefaultPlatformFee = () => {
  const fromEnv = Number(process.env.PROMOTE_PLATFORM_FEE || process.env.PROMOTE_PLATFORM_FEE_DEFAULT);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  return 150;
};

const getDefaultServiceChargePercent = () => {
  const fromEnv = Number(process.env.SERVICE_CHARGE_PERCENT || process.env.SERVICE_CHARGE_PERCENT_DEFAULT);
  if (Number.isFinite(fromEnv) && fromEnv >= 0 && fromEnv <= 100) return fromEnv;
  return 2.5;
};

const getDefaultNormalDayMinMultiplier = () => {
  const fromEnv = Number(process.env.NORMAL_DAY_MIN_MULTIPLIER);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 1;
};

const getDefaultNormalDayMaxMultiplier = () => {
  const fromEnv = Number(process.env.NORMAL_DAY_MAX_MULTIPLIER);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 1;
};

const getDefaultHighDemandMinMultiplier = () => {
  const fromEnv = Number(process.env.HIGH_DEMAND_MIN_MULTIPLIER);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 1.5;
};

const getDefaultHighDemandMaxMultiplier = () => {
  const fromEnv = Number(process.env.HIGH_DEMAND_MAX_MULTIPLIER);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 2.25;
};

const buildDemandPricingMultipliers = (cfg) => ({
  normal: {
    min: Number(cfg?.normalDayMinMultiplier),
    max: Number(cfg?.normalDayMaxMultiplier),
  },
  highDemand: {
    min: Number(cfg?.highDemandMinMultiplier),
    max: Number(cfg?.highDemandMaxMultiplier),
  },
});

const getOrCreateConfig = async () => {
  const platformFee = getDefaultPlatformFee();
  const serviceChargePercent = getDefaultServiceChargePercent();
  const normalDayMinMultiplier = getDefaultNormalDayMinMultiplier();
  const normalDayMaxMultiplier = getDefaultNormalDayMaxMultiplier();
  const highDemandMinMultiplier = getDefaultHighDemandMinMultiplier();
  const highDemandMaxMultiplier = getDefaultHighDemandMaxMultiplier();

  const cfg = await PromoteConfig.findOneAndUpdate(
    { key: CONFIG_KEY },
    {
      $setOnInsert: {
        key: CONFIG_KEY,
        platformFee,
        serviceChargePercent,
        normalDayMinMultiplier,
        normalDayMaxMultiplier,
        highDemandMinMultiplier,
        highDemandMaxMultiplier,
      },
    },
    { new: true, upsert: true }
  ).lean();

  // Backfill missing fields for legacy config docs
  const needsBackfill =
    cfg.platformFee === undefined ||
    cfg.platformFee === null ||
    cfg.serviceChargePercent === undefined ||
    cfg.serviceChargePercent === null ||
    cfg.normalDayMinMultiplier === undefined ||
    cfg.normalDayMinMultiplier === null ||
    cfg.normalDayMaxMultiplier === undefined ||
    cfg.normalDayMaxMultiplier === null ||
    cfg.highDemandMinMultiplier === undefined ||
    cfg.highDemandMinMultiplier === null ||
    cfg.highDemandMaxMultiplier === undefined ||
    cfg.highDemandMaxMultiplier === null;

  if (!needsBackfill) return cfg;

  return PromoteConfig.findOneAndUpdate(
    { key: CONFIG_KEY },
    {
      $set: {
        ...(cfg.platformFee === undefined || cfg.platformFee === null ? { platformFee } : {}),
        ...(cfg.serviceChargePercent === undefined || cfg.serviceChargePercent === null ? { serviceChargePercent } : {}),
        ...(cfg.normalDayMinMultiplier === undefined || cfg.normalDayMinMultiplier === null ? { normalDayMinMultiplier } : {}),
        ...(cfg.normalDayMaxMultiplier === undefined || cfg.normalDayMaxMultiplier === null ? { normalDayMaxMultiplier } : {}),
        ...(cfg.highDemandMinMultiplier === undefined || cfg.highDemandMinMultiplier === null ? { highDemandMinMultiplier } : {}),
        ...(cfg.highDemandMaxMultiplier === undefined || cfg.highDemandMaxMultiplier === null ? { highDemandMaxMultiplier } : {}),
      },
    },
    { new: true }
  ).lean();
};

const getFees = async () => {
  const cfg = await getOrCreateConfig();
  return {
    platformFee: cfg.platformFee,
    serviceChargePercent: cfg.serviceChargePercent,
    demandPricingMultipliers: buildDemandPricingMultipliers(cfg),
    updatedAt: cfg.updatedAt,
  };
};

const getPlatformFee = async () => {
  const cfg = await getOrCreateConfig();
  return {
    platformFee: cfg.platformFee,
    updatedAt: cfg.updatedAt,
  };
};

const updatePlatformFee = async ({ platformFee, updatedByAuthId }) => {
  const fee = Number(platformFee);
  if (!Number.isFinite(fee) || fee < 0) {
    throw createApiError(400, 'platformFee must be a non-negative number');
  }

  const updated = await PromoteConfig.findOneAndUpdate(
    { key: CONFIG_KEY },
    {
      $set: { platformFee: fee, updatedByAuthId: updatedByAuthId || null },
      $setOnInsert: { key: CONFIG_KEY, serviceChargePercent: getDefaultServiceChargePercent() },
    },
    { new: true, upsert: true }
  ).lean();

  return {
    platformFee: updated.platformFee,
    serviceChargePercent: updated.serviceChargePercent,
    updatedAt: updated.updatedAt,
    updatedByAuthId: updated.updatedByAuthId,
  };
};

const normalizeMultiplier = (value, fieldName) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw createApiError(400, `${fieldName} must be a positive number`);
  }
  return n;
};

const updateFees = async ({ platformFee, serviceChargePercent, demandPricingMultipliers, updatedByAuthId }) => {
  const updates = {};

  if (platformFee !== undefined) {
    const fee = Number(platformFee);
    if (!Number.isFinite(fee) || fee < 0) {
      throw createApiError(400, 'platformFee must be a non-negative number');
    }
    updates.platformFee = fee;
  }

  if (serviceChargePercent !== undefined) {
    const pct = Number(serviceChargePercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw createApiError(400, 'serviceChargePercent must be between 0 and 100');
    }
    updates.serviceChargePercent = pct;
  }

  if (demandPricingMultipliers !== undefined) {
    if (!demandPricingMultipliers || typeof demandPricingMultipliers !== 'object') {
      throw createApiError(400, 'demandPricingMultipliers must be an object');
    }

    const normal = demandPricingMultipliers.normal;
    const highDemand = demandPricingMultipliers.highDemand;

    if (normal && typeof normal === 'object') {
      if (normal.min !== undefined) {
        updates.normalDayMinMultiplier = normalizeMultiplier(normal.min, 'normal.min');
      }
      if (normal.max !== undefined) {
        updates.normalDayMaxMultiplier = normalizeMultiplier(normal.max, 'normal.max');
      }
    }

    if (highDemand && typeof highDemand === 'object') {
      if (highDemand.min !== undefined) {
        updates.highDemandMinMultiplier = normalizeMultiplier(highDemand.min, 'highDemand.min');
      }
      if (highDemand.max !== undefined) {
        updates.highDemandMaxMultiplier = normalizeMultiplier(highDemand.max, 'highDemand.max');
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    throw createApiError(400, 'No updates provided');
  }

  const existing = await getOrCreateConfig();
  const normalMin = updates.normalDayMinMultiplier ?? Number(existing?.normalDayMinMultiplier);
  const normalMax = updates.normalDayMaxMultiplier ?? Number(existing?.normalDayMaxMultiplier);
  const highMin = updates.highDemandMinMultiplier ?? Number(existing?.highDemandMinMultiplier);
  const highMax = updates.highDemandMaxMultiplier ?? Number(existing?.highDemandMaxMultiplier);

  if (normalMax < normalMin) {
    throw createApiError(400, 'normal.max must be greater than or equal to normal.min');
  }
  if (highMax < highMin) {
    throw createApiError(400, 'highDemand.max must be greater than or equal to highDemand.min');
  }

  updates.updatedByAuthId = updatedByAuthId || null;

  // NOTE: MongoDB disallows updating the same path across operators in one update
  // (e.g., setting platformFee in both $set and $setOnInsert), even though $setOnInsert
  // only applies during inserts.
  const setOnInsert = { key: CONFIG_KEY };
  if (updates.platformFee === undefined) setOnInsert.platformFee = getDefaultPlatformFee();
  if (updates.serviceChargePercent === undefined) setOnInsert.serviceChargePercent = getDefaultServiceChargePercent();
  if (updates.normalDayMinMultiplier === undefined) setOnInsert.normalDayMinMultiplier = getDefaultNormalDayMinMultiplier();
  if (updates.normalDayMaxMultiplier === undefined) setOnInsert.normalDayMaxMultiplier = getDefaultNormalDayMaxMultiplier();
  if (updates.highDemandMinMultiplier === undefined) setOnInsert.highDemandMinMultiplier = getDefaultHighDemandMinMultiplier();
  if (updates.highDemandMaxMultiplier === undefined) setOnInsert.highDemandMaxMultiplier = getDefaultHighDemandMaxMultiplier();

  const updated = await PromoteConfig.findOneAndUpdate(
    { key: CONFIG_KEY },
    { $set: updates, $setOnInsert: setOnInsert },
    { new: true, upsert: true }
  ).lean();

  return {
    platformFee: updated.platformFee,
    serviceChargePercent: updated.serviceChargePercent,
    demandPricingMultipliers: buildDemandPricingMultipliers(updated),
    updatedAt: updated.updatedAt,
    updatedByAuthId: updated.updatedByAuthId,
  };
};

module.exports = {
  getFees,
  updateFees,
  getPlatformFee,
  updatePlatformFee,
  getDefaultPlatformFee,
  getDefaultServiceChargePercent,
  getDefaultNormalDayMinMultiplier,
  getDefaultNormalDayMaxMultiplier,
  getDefaultHighDemandMinMultiplier,
  getDefaultHighDemandMaxMultiplier,
};
