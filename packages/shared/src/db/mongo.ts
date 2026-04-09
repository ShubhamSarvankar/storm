import mongoose from 'mongoose';
import { createLogger } from '../logger.js';

const logger = createLogger('mongo');

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 2_000;

export async function connectMongo(uri?: string): Promise<void> {
  const connectionUri = uri ?? process.env['MONGO_URI'];
  if (!connectionUri) {
    throw new Error('MONGO_URI environment variable is not set');
  }

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err: unknown) => logger.error({ err }, 'MongoDB error'));

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(connectionUri, {
        serverSelectionTimeoutMS: 5_000,
        socketTimeoutMS: 45_000,
      });
      logger.info('MongoDB connected');
      return;
    } catch (err) {
      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      logger.warn({ err, attempt, delay }, 'MongoDB connection failed, retrying...');
      if (attempt === MAX_RETRIES) throw err;
      await sleep(delay);
    }
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected cleanly');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}