import winston from 'winston';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const logger = winston.createLogger({
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: { service: 'fixedline-backend' },
  transports: [
    new winston.transports.Console({
      format: process.env['NODE_ENV'] === 'production'
        ? combine(timestamp(), json())
        : combine(colorize(), simple()),
    }),
  ],
});

export default logger;
