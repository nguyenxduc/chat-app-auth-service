import { sequelize } from '@/db/sequelize';
import { RefreshToken, UserCredentials } from '@/models';
import { AuthResponse, AuthTokens, LoginInput, RegisterInput } from '@/types/auth';
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from '@/utils/token';
import { HttpError } from '@chatapp/common';
import { Op, Transaction } from 'sequelize';
import crypto from 'crypto';
import { publishUserRegistered } from '@/messaging/event-publishing';
import { logger } from '@/utils/logger';

const REFRESH_TOKEN_TTL_DAYS = 30;

export const register = async (input: RegisterInput): Promise<AuthResponse> => {
  const existing = await UserCredentials.findOne({
    where: { email: { [Op.eq]: input.email } },
  });

  if (existing) {
    throw new HttpError(409, 'User with this email already exists');
  }

  const transaction = await sequelize.transaction();
  try {
    const passwordHash = await hashPassword(input.password);
    const user = await UserCredentials.create(
      {
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      },
      { transaction },
    );

    const refreshTokenRecord = await createRefreshToken(user.id, transaction);

    await transaction.commit();

    const accessToken = signAccessToken({ sub: user.id, email: user.email });
    const refreshToken = signRefreshToken({
      sub: user.id,
      tokenId: refreshTokenRecord.tokenId,
    });

    const userData = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    };

    publishUserRegistered(userData);

    return {
      accessToken,
      refreshToken,
      user: userData,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const login = async (input: LoginInput): Promise<AuthTokens> => {
  const credential = await UserCredentials.findOne({ where: { email: { [Op.eq]: input.email } } });
  if (!credential) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const valid = await verifyPassword(input.password, credential.passwordHash);
  if (!valid) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const refreshTokenRecord = await createRefreshToken(credential.id);

  const accessToken = signAccessToken({ sub: credential.id, email: credential.email });
  const refreshToken = signRefreshToken({
    sub: credential.id,
    tokenId: refreshTokenRecord.tokenId,
  });

  return {
    accessToken,
    refreshToken,
  };
};

export const refreshTokens = async (token: string): Promise<AuthTokens> => {
  const payload = verifyRefreshToken(token);

  const tokenRecord = await RefreshToken.findOne({
    where: { tokenId: payload.tokenId, userId: payload.sub },
  });

  if (!tokenRecord) {
    throw new HttpError(401, 'Invalid refresh token');
  }

  if (tokenRecord.expiresAt.getTime() < Date.now()) {
    await tokenRecord.destroy();
    throw new HttpError(401, 'Refresh token has expired');
  }

  const credential = await UserCredentials.findByPk(payload.sub);

  if (!credential) {
    logger.warn({ userId: payload.sub }, 'User missing for refresh token');
    throw new HttpError(401, 'Invalid refresh token');
  }

  await tokenRecord.destroy();
  const newTokenRecord = await createRefreshToken(credential.id);

  return {
    accessToken: signAccessToken({ sub: credential.id, email: credential.email }),
    refreshToken: signRefreshToken({ sub: credential.id, tokenId: newTokenRecord.tokenId }),
  };
};

export const revokeRefreshToken = async (userId: string) => {
  await RefreshToken.destroy({ where: { userId } });
};

const createRefreshToken = async (userId: string, transaction?: Transaction) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS); // 30 days from now

  const tokenId = crypto.randomUUID();

  const record = await RefreshToken.create(
    {
      userId,
      tokenId,
      expiresAt,
    },
    { transaction },
  );

  return record;
};
