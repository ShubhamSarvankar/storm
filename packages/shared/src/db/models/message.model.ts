import { Schema, model, type Model } from 'mongoose';
import type { DeliveryStatus } from '../../types.js';

export interface IMessage {
  messageId: string;
  channelId: Schema.Types.ObjectId;
  senderId: Schema.Types.ObjectId;
  encryptedContent: string;
  iv: string;
  authTag: string;
  deliveryStatus: DeliveryStatus;
  clientTs: Date;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    messageId:        { type: String, required: true },
    channelId:        { type: Schema.Types.ObjectId, ref: 'Channel', required: true },
    senderId:         { type: Schema.Types.ObjectId, ref: 'User', required: true },
    encryptedContent: { type: String, required: true },
    iv:               { type: String, required: true },
    authTag:          { type: String, required: true },
    deliveryStatus: {
      type: String,
      enum: ['pending', 'delivered', 'failed'] satisfies DeliveryStatus[],
      default: 'pending',
      required: true,
    },
    clientTs: { type: Date, required: true },
  },
  { timestamps: true },
);

// ── Indexes ───────────────────────────────────────────────────
messageSchema.index({ messageId: 1 }, { unique: true });
messageSchema.index({ channelId: 1, createdAt: -1, _id: -1 });
messageSchema.index({ channelId: 1, deliveryStatus: 1 });
messageSchema.index({ senderId: 1, createdAt: -1 });

export const MessageModel: Model<IMessage> = model<IMessage>('Message', messageSchema);