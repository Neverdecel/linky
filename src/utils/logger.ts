import winston from 'winston';
import path from 'path';
import { config } from './config';
import { RunMode } from '../types';

// Create session-based log directory
const baseLogDir = path.join(process.cwd(), 'logs');
const now = new Date();
const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-mm-ss
const mode = process.env.RUN_MODE || 'unknown';
const sessionId = `${dateStr}_${timeStr}_${mode}`;
const logDir = path.join(baseLogDir, sessionId);

// Ensure log directory exists
import fs from 'fs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
    }),
  ],
});

if (config.runMode === RunMode.SAFE || config.runMode === RunMode.DEBUG) {
  logger.add(new winston.transports.File({
    filename: path.join(logDir, 'actions.log'),
    level: 'debug',
  }));
}

// Log session information
logger.info('Log session started', { 
  sessionId, 
  logDir,
  mode: process.env.RUN_MODE || 'unknown'
});

export default logger;
export { sessionId };