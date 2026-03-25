const Planning = require('../models/Planning');
const Promote = require('../models/Promote');
const UserEventTicket = require('../models/UserEventTicket');
const { CATEGORY, STATUS } = require('../utils/planningConstants');
const { ADMIN_DECISION_STATUS, PROMOTE_STATUS } = require('../utils/promoteConstants');
const { USER_TICKET_STATUS } = require('../utils/ticketConstants');

const toPositiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
};

const normalizePlanningTickets = (tickets) => {
  const noOfTickets = Number(tickets?.totalTickets || 0);
  const ticketType = String(tickets?.ticketType || '').trim().toLowerCase() === 'paid' ? 'paid' : 'free';
  const tiers = Array.isArray(tickets?.tiers)
    ? tickets.tiers
      .map((tier) => ({
        name: String(tier?.tierName || '').trim(),
        noOfTickets: Number(tier?.ticketCount || 0),
        price: Number(tier?.ticketPrice || 0),
      }))
      .filter((tier) => tier.name && tier.noOfTickets > 0)
    : [];

  return {
    noOfTickets,
    ticketType,
    tiers,
  };
};

const normalizePromoteTickets = (tickets) => {
  const noOfTickets = Number(tickets?.noOfTickets || 0);
  const ticketType = String(tickets?.ticketType || '').trim().toLowerCase() === 'paid' ? 'paid' : 'free';
  const tiers = Array.isArray(tickets?.tiers)
    ? tickets.tiers
      .map((tier) => ({
        name: String(tier?.name || '').trim(),
        noOfTickets: Number(tier?.quantity || 0),
        price: Number(tier?.price || 0),
      }))
      .filter((tier) => tier.name && tier.noOfTickets > 0)
    : [];

  return {
    noOfTickets,
    ticketType,
    tiers,
  };
};

const mapPlanningEvent = (event, soldCount = 0) => {
  const totalTickets = Number(event?.tickets?.totalTickets || 0);
  const safeTotal = totalTickets > 0 ? totalTickets : 1;
  const trendingScore = Number((Number(soldCount || 0) / safeTotal).toFixed(4));

  return {
  source: 'planning-public',
  eventId: event.eventId,
  ticketAvailabilityEndAt: event?.ticketAvailability?.endAt || null,
  eventTitle: event.eventTitle || '',
  eventDescription: event.eventDescription || '',
  eventScheduled: {
    startAt: event?.schedule?.startAt || null,
    endAt: event?.schedule?.endAt || null,
  },
  venue: {
    locationName: event?.location?.name || '',
    latitude: event?.location?.latitude ?? null,
    longitude: event?.location?.longitude ?? null,
  },
  tickets: normalizePlanningTickets(event?.tickets),
  ticketsSold: Number(soldCount || 0),
  trendingScore,
  eventField: event?.eventField || null,
  eventBanner: event?.eventBanner || null,
  };
};

const mapPromoteEvent = (event, soldCount = 0) => {
  const modelSold = Number(event?.ticketAnalytics?.ticketsSold || 0);
  const effectiveSold = Math.max(modelSold, Number(soldCount || 0));
  const totalTickets = Number(event?.tickets?.noOfTickets || 0);
  const safeTotal = totalTickets > 0 ? totalTickets : 1;
  const trendingScore = Number((effectiveSold / safeTotal).toFixed(4));

  return {
  source: 'promote',
  eventId: event.eventId,
  ticketAvailabilityEndAt: event?.ticketAvailability?.endAt || null,
  eventTitle: event.eventTitle || '',
  eventDescription: event.eventDescription || '',
  eventScheduled: {
    startAt: event?.schedule?.startAt || null,
    endAt: event?.schedule?.endAt || null,
  },
  venue: {
    locationName: event?.venue?.locationName || '',
    latitude: event?.venue?.latitude ?? null,
    longitude: event?.venue?.longitude ?? null,
  },
  tickets: normalizePromoteTickets(event?.tickets),
  ticketsSold: effectiveSold,
  trendingScore,
  eventField: event?.eventField || null,
  eventBanner: event?.eventBanner || null,
  };
};

const getTicketMarketplaceEvents = async ({ page = 1, limit = 20 } = {}) => {
  const safePage = toPositiveInt(page, 1);
  const safeLimit = Math.min(100, toPositiveInt(limit, 20));
  const now = new Date();

  const planningQuery = {
    category: CATEGORY.PUBLIC,
    platformFeePaid: true,
    status: { $nin: [STATUS.PAYMENT_PENDING, STATUS.REJECTED, STATUS.COMPLETED] },
    'ticketAvailability.startAt': { $lte: now },
    'ticketAvailability.endAt': { $gte: now },
  };

  const promoteQuery = {
    platformFeePaid: true,
    eventStatus: { $nin: [PROMOTE_STATUS.PAYMENT_REQUIRED, PROMOTE_STATUS.COMPLETE] },
    'adminDecision.status': ADMIN_DECISION_STATUS.APPROVED,
    'ticketAvailability.startAt': { $lte: now },
    'ticketAvailability.endAt': { $gte: now },
  };

  const planningSelect = [
    'eventId',
    'eventTitle',
    'eventDescription',
    'eventField',
    'eventBanner',
    'location',
    'schedule',
    'ticketAvailability',
    'tickets',
    'updatedAt',
  ].join(' ');

  const promoteSelect = [
    'eventId',
    'eventTitle',
    'eventDescription',
    'eventField',
    'eventBanner',
    'venue',
    'schedule',
    'ticketAvailability',
    'tickets',
    'ticketAnalytics',
    'updatedAt',
  ].join(' ');

  const [planningEvents, promoteEvents] = await Promise.all([
    Planning.find(planningQuery).select(planningSelect).lean(),
    Promote.find(promoteQuery).select(promoteSelect).lean(),
  ]);

  const eventIds = [
    ...(planningEvents || []).map((e) => String(e?.eventId || '').trim()).filter(Boolean),
    ...(promoteEvents || []).map((e) => String(e?.eventId || '').trim()).filter(Boolean),
  ];

  const soldAgg = eventIds.length
    ? await UserEventTicket.aggregate([
      {
        $match: {
          eventId: { $in: eventIds },
          ticketStatus: USER_TICKET_STATUS.SUCCESS,
        },
      },
      {
        $group: {
          _id: '$eventId',
          sold: { $sum: 1 },
        },
      },
    ])
    : [];

  const soldMap = new Map((soldAgg || []).map((row) => [String(row?._id || ''), Number(row?.sold || 0)]));

  const unified = [
    ...(planningEvents || []).map((e) => mapPlanningEvent(e, soldMap.get(String(e?.eventId || '')) || 0)),
    ...(promoteEvents || []).map((e) => mapPromoteEvent(e, soldMap.get(String(e?.eventId || '')) || 0)),
  ].sort((a, b) => {
    const diff = Number(b?.trendingScore || 0) - Number(a?.trendingScore || 0);
    if (diff !== 0) return diff;
    const aSold = Number(b?.ticketsSold || 0) - Number(a?.ticketsSold || 0);
    if (aSold !== 0) return aSold;
    const aEnd = new Date(a?.ticketAvailabilityEndAt || 0).getTime();
    const bEnd = new Date(b?.ticketAvailabilityEndAt || 0).getTime();
    return aEnd - bEnd;
  });

  const total = unified.length;
  const skip = (safePage - 1) * safeLimit;
  const events = unified.slice(skip, skip + safeLimit);

  return {
    events,
    pagination: {
      currentPage: safePage,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      total,
      limit: safeLimit,
    },
    serverTime: now.toISOString(),
  };
};

const getMyTicketInterests = async ({ userAuthId } = {}) => {
  const authId = String(userAuthId || '').trim();
  if (!authId) {
    return {
      fields: [],
      totalPurchasedTickets: 0,
    };
  }

  const purchased = await UserEventTicket.find({
    userAuthId: authId,
    ticketStatus: USER_TICKET_STATUS.SUCCESS,
  })
    .select('eventField')
    .lean();

  const fieldCount = new Map();
  for (const row of purchased || []) {
    const field = String(row?.eventField || '').trim();
    if (!field) continue;
    fieldCount.set(field, (fieldCount.get(field) || 0) + 1);
  }

  const fields = Array.from(fieldCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([field]) => field);

  return {
    fields,
    totalPurchasedTickets: (purchased || []).length,
  };
};

module.exports = {
  getTicketMarketplaceEvents,
  getMyTicketInterests,
};
