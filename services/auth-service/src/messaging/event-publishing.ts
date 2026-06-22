import {
  AUTH_EVENT_EXCHANGE,
  AUTH_USER_REGISTERED_ROUTING_KEY,
  type AuthUserRegisteredPayload,
} from '@chatapp/common';
import { connect, type Channel, type ChannelModel } from 'amqplib';

import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import {
  PASSWORD_RESET_EXCHANGE,
  PASSWORD_RESET_REQUESTED_ROUTING_KEY,
  type PasswordResetRequestedPayload,
} from '@/messaging/password-reset.events';

let connectionRef: ChannelModel | null = null;
let channel: Channel | null = null;

export const initPublisher = async () => {
  if (!env.RABBITMQ_URL) {
    logger.warn('RABBITMQ_URL is not defined. Skipping RabbitMQ initialization.');
    return;
  }

  if (channel) {
    return;
  }

  const connection = await connect(env.RABBITMQ_URL);
  connectionRef = connection;
  channel = await connection.createChannel();
  await channel.assertExchange(AUTH_EVENT_EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(PASSWORD_RESET_EXCHANGE, 'direct', { durable: true });

  connection.on('close', () => {
    logger.warn('RabbitMQ connection closed');
    channel = null;
    connectionRef = null;
  });
  connection.on('error', (err) => {
    logger.error({ err }, 'RabbitMQ connection error');
  });

  logger.info('Auth service RabbitMQ publisher initialized');
};

export const publishUserRegistered = (payload: AuthUserRegisteredPayload) => {
  if (!channel) {
    logger.warn('RabbitMQ channel is not initialized. Cannot publish message.');
    return;
  }

  const event = {
    type: AUTH_USER_REGISTERED_ROUTING_KEY,
    payload,
    occuredAt: new Date().toISOString(),
    metadata: { version: 1 },
  };

  const published = channel.publish(
    AUTH_EVENT_EXCHANGE,
    AUTH_USER_REGISTERED_ROUTING_KEY,
    Buffer.from(JSON.stringify(event)),
    { contentType: 'application/json', persistent: true },
  );

  if (!published) {
    logger.warn({ event }, 'Failed to publish user registered event');
  }
};

export const publishPasswordResetRequested = (payload: PasswordResetRequestedPayload) => {
  if (!channel) {
    logger.warn('RabbitMQ channel is not initialized. Cannot publish message.');
    return;
  }

  const published = channel.publish(
    PASSWORD_RESET_EXCHANGE,
    PASSWORD_RESET_REQUESTED_ROUTING_KEY,
    Buffer.from(JSON.stringify(payload)),
    { contentType: 'application/json', persistent: true },
  );

  if (!published) {
    logger.warn({ email: payload.email }, 'Failed to publish password reset requested event');
  }
};

export const closePublisher = async () => {
  try {
    const ch = channel;
    if (ch) {
      await ch.close();
      channel = null;
    }
    const conn = connectionRef;
    if (conn) {
      await conn.close();
      connectionRef = null;
    }
  } catch (error) {
    logger.error({ err: error }, 'Error closing RabbitMQ connection/channel');
  }
};
