const crypto = require('crypto');
const createApiError = require('./ApiError');

const toBase64Url = (input) => {
  const raw = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(String(input), 'utf8').toString('base64');
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (input) => {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + '='.repeat(padLength);
  return Buffer.from(padded, 'base64').toString('utf8');
};

const getQrSecret = () => {
  const secret = process.env.TICKET_QR_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw createApiError(500, 'QR token secret is not configured');
  }
  return secret;
};

const signTicketQrToken = ({ ticketId, eventId, userAuthId }) => {
  const payload = {
    v: 1,
    ticketId: String(ticketId || '').trim(),
    eventId: String(eventId || '').trim(),
    userAuthId: String(userAuthId || '').trim(),
    iat: Date.now(),
  };

  if (!payload.ticketId || !payload.eventId || !payload.userAuthId) {
    throw createApiError(400, 'Missing ticket identity fields for QR token generation');
  }

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', getQrSecret())
    .update(encodedPayload)
    .digest();

  return `${encodedPayload}.${toBase64Url(signature)}`;
};

const verifyTicketQrToken = (token) => {
  const normalized = String(token || '').trim();
  if (!normalized) {
    throw createApiError(400, 'QR token is required');
  }

  const parts = normalized.split('.');
  if (parts.length !== 2) {
    throw createApiError(400, 'Invalid QR token format');
  }

  const [encodedPayload, encodedSignature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', getQrSecret())
    .update(encodedPayload)
    .digest();

  const providedSignatureRaw = Buffer.from(
    encodedSignature.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encodedSignature.length / 4) * 4, '='),
    'base64'
  );

  if (
    providedSignatureRaw.length !== expectedSignature.length
    || !crypto.timingSafeEqual(providedSignatureRaw, expectedSignature)
  ) {
    throw createApiError(401, 'Invalid QR token signature');
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload));
  } catch (_) {
    throw createApiError(400, 'Invalid QR token payload');
  }

  if (!payload?.ticketId || !payload?.eventId || !payload?.userAuthId) {
    throw createApiError(400, 'QR token payload is incomplete');
  }

  return payload;
};

module.exports = {
  signTicketQrToken,
  verifyTicketQrToken,
};
