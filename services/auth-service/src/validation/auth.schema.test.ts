import { describe, expect, it } from 'vitest';

import { loginSchema, refreshSchema, registerSchema, revokeSchema } from '@/validation/auth.schema';

describe('registerSchema', () => {
  it('accepts a valid payload', () => {
    const result = registerSchema.shape.body.safeParse({
      email: 'a@b.com',
      password: 'password123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = registerSchema.shape.body.safeParse({
      email: 'not-an-email',
      password: 'password123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password shorter than 8 characters', () => {
    const result = registerSchema.shape.body.safeParse({
      email: 'a@b.com',
      password: 'short',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a displayName outside the 3-30 character range', () => {
    const result = registerSchema.shape.body.safeParse({
      email: 'a@b.com',
      password: 'password123',
      displayName: 'ab',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts a valid payload', () => {
    const result = loginSchema.shape.body.safeParse({ email: 'a@b.com', password: 'password123' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing password', () => {
    const result = loginSchema.shape.body.safeParse({ email: 'a@b.com' });
    expect(result.success).toBe(false);
  });
});

describe('refreshSchema', () => {
  it('accepts a valid payload', () => {
    const result = refreshSchema.shape.body.safeParse({ refreshToken: 'some-token' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing refreshToken field', () => {
    const result = refreshSchema.shape.body.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('revokeSchema', () => {
  it('accepts a valid UUID userId', () => {
    const result = revokeSchema.shape.body.safeParse({ userId: '123e4567-e89b-12d3-a456-426614174000' });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID userId', () => {
    const result = revokeSchema.shape.body.safeParse({ userId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});
