import { beforeEach, describe, expect, it, vi } from 'vitest';

// Prevent createEnv Zod validation from failing when AUTH_DB_URL is not set in CI.
vi.mock('@/config/env', () => ({
  env: {
    AUTH_DB_URL: 'postgres://test:test@localhost:5432/test',
    JWT_SECRET: 'unit-test-jwt-secret-at-least-32-chars',
    JWT_REFRESH_SECRET: 'unit-test-refresh-secret-at-least-32c',
    JWT_EXPIRES_IN: '1d',
    JWT_REFRESH_EXPIRES_IN: '30d',
    RABBITMQ_URL: 'amqp://localhost',
    INTERNAL_API_TOKEN: 'unit-test-internal-token-at-least-32c',
    NODE_ENV: 'test',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    OTP_TTL_SECONDS: 600,
    AUTH_SERVICE_PORT: 4003,
  },
}));

// Prevent Sequelize from connecting to a real database in unit tests.
vi.mock('@/db/sequelize', () => ({
  sequelize: { transaction: vi.fn() },
  connectToDatabase: vi.fn(),
  closeDatabase: vi.fn(),
}));

// auth.service.ts pulls in the repository modules (for its exported singleton),
// which import @/models — mock that leaf so a real (unconnected) Sequelize Model.init()
// never runs during these unit tests.
vi.mock('@/models', () => ({
  UserCredentials: class {},
  RefreshToken: class {},
}));

vi.mock('@/messaging/event-publishing', () => ({
  publishUserRegistered: vi.fn(),
  publishPasswordResetRequested: vi.fn(),
}));

vi.mock('@/utils/token', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  verifyPassword: vi.fn(),
  signAccessToken: vi.fn().mockReturnValue('access-token'),
  signRefreshToken: vi.fn().mockReturnValue('refresh-token'),
  verifyRefreshToken: vi.fn(),
}));

vi.mock('@/utils/google', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import { AuthService } from '@/services/auth.service';
import { publishPasswordResetRequested, publishUserRegistered } from '@/messaging/event-publishing';
import { verifyPassword, verifyRefreshToken } from '@/utils/token';
import { verifyGoogleIdToken } from '@/utils/google';
import { sequelize } from '@/db/sequelize';

const fakeTransaction = {
  commit: vi.fn().mockResolvedValue(undefined),
  rollback: vi.fn().mockResolvedValue(undefined),
};

vi.spyOn(sequelize, 'transaction').mockImplementation(
  () => Promise.resolve(fakeTransaction) as never,
);

const createMockUserCredentialsRepository = () => ({
  findByEmail: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  findByGoogleId: vi.fn(),
  createFromGoogle: vi.fn(),
  linkGoogleId: vi.fn(),
  updatePassword: vi.fn(),
});

const createMockRefreshTokenRepository = () => ({
  create: vi.fn(),
  findByTokenId: vi.fn(),
  destroy: vi.fn(),
  destroyAllByUserId: vi.fn(),
});

const createMockPasswordResetRepository = () => ({
  saveOtp: vi.fn(),
  getOtp: vi.fn(),
  deleteOtp: vi.fn(),
});

const createService = (
  userRepo = createMockUserCredentialsRepository(),
  refreshRepo = createMockRefreshTokenRepository(),
  passwordResetRepo = createMockPasswordResetRepository(),
) => ({
  service: new AuthService(userRepo as never, refreshRepo as never, passwordResetRepo as never),
  userRepo,
  refreshRepo,
  passwordResetRepo,
});

const fakeUser = {
  id: 'user-1',
  email: 'a@b.com',
  displayName: 'Test User',
  passwordHash: 'hashed-password',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
};

const fakeGoogleUser = {
  id: 'user-2',
  email: 'google@b.com',
  displayName: 'Google User',
  passwordHash: null,
  googleId: 'google-sub-1',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
};

const fakeTokenRecord = (overrides: Partial<{ tokenId: string; expiresAt: Date }> = {}) => ({
  tokenId: 'token-1',
  expiresAt: new Date(Date.now() + 1000 * 60 * 60),
  destroy: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  fakeTransaction.commit.mockClear();
  fakeTransaction.rollback.mockClear();
});

describe('AuthService.register', () => {
  it('creates a user, commits the transaction, and publishes user.registered', async () => {
    const { service, userRepo, refreshRepo } = createService();
    userRepo.findByEmail.mockResolvedValue(null);
    userRepo.create.mockResolvedValue(fakeUser);
    refreshRepo.create.mockResolvedValue(fakeTokenRecord());

    const result = await service.register({
      email: fakeUser.email,
      password: 'password123',
      displayName: fakeUser.displayName,
    });

    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: fakeUser.id,
        email: fakeUser.email,
        displayName: fakeUser.displayName,
        createdAt: fakeUser.createdAt.toISOString(),
      },
    });
    expect(fakeTransaction.commit).toHaveBeenCalledTimes(1);
    expect(fakeTransaction.rollback).not.toHaveBeenCalled();
    expect(publishUserRegistered).toHaveBeenCalledWith({
      id: fakeUser.id,
      email: fakeUser.email,
      displayName: fakeUser.displayName,
      createdAt: fakeUser.createdAt.toISOString(),
    });
  });

  it('throws a 409 HttpError when the email is already registered, without starting a transaction', async () => {
    const { service, userRepo } = createService();
    userRepo.findByEmail.mockResolvedValue(fakeUser);

    await expect(
      service.register({ email: fakeUser.email, password: 'password123', displayName: 'X' }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'User with this email already exists' });
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it('rolls back the transaction and rethrows when creation fails', async () => {
    const { service, userRepo } = createService();
    userRepo.findByEmail.mockResolvedValue(null);
    const dbError = new Error('insert failed');
    userRepo.create.mockRejectedValue(dbError);

    await expect(
      service.register({ email: fakeUser.email, password: 'password123', displayName: 'X' }),
    ).rejects.toBe(dbError);
    expect(fakeTransaction.rollback).toHaveBeenCalledTimes(1);
    expect(fakeTransaction.commit).not.toHaveBeenCalled();
  });
});

describe('AuthService.login', () => {
  it('returns tokens for valid credentials', async () => {
    const { service, userRepo, refreshRepo } = createService();
    userRepo.findByEmail.mockResolvedValue(fakeUser);
    refreshRepo.create.mockResolvedValue(fakeTokenRecord());
    vi.mocked(verifyPassword).mockResolvedValue(true);

    const result = await service.login({ email: fakeUser.email, password: 'password123' });

    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: fakeUser.id,
        email: fakeUser.email,
        displayName: fakeUser.displayName,
        createdAt: fakeUser.createdAt.toISOString(),
      },
    });
  });

  it('throws a 401 HttpError for an unknown email', async () => {
    const { service, userRepo } = createService();
    userRepo.findByEmail.mockResolvedValue(null);

    await expect(
      service.login({ email: 'nope@b.com', password: 'password123' }),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
  });

  it('throws a 401 HttpError for a wrong password', async () => {
    const { service, userRepo } = createService();
    userRepo.findByEmail.mockResolvedValue(fakeUser);
    vi.mocked(verifyPassword).mockResolvedValue(false);

    await expect(
      service.login({ email: fakeUser.email, password: 'wrong-password' }),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
  });

  it('throws a 401 HttpError for a Google-only account with no password set', async () => {
    const { service, userRepo } = createService();
    userRepo.findByEmail.mockResolvedValue(fakeGoogleUser);

    await expect(
      service.login({ email: fakeGoogleUser.email, password: 'whatever' }),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
    expect(verifyPassword).not.toHaveBeenCalled();
  });
});

describe('AuthService.refreshTokens', () => {
  it('rotates the refresh token on success', async () => {
    const { service, userRepo, refreshRepo } = createService();
    const oldRecord = fakeTokenRecord();
    vi.mocked(verifyRefreshToken).mockReturnValue({ sub: fakeUser.id, tokenId: oldRecord.tokenId });
    refreshRepo.findByTokenId.mockResolvedValue(oldRecord);
    userRepo.findById.mockResolvedValue(fakeUser);
    refreshRepo.create.mockResolvedValue(fakeTokenRecord({ tokenId: 'token-2' }));

    const result = await service.refreshTokens('old-refresh-token');

    expect(refreshRepo.destroy).toHaveBeenCalledWith(oldRecord);
    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: fakeUser.id,
        email: fakeUser.email,
        displayName: fakeUser.displayName,
        createdAt: fakeUser.createdAt.toISOString(),
      },
    });
  });

  it('throws a 401 HttpError when the token record is not found', async () => {
    const { service, refreshRepo } = createService();
    vi.mocked(verifyRefreshToken).mockReturnValue({ sub: fakeUser.id, tokenId: 'missing' });
    refreshRepo.findByTokenId.mockResolvedValue(null);

    await expect(service.refreshTokens('bogus')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid refresh token',
    });
  });

  it('destroys and rejects an expired token', async () => {
    const { service, refreshRepo } = createService();
    const expiredRecord = fakeTokenRecord({ expiresAt: new Date(Date.now() - 1000) });
    vi.mocked(verifyRefreshToken).mockReturnValue({ sub: fakeUser.id, tokenId: expiredRecord.tokenId });
    refreshRepo.findByTokenId.mockResolvedValue(expiredRecord);

    await expect(service.refreshTokens('expired')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Refresh token has expired',
    });
    expect(refreshRepo.destroy).toHaveBeenCalledWith(expiredRecord);
  });

  it('throws a 401 HttpError when the user no longer exists', async () => {
    const { service, userRepo, refreshRepo } = createService();
    const record = fakeTokenRecord();
    vi.mocked(verifyRefreshToken).mockReturnValue({ sub: 'deleted-user', tokenId: record.tokenId });
    refreshRepo.findByTokenId.mockResolvedValue(record);
    userRepo.findById.mockResolvedValue(null);

    await expect(service.refreshTokens('orphaned')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid refresh token',
    });
  });
});

describe('AuthService.revokeRefreshToken', () => {
  it('destroys all refresh tokens for the given user', async () => {
    const { service, refreshRepo } = createService();
    await service.revokeRefreshToken('user-1');

    expect(refreshRepo.destroyAllByUserId).toHaveBeenCalledWith('user-1');
  });
});

describe('AuthService.loginWithGoogle', () => {
  it('logs in an existing Google-linked account', async () => {
    const { service, userRepo, refreshRepo } = createService();
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({
      sub: fakeGoogleUser.googleId,
      email: fakeGoogleUser.email,
      name: fakeGoogleUser.displayName,
    });
    userRepo.findByGoogleId.mockResolvedValue(fakeGoogleUser);
    refreshRepo.create.mockResolvedValue(fakeTokenRecord());

    const result = await service.loginWithGoogle('id-token');

    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: fakeGoogleUser.id,
        email: fakeGoogleUser.email,
        displayName: fakeGoogleUser.displayName,
        createdAt: fakeGoogleUser.createdAt.toISOString(),
      },
    });
    expect(userRepo.findByEmail).not.toHaveBeenCalled();
    expect(userRepo.createFromGoogle).not.toHaveBeenCalled();
  });

  it('links an existing email/password account on first Google login', async () => {
    const { service, userRepo, refreshRepo } = createService();
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({
      sub: 'google-sub-new',
      email: fakeUser.email,
      name: fakeUser.displayName,
    });
    userRepo.findByGoogleId.mockResolvedValue(null);
    userRepo.findByEmail.mockResolvedValue(fakeUser);
    refreshRepo.create.mockResolvedValue(fakeTokenRecord());

    await service.loginWithGoogle('id-token');

    expect(userRepo.linkGoogleId).toHaveBeenCalledWith(fakeUser.id, 'google-sub-new');
    expect(userRepo.createFromGoogle).not.toHaveBeenCalled();
    expect(publishUserRegistered).not.toHaveBeenCalled();
  });

  it('creates a brand new account and publishes user.registered when no match exists', async () => {
    const { service, userRepo, refreshRepo } = createService();
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({
      sub: fakeGoogleUser.googleId,
      email: fakeGoogleUser.email,
      name: fakeGoogleUser.displayName,
    });
    userRepo.findByGoogleId.mockResolvedValue(null);
    userRepo.findByEmail.mockResolvedValue(null);
    userRepo.createFromGoogle.mockResolvedValue(fakeGoogleUser);
    refreshRepo.create.mockResolvedValue(fakeTokenRecord());

    await service.loginWithGoogle('id-token');

    expect(userRepo.createFromGoogle).toHaveBeenCalledWith({
      email: fakeGoogleUser.email,
      displayName: fakeGoogleUser.displayName,
      googleId: fakeGoogleUser.googleId,
    });
    expect(publishUserRegistered).toHaveBeenCalledWith({
      id: fakeGoogleUser.id,
      email: fakeGoogleUser.email,
      displayName: fakeGoogleUser.displayName,
      createdAt: fakeGoogleUser.createdAt.toISOString(),
    });
  });

  it('propagates an invalid Google token error unchanged', async () => {
    const { service } = createService();
    vi.mocked(verifyGoogleIdToken).mockRejectedValue(
      Object.assign(new Error('Invalid Google token'), { statusCode: 401 }),
    );

    await expect(service.loginWithGoogle('bad-token')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('AuthService.requestPasswordReset', () => {
  it('generates and stores an OTP, then publishes a password reset event', async () => {
    const { service, userRepo, passwordResetRepo } = createService();
    userRepo.findByEmail.mockResolvedValue(fakeUser);

    await service.requestPasswordReset(fakeUser.email);

    expect(passwordResetRepo.saveOtp).toHaveBeenCalledWith(
      fakeUser.email,
      expect.stringMatching(/^\d{6}$/),
    );
    expect(publishPasswordResetRequested).toHaveBeenCalledWith({
      email: fakeUser.email,
      otp: expect.stringMatching(/^\d{6}$/),
    });
  });

  it('does nothing and does not leak whether the email exists', async () => {
    const { service, userRepo, passwordResetRepo } = createService();
    userRepo.findByEmail.mockResolvedValue(null);

    await service.requestPasswordReset('unknown@b.com');

    expect(passwordResetRepo.saveOtp).not.toHaveBeenCalled();
    expect(publishPasswordResetRequested).not.toHaveBeenCalled();
  });
});

describe('AuthService.resetPassword', () => {
  it('updates the password, clears the OTP, and revokes existing refresh tokens', async () => {
    const { service, userRepo, refreshRepo, passwordResetRepo } = createService();
    passwordResetRepo.getOtp.mockResolvedValue('123456');
    userRepo.findByEmail.mockResolvedValue(fakeUser);

    await service.resetPassword({
      email: fakeUser.email,
      otp: '123456',
      newPassword: 'new-password123',
    });

    expect(userRepo.updatePassword).toHaveBeenCalledWith(fakeUser.id, 'hashed-password');
    expect(passwordResetRepo.deleteOtp).toHaveBeenCalledWith(fakeUser.email);
    expect(refreshRepo.destroyAllByUserId).toHaveBeenCalledWith(fakeUser.id);
  });

  it('throws a 400 HttpError when the OTP does not match', async () => {
    const { service, userRepo, passwordResetRepo } = createService();
    passwordResetRepo.getOtp.mockResolvedValue('123456');

    await expect(
      service.resetPassword({ email: fakeUser.email, otp: '000000', newPassword: 'new-password123' }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid or expired OTP' });
    expect(userRepo.updatePassword).not.toHaveBeenCalled();
  });

  it('throws a 400 HttpError when the OTP has expired (no longer in storage)', async () => {
    const { service, passwordResetRepo } = createService();
    passwordResetRepo.getOtp.mockResolvedValue(null);

    await expect(
      service.resetPassword({ email: fakeUser.email, otp: '123456', newPassword: 'new-password123' }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid or expired OTP' });
  });
});
