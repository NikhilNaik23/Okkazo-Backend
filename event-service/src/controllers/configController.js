const promoteConfigService = require('../services/promoteConfigService');
const logger = require('../utils/logger');
const { getState: getManagerAutoAssignState, setEnabledOverride } = require('../jobs/managerAutoAssignRuntimeConfig');
const { startManagerAutoAssignJob, stopManagerAutoAssignJob } = require('../jobs/managerAutoAssignJob');

// GET /config/fees
const getFees = async (req, res) => {
  try {
    const cfg = await promoteConfigService.getFees();
    return res.status(200).json({
      success: true,
      data: cfg,
    });
  } catch (error) {
    logger.error('Error in getFees:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

// PATCH /config/fees (Admin only)
const updateFees = async (req, res) => {
  try {
    const { platformFee, serviceChargePercent } = req.body || {};

    const updated = await promoteConfigService.updateFees({
      platformFee,
      serviceChargePercent,
      updatedByAuthId: req.user?.authId,
    });

    return res.status(200).json({
      success: true,
      message: 'Fees updated successfully',
      data: updated,
    });
  } catch (error) {
    logger.error('Error in updateFees:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getFees,
  updateFees,
  // GET /config/manager-autoassign (Admin only)
  getManagerAutoAssign: async (req, res) => {
    try {
      const state = getManagerAutoAssignState();
      return res.status(200).json({
        success: true,
        data: {
          enabled: Boolean(state?.enabled),
          source: state?.source || 'env',
          updatedAt: state?.updatedAt || null,
          updatedByAuthId: state?.updatedByAuthId || null,
          envEnabled: Boolean(state?.envEnabled),
        },
      });
    } catch (error) {
      logger.error('Error in getManagerAutoAssign:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch manager auto-assign config',
      });
    }
  },

  // PATCH /config/manager-autoassign (Admin only)
  updateManagerAutoAssign: async (req, res) => {
    try {
      const { enabled } = req.body || {};

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'enabled (boolean) is required',
        });
      }

      const state = setEnabledOverride({
        enabled,
        updatedByAuthId: req.user?.authId,
      });

      if (enabled) startManagerAutoAssignJob();
      else stopManagerAutoAssignJob();

      return res.status(200).json({
        success: true,
        message: `Manager auto-assign ${enabled ? 'enabled' : 'disabled'}`,
        data: {
          enabled: Boolean(state?.enabled),
          source: state?.source || 'runtime',
          updatedAt: state?.updatedAt || null,
          updatedByAuthId: state?.updatedByAuthId || null,
          envEnabled: Boolean(state?.envEnabled),
        },
      });
    } catch (error) {
      logger.error('Error in updateManagerAutoAssign:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update manager auto-assign config',
      });
    }
  },
};
