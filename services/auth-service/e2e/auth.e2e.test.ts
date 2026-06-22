import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '@/app';
import { env } from '@/config/env';
import { closeDatabase, connectToDatabase } from '@/db/sequelize';
import { closeRedis, connectRedis } from '@/db/redis';
import { initModels } from '@/models';
import { passwordResetRepository } from '@/repositories/password-reset.repository';

const app = createApp();
const uniqueEmail = () => `e2e-${randomUUID()}@example.com`;

beforeAll(async () => {
  await connectToDatabase();
  await initModels();
  await connectRedis();
});

afterAll(async () => {
  await closeRedis();
  await closeDatabase();
});

describe('Auth e2e: register -> login -> refresh -> revoke', () => {
  it('completes the full lifecycle against a real database', async () => {
    const email = uniqueEmail();
    const password = 'password123';

    const registerRes = await request(app)
      .post('/auth/register')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ email, password, displayName: 'E2E User' });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.user).toMatchObject({ email, displayName: 'E2E User' });
    const userId: string = registerRes.body.user.id;
    const firstRefreshToken: string = registerRes.body.refreshToken;

    const loginRes = await request(app)
      .post('/auth/login')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ email, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.accessToken).toBeTruthy();

    const refreshRes = await request(app)
      .post('/auth/refresh')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ refreshToken: firstRefreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.refreshToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).not.toBe(firstRefreshToken);

    // Single-use rotation: replaying the original refresh token must now fail.
    const replayRes = await request(app)
      .post('/auth/refresh')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ refreshToken: firstRefreshToken });
    expect(replayRes.status).toBe(401);

    const revokeRes = await request(app)
      .post('/auth/revoke')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ userId });
    expect(revokeRes.status).toBe(204);

    const refreshAfterRevokeRes = await request(app)
      .post('/auth/refresh')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ refreshToken: refreshRes.body.refreshToken });
    expect(refreshAfterRevokeRes.status).toBe(401);
  });

  it('rejects registering the same email twice with a 409', async () => {
    const payload = { email: uniqueEmail(), password: 'password123', displayName: 'Dup User' };

    const firstRes = await request(app)
      .post('/auth/register')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send(payload);
    expect(firstRes.status).toBe(201);

    const secondRes = await request(app)
      .post('/auth/register')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send(payload);
    expect(secondRes.status).toBe(409);
  });

  it('rejects unauthenticated requests with a 401', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'whatever' });
    expect(res.status).toBe(401);
  });
});

describe('Auth e2e: forgot-password -> reset-password', () => {
  it('issues an OTP via Redis and allows resetting the password with it', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/auth/register')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ email, password: 'old-password1', displayName: 'Reset User' });

    const forgotRes = await request(app)
      .post('/auth/forgot-password')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ email });
    expect(forgotRes.status).toBe(202);

    const otp = await passwordResetRepository.getOtp(email);
    expect(otp).toMatch(/^\d{6}$/);

    const resetRes = await request(app)
      .post('/auth/reset-password')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ email, otp, newPassword: 'new-password1' });
    expect(resetRes.status).toBe(204);

    const oldLoginRes = await request(app)
      .post('/auth/login')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ email, password: 'old-password1' });
    expect(oldLoginRes.status).toBe(401);

    const newLoginRes = await request(app)
      .post('/auth/login')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ email, password: 'new-password1' });
    expect(newLoginRes.status).toBe(200);
  });

  it('rejects reset-password with a wrong OTP', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/auth/register')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ email, password: 'old-password1', displayName: 'Reset User 2' });

    await request(app)
      .post('/auth/forgot-password')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ email });

    const resetRes = await request(app)
      .post('/auth/reset-password')
      .set('x-internal-token', env.INTERNAL_API_TOKEN)
      .send({ email, otp: '000000', newPassword: 'new-password1' });
    expect(resetRes.status).toBe(400);
  });
});
