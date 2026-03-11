const kafkaConfig = require('../config/kafka');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

// Module state
let consumer = null;
const topic = process.env.KAFKA_TOPIC || 'auth_events';

const initialize = async () => {
  const maxRetries = 5;
  const retryDelay = 3000; // 3 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      consumer = await kafkaConfig.createConsumer();
      
      // Add a small delay before subscribing to allow metadata to sync
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await consumer.subscribe({
        topic: topic,
        fromBeginning: false,
      });

      logger.info(`Subscribed to Kafka topic: ${topic}`);
      return; // Success, exit the function
    } catch (error) {
      logger.error(`Error initializing Kafka consumer (attempt ${attempt}/${maxRetries}):`, error.message);
      
      if (attempt < maxRetries) {
        logger.info(`Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        logger.error('Max retries reached. Kafka consumer initialization failed.');
        throw error;
      }
    }
  }
};

const startConsuming = async () => {
  try {
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const key = message.key ? message.key.toString() : null;
          const rawValue = message.value.toString();
          
          // Log raw message for debugging
          logger.debug('Raw Kafka message:', { rawValue });
          
          const value = JSON.parse(rawValue);

          // Handle both 'type' and 'eventType' fields for backward compatibility
          const eventType = value.type || value.eventType;

          // Log parsed value structure
          logger.debug('Parsed Kafka message:', { value, eventType });

          logger.info(`Received Kafka message: ${eventType}`, {
            topic,
            partition,
            offset: message.offset,
            key,
          });

          // Normalize to 'type' field
          if (value.eventType && !value.type) {
            value.type = value.eventType;
          }

          await handleEvent(value);
        } catch (error) {
          logger.error('Error processing Kafka message:', error);
          // Don't throw to prevent consumer from stopping
        }
      },
    });

    logger.info('Kafka consumer started successfully');
  } catch (error) {
    logger.error('Error starting Kafka consumer:', error);
    throw error;
  }
};

const handleEvent = async (event) => {
  try {
    if (!event || !event.type) {
      logger.warn('Received event without type');
      return;
    }

    switch (event.type) {
      case 'USER_REGISTERED':
        await handleUserRegistered(event);
        break;

      case 'PASSWORD_RESET_REQUESTED':
        await handlePasswordResetRequested(event);
        break;

      case 'EMAIL_VERIFICATION_RESEND':
        await handleEmailVerificationResend(event);
        break;

      case 'VENDOR_ACCOUNT_CREATED':
        await handleVendorAccountCreated(event);
        break;

      case 'MANAGER_ACCOUNT_CREATED':
        await handleManagerAccountCreated(event);
        break;

      default:
        logger.warn(`Unknown event type: ${event.type}`);
    }
  } catch (error) {
    logger.error(`Error handling event ${event.type}:`, error);
    // Log but don't throw to allow processing of other messages
  }
};

const handleUserRegistered = async (event) => {
  try {
    const { authId, email, verificationToken } = event;

    if (!authId || !email || !verificationToken) {
      logger.error('USER_REGISTERED event missing required fields', { event });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logger.error('USER_REGISTERED event has invalid email format', { email });
      return;
    }

    logger.info('Processing USER_REGISTERED event', { authId, email });

    // Send verification email
    await emailService.sendVerificationEmail(
      email,
      verificationToken,
      authId
    );

    logger.info('Verification email sent successfully', { authId, email });
  } catch (error) {
    logger.error('Error handling USER_REGISTERED event:', error);
    throw error;
  }
};

const handlePasswordResetRequested = async (event) => {
  try {
    const { authId, email, resetToken } = event;

    if (!authId || !email || !resetToken) {
      logger.error('PASSWORD_RESET_REQUESTED event missing required fields', {
        event,
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logger.error('PASSWORD_RESET_REQUESTED event has invalid email format', {
        email,
      });
      return;
    }

    logger.info('Processing PASSWORD_RESET_REQUESTED event', { authId, email });

    // Send password reset email
    await emailService.sendPasswordResetEmail(email, resetToken, authId);

    logger.info('Password reset email sent successfully', { authId, email });
  } catch (error) {
    logger.error('Error handling PASSWORD_RESET_REQUESTED event:', error);
    throw error;
  }
};

const handleEmailVerificationResend = async (event) => {
  try {
    const { authId, email, verificationToken } = event;

    if (!authId || !email || !verificationToken) {
      logger.error('EMAIL_VERIFICATION_RESEND event missing required fields', {
        event,
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logger.error('EMAIL_VERIFICATION_RESEND event has invalid email format', {
        email,
      });
      return;
    }

    logger.info('Processing EMAIL_VERIFICATION_RESEND event', { authId, email });

    // Resend verification email
    await emailService.sendVerificationEmail(
      email,
      verificationToken,
      authId
    );

    logger.info('Verification email resent successfully', { authId, email });
  } catch (error) {
    logger.error('Error handling EMAIL_VERIFICATION_RESEND event:', error);
    throw error;
  }
};

const handleVendorAccountCreated = async (event) => {
  try {
    const { authId, email, passwordResetToken, businessName, applicationId } = event;

    if (!authId || !email || !passwordResetToken || !businessName || !applicationId) {
      logger.error('VENDOR_ACCOUNT_CREATED event missing required fields', {
        event,
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logger.error('VENDOR_ACCOUNT_CREATED event has invalid email format', {
        email,
      });
      return;
    }

    logger.info('Processing VENDOR_ACCOUNT_CREATED event', { authId, email, businessName, applicationId });

    // Send vendor account created email with set password link
    await emailService.sendVendorAccountCreatedEmail(
      email,
      passwordResetToken,
      businessName,
      applicationId,
      authId
    );

    logger.info('Vendor account created email sent successfully', { authId, email, applicationId });
  } catch (error) {
    logger.error('Error handling VENDOR_ACCOUNT_CREATED event:', error);
    throw error;
  }
};

const handleManagerAccountCreated = async (event) => {
  try {
    const { authId, email, passwordResetToken, name, department, assignedRole } = event;

    if (!authId || !email || !passwordResetToken || !name) {
      logger.error('MANAGER_ACCOUNT_CREATED event missing required fields', { event });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logger.error('MANAGER_ACCOUNT_CREATED event has invalid email format', { email });
      return;
    }

    logger.info('Processing MANAGER_ACCOUNT_CREATED event', { authId, email, name, department });

    await emailService.sendManagerAccountCreatedEmail(
      email,
      passwordResetToken,
      name,
      department,
      assignedRole,
      authId
    );

    logger.info('Manager account created email sent successfully', { authId, email });
  } catch (error) {
    logger.error('Error handling MANAGER_ACCOUNT_CREATED event:', error);
    throw error;
  }
};

const shutdown = async () => {
  try {
    if (consumer) {
      await consumer.disconnect();
      logger.info('Kafka consumer shut down gracefully');
    }
  } catch (error) {
    logger.error('Error shutting down Kafka consumer:', error);
  }
};

module.exports = {
  initialize,
  startConsuming,
  shutdown,
};
