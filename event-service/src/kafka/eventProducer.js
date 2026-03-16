const kafkaConfig = require('../config/kafka');
const logger = require('../utils/logger');

const topic = process.env.KAFKA_TOPIC || 'event_events';

const publishEvent = async (type, payload, key) => {
  const producer = kafkaConfig.getProducer();

  if (!producer) {
    throw new Error('Kafka producer not initialized');
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
        key: key || payload.eventId || payload.authId || 'event-service',
        value: JSON.stringify(message),
      },
    ],
  });

  logger.info(`Kafka event published: ${type}`, { topic, key: key || payload.eventId });
};

module.exports = {
  publishEvent,
};
