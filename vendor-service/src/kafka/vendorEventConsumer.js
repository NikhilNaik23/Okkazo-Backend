const kafkaConfig = require('../config/kafka');
const vendorService = require('../services/vendorService');
const logger = require('../utils/logger');

// Module state
let consumer = null;
const topic = process.env.KAFKA_TOPIC || 'vendor_events';

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
          const value = JSON.parse(rawValue);

          const eventType = value.eventType || value.type;

          logger.info(`Received Kafka message: ${eventType}`, {
            topic,
            partition,
            offset: message.offset,
            key,
          });

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
    const eventType = event.eventType || event.type;
    
    switch (eventType) {
      case 'VENDOR_REGISTRATION_SUBMITTED':
        await handleVendorRegistration(event);
        break;

      default:
        logger.warn(`Unknown event type received: ${eventType}`);
        break;
    }
  } catch (error) {
    logger.error('Error handling event:', error);
    throw error;
  }
};

/**
 * Convert Java LocalDateTime array to JavaScript Date
 * Java LocalDateTime serializes as [year, month, day, hour, minute, second, nanosecond]
 */
const parseJavaDateTime = (dateTimeValue) => {
  if (!dateTimeValue) return new Date();
  
  // If it's already a Date or ISO string, return as Date
  if (dateTimeValue instanceof Date) return dateTimeValue;
  if (typeof dateTimeValue === 'string') return new Date(dateTimeValue);
  
  // If it's a Java LocalDateTime array [year, month, day, hour, minute, second, nanosecond]
  if (Array.isArray(dateTimeValue) && dateTimeValue.length >= 6) {
    const [year, month, day, hour, minute, second, nano = 0] = dateTimeValue;
    // JavaScript months are 0-indexed, Java months are 1-indexed
    return new Date(year, month - 1, day, hour, minute, second, Math.floor(nano / 1000000));
  }
  
  return new Date();
};

const handleVendorRegistration = async (event) => {
  try {
    logger.info('Processing vendor registration event', {
      applicationId: event.applicationId,
      businessName: event.businessName,
      email: event.email,
    });

    // Map event data to application data
    const applicationData = {
      authId: event.authId,
      applicationId: event.applicationId,
      businessName: event.businessName,
      serviceCategory: event.serviceCategory,
      images: {
        profile: event?.images?.profile || (event.profileImageUrl ? { fileUrl: event.profileImageUrl } : null),
        banner: event?.images?.banner || (event.bannerImageUrl ? { fileUrl: event.bannerImageUrl } : null),
      },
      email: event.email,
      phone: event.phone,
      location: event.location,
      place: event.place,
      country: event.country,
      latitude: event.latitude,
      longitude: event.longitude,
      description: event.description,
      agreedToTerms: event.agreedToTerms,
      status: event.status || 'PENDING_REVIEW',
      submittedAt: parseJavaDateTime(event.submittedAt),
      documents: {
        businessLicense: null,
        ownerIdentity: null,
        otherProofs: [],
      },
    };

    // Map documents if provided
    if (event.businessLicenseUrl) {
      applicationData.documents.businessLicense = {
        documentId: `doc-bl-${event.applicationId}`,
        documentType: 'businessLicense',
        fileName: 'business_license',
        fileUrl: event.businessLicenseUrl,
        status: 'PENDING_VERIFICATION',
        uploadedAt: new Date(),
      };
    }

    if (event.ownerIdentityUrl) {
      applicationData.documents.ownerIdentity = {
        documentId: `doc-oi-${event.applicationId}`,
        documentType: 'ownerIdentity',
        fileName: 'owner_identity',
        fileUrl: event.ownerIdentityUrl,
        status: 'PENDING_VERIFICATION',
        uploadedAt: new Date(),
      };
    }

    if (event.otherProofsUrls && Array.isArray(event.otherProofsUrls)) {
      applicationData.documents.otherProofs = event.otherProofsUrls.map((url, index) => ({
        documentId: `doc-op-${event.applicationId}-${index}`,
        documentType: 'otherProof',
        fileName: `other_proof_${index + 1}`,
        fileUrl: url,
        status: 'PENDING_VERIFICATION',
        uploadedAt: new Date(),
      }));
    }

    // Create the vendor application in the database
    await vendorService.createVendorApplication(applicationData);

    logger.info('Vendor registration processed successfully', {
      applicationId: event.applicationId,
    });
  } catch (error) {
    logger.error('Error processing vendor registration:', error);
    throw error;
  }
};

const shutdown = async () => {
  try {
    if (consumer) {
      await kafkaConfig.disconnect();
      logger.info('Kafka consumer shutdown completed');
    }
  } catch (error) {
    logger.error('Error shutting down Kafka consumer:', error);
    throw error;
  }
};

module.exports = {
  initialize,
  startConsuming,
  shutdown,
};
