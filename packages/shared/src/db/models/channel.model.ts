import { Schema, model, type Model } from 'mongoose';

export interface IChannel {
  name: string;
  description?: string;
  createdBy: Schema.Types.ObjectId;
  members: Schema.Types.ObjectId[];
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const channelSchema = new Schema<IChannel>(
  {
    name:        { type: String, required: true, trim: true, minlength: 2, maxlength: 64 },
    description: { type: String, trim: true, maxlength: 500 },
    createdBy:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members:     { type: [Schema.Types.ObjectId], ref: 'User', default: [], required: true },
    isArchived:  { type: Boolean, default: false, required: true },
  },
  { timestamps: true },
);

// ── Indexes ───────────────────────────────────────────────────
channelSchema.index({ name: 1 }, { unique: true });
channelSchema.index({ members: 1 });
channelSchema.index({ isArchived: 1, createdAt: -1, _id: -1 });

export const ChannelModel: Model<IChannel> = model<IChannel>('Channel', channelSchema);