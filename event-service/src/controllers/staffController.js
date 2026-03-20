const Planning = require('../models/Planning');
const Promote = require('../models/Promote');
const logger = require('../utils/logger');
const { fetchActiveManagers } = require('../services/userServiceClient');
const { STATUS: PLANNING_STATUS } = require('../utils/planningConstants');
const { PROMOTE_STATUS } = require('../utils/promoteConstants');
const { ADMIN_DECISION_STATUS } = require('../utils/promoteConstants');

const normalizeLoose = (value) => String(value || '').trim().toLowerCase();

const isCoreOperationDepartment = (department) => {
  const d = normalizeLoose(department);
  return d === 'core operation' || d === 'core' || d.includes('core');
};

/**
 * GET /staff/core/available
 * Returns managers in Core Operation department who are not assigned to any active planning/promote.
 * Optional query: ?excludeEventId=... (does not mark assignments on that eventId as conflicts)
 */
const getAvailableCoreStaff = async (req, res) => {
  try {
    const excludeEventId = String(req.query?.excludeEventId || '').trim();

    const managers = await fetchActiveManagers({ limit: 500 });
    const coreManagers = (managers || []).filter((u) => {
      if (!u) return false;
      if (normalizeLoose(u.role) !== 'manager') return false;
      if (u.isActive === false) return false;
      if (!isCoreOperationDepartment(u.department)) return false;
      return true;
    });

    const [planningAssignments, promoteAssignments] = await Promise.all([
      Planning.find({
        status: { $nin: [PLANNING_STATUS.COMPLETED, PLANNING_STATUS.REJECTED] },
        $or: [
          { assignedManagerId: { $ne: null } },
          { coreStaffIds: { $exists: true, $ne: [] } },
        ],
      })
        .select('eventId assignedManagerId coreStaffIds')
        .lean(),
      Promote.find({
        eventStatus: { $ne: PROMOTE_STATUS.COMPLETE },
        'adminDecision.status': { $ne: ADMIN_DECISION_STATUS.REJECTED },
        $or: [
          { assignedManagerId: { $ne: null } },
          { coreStaffIds: { $exists: true, $ne: [] } },
        ],
      })
        .select('eventId assignedManagerId coreStaffIds')
        .lean(),
    ]);

    const busyManagerIds = new Set();

    for (const rec of planningAssignments || []) {
      if (excludeEventId && String(rec.eventId || '').trim() === excludeEventId) continue;

      if (rec?.assignedManagerId) {
        busyManagerIds.add(String(rec.assignedManagerId));
      }

      for (const staffId of rec?.coreStaffIds || []) {
        if (!staffId) continue;
        busyManagerIds.add(String(staffId));
      }
    }
    for (const rec of promoteAssignments || []) {
      if (excludeEventId && String(rec.eventId || '').trim() === excludeEventId) continue;

      if (rec?.assignedManagerId) {
        busyManagerIds.add(String(rec.assignedManagerId));
      }

      for (const staffId of rec?.coreStaffIds || []) {
        if (!staffId) continue;
        busyManagerIds.add(String(staffId));
      }
    }

    const available = coreManagers
      .filter((u) => {
        const id = String(u?._id || u?.id || '').trim();
        if (!id) return false;
        return !busyManagerIds.has(id);
      })
      .map((u) => ({
        id: String(u?._id || u?.id || '').trim(),
        authId: u?.authId || null,
        name: u?.name || null,
        email: u?.email || null,
        department: u?.department || null,
        assignedRole: u?.assignedRole || null,
        avatar: u?.avatar || null,
      }));

    return res.status(200).json({
      success: true,
      data: { staff: available },
    });
  } catch (error) {
    logger.error('Error in getAvailableCoreStaff:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch available core staff',
    });
  }
};

module.exports = {
  getAvailableCoreStaff,
};
