const logger = require('../utils/logger');
const createApiError = require('../utils/ApiError');

/**
 * Middleware to authorize based on user roles
 */
const authorizeRoles = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw createApiError(401, 'Authentication required');
      }

      const userRole = req.user.role;

      if (!allowedRoles.includes(userRole)) {
        logger.warn('Authorization failed', {
          authId: req.user.authId,
          userRole,
          allowedRoles,
        });

        throw createApiError(
          403,
          'Access denied. Insufficient permissions.'
        );
      }

      logger.debug('User authorized', {
        authId: req.user.authId,
        role: userRole,
      });

      next();
    } catch (error) {
      return res.status(error.statusCode || 403).json({
        success: false,
        message: error.message,
      });
    }
  };
};

/**
 * Middleware to check if user is admin
 */
const isAdmin = (req, res, next) => {
  return authorizeRoles(['ADMIN'])(req, res, next);
};

/**
 * Middleware to check if user is admin or manager
 */
const isAdminOrManager = (req, res, next) => {
  return authorizeRoles(['ADMIN', 'MANAGER'])(req, res, next);
};

/**
 * Middleware to check if user owns the resource
 */
const isOwner = (resourceAuthIdParam = 'authId') => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw createApiError(401, 'Authentication required');
      }

      const requestedAuthId = req.params[resourceAuthIdParam];
      const userAuthId = req.user.authId;

      // Admin can access any resource
      if (req.user.role === 'ADMIN') {
        return next();
      }

      // Check ownership
      if (requestedAuthId !== userAuthId) {
        throw createApiError(403, 'Access denied. You can only access your own resources.');
      }

      next();
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
  isAdmin,
  isAdminOrManager,
  isOwner,
};
