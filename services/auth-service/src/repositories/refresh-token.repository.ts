import type { Transaction } from 'sequelize';

import { RefreshToken } from '@/models';

export class RefreshTokenRepository {
  async create(
    data: { userId: string; tokenId: string; expiresAt: Date },
    options?: { transaction?: Transaction },
  ) {
    return RefreshToken.create(data, { transaction: options?.transaction });
  }

  async findByTokenId(tokenId: string, userId: string) {
    return RefreshToken.findOne({
      where: { tokenId, userId },
    });
  }

  async destroy(token: RefreshToken): Promise<void> {
    await token.destroy();
  }

  async destroyAllByUserId(userId: string): Promise<void> {
    await RefreshToken.destroy({ where: { userId } });
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
