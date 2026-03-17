const kafkaConfig = require('../config/kafka');
const logger = require('../utils/logger');

const topic = process.env.KAFKA_ADMIN_TOPIC || 'admin_events';
let producer = null;

const ensureProducer = async () => {
  if (producer) return producer;
  producer = await kafkaConfig.createProducer();
  return producer;
};

const publishTeamMemberBlocked = async ({ authId, email, changedBy }) => {
  const kafkaProducer = await ensureProducer();

  const event = {
    type: 'TEAM_MEMBER_BLOCKED',
    authId,
    email,
    changedBy,
    changedAt: new Date().toISOString(),
  };

  await kafkaProducer.send({
    topic,
    messages: [
      {
        key: authId,
        value: JSON.stringify(event),
      },
    ],
  });

  logger.info('Published TEAM_MEMBER_BLOCKED event', {
    authId,
    email,
    changedBy,
    topic,
  });
};

const publishTeamMemberUnblocked = async ({ authId, email, changedBy }) => {
  const kafkaProducer = await ensureProducer();

  const event = {
    type: 'TEAM_MEMBER_UNBLOCKED',
    authId,
    email,
    changedBy,
    changedAt: new Date().toISOString(),
  };

  await kafkaProducer.send({
    topic,
    messages: [
      {
        key: authId,
        value: JSON.stringify(event),
      },
    ],
  });

  logger.info('Published TEAM_MEMBER_UNBLOCKED event', {
    authId,
    email,
    changedBy,
    topic,
  });
};

module.exports = {
  publishTeamMemberBlocked,
  publishTeamMemberUnblocked,
};
