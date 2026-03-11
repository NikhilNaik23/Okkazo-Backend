const { Kafka } = require('kafkajs');
const logger = require('../utils/logger');

const brokers = process.env.KAFKA_BROKERS || 'localhost:9092';
const brokerList = brokers.split(',');

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'admin-service',
  brokers: brokerList,
  retry: {
    initialRetryTime: 300,
    retries: 10,
  },
});

let producer = null;

const createProducer = async () => {
  try {
    producer = kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });

    await producer.connect();
    logger.info('Kafka producer connected successfully');
    return producer;
  } catch (error) {
    logger.error('Error creating Kafka producer:', error);
    throw error;
  }
};

const getProducer = () => producer;

const disconnect = async () => {
  try {
    if (producer) {
      await producer.disconnect();
      logger.info('Kafka producer disconnected');
    }
  } catch (error) {
    logger.error('Error disconnecting Kafka:', error);
  }
};

module.exports = {
  createProducer,
  getProducer,
  disconnect,
};
