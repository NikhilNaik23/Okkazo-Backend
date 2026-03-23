const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');

/**
 * Require an authenticated user.
 *
 * Primary mode: API Gateway injects `req.user` via headers (see extractUser).
 * Fallback: verify `Authorization: Bearer <token>` locally using JWT_SECRET.
 */
const requireUser = (req, res, next) => {
  if (req.user?.authId) return next();

  const authHeader = String(req.headers.authorization || '').trim();
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) throw new ApiError(401, 'Authentication required');

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new ApiError(500, 'JWT_SECRET is not configured');

  const payload = jwt.verify(token, secret);
  const authId = payload?.authId || payload?.sub || payload?.userId;
  if (!authId) throw new ApiError(401, 'Invalid token');

  req.user = {
    authId: String(authId),
    userId: payload?.userId ? String(payload.userId) : undefined,
    email: payload?.email,
    username: payload?.username,
    role: payload?.role,
  };

  next();
};

module.exports = { requireUser };
