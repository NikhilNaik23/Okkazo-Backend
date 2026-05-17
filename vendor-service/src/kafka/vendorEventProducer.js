const kafkaConfig = require('../config/kafka');
const logger = require('../utils/logger');

const topic = process.env.KAFKA_VENDOR_TOPIC || 'vendor_events';

const publishVendorEvent = async (type, payload = {}, key = null) => {
  try {
    const producer = kafkaConfig.getProducer();
    if (!producer) {
      logger.warn('Kafka producer not initialized; skipping vendor event', { type });
      return false;
    }

    const message = {
      type,
      ...payload,
      timestamp: new Date().toISOString(),
    };

    await producer.send({
      topic,
      messages: [
        {
          key: key || payload.complaintId || payload.vendorAuthId || 'vendor-service',
          value: JSON.stringify(message),
        },
      ],
    });

    logger.info(`Vendor event published: ${type}`, {
      topic,
      key: key || payload.complaintId || payload.vendorAuthId,
    });

    return true;
  } catch (error) {
    logger.warn('Failed to publish vendor event', {
      type,
      message: error?.message || String(error),
    });
    return false;
  }
};

module.exports = {
  publishVendorEvent,
};
