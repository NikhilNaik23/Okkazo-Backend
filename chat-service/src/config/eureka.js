const Eureka = require('eureka-js-client').Eureka;
const logger = require('../utils/logger');

let client = null;

const initialize = () => {
  const serviceName = process.env.SERVICE_NAME || 'chat-service';
  const serviceHost = process.env.SERVICE_HOST || 'chat-service';
  const servicePort = Number(process.env.PORT) || 8089;

  client = new Eureka({
    instance: {
      app: serviceName.toUpperCase(),
      instanceId: `${serviceHost}:${serviceName}:${servicePort}`,
      hostName: serviceHost,
      ipAddr: serviceHost,
      statusPageUrl: `http://${serviceHost}:${servicePort}/health`,
      healthCheckUrl: `http://${serviceHost}:${servicePort}/health`,
      port: { $: servicePort, '@enabled': true },
      vipAddress: serviceName,
      dataCenterInfo: {
        '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo',
        name: 'MyOwn',
      },
      metadata: {
        'management.port': servicePort,
      },
    },
    eureka: {
      host: process.env.EUREKA_HOST || 'localhost',
      port: Number(process.env.EUREKA_PORT) || 8761,
      servicePath: '/eureka/apps/',
      maxRetries: 10,
      requestRetryDelay: 5000,
      registerWithEureka: true,
      fetchRegistry: true,
    },
  });

  return client;
};

const start = () => {
  if (!client) initialize();

  client.start((error) => {
    if (error) {
      logger.error('Error starting Eureka client:', error);
    } else {
      logger.info('Eureka client started successfully');
    }
  });

  client.on('error', (error) => {
    logger.error('Eureka client error:', error);
  });

  client.on('registered', () => {
    logger.info('Service registered with Eureka');
  });

  client.on('deregistered', () => {
    logger.info('Service deregistered from Eureka');
  });
};

const stop = () => {
  if (client) {
    client.stop((error) => {
      if (error) {
        logger.error('Error stopping Eureka client:', error);
      } else {
        logger.info('Eureka client stopped successfully');
      }
    });
  }
};

module.exports = { initialize, start, stop };
