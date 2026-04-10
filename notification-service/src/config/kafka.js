const { Kafka } = require('kafkajs');
const logger = require('../utils/logger');

const brokers = process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || 'localhost:9092';
const brokerList = brokers.split(',');

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'notification-service',
  brokers: brokerList,
  retry: {
    initialRetryTime: 300,
    retries: 10,
  },
});

let consumer = null;
let producer = null;

const createConsumer = async (groupId) => {
  try {
    consumer = kafka.consumer({
      groupId: groupId || process.env.KAFKA_GROUP_ID || 'notification-service-group',
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    await consumer.connect();
    logger.info('Kafka consumer connected successfully');
    return consumer;
  } catch (error) {
    logger.error('Error creating Kafka consumer:', error);
    throw error;
  }
};

const createProducer = async () => {
  try {
    if (producer) {
      return producer;
    }

    producer = kafka.producer();
    await producer.connect();
    logger.info('Kafka producer connected successfully');
    return producer;
  } catch (error) {
    logger.error('Error creating Kafka producer:', error);
    throw error;
  }
};

const sendEvent = async ({ topic, key, payload, headers = {} } = {}) => {
  const normalizedTopic = String(topic || '').trim();
  if (!normalizedTopic) {
    throw new Error('Kafka topic is required');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Kafka payload must be an object');
  }

  const activeProducer = await createProducer();
  await activeProducer.send({
    topic: normalizedTopic,
    messages: [
      {
        key: key == null ? null : String(key),
        value: JSON.stringify(payload),
        headers,
      },
    ],
  });
};

const disconnect = async () => {
  try {
    if (consumer) {
      await consumer.disconnect();
      consumer = null;
      logger.info('Kafka consumer disconnected');
    }

    if (producer) {
      await producer.disconnect();
      producer = null;
      logger.info('Kafka producer disconnected');
    }
  } catch (error) {
    logger.error('Error disconnecting Kafka:', error);
  }
};

module.exports = {
  createConsumer,
  createProducer,
  sendEvent,
  disconnect,
};
