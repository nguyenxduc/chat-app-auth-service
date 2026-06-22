import { Op, type Transaction } from 'sequelize';

import { UserCredentials } from '@/models';

export class UserCredentialsRepository {
  async findByEmail(email: string) {
    return UserCredentials.findOne({
      where: { email: { [Op.eq]: email } },
    });
  }

  async findById(id: string) {
    return UserCredentials.findByPk(id);
  }

  async create(
    data: { email: string; displayName: string; passwordHash: string },
    options?: { transaction?: Transaction },
  ) {
    return UserCredentials.create(data, { transaction: options?.transaction });
  }

  async findByGoogleId(googleId: string) {
    return UserCredentials.findOne({
      where: { googleId: { [Op.eq]: googleId } },
    });
  }

  async createFromGoogle(data: { email: string; displayName: string; googleId: string }) {
    return UserCredentials.create({ ...data, passwordHash: null });
  }

  async linkGoogleId(id: string, googleId: string) {
    await UserCredentials.update({ googleId }, { where: { id } });
  }

  async updatePassword(id: string, passwordHash: string) {
    await UserCredentials.update({ passwordHash }, { where: { id } });
  }
}

export const userCredentialsRepository = new UserCredentialsRepository();
