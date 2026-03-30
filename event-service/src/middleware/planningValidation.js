const Joi = require('joi');
const {
  CATEGORY,
  PRIVATE_EVENT_TYPES,
  PUBLIC_EVENT_TYPES,
  SERVICE_OPTIONS,
  PUBLIC_PROMOTION_OPTIONS,
} = require('../utils/planningConstants');
const promotionConfigService = require('../services/promotionConfigService');
const logger = require('../utils/logger');
const { toIstDayString } = require('../utils/istDateTime');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET = '+05:30';

const toSafeInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

const getInclusiveIstDaysInRange = (startAt, endAt) => {
  const startDay = toIstDayString(startAt);
  const endDay = toIstDayString(endAt || startAt);
  if (!startDay || !endDay) return [];

  const start = new Date(`${startDay}T00:00:00${IST_OFFSET}`);
  const end = new Date(`${endDay}T00:00:00${IST_OFFSET}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const min = start.getTime() <= end.getTime() ? start : end;
  const max = start.getTime() <= end.getTime() ? end : start;

  const days = [];
  const cursor = new Date(min.getTime());
  let guard = 0;
  while (cursor.getTime() <= max.getTime() && guard < 400) {
    const day = toIstDayString(cursor);
    if (day) days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }

  return days;
};

const deriveEventField = (body) => {
  if (!body || typeof body !== 'object') return undefined;

  const direct = body.eventField ?? body.field;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const interests = body.interests;
  if (Array.isArray(interests)) {
    const first = interests.find((v) => typeof v === 'string' && v.trim());
    return first ? first.trim() : undefined;
  }
  if (typeof interests === 'string' && interests.trim()) return interests.trim();

  return undefined;
};

/**
 * Common fields shared by both private and public plannings
 */
const commonFields = {
  category: Joi.string()
    .valid(CATEGORY.PUBLIC, CATEGORY.PRIVATE)
    .required()
    .messages({ 'any.only': 'category must be either "public" or "private"' }),

  eventTitle: Joi.string().trim().min(2).max(200).required(),

  eventType: Joi.string().trim().required(),

  // Domain / industry focus of the event (UI calls this "Field")
  eventField: Joi.string().trim().max(120).allow(null, ''),

  customEventType: Joi.string().trim().max(120).allow(null, ''),

  eventDescription: Joi.string().trim().max(1000).allow(null, ''),

  location: Joi.object({
    name: Joi.string().trim().required(),
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
  }).required(),

  selectedServices: Joi.array()
    .items(Joi.string().valid(...SERVICE_OPTIONS))
    .min(1)
    .required()
    .messages({ 'array.min': 'At least one service must be selected' }),

  platformFeePaid: Joi.boolean().default(false),
};

/**
 * Private planning schema
 */
const privatePlanningSchema = Joi.object({
  ...commonFields,
  category: Joi.string().valid(CATEGORY.PRIVATE).required(),
  eventType: Joi.string()
    .valid(...PRIVATE_EVENT_TYPES)
    .required(),
  eventDate: Joi.date().iso().required().messages({
    'date.base': 'eventDate must be a valid date',
    'any.required': 'eventDate is required for private events',
  }),
  eventTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .required()
    .messages({
      'string.pattern.base': 'eventTime must be in HH:mm format',
      'any.required': 'eventTime is required for private events',
    }),
  guestCount: Joi.number().integer().min(1).required().messages({
    'number.min': 'guestCount must be at least 1',
    'any.required': 'guestCount is required for private events',
  }),
});

/**
 * Public planning schema
 *
 * Note: eventBanner is NOT validated here — it arrives as a multipart file
 * and is processed by the multer middleware + bannerUploadService.
 * The Cloudinary URL is attached to the planning in the controller.
 */
const publicPlanningSchema = Joi.object({
  ...commonFields,
  category: Joi.string().valid(CATEGORY.PUBLIC).required(),
  eventType: Joi.string()
    .valid(...PUBLIC_EVENT_TYPES)
    .required(),
  eventDescription: Joi.string().trim().min(1).max(1000).required().messages({
    'any.required': 'eventDescription is required for public events',
    'string.max': 'eventDescription must be at most 1000 characters',
  }),
  schedule: Joi.object({
    startAt: Joi.date().iso().required(),
    endAt: Joi.date().iso().greater(Joi.ref('startAt')).required(),
  }).required(),
  ticketAvailability: Joi.object({
    startAt: Joi.date().iso().required(),
    endAt: Joi.date().iso().greater(Joi.ref('startAt')).required(),
  }).required(),
  tickets: Joi.object({
    totalTickets: Joi.number().integer().min(1).required(),
    ticketType: Joi.string().valid('free', 'paid').required(),
    tiers: Joi.array()
      .items(
        Joi.object({
          tierName: Joi.string().trim().required(),
          ticketPrice: Joi.number().min(0).required(),
          ticketCount: Joi.number().integer().min(1).required(),
        })
      )
      .default([]),
    dayWiseAllocations: Joi.array()
      .items(
        Joi.object({
          day: Joi.string().pattern(DAY_RE).required(),
          ticketCount: Joi.number().integer().min(1).required(),
          tierBreakdown: Joi.array()
            .items(
              Joi.object({
                tierName: Joi.string().trim().required(),
                ticketCount: Joi.number().integer().min(0).required(),
              })
            )
            .default([]),
        })
      )
      .min(1)
      .required(),
  }).required(),
  promotionType: Joi.array()
    .items(Joi.string())
    .default([]),
}).custom((value, helpers) => {
  const expectedDays = getInclusiveIstDaysInRange(value?.schedule?.startAt, value?.schedule?.endAt);
  if (expectedDays.length === 0) {
    return helpers.message('tickets.dayWiseAllocations cannot be validated because schedule range is invalid');
  }

  const allocations = Array.isArray(value?.tickets?.dayWiseAllocations)
    ? value.tickets.dayWiseAllocations
    : [];

  const totalTickets = Number(value?.tickets?.totalTickets || 0);
  const seen = new Set();
  for (const row of allocations) {
    const day = String(row?.day || '').trim();
    if (!DAY_RE.test(day)) {
      return helpers.message('tickets.dayWiseAllocations.day must be in YYYY-MM-DD format');
    }
    if (seen.has(day)) {
      return helpers.message('tickets.dayWiseAllocations cannot contain duplicate days');
    }
    seen.add(day);

    const dayCount = Number(row?.ticketCount || 0);
    if (!Number.isFinite(dayCount) || dayCount < 1) {
      return helpers.message('tickets.dayWiseAllocations.ticketCount must be at least 1 for each day');
    }
    if (totalTickets > 0 && dayCount > totalTickets) {
      return helpers.message('tickets.dayWiseAllocations.ticketCount cannot exceed tickets.totalTickets');
    }
  }

  if (seen.size !== expectedDays.length) {
    return helpers.message('tickets.dayWiseAllocations must include every day in the event schedule range');
  }

  const missing = expectedDays.find((day) => !seen.has(day));
  if (missing) {
    return helpers.message(`tickets.dayWiseAllocations is missing schedule day ${missing}`);
  }

  const hasExtra = Array.from(seen).some((day) => !expectedDays.includes(day));
  if (hasExtra) {
    return helpers.message('tickets.dayWiseAllocations contains days outside the event schedule range');
  }

  const ticketType = String(value?.tickets?.ticketType || '').trim().toLowerCase();
  const tiers = Array.isArray(value?.tickets?.tiers) ? value.tickets.tiers : [];
  const tierTargets = new Map();

  if (ticketType === 'paid') {
    for (const tier of tiers) {
      const tierName = String(tier?.tierName || '').trim();
      if (!tierName) {
        return helpers.message('tickets.tiers.tierName is required for paid events');
      }
      if (tierTargets.has(tierName)) {
        return helpers.message('tickets.tiers cannot contain duplicate tierName values');
      }
      tierTargets.set(tierName, toSafeInt(tier?.ticketCount));
    }

    const tierTotals = Object.fromEntries(Array.from(tierTargets.keys()).map((name) => [name, 0]));

    for (const row of allocations) {
      const day = String(row?.day || '').trim();
      const dayCount = toSafeInt(row?.ticketCount);
      const breakdown = Array.isArray(row?.tierBreakdown) ? row.tierBreakdown : [];

      if (breakdown.length !== tierTargets.size) {
        return helpers.message(`tickets.dayWiseAllocations.tierBreakdown must include every tier for day ${day}`);
      }

      let dayTierTotal = 0;
      const dayTierSeen = new Set();
      for (const item of breakdown) {
        const tierName = String(item?.tierName || '').trim();
        const itemCount = toSafeInt(item?.ticketCount);

        if (!tierTargets.has(tierName)) {
          return helpers.message(`tickets.dayWiseAllocations.tierBreakdown contains unknown tierName ${tierName}`);
        }
        if (dayTierSeen.has(tierName)) {
          return helpers.message(`tickets.dayWiseAllocations.tierBreakdown cannot contain duplicate tierName values for day ${day}`);
        }

        dayTierSeen.add(tierName);
        dayTierTotal += itemCount;
        tierTotals[tierName] += itemCount;
      }

      if (dayTierTotal !== dayCount) {
        return helpers.message(`tickets.dayWiseAllocations.tierBreakdown total must equal ticketCount for day ${day}`);
      }
    }

    for (const [tierName, targetCount] of tierTargets.entries()) {
      if (toSafeInt(tierTotals[tierName]) !== toSafeInt(targetCount)) {
        return helpers.message(`tickets.dayWiseAllocations.tierBreakdown total for ${tierName} must match tickets.tiers.ticketCount`);
      }
    }
  }

  if (ticketType === 'free') {
    const hasTierBreakdown = allocations.some((row) => Array.isArray(row?.tierBreakdown) && row.tierBreakdown.length > 0);
    if (hasTierBreakdown) {
      return helpers.message('tickets.dayWiseAllocations.tierBreakdown must be empty for free events');
    }
  }

  return value;
});

/**
 * Middleware to validate planning creation request
 *
 * For multipart/form-data requests, nested objects (location, schedule, etc.)
 * arrive as JSON strings and must be parsed before validation.
 */
const validateCreatePlanning = async (req, res, next) => {
  // Parse JSON string fields that arrive via multipart/form-data
  parseJsonFields(req);

  // Normalize the various possible frontend names into one persisted field.
  // Frontend may send: eventField (string) OR field (string) OR interests ([string] or string).
  const eventField = deriveEventField(req.body);
  if (eventField) {
    req.body.eventField = eventField;
  }
  // Keep payload tidy; stripUnknown will also remove them.
  delete req.body.field;
  delete req.body.interests;

  const { category } = req.body;

  let allowedPromotionValues = null;
  if (category === CATEGORY.PUBLIC) {
    try {
      const cfg = await promotionConfigService.getPromotions();
      allowedPromotionValues = promotionConfigService.getAllowedActiveValues(cfg.publicPromotionOptions);
    } catch (e) {
      // Fallback so public planning does not break if config is unavailable.
      allowedPromotionValues = Array.isArray(PUBLIC_PROMOTION_OPTIONS) ? PUBLIC_PROMOTION_OPTIONS : [];
    }
  }

  let schema;
  if (category === CATEGORY.PRIVATE) {
    schema = privatePlanningSchema;
  } else if (category === CATEGORY.PUBLIC) {
    schema = publicPlanningSchema.keys({
      promotionType: Joi.array()
        .items(Joi.string().valid(...(allowedPromotionValues || [])))
        .default([])
        .messages({
          'any.only': `promotionType items must be one of: ${(allowedPromotionValues || []).join(', ')}`,
        }),
    });
  } else {
    return res.status(400).json({
      success: false,
      message: 'category must be either "public" or "private"',
    });
  }

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const messages = error.details.map((detail) => detail.message);
    logger.warn('Planning validation failed', { errors: messages });
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: messages,
    });
  }

  req.body = value;
  next();
};

/**
 * When multipart/form-data is used, nested objects come as JSON strings.
 * This helper parses them back into objects so Joi can validate properly.
 */
const parseJsonFields = (req) => {
  const jsonFields = [
    'location',
    'schedule',
    'ticketAvailability',
    'tickets',
    'selectedServices',
    'promotionType',
  ];

  for (const field of jsonFields) {
    if (typeof req.body[field] === 'string') {
      try {
        req.body[field] = JSON.parse(req.body[field]);
      } catch (e) {
        // Leave as-is — Joi will catch the type mismatch
      }
    }
  }

  // Parse simple type coercions for multipart
  if (typeof req.body.platformFeePaid === 'string') {
    req.body.platformFeePaid = req.body.platformFeePaid === 'true';
  }
  // Backward-compat: older clients might still send `isPaid`
  if (typeof req.body.isPaid === 'string') {
    const legacyPaid = req.body.isPaid === 'true';
    // Payment should only ever move forward (false -> true). Do not let legacy `false`
    // overwrite an existing paid flag.
    if (legacyPaid && req.body.platformFeePaid === undefined) {
      req.body.platformFeePaid = true;
    }
    delete req.body.isPaid;
  }
  if (typeof req.body.isPaid === 'boolean') {
    const legacyPaid = req.body.isPaid === true;
    if (legacyPaid && req.body.platformFeePaid === undefined) {
      req.body.platformFeePaid = true;
    }
    delete req.body.isPaid;
  }
  if (typeof req.body.guestCount === 'string') {
    req.body.guestCount = Number(req.body.guestCount);
  }
};

module.exports = {
  validateCreatePlanning,
};
