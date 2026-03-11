const kafkaConfig = require('../config/kafka');
const logger = require('../utils/logger');

const topic = process.env.KAFKA_TOPIC || 'admin_events';

const publishManagerCreated = async (managerData) => {
  try {
    const producer = kafkaConfig.getProducer();
    if (!producer) {
      throw new Error('Kafka producer not initialized');
    }

    const event = {
      type: 'MANAGER_CREATED',
      name: managerData.name,
      email: managerData.email,
      department: managerData.department,
      assignedRole: managerData.assignedRole,
      createdBy: managerData.createdBy,
      timestamp: new Date().toISOString(),
    };

    await producer.send({
      topic,
      messages: [
        {
          key: managerData.email,
          value: JSON.stringify(event),
        },
      ],
    });

    logger.info('MANAGER_CREATED event published', {
      email: managerData.email,
      topic,
    });

    return true;
  } catch (error) {
    logger.error('Error publishing MANAGER_CREATED event:', error);
    throw error;
  }
};

module.exports = {
  publishManagerCreated,
};
