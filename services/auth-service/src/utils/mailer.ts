import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '@/config/env';
import { logger } from '@/utils/logger';

let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transporter;
};

export const sendPasswordResetOtpEmail = async (to: string, otp: string): Promise<void> => {
  const client = getTransporter();
  if (!client) {
    logger.warn({ to }, 'SMTP is not configured. Skipping password reset email.');
    return;
  }

  const minutes = Math.round(env.OTP_TTL_SECONDS / 60);

  await client.sendMail({
    from: env.MAIL_FROM ?? env.SMTP_USER,
    to,
    subject: 'Your password reset code',
    text: `Your password reset code is ${otp}. It expires in ${minutes} minutes.`,
    html: `<p>Your password reset code is <strong>${otp}</strong>.</p><p>It expires in ${minutes} minutes.</p>`,
  });
};
