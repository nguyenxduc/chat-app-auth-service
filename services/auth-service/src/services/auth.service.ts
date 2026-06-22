import { sequelize } from '@/db/sequelize';
import type { RefreshToken } from '@/models';
import {
  refreshTokenRepository,
  RefreshTokenRepository,
} from '@/repositories/refresh-token.repository';
import {
  userCredentialsRepository,
  UserCredentialsRepository,
} from '@/repositories/user-credentials.repository';
import { AuthResponse, AuthTokens, LoginInput, RegisterInput } from '@/types/auth';
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from '@/utils/token';
import { HttpError } from '@chatapp/common';
import type { Transaction } from 'sequelize';
import crypto from 'crypto';
import { publishUserRegistered } from '@/messaging/event-publishing';
import { logger } from '@/utils/logger';

const REFRESH_TOKEN_TTL_DAYS = 30;

export class AuthService {
  constructor(
    private readonly userCredentialsRepository: UserCredentialsRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const existing = await this.userCredentialsRepository.findByEmail(input.email);

    if (existing) {
      throw new HttpError(409, 'User with this email already exists');
    }

    const transaction = await sequelize.transaction();
    try {
      const passwordHash = await hashPassword(input.password);
      const user = await this.userCredentialsRepository.create(
        {
          email: input.email,
          displayName: input.displayName,
          passwordHash,
        },
        { transaction },
      );

      const refreshTokenRecord = await this.createRefreshToken(user.id, transaction);

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
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const credential = await this.userCredentialsRepository.findByEmail(input.email);
    if (!credential) {
      throw new HttpError(401, 'Invalid credentials');
    }

    const valid = await verifyPassword(input.password, credential.passwordHash);
    if (!valid) {
      throw new HttpError(401, 'Invalid credentials');
    }

    const refreshTokenRecord = await this.createRefreshToken(credential.id);

    const accessToken = signAccessToken({ sub: credential.id, email: credential.email });
    const refreshToken = signRefreshToken({
      sub: credential.id,
      tokenId: refreshTokenRecord.tokenId,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  async refreshTokens(token: string): Promise<AuthTokens> {
    const payload = verifyRefreshToken(token);

    const tokenRecord = await this.refreshTokenRepository.findByTokenId(
      payload.tokenId,
      payload.sub,
    );

    if (!tokenRecord) {
      throw new HttpError(401, 'Invalid refresh token');
    }

    if (tokenRecord.expiresAt.getTime() < Date.now()) {
      await this.refreshTokenRepository.destroy(tokenRecord);
      throw new HttpError(401, 'Refresh token has expired');
    }

    const credential = await this.userCredentialsRepository.findById(payload.sub);

    if (!credential) {
      logger.warn({ userId: payload.sub }, 'User missing for refresh token');
      throw new HttpError(401, 'Invalid refresh token');
    }

    await this.refreshTokenRepository.destroy(tokenRecord);
    const newTokenRecord = await this.createRefreshToken(credential.id);

    return {
      accessToken: signAccessToken({ sub: credential.id, email: credential.email }),
      refreshToken: signRefreshToken({ sub: credential.id, tokenId: newTokenRecord.tokenId }),
    };
  }

  async revokeRefreshToken(userId: string): Promise<void> {
    await this.refreshTokenRepository.destroyAllByUserId(userId);
  }

  private async createRefreshToken(
    userId: string,
    transaction?: Transaction,
  ): Promise<RefreshToken> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS); // 30 days from now

    const tokenId = crypto.randomUUID();

    const record = await this.refreshTokenRepository.create(
      {
        userId,
        tokenId,
        expiresAt,
      },
      { transaction },
    );

    return record;
  }
}

export const authService = new AuthService(userCredentialsRepository, refreshTokenRepository);
