require('dotenv').config();
require('express-async-errors');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const connectDB = require('./config/database');
const eurekaClient = require('./config/eureka');
const kafkaConfig = require('./config/kafka');
const logger = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { extractUser } = require('./middleware/extractUser');
const orderController = require('./controllers/orderController');
const orderRoutes = require('./routes/orderRoutes');

const app = express();

app.post('/orders/webhook', express.raw({ type: 'application/json' }), orderController.webhook);

app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (message) => logger.http(message.trim()) } }));

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Order service is running',
    timestamp: new Date().toISOString(),
  });
});

app.use(extractUser);
app.use('/', orderRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 8087;
const NODE_ENV = process.env.NODE_ENV || 'development';

const startServer = async () => {
  try {
    await connectDB();
    logger.info('MongoDB connection established');

    await kafkaConfig.createProducer();
    logger.info('Kafka producer initialized');

    if (process.env.EUREKA_REGISTER_WITH_EUREKA !== 'false') {
      eurekaClient.start();
      logger.info('Eureka client started');
    }

    const server = app.listen(PORT, () => {
      logger.info(`Server running in ${NODE_ENV} mode on port ${PORT}`);
      logger.info(`Service: ${process.env.SERVICE_NAME || 'order-service'}`);
    });

    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          await kafkaConfig.disconnect();
          logger.info('Kafka disconnected');

          eurekaClient.stop();
          logger.info('Eureka client stopped');

          const mongoose = require('mongoose');
          await mongoose.connection.close();
          logger.info('MongoDB connection closed');

          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown:', error);
          process.exit(1);
        }
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
