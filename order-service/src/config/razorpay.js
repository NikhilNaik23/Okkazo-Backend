const Razorpay = require('razorpay');
const createApiError = require('../utils/ApiError');

let razorpayClient;

const getRazorpayClient = () => {
  if (!razorpayClient) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw createApiError(500, 'Razorpay credentials are not configured');
    }

    razorpayClient = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  return razorpayClient;
};

module.exports = {
  getRazorpayClient,
};
