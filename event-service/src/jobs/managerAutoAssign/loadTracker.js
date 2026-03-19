'use strict';

const mongoose = require('mongoose');

const Promote = require('../../models/Promote');
const Planning = require('../../models/Planning');
const { PROMOTE_STATUS } = require('../../utils/promoteConstants');
const { STATUS: PLANNING_STATUS } = require('../../utils/planningConstants');

const toObjectIds = (ids) => {
  const out = [];
  for (const id of ids || []) {
    const raw = String(id);
    if (mongoose.Types.ObjectId.isValid(raw)) out.push(new mongoose.Types.ObjectId(raw));
  }
  return out;
};

const mergeCountsIntoMap = (target, rows) => {
  for (const row of rows || []) {
    const id = row?._id ? String(row._id) : null;
    const count = Number(row?.count) || 0;
    if (!id) continue;
    target.set(id, (target.get(id) || 0) + count);
  }
};

const buildActiveLoadByManagerId = async ({ eligibleManagerIds } = {}) => {
  const objectIds = toObjectIds(eligibleManagerIds);
  const loadById = new Map();
  if (objectIds.length === 0) return loadById;

  const [promoteLoad, planningLoad] = await Promise.all([
    Promote.aggregate([
      {
        $match: {
          assignedManagerId: { $in: objectIds },
          eventStatus: { $ne: PROMOTE_STATUS.COMPLETE },
          'adminDecision.status': { $ne: 'REJECTED' },
        },
      },
      { $group: { _id: '$assignedManagerId', count: { $sum: 1 } } },
    ]),
    Planning.aggregate([
      {
        $match: {
          assignedManagerId: { $in: objectIds },
          status: { $nin: [PLANNING_STATUS.COMPLETED, PLANNING_STATUS.REJECTED] },
        },
      },
      { $group: { _id: '$assignedManagerId', count: { $sum: 1 } } },
    ]),
  ]);

  mergeCountsIntoMap(loadById, promoteLoad);
  mergeCountsIntoMap(loadById, planningLoad);

  return loadById;
};

module.exports = {
  buildActiveLoadByManagerId,
};
