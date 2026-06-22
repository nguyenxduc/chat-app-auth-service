import {
  connect,
  type Channel,
  type ChannelModel,
  type Connection,
  type ConsumeMessage,
  type Replies,
} from 'amqplib';

import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { sendPasswordResetOtpEmail } from '@/utils/mailer';
import {
  PASSWORD_RESET_EXCHANGE,
  PASSWORD_RESET_QUEUE,
  PASSWORD_RESET_REQUESTED_ROUTING_KEY,
  type PasswordResetRequestedPayload,
} from '@/messaging/password-reset.events';

type ManageConnection = Connection & ChannelModel;

let connectionRef: ManageConnection | null = null;
let channel: Channel | null = null;
let consumerTag: string | null = null;

const handleMessage = async (message: ConsumeMessage, ch: Channel) => {
  const raw = message.content.toString('utf-8');
  const payload = JSON.parse(raw) as PasswordResetRequestedPayload;

  await sendPasswordResetOtpEmail(payload.email, payload.otp);

  ch.ack(message);
};

export const startPasswordResetConsumer = async () => {
  if (!env.RABBITMQ_URL) {
    logger.warn('RabbitMQ URL is not configured, skip');
    return;
  }

  if (channel) {
    return;
  }

  const connection = (await connect(env.RABBITMQ_URL)) as ManageConnection;
  connectionRef = connection;
  const ch = await connection.createChannel();
  channel = ch;

  await ch.assertExchange(PASSWORD_RESET_EXCHANGE, 'direct', { durable: true });
  const queue = await ch.assertQueue(PASSWORD_RESET_QUEUE, { durable: true });
  await ch.bindQueue(queue.queue, PASSWORD_RESET_EXCHANGE, PASSWORD_RESET_REQUESTED_ROUTING_KEY);

  const consumeHandler = (msg: ConsumeMessage | null) => {
    if (!msg) {
      return;
    }

    void handleMessage(msg, ch).catch((error: unknown) => {
      logger.error({ err: error }, 'Failed to process password reset event');
      ch.nack(msg, false, false);
    });
  };

  const result: Replies.Consume = await ch.consume(queue.queue, consumeHandler);
  consumerTag = result.consumerTag;

  connection.on('close', () => {
    logger.warn('Password reset consumer connection closed');
    connectionRef = null;
    channel = null;
    consumerTag = null;
  });

  connection.on('error', (error) => {
    logger.error({ err: error }, 'Password reset consumer connection error');
  });

  logger.info('Password reset consumer started');
};

export const stopPasswordResetConsumer = async () => {
  try {
    const ch = channel;
    if (ch && consumerTag) {
      await ch.cancel(consumerTag);
      consumerTag = null;
    }
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
    logger.error({ err: error }, 'Failed to stop password reset consumer');
  }
};
