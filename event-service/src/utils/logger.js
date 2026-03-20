const winston = require('winston');
const util = require('util');

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(logColors);

const OMIT_META_KEYS = new Set([
  // Axios / Node HTTP objects commonly contain circular references
  'request',
  'response',
  'socket',
  '_httpMessage',
  'res',
  'req',
  'client',
  'connection',
]);

const safeJsonStringify = (value) => {
  const seen = new WeakSet();

  const replacer = (key, val) => {
    if (OMIT_META_KEYS.has(key)) return '[Omitted]';

    if (val instanceof Error) {
      return {
        name: val.name,
        message: val.message,
        stack: val.stack,
      };
    }

    // Axios errors are huge; keep the useful bits only.
    if (val && typeof val === 'object' && val.isAxiosError) {
      return {
        isAxiosError: true,
        message: val.message,
        code: val.code,
        method: val.config?.method,
        url: val.config?.url,
        status: val.response?.status,
        responseData: val.response?.data,
      };
    }

    if (typeof val === 'function') return '[Function]';

    if (val && typeof val === 'object') {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }

    return val;
  };

  try {
    return JSON.stringify(value, replacer, 2);
  } catch (err) {
    return util.inspect(value, { depth: 5, colors: false });
  }
};

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    let metaString = '';
    if (Object.keys(meta).length > 0) {
      metaString = `\n${safeJsonStringify(meta)}`;
    }
    return `${timestamp} [${level}]: ${message}${metaString}`;
  })
);

const transports = [
  new winston.transports.Console(),
  new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
  }),
  new winston.transports.File({ filename: 'logs/combined.log' }),
];

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels: logLevels,
  format,
  transports,
});

module.exports = logger;
