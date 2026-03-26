const VendorReservation = require('../models/VendorReservation');
const Planning = require('../models/Planning');
const VendorSelection = require('../models/VendorSelection');
const { STATUS } = require('../utils/planningConstants');
const { VENDOR_STATUS } = require('../utils/vendorSelectionConstants');
const createApiError = require('../utils/ApiError');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOLD_TTL_MS = Math.max(60 * 1000, Number(process.env.VENDOR_RESERVATION_HOLD_TTL_MS || 10 * 60 * 1000));
const STICKY_PLANNING_STATUSES = new Set([STATUS.APPROVED, STATUS.CONFIRMED, STATUS.COMPLETED]);
const VENUE_SERVICE_LABEL = 'Venue';

const normalizeDay = (day) => {
  const d = String(day || '').trim();
  if (!d || !DAY_RE.test(d)) {
    throw createApiError(400, 'Planning day is required (YYYY-MM-DD)');
  }
  return d;
};

const planningToDay = (planning) => {
  const dt =
    (planning?.eventDate instanceof Date && !isNaN(planning.eventDate))
      ? planning.eventDate
      : ((planning?.schedule?.startAt instanceof Date && !isNaN(planning.schedule.startAt))
        ? planning.schedule.startAt
        : null);

  if (!dt) return null;
  return dt.toISOString().slice(0, 10);
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const buildExpiresAt = (now = new Date()) => new Date(now.getTime() + HOLD_TTL_MS);

const isVenueService = (service) => String(service || '').trim() === VENUE_SERVICE_LABEL;

const normalizeOptionalId = (value) => {
  const v = String(value || '').trim();
  return v || null;
};

const buildReservationIdentity = ({ vendorAuthId, service, serviceId }) => {
  const vendor = String(vendorAuthId || '').trim();
  if (!vendor) throw createApiError(400, 'vendorAuthId is required');

  const normalizedService = String(service || '').trim() || null;
  const normalizedServiceId = normalizeOptionalId(serviceId);

  if (isVenueService(normalizedService) && normalizedServiceId) {
    return {
      lockId: `service:${normalizedServiceId}`,
      ownerVendorAuthId: vendor,
      serviceId: normalizedServiceId,
      service: normalizedService,
    };
  }

  return {
    lockId: vendor,
    ownerVendorAuthId: vendor,
    serviceId: normalizedServiceId,
    service: normalizedService,
  };
};

const shouldKeepReservationSticky = async ({ eventId, vendorAuthId = null }) => {
  const eid = String(eventId || '').trim();
  if (!eid) return false;

  const planning = await Planning.findOne({ eventId: eid })
    .select('status platformFeePaid isPaid depositPaid vendorConfirmationPaid fullPaymentPaid')
    .lean();

  if (!planning) return false;

  const hasPaymentProgress =
    Boolean(planning.platformFeePaid) ||
    Boolean(planning.isPaid) ||
    Boolean(planning.depositPaid) ||
    Boolean(planning.vendorConfirmationPaid) ||
    Boolean(planning.fullPaymentPaid);

  if (hasPaymentProgress) return true;
  if (STICKY_PLANNING_STATUSES.has(String(planning.status || '').trim())) return true;

  // Keep sticky when vendor has already accepted (best effort mapping to user expectation).
  const selection = await VendorSelection.findOne({ eventId: eid })
    .select('vendors vendorsAccepted')
    .lean();

  if (!selection) return false;
  if (selection.vendorsAccepted) return true;

  const vendor = String(vendorAuthId || '').trim();
  if (!vendor) return false;

  return Array.isArray(selection.vendors)
    ? selection.vendors.some((v) => String(v?.vendorAuthId || '').trim() === vendor && v?.status === VENDOR_STATUS.ACCEPTED)
    : false;
};

const isReservationExpired = ({ reservation, now, sticky }) => {
  if (sticky) return false;

  const expiresAt = toDateOrNull(reservation?.expiresAt);
  if (expiresAt) return expiresAt <= now;

  // Legacy rows without expiresAt: infer expiry from creation time.
  const createdAt = toDateOrNull(reservation?.createdAt);
  if (!createdAt) return false;
  return createdAt.getTime() + HOLD_TTL_MS <= now.getTime();
};

const normalizeOrReleaseReservation = async ({ reservation, now, stickyCache }) => {
  if (!reservation?._id) {
    return { active: false, sticky: false, expired: true };
  }

  const eventId = String(reservation.eventId || '').trim();
  if (!eventId) {
    await VendorReservation.deleteOne({ _id: reservation._id });
    return { active: false, sticky: false, expired: true };
  }

  let sticky = stickyCache.get(eventId);
  if (sticky === undefined) {
    sticky = await shouldKeepReservationSticky({
      eventId,
      vendorAuthId: reservation.ownerVendorAuthId || reservation.vendorAuthId,
    });
    stickyCache.set(eventId, sticky);
  }

  const expired = isReservationExpired({ reservation, now, sticky });
  if (expired) {
    await VendorReservation.deleteOne({ _id: reservation._id });
    return { active: false, sticky, expired: true };
  }

  const desiredExpiresAt = sticky ? null : buildExpiresAt(now);
  const currentExpiresAt = toDateOrNull(reservation.expiresAt);
  const needsUpdate =
    (sticky && currentExpiresAt !== null) ||
    (!sticky && (!currentExpiresAt || Math.abs(currentExpiresAt.getTime() - desiredExpiresAt.getTime()) > 15 * 1000));

  if (needsUpdate) {
    await VendorReservation.updateOne(
      { _id: reservation._id },
      { $set: { expiresAt: desiredExpiresAt } }
    );
  }

  return { active: true, sticky, expired: false };
};

const claim = async ({ vendorAuthId, day, eventId, authId, service, serviceId }) => {
  const vendor = String(vendorAuthId || '').trim();
  const eid = String(eventId || '').trim();
  const uid = String(authId || '').trim();

  if (!vendor) throw createApiError(400, 'vendorAuthId is required');
  if (!eid) throw createApiError(400, 'eventId is required');
  if (!uid) throw createApiError(400, 'authId is required');

  const identity = buildReservationIdentity({ vendorAuthId: vendor, service, serviceId });
  const normalizedDay = normalizeDay(day);
  const now = new Date();
  const stickyCache = new Map();

  // If already reserved, normalize stale/legacy rows before enforcing conflict.
  const existing = await VendorReservation.findOne({ vendorAuthId: identity.lockId, day: normalizedDay }).lean();
  if (existing) {
    const state = await normalizeOrReleaseReservation({ reservation: existing, now, stickyCache });
    if (!state.active) {
      // Stale hold released; continue and claim below.
    } else if (existing.eventId !== eid) {
      throw createApiError(409, 'Vendor is not available for the selected date');
    } else {
      const sticky = state.sticky;
      const expiresAt = sticky ? null : buildExpiresAt(now);

      // Same event: refresh metadata + hold window.
      await VendorReservation.updateOne(
        { _id: existing._id },
        {
          $set: {
            authId: uid,
            ownerVendorAuthId: identity.ownerVendorAuthId,
            service: identity.service || existing.service,
            serviceId: identity.serviceId || existing.serviceId,
            expiresAt,
          },
        }
      );
      return {
        ...existing,
        authId: uid,
        ownerVendorAuthId: identity.ownerVendorAuthId,
        service: identity.service || existing.service,
        serviceId: identity.serviceId || existing.serviceId,
        expiresAt,
      };
    }
  }

  const sticky = await shouldKeepReservationSticky({ eventId: eid, vendorAuthId: identity.ownerVendorAuthId });
  const expiresAt = sticky ? null : buildExpiresAt(now);

  try {
    const doc = await VendorReservation.create({
      vendorAuthId: identity.lockId,
      ownerVendorAuthId: identity.ownerVendorAuthId,
      serviceId: identity.serviceId,
      day: normalizedDay,
      eventId: eid,
      authId: uid,
      service: identity.service,
      expiresAt,
    });

    return doc.toObject();
  } catch (e) {
    // Duplicate key race: someone else reserved simultaneously
    if (e && (e.code === 11000 || String(e.message || '').includes('E11000'))) {
      throw createApiError(409, 'Vendor is not available for the selected date');
    }
    throw e;
  }
};

const release = async ({ vendorAuthId, day, eventId, service, serviceId }) => {
  const vendor = String(vendorAuthId || '').trim();
  const eid = String(eventId || '').trim();
  if (!vendor) throw createApiError(400, 'vendorAuthId is required');
  if (!eid) throw createApiError(400, 'eventId is required');

  const identity = buildReservationIdentity({ vendorAuthId: vendor, service, serviceId });
  const normalizedDay = normalizeDay(day);

  // Only release if this event owns the reservation
  const existing = await VendorReservation.findOne({ vendorAuthId: identity.lockId, day: normalizedDay }).lean();
  if (!existing) return { removed: 0 };
  if (existing.eventId !== eid) return { removed: 0 };

  const result = await VendorReservation.deleteOne({ _id: existing._id });
  return { removed: result.deletedCount || 0 };
};

const listReservedVendorAuthIdsForDay = async ({ day, excludeEventId }) => {
  const normalizedDay = normalizeDay(day);
  const query = { day: normalizedDay };
  if (excludeEventId && String(excludeEventId).trim()) {
    query.eventId = { $ne: String(excludeEventId).trim() };
  }

  const now = new Date();
  const stickyCache = new Map();
  const docs = await VendorReservation.find(query)
    .select({ _id: 1, vendorAuthId: 1, ownerVendorAuthId: 1, serviceId: 1, eventId: 1, expiresAt: 1, createdAt: 1 })
    .lean();

  const activeVendorIds = [];
  for (const doc of docs) {
    const state = await normalizeOrReleaseReservation({ reservation: doc, now, stickyCache });
    if (!state.active) continue;

    // Vendor-level locks only (non-Venue). Venue service locks are tracked separately.
    const isServiceLock = Boolean(doc?.serviceId) || String(doc?.vendorAuthId || '').startsWith('service:');
    if (!isServiceLock && doc?.vendorAuthId) {
      activeVendorIds.push(doc.ownerVendorAuthId || doc.vendorAuthId);
    }
  }

  return Array.from(new Set(activeVendorIds.filter(Boolean)));
};

const listReservedServiceIdsForDay = async ({ day, excludeEventId }) => {
  const normalizedDay = normalizeDay(day);
  const query = { day: normalizedDay };
  if (excludeEventId && String(excludeEventId).trim()) {
    query.eventId = { $ne: String(excludeEventId).trim() };
  }

  const now = new Date();
  const stickyCache = new Map();
  const docs = await VendorReservation.find(query)
    .select({ _id: 1, vendorAuthId: 1, serviceId: 1, eventId: 1, expiresAt: 1, createdAt: 1 })
    .lean();

  const activeServiceIds = [];
  for (const doc of docs) {
    const state = await normalizeOrReleaseReservation({ reservation: doc, now, stickyCache });
    if (!state.active) continue;

    const sid = normalizeOptionalId(doc?.serviceId)
      || (() => {
        const raw = String(doc?.vendorAuthId || '').trim();
        if (!raw.startsWith('service:')) return null;
        return normalizeOptionalId(raw.slice('service:'.length));
      })();

    if (sid) activeServiceIds.push(sid);
  }

  return Array.from(new Set(activeServiceIds));
};

module.exports = {
  planningToDay,
  claim,
  release,
  listReservedVendorAuthIdsForDay,
  listReservedServiceIdsForDay,
};
