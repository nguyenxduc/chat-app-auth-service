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
}

export const userCredentialsRepository = new UserCredentialsRepository();
