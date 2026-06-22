import 'dotenv/config';

import { createEnv, z } from '@chatapp/common';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  AUTH_SERVICE_PORT: z.coerce.number().int().min(0).max(65_535).default(4003),
  AUTH_DB_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('1d'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  RABBITMQ_URL: z.string(),
  INTERNAL_API_TOKEN: z.string().min(32),
  REDIS_URL: z.string().optional(),
  /** Google OAuth2 client id used to verify "Login with Google" id tokens. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(0).max(65_535).default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
});

type EnvType = z.infer<typeof envSchema>;

export const env: EnvType = createEnv(envSchema, {
  serviceName: 'auth-service',
});

export type Env = typeof env;
