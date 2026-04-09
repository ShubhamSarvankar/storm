import { Schema, model, type Model } from 'mongoose';
import type { Role } from '../../types.js';

// Interface describes the plain document shape — no `extends Document`.
// Mongoose infers the full document type from the schema via HydratedDocument.
export interface IUser {
  username: string;
  email: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, trim: true, minlength: 3, maxlength: 32 },
    email:    { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['admin', 'moderator', 'member'] satisfies Role[],
      default: 'member',
      required: true,
    },
    isActive:   { type: Boolean, default: true, required: true },
    lastSeenAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        // Remove passwordHash from any serialised output
        ret['passwordHash'] = undefined;
        return ret;
      },
    },
  },
);

// ── Indexes ───────────────────────────────────────────────────
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ isActive: 1, createdAt: -1, _id: -1 });

export const UserModel: Model<IUser> = model<IUser>('User', userSchema);