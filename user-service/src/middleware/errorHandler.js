const logger = require('../utils/logger');
const createApiError = require('../utils/ApiError');

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = err;

  // Log error
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((val) => val.message);
    error = createApiError(400, `Validation Error: ${message.join(', ')}`);
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    error = createApiError(409, `${field} already exists`);
  }

  // Mongoose cast error (invalid ID)
  if (err.name === 'CastError') {
    error = createApiError(400, `Invalid ${err.path}: ${err.value}`);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = createApiError(401, 'Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    error = createApiError(401, 'Token expired');
  }

  // Send error response
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * Handle 404 errors
 */
const notFound = (req, res, next) => {
  const error = createApiError(404, `Route ${req.originalUrl} not found`);
  next(error);
};

/**
 * Async error wrapper
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  errorHandler,
  notFound,
  asyncHandler,
};
