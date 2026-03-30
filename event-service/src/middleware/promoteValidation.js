const Joi = require('joi');
const { PROMOTE_EVENT_CATEGORIES, PROMOTION_PACKAGES } = require('../utils/promoteConstants');
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

// ─── Tier sub-schema ──────────────────────────────────────────────────────────

const tierSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    'any.required': 'Tier name is required',
  }),
  price: Joi.number().min(0).required().messages({
    'number.min': 'Tier price must be ≥ 0',
    'any.required': 'Tier price is required',
  }),
  quantity: Joi.number().integer().min(1).required().messages({
    'number.min': 'Tier quantity must be at least 1',
    'any.required': 'Tier quantity is required',
  }),
});

// ─── Main promote creation schema ─────────────────────────────────────────────

const createPromoteSchema = Joi.object({
  // Core identity
  eventTitle: Joi.string().trim().min(2).max(200).required().messages({
    'any.required': 'eventTitle is required',
  }),
  eventDescription: Joi.string().trim().min(10).max(2000).required().messages({
    'any.required': 'eventDescription is required',
    'string.min': 'eventDescription must be at least 10 characters',
  }),
  eventCategory: Joi.string()
    .valid(...PROMOTE_EVENT_CATEGORIES)
    .required()
    .messages({
      'any.only': `eventCategory must be one of: ${PROMOTE_EVENT_CATEGORIES.join(', ')}`,
      'any.required': 'eventCategory is required',
    }),

  // Domain / industry focus of the event (UI calls this "Field")
  eventField: Joi.string().trim().max(120).allow(null, '').optional(),
  customCategory: Joi.when('eventCategory', {
    is: 'Other',
    then: Joi.string().trim().max(120).required().messages({
      'any.required': 'customCategory is required when eventCategory is Other',
    }),
    otherwise: Joi.string().trim().max(120).allow(null, '').optional(),
  }),

  // Tickets
  tickets: Joi.object({
    noOfTickets: Joi.number().integer().min(1).required().messages({
      'any.required': 'tickets.noOfTickets is required',
    }),
    ticketType: Joi.string().valid('free', 'paid').required().messages({
      'any.required': 'tickets.ticketType is required',
    }),
    tiers: Joi.when('ticketType', {
      is: 'paid',
      then: Joi.array().items(tierSchema).min(1).required().messages({
        'array.min': 'At least one tier is required for paid events',
      }),
      otherwise: Joi.array().items(tierSchema).max(0).default([]).messages({
        'array.max': 'Tiers must be empty for free events',
      }),
    }),
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

  // Schedule
  schedule: Joi.object({
    startAt: Joi.date().iso().required().messages({
      'any.required': 'schedule.startAt is required',
    }),
    endAt: Joi.date().iso().greater(Joi.ref('startAt')).required().messages({
      'any.required': 'schedule.endAt is required',
      'date.greater': 'schedule.endAt must be after schedule.startAt',
    }),
  }).required(),

  // Ticket availability
  ticketAvailability: Joi.object({
    startAt: Joi.date().iso().required().messages({
      'any.required': 'ticketAvailability.startAt is required',
    }),
    endAt: Joi.date().iso().greater(Joi.ref('startAt')).required().messages({
      'any.required': 'ticketAvailability.endAt is required',
      'date.greater': 'ticketAvailability.endAt must be after ticketAvailability.startAt',
    }),
  }).required(),

  // Venue
  venue: Joi.object({
    locationName: Joi.string().trim().required().messages({
      'any.required': 'venue.locationName is required',
    }),
    latitude: Joi.number().min(-90).max(90).required().messages({
      'any.required': 'venue.latitude is required',
    }),
    longitude: Joi.number().min(-180).max(180).required().messages({
      'any.required': 'venue.longitude is required',
    }),
  }).required(),

  // Promotions (validated dynamically in middleware)
  promotion: Joi.array().items(Joi.string()).default([]),
}).custom((value, helpers) => {
  const expectedDays = getInclusiveIstDaysInRange(value?.schedule?.startAt, value?.schedule?.endAt);
  if (expectedDays.length === 0) {
    return helpers.message('tickets.dayWiseAllocations cannot be validated because schedule range is invalid');
  }

  const allocations = Array.isArray(value?.tickets?.dayWiseAllocations)
    ? value.tickets.dayWiseAllocations
    : [];
  const totalTickets = Number(value?.tickets?.noOfTickets || 0);
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
      return helpers.message('tickets.dayWiseAllocations.ticketCount cannot exceed tickets.noOfTickets');
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
      const tierName = String(tier?.name || '').trim();
      if (!tierName) {
        return helpers.message('tickets.tiers.name is required for paid events');
      }
      if (tierTargets.has(tierName)) {
        return helpers.message('tickets.tiers cannot contain duplicate name values');
      }
      tierTargets.set(tierName, toSafeInt(tier?.quantity));
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
        return helpers.message(`tickets.dayWiseAllocations.tierBreakdown total for ${tierName} must match tickets.tiers.quantity`);
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

// ─── JSON field list for multipart parsing ────────────────────────────────────

const JSON_FIELDS = [
  'tickets',
  'schedule',
  'ticketAvailability',
  'venue',
  'promotion',
];

// ─── Middleware ───────────────────────────────────────────────────────────────

const validateCreatePromote = async (req, res, next) => {
  // Parse JSON-string fields that come in via multipart/form-data
  for (const field of JSON_FIELDS) {
    if (typeof req.body[field] === 'string') {
      try {
        req.body[field] = JSON.parse(req.body[field]);
      } catch (_) {
        // Leave as-is; Joi will catch the type error
      }
    }
  }

  // Normalize to a single persisted field name.
  const eventField = deriveEventField(req.body);
  if (eventField) {
    req.body.eventField = eventField;
  }
  delete req.body.field;
  delete req.body.interests;

  let allowedPromotionValues;
  try {
    const cfg = await promotionConfigService.getPromotions();
    allowedPromotionValues = promotionConfigService.getAllowedActiveValues(cfg.promotePackages);
  } catch (e) {
    allowedPromotionValues = Array.isArray(PROMOTION_PACKAGES) ? PROMOTION_PACKAGES : [];
  }

  const schema = createPromoteSchema.keys({
    promotion: Joi.array()
      .items(Joi.string().valid(...(allowedPromotionValues || [])))
      .default([])
      .messages({
        'any.only': `promotion items must be one of: ${(allowedPromotionValues || []).join(', ')}`,
      }),
  });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const messages = error.details.map((d) => d.message);
    logger.warn('Promote validation failed', { errors: messages });
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: messages,
    });
  }

  req.body = value;
  next();
};

module.exports = { validateCreatePromote, JSON_FIELDS };
