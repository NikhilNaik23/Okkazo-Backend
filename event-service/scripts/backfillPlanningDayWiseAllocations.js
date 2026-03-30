require('dotenv').config();
const mongoose = require('mongoose');
const Planning = require('../src/models/Planning');
const { toIstDayString } = require('../src/utils/istDateTime');

const IST_OFFSET = '+05:30';
const MAX_DAYS = 400;

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

  while (cursor.getTime() <= max.getTime() && guard < MAX_DAYS) {
    const day = toIstDayString(cursor);
    if (day) days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }

  return days;
};

const normalizeExistingAllocationMap = (rows, totalTickets, expectedSet) => {
  const map = {};
  const values = Array.isArray(rows) ? rows : [];

  for (const row of values) {
    const day = String(row?.day || '').trim();
    if (!day || !expectedSet.has(day)) continue;

    const count = Number(row?.ticketCount || 0);
    if (!Number.isFinite(count) || count < 1) continue;
    if (totalTickets > 0 && count > totalTickets) continue;

    map[day] = Math.floor(count);
  }

  return map;
};

const shouldBackfill = (expectedDays, existingRows) => {
  const expectedSet = new Set(expectedDays);
  const values = Array.isArray(existingRows) ? existingRows : [];

  if (values.length === 0) return true;

  const seen = new Set();
  for (const row of values) {
    const day = String(row?.day || '').trim();
    const count = Number(row?.ticketCount || 0);
    if (!day || !expectedSet.has(day)) return true;
    if (!Number.isFinite(count) || count < 1) return true;
    if (seen.has(day)) return true;
    seen.add(day);
  }

  return seen.size !== expectedSet.size;
};

const run = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  try {
    const cursor = Planning.find({
      category: 'public',
      'schedule.startAt': { $exists: true, $ne: null },
      'tickets.totalTickets': { $gte: 1 },
    })
      .select('eventId schedule tickets.totalTickets tickets.dayWiseAllocations')
      .lean()
      .cursor();

    let scanned = 0;
    let skipped = 0;
    let prepared = 0;
    const ops = [];

    for await (const planning of cursor) {
      scanned += 1;

      const eventId = String(planning?.eventId || '').trim();
      const totalTickets = Number(planning?.tickets?.totalTickets || 0);
      const expectedDays = getInclusiveIstDaysInRange(planning?.schedule?.startAt, planning?.schedule?.endAt);

      if (!eventId || !Number.isFinite(totalTickets) || totalTickets < 1 || expectedDays.length === 0) {
        skipped += 1;
        continue;
      }

      const existingRows = planning?.tickets?.dayWiseAllocations;
      if (!shouldBackfill(expectedDays, existingRows)) {
        skipped += 1;
        continue;
      }

      const expectedSet = new Set(expectedDays);
      const existingMap = normalizeExistingAllocationMap(existingRows, totalTickets, expectedSet);

      const nextRows = expectedDays.map((day) => ({
        day,
        ticketCount: existingMap[day] || Math.floor(totalTickets),
      }));

      prepared += 1;
      ops.push({
        updateOne: {
          filter: { eventId },
          update: {
            $set: {
              'tickets.dayWiseAllocations': nextRows,
            },
          },
        },
      });
    }

    if (ops.length === 0) {
      console.log(`[backfill] scanned=${scanned}, updated=0, skipped=${skipped}, dryRun=${dryRun}`);
      return;
    }

    if (dryRun) {
      console.log(`[backfill][dry-run] scanned=${scanned}, wouldUpdate=${prepared}, skipped=${skipped}`);
      return;
    }

    const result = await Planning.bulkWrite(ops, { ordered: false });
    console.log(
      `[backfill] scanned=${scanned}, matched=${result?.matchedCount || 0}, modified=${result?.modifiedCount || 0}, skipped=${skipped}`
    );
  } finally {
    await mongoose.connection.close();
  }
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[backfill] failed:', error?.message || error);
    process.exit(1);
  });
