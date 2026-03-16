/**
 * Middleware to extract user information from headers set by API Gateway
 * API Gateway validates JWT and passes user info via headers
 * This middleware is non-blocking - it just extracts info if present
 */
const extractUser = (req, res, next) => {
  // Extract user information from headers set by API Gateway
  const authId = req.headers['x-auth-id'];
  const userId = req.headers['x-user-id'];
  const email = req.headers['x-user-email'];
  const username = req.headers['x-user-username'];
  const role = req.headers['x-user-role'];

  // Attach user information to request object if present
  if (authId || userId) {
    req.user = {
      authId,
      userId,
      email,
      username,
      role,
    };
  }

  next();
};

module.exports = { extractUser };
