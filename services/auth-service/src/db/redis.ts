import { createClient, type RedisClientType } from 'redis';

import { env } from '@/config/env';
import { logger } from '@/utils/logger';

let client: RedisClientType | null = null;

export const connectRedis = async (): Promise<void> => {
  if (!env.REDIS_URL) {
    logger.warn('REDIS_URL is not defined. Skipping Redis initialization.');
    return;
  }

  const redisClient: RedisClientType = createClient({ url: env.REDIS_URL });
  redisClient.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });

  await redisClient.connect();
  client = redisClient;
  logger.info('Auth service Redis client connected');
};

export const closeRedis = async (): Promise<void> => {
  if (client) {
    await client.quit();
    client = null;
    logger.info('Auth service Redis client closed');
  }
};

export const getRedisClient = (): RedisClientType | null => client;
