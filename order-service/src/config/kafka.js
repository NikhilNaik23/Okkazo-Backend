const { Kafka } = require('kafkajs');
const logger = require('../utils/logger');

const brokers = process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || 'localhost:9092';
const brokerList = brokers.split(',');

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'order-service',
  brokers: brokerList,
  retry: {
    initialRetryTime: 300,
    retries: 10,
  },
});

let producer = null;

const createProducer = async () => {
  producer = kafka.producer({
    allowAutoTopicCreation: true,
    transactionTimeout: 30000,
  });

  await producer.connect();
  logger.info('Kafka producer connected successfully');
  return producer;
};

const getProducer = () => producer;

const disconnect = async () => {
  if (producer) {
    await producer.disconnect();
    logger.info('Kafka producer disconnected');
  }
};

module.exports = {
  createProducer,
  getProducer,
  disconnect,
};
