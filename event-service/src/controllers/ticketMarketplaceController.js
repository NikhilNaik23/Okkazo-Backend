const ticketMarketplaceService = require('../services/ticketMarketplaceService');
const logger = require('../utils/logger');

const getTicketMarketplaceEvents = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const result = await ticketMarketplaceService.getTicketMarketplaceEvents({
      page,
      limit,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error in getTicketMarketplaceEvents:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch ticket marketplace events',
    });
  }
};

const getMyTicketInterests = async (req, res) => {
  try {
    const userAuthId = req.user?.authId;

    const result = await ticketMarketplaceService.getMyTicketInterests({
      userAuthId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error in getMyTicketInterests:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch ticket interests',
    });
  }
};

module.exports = {
  getTicketMarketplaceEvents,
  getMyTicketInterests,
};
