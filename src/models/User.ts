import { model, Schema, type HydratedDocument, type Model } from 'mongoose';
import { USER_ROLES, type UserRole } from '../modules/auth/auth.types.js';

export interface UserAttrs {
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<UserAttrs>;

const userSchema = new Schema<UserAttrs>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      // FR-4: never returned in a response payload. Making it opt-in at the query
      // level means forgetting to strip it isn't possible — you have to ask for it.
      select: false,
    },
    role: {
      type: String,
      required: true,
      enum: USER_ROLES,
      default: 'admin',
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret: Record<string, unknown>) {
        delete ret._id;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

export const User: Model<UserAttrs> = model<UserAttrs>('User', userSchema);
