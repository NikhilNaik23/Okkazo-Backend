const managerService = require('../services/managerService');
const logger = require('../utils/logger');

const createManager = async (req, res) => {
  try {
    const { name, email, department, assignedRole } = req.body;

    const result = await managerService.createManager(
      { name, email, department, assignedRole },
      req.user.authId
    );

    logger.info('Manager creation request processed', {
      email: result.email,
      createdBy: req.user.authId,
    });

    res.status(202).json({
      success: true,
      message: 'Manager creation initiated. An email will be sent to set up their password.',
      data: result,
    });
  } catch (error) {
    logger.error('Error in createManager controller:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to create manager',
    });
  }
};

module.exports = {
  createManager,
};
