import { Schema, Types, model } from 'mongoose';
import { tenantScopePlugin } from '../tenantPlugin.js';

export type ReviewFlagType = 'POSSIBLE_DUPLICATE' | 'UNUSUALLY_LARGE' | 'LOW_CONFIDENCE' | 'CLASSIFICATION_FAILED';
export type ReviewFlagStatus = 'open' | 'resolved';

export interface ReviewFlagDocument {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  transactionId: Types.ObjectId;
  type: ReviewFlagType;
  reason: string;
  details: Record<string, unknown> | null;
  status: ReviewFlagStatus;
  resolvedBy: Types.ObjectId | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const reviewFlagSchema = new Schema<ReviewFlagDocument>(
  {
    organisationId: { type: Schema.Types.ObjectId, required: true, ref: 'Organisation' },
    transactionId: { type: Schema.Types.ObjectId, required: true, ref: 'Transaction' },
    type: {
      type: String,
      enum: ['POSSIBLE_DUPLICATE', 'UNUSUALLY_LARGE', 'LOW_CONFIDENCE', 'CLASSIFICATION_FAILED'],
      required: true,
    },
    reason: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['open', 'resolved'], required: true, default: 'open' },
    resolvedBy: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'review_flags' },
);

// One flag per (transaction, type): this is what makes a detector idempotent
// — running it again over an already-flagged transaction just hits E11000.
reviewFlagSchema.index({ transactionId: 1, type: 1 }, { unique: true });
reviewFlagSchema.index({ organisationId: 1, status: 1, createdAt: -1 });
reviewFlagSchema.plugin(tenantScopePlugin);

export const ReviewFlagModel = model<ReviewFlagDocument>('ReviewFlag', reviewFlagSchema);
