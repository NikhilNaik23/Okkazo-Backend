'use strict';

const normalizeLoose = (value) => String(value || '').trim().toLowerCase();

const pickLeastLoadedManagerId = ({ managerIds, unavailableIds, loadById, assignedThisRunById }) => {
  if (!Array.isArray(managerIds) || managerIds.length === 0) return null;
  if (!(unavailableIds instanceof Set)) return null;

  let bestId = null;
  let bestLoad = Number.POSITIVE_INFINITY;

  for (const rawId of managerIds) {
    const id = String(rawId);
    if (unavailableIds.has(id)) continue;

    const base = loadById?.get(id) || 0;
    const run = assignedThisRunById?.get(id) || 0;
    const total = base + run;

    if (total < bestLoad) {
      bestLoad = total;
      bestId = id;
    }
  }

  return bestId;
};

const pickRoundRobinManagerId = async ({ deptKey, managerIds, unavailableIds, cursorStore }) => {
  if (!Array.isArray(managerIds) || managerIds.length === 0) return { managerId: null, nextCursor: 0 };
  if (!(unavailableIds instanceof Set)) return { managerId: null, nextCursor: 0 };

  const normalizedDept = normalizeLoose(deptKey);
  const startCursor = cursorStore ? await cursorStore.getCursor(normalizedDept) : 0;
  const size = managerIds.length;

  for (let offset = 0; offset < size; offset += 1) {
    const idx = (startCursor + offset) % size;
    const id = String(managerIds[idx]);
    if (unavailableIds.has(id)) continue;

    const nextCursor = (idx + 1) % size;
    if (cursorStore) await cursorStore.setCursor(normalizedDept, nextCursor);
    return { managerId: id, nextCursor };
  }

  return { managerId: null, nextCursor: startCursor % size };
};

module.exports = {
  pickLeastLoadedManagerId,
  pickRoundRobinManagerId,
};
