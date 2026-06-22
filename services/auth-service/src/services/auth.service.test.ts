import { beforeEach, describe, expect, it, vi } from 'vitest';

// auth.service.ts pulls in the repository modules (for its exported singleton),
// which import @/models — mock that leaf so a real (unconnected) Sequelize Model.init()
// never runs during these unit tests.
vi.mock('@/models', () => ({
  UserCredentials: class {},
  RefreshToken: class {},
}));

vi.mock('@/messaging/event-publishing', () => ({
  publishUserRegistered: vi.fn(),
}));

vi.mock('@/utils/token', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  verifyPassword: vi.fn(),
  signAccessToken: vi.fn().mockReturnValue('access-token'),
  signRefreshToken: vi.fn().mockReturnValue('refresh-token'),
  verifyRefreshToken: vi.fn(),
}));

import { AuthService } from '@/services/auth.service';
import { publishUserRegistered } from '@/messaging/event-publishing';
import { verifyPassword, verifyRefreshToken } from '@/utils/token';
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
});

const createMockRefreshTokenRepository = () => ({
  create: vi.fn(),
  findByTokenId: vi.fn(),
  destroy: vi.fn(),
  destroyAllByUserId: vi.fn(),
});

const fakeUser = {
  id: 'user-1',
  email: 'a@b.com',
  displayName: 'Test User',
  passwordHash: 'hashed-password',
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
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();
    userRepo.findByEmail.mockResolvedValue(null);
    userRepo.create.mockResolvedValue(fakeUser);
    refreshRepo.create.mockResolvedValue(fakeTokenRecord());

    const service = new AuthService(userRepo as never, refreshRepo as never);

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
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();
    userRepo.findByEmail.mockResolvedValue(fakeUser);

    const service = new AuthService(userRepo as never, refreshRepo as never);

    await expect(
      service.register({ email: fakeUser.email, password: 'password123', displayName: 'X' }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'User with this email already exists' });
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it('rolls back the transaction and rethrows when creation fails', async () => {
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();
    userRepo.findByEmail.mockResolvedValue(null);
    const dbError = new Error('insert failed');
    userRepo.create.mockRejectedValue(dbError);

    const service = new AuthService(userRepo as never, refreshRepo as never);

    await expect(
      service.register({ email: fakeUser.email, password: 'password123', displayName: 'X' }),
    ).rejects.toBe(dbError);
    expect(fakeTransaction.rollback).toHaveBeenCalledTimes(1);
    expect(fakeTransaction.commit).not.toHaveBeenCalled();
  });
});

describe('AuthService.login', () => {
  it('returns tokens for valid credentials', async () => {
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();
    userRepo.findByEmail.mockResolvedValue(fakeUser);
    refreshRepo.create.mockResolvedValue(fakeTokenRecord());
    vi.mocked(verifyPassword).mockResolvedValue(true);

    const service = new AuthService(userRepo as never, refreshRepo as never);

    const result = await service.login({ email: fakeUser.email, password: 'password123' });

    expect(result).toEqual({ accessToken: 'access-token', refreshToken: 'refresh-token' });
  });

  it('throws a 401 HttpError for an unknown email', async () => {
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();
    userRepo.findByEmail.mockResolvedValue(null);

    const service = new AuthService(userRepo as never, refreshRepo as never);

    await expect(
      service.login({ email: 'nope@b.com', password: 'password123' }),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
  });

  it('throws a 401 HttpError for a wrong password', async () => {
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();
    userRepo.findByEmail.mockResolvedValue(fakeUser);
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const service = new AuthService(userRepo as never, refreshRepo as never);

    await expect(
      service.login({ email: fakeUser.email, password: 'wrong-password' }),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
  });
});

describe('AuthService.refreshTokens', () => {
  it('rotates the refresh token on success', async () => {
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();
    const oldRecord = fakeTokenRecord();
    vi.mocked(verifyRefreshToken).mockReturnValue({ sub: fakeUser.id, tokenId: oldRecord.tokenId });
    refreshRepo.findByTokenId.mockResolvedValue(oldRecord);
    userRepo.findById.mockResolvedValue(fakeUser);
    refreshRepo.create.mockResolvedValue(fakeTokenRecord({ tokenId: 'token-2' }));

    const service = new AuthService(userRepo as never, refreshRepo as never);

    const result = await service.refreshTokens('old-refresh-token');

    expect(refreshRepo.destroy).toHaveBeenCalledWith(oldRecord);
    expect(result).toEqual({ accessToken: 'access-token', refreshToken: 'refresh-token' });
  });

  it('throws a 401 HttpError when the token record is not found', async () => {
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();
    vi.mocked(verifyRefreshToken).mockReturnValue({ sub: fakeUser.id, tokenId: 'missing' });
    refreshRepo.findByTokenId.mockResolvedValue(null);

    const service = new AuthService(userRepo as never, refreshRepo as never);

    await expect(service.refreshTokens('bogus')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid refresh token',
    });
  });

  it('destroys and rejects an expired token', async () => {
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();
    const expiredRecord = fakeTokenRecord({ expiresAt: new Date(Date.now() - 1000) });
    vi.mocked(verifyRefreshToken).mockReturnValue({ sub: fakeUser.id, tokenId: expiredRecord.tokenId });
    refreshRepo.findByTokenId.mockResolvedValue(expiredRecord);

    const service = new AuthService(userRepo as never, refreshRepo as never);

    await expect(service.refreshTokens('expired')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Refresh token has expired',
    });
    expect(refreshRepo.destroy).toHaveBeenCalledWith(expiredRecord);
  });

  it('throws a 401 HttpError when the user no longer exists', async () => {
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();
    const record = fakeTokenRecord();
    vi.mocked(verifyRefreshToken).mockReturnValue({ sub: 'deleted-user', tokenId: record.tokenId });
    refreshRepo.findByTokenId.mockResolvedValue(record);
    userRepo.findById.mockResolvedValue(null);

    const service = new AuthService(userRepo as never, refreshRepo as never);

    await expect(service.refreshTokens('orphaned')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid refresh token',
    });
  });
});

describe('AuthService.revokeRefreshToken', () => {
  it('destroys all refresh tokens for the given user', async () => {
    const userRepo = createMockUserCredentialsRepository();
    const refreshRepo = createMockRefreshTokenRepository();

    const service = new AuthService(userRepo as never, refreshRepo as never);
    await service.revokeRefreshToken('user-1');

    expect(refreshRepo.destroyAllByUserId).toHaveBeenCalledWith('user-1');
  });
});
