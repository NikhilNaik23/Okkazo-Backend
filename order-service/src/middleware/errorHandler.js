const logger = require('../utils/logger');
const createApiError = require('../utils/ApiError');
const {
  isAxiosLikeError,
  normalizeAxiosError,
  isRazorpayLikeError,
  normalizeRazorpayError,
  getErrorLogMeta,
} = require('../utils/normalizeError');

const errorHandler = (err, req, res, next) => {
  let error = err;

  logger.error('Error:', {
    ...getErrorLogMeta(err),
    stack: err?.stack,
    url: req.url,
    method: req.method,
  });

  // Normalize common third-party error shapes that don't populate `err.message`
  // so clients don't get a generic "Internal Server Error".
  if (!error?.statusCode) {
    if (isAxiosLikeError(err)) {
      error = normalizeAxiosError(err, { upstreamName: 'upstream service' });
    } else if (isRazorpayLikeError(err)) {
      error = normalizeRazorpayError(err, {
        defaultStatusCode: 422,
        defaultMessage: 'Payment provider error',
      });
    }
  }

  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((val) => val.message);
    error = createApiError(400, `Validation Error: ${message.join(', ')}`);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    error = createApiError(409, `${field} already exists`);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

const notFound = (req, res, next) => {
  const error = createApiError(404, `Route ${req.originalUrl} not found`);
  next(error);
};

module.exports = {
  errorHandler,
  notFound,
};
