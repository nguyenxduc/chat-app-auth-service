import { getRedisClient } from '@/db/redis';
import { env } from '@/config/env';

const otpKey = (email: string) => `password-reset-otp:${email.toLowerCase()}`;

export class PasswordResetRepository {
  async saveOtp(email: string, otp: string): Promise<void> {
    const client = getRedisClient();
    if (!client) {
      throw new Error('Redis is not configured; cannot store password reset OTP');
    }
    await client.set(otpKey(email), otp, { EX: env.OTP_TTL_SECONDS });
  }

  async getOtp(email: string): Promise<string | null> {
    const client = getRedisClient();
    if (!client) {
      return null;
    }
    return client.get(otpKey(email));
  }

  async deleteOtp(email: string): Promise<void> {
    const client = getRedisClient();
    if (!client) {
      return;
    }
    await client.del(otpKey(email));
  }
}

export const passwordResetRepository = new PasswordResetRepository();
