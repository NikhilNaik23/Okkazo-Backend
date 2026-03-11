const createApiError = (statusCode, message, isOperational = true) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.isOperational = isOperational;
  return error;
};

module.exports = { createApiError };
