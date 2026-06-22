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
import {
  passwordResetRepository,
  PasswordResetRepository,
} from '@/repositories/password-reset.repository';
import { AuthResponse, AuthTokens, LoginInput, RegisterInput } from '@/types/auth';
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from '@/utils/token';
import { verifyGoogleIdToken } from '@/utils/google';
import { HttpError } from '@chatapp/common';
import type { Transaction } from 'sequelize';
import crypto from 'crypto';
import {
  publishPasswordResetRequested,
  publishUserRegistered,
} from '@/messaging/event-publishing';
import { logger } from '@/utils/logger';

const REFRESH_TOKEN_TTL_DAYS = 30;
const OTP_DIGITS = 6;

export class AuthService {
  constructor(
    private readonly userCredentialsRepository: UserCredentialsRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly passwordResetRepository: PasswordResetRepository,
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
      logger.info({ userId: user.id }, 'User registered');

      return {
        accessToken,
        refreshToken,
        user: userData,
      };
    } catch (error) {
      await transaction.rollback();
      logger.error({ err: error, email: input.email }, 'Registration failed, transaction rolled back');
      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const credential = await this.userCredentialsRepository.findByEmail(input.email);
    if (!credential?.passwordHash) {
      logger.warn({ email: input.email }, 'Login failed: unknown email or no password set');
      throw new HttpError(401, 'Invalid credentials');
    }

    const valid = await verifyPassword(input.password, credential.passwordHash);
    if (!valid) {
      logger.warn({ userId: credential.id }, 'Login failed: wrong password');
      throw new HttpError(401, 'Invalid credentials');
    }

    const refreshTokenRecord = await this.createRefreshToken(credential.id);

    const accessToken = signAccessToken({ sub: credential.id, email: credential.email });
    const refreshToken = signRefreshToken({
      sub: credential.id,
      tokenId: refreshTokenRecord.tokenId,
    });

    logger.info({ userId: credential.id }, 'User logged in');

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

    logger.info({ userId: credential.id }, 'Refresh token rotated');

    return {
      accessToken: signAccessToken({ sub: credential.id, email: credential.email }),
      refreshToken: signRefreshToken({ sub: credential.id, tokenId: newTokenRecord.tokenId }),
    };
  }

  async revokeRefreshToken(userId: string): Promise<void> {
    await this.refreshTokenRepository.destroyAllByUserId(userId);
    logger.info({ userId }, 'All refresh tokens revoked');
  }

  async loginWithGoogle(idToken: string): Promise<AuthTokens> {
    const googlePayload = await verifyGoogleIdToken(idToken);

    let credential = await this.userCredentialsRepository.findByGoogleId(googlePayload.sub);

    if (!credential) {
      credential = await this.userCredentialsRepository.findByEmail(googlePayload.email);

      if (credential) {
        await this.userCredentialsRepository.linkGoogleId(credential.id, googlePayload.sub);
        logger.info({ userId: credential.id }, 'Linked existing account to Google');
      } else {
        credential = await this.userCredentialsRepository.createFromGoogle({
          email: googlePayload.email,
          displayName: googlePayload.name ?? googlePayload.email,
          googleId: googlePayload.sub,
        });

        publishUserRegistered({
          id: credential.id,
          email: credential.email,
          displayName: credential.displayName,
          createdAt: credential.createdAt.toISOString(),
        });
        logger.info({ userId: credential.id }, 'Created new account via Google login');
      }
    }

    const refreshTokenRecord = await this.createRefreshToken(credential.id);

    return {
      accessToken: signAccessToken({ sub: credential.id, email: credential.email }),
      refreshToken: signRefreshToken({ sub: credential.id, tokenId: refreshTokenRecord.tokenId }),
    };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const credential = await this.userCredentialsRepository.findByEmail(email);
    if (!credential) {
      // Don't reveal whether the email is registered.
      logger.info({ email }, 'Password reset requested for unknown email');
      return;
    }

    const otp = crypto.randomInt(0, 10 ** OTP_DIGITS).toString().padStart(OTP_DIGITS, '0');
    await this.passwordResetRepository.saveOtp(email, otp);
    publishPasswordResetRequested({ email, otp });
    logger.info({ userId: credential.id }, 'Password reset OTP issued');
  }

  async resetPassword(input: { email: string; otp: string; newPassword: string }): Promise<void> {
    const storedOtp = await this.passwordResetRepository.getOtp(input.email);
    if (!storedOtp || storedOtp !== input.otp) {
      throw new HttpError(400, 'Invalid or expired OTP');
    }

    const credential = await this.userCredentialsRepository.findByEmail(input.email);
    if (!credential) {
      throw new HttpError(400, 'Invalid or expired OTP');
    }

    const passwordHash = await hashPassword(input.newPassword);
    await this.userCredentialsRepository.updatePassword(credential.id, passwordHash);
    await this.passwordResetRepository.deleteOtp(input.email);
    await this.refreshTokenRepository.destroyAllByUserId(credential.id);
    logger.info({ userId: credential.id }, 'Password reset completed');
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

export const authService = new AuthService(
  userCredentialsRepository,
  refreshTokenRepository,
  passwordResetRepository,
);
