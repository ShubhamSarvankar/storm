import { Schema, model, type Model } from 'mongoose';

export interface IRefreshToken {
  userId: Schema.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt:    { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// ── Indexes ───────────────────────────────────────────────────
refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel: Model<IRefreshToken> = model<IRefreshToken>(
  'RefreshToken',
  refreshTokenSchema,
);