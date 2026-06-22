import { DataTypes, Model, type Optional } from "sequelize";
import { sequelize } from "@/db/sequelize";

export interface UserCredentialsAttributes {
  id: string;
  email: string;
  displayName: string;
  /** Null for accounts created via Google login that have never set a password. */
  passwordHash: string | null;
  /** Google "sub" claim. Null for accounts that have never linked a Google account. */
  googleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserCredentialsCreationAttributes = Optional<
  UserCredentialsAttributes,
  "id" | "createdAt" | "updatedAt" | "passwordHash" | "googleId"
>;

export class UserCredentials
  extends Model<UserCredentialsAttributes, UserCredentialsCreationAttributes>
  implements UserCredentialsAttributes
{
  declare id: string;
  declare email: string;
  declare displayName: string;
  declare passwordHash: string | null;
  declare googleId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

UserCredentials.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    googleId: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    displayName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "user_credentials",
  },
);
