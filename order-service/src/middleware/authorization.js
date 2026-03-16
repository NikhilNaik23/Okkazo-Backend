const createApiError = require('../utils/ApiError');

const authorizeRoles = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw createApiError(401, 'Authentication required');
      }

      if (!allowedRoles.includes(req.user.role)) {
        throw createApiError(403, 'Access denied. Insufficient permissions.');
      }

      return next();
    } catch (error) {
      return res.status(error.statusCode || 403).json({
        success: false,
        message: error.message,
      });
    }
  };
};

module.exports = {
  authorizeRoles,
};
