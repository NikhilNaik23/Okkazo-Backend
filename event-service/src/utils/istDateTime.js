const IST_OFFSET_MINUTES = 330;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const toDateOrNull = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const pad2 = (n) => String(n).padStart(2, '0');

const toIstShiftedDate = (value) => {
  const d = toDateOrNull(value);
  if (!d) return null;
  return new Date(d.getTime() + IST_OFFSET_MS);
};

const toIstDayString = (value) => {
  const shifted = toIstShiftedDate(value);
  if (!shifted) return null;
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
};

const parseIstDayStart = (day) => {
  const raw = String(day || '').trim();
  if (!DAY_RE.test(raw)) return null;

  const [year, month, date] = raw.split('-').map((x) => Number(x));
  if (!year || !month || !date) return null;

  // Midnight in IST converted to UTC instant.
  return new Date(Date.UTC(year, month - 1, date, 0, 0, 0, 0) - IST_OFFSET_MS);
};

const normalizeIstDayInput = (value) => {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;

  if (DAY_RE.test(raw)) return raw;

  // Always resolve timestamp-like input through IST conversion.
  // Prefix-truncating ISO values can produce the wrong IST day for UTC timestamps.
  return toIstDayString(raw);
};

const shiftDateKeepingIstTime = (targetDay, sourceDate) => {
  const dayStart = parseIstDayStart(targetDay);
  const source = toDateOrNull(sourceDate);
  if (!dayStart || !source) return null;

  const sourceIst = new Date(source.getTime() + IST_OFFSET_MS);

  const h = sourceIst.getUTCHours();
  const m = sourceIst.getUTCMinutes();
  const s = sourceIst.getUTCSeconds();
  const ms = sourceIst.getUTCMilliseconds();

  const baseIst = new Date(dayStart.getTime() + IST_OFFSET_MS);
  const y = baseIst.getUTCFullYear();
  const mo = baseIst.getUTCMonth();
  const d = baseIst.getUTCDate();

  return new Date(Date.UTC(y, mo, d, h, m, s, ms) - IST_OFFSET_MS);
};

const startOfIstDay = (value = new Date()) => {
  const day = toIstDayString(value);
  return day ? parseIstDayStart(day) : null;
};

const addDays = (value, days) => {
  const d = toDateOrNull(value);
  if (!d) return null;
  return new Date(d.getTime() + (Number(days) || 0) * 24 * 60 * 60 * 1000);
};

module.exports = {
  IST_OFFSET_MINUTES,
  DAY_RE,
  toDateOrNull,
  toIstDayString,
  parseIstDayStart,
  normalizeIstDayInput,
  shiftDateKeepingIstTime,
  startOfIstDay,
  addDays,
};
