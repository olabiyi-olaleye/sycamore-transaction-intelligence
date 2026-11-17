import { Schema, Types, model } from 'mongoose';
import { CATEGORIES, type Category } from '../constants/categories.js';
import { tenantScopePlugin } from './tenantPlugin.js';

export type ClassificationSource = 'rule' | 'ai' | 'human';

export interface ClassificationEventDocument {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  transactionId: Types.ObjectId;
  source: ClassificationSource;
  provider: string;
  category: Category;
  previousCategory: Category | null;
  confidence: number | null;
  reason: string;
  actorUserId: Types.ObjectId | null;
  note: string | null;
  createdAt: Date;
}

// Append-only: this file only exports insertEvent and listEventsForTransaction.
// A correction adds a new event here rather than editing an old one.
const classificationEventSchema = new Schema<ClassificationEventDocument>(
  {
    organisationId: { type: Schema.Types.ObjectId, required: true, ref: 'Organisation' },
    transactionId: { type: Schema.Types.ObjectId, required: true, ref: 'Transaction' },
    source: { type: String, enum: ['rule', 'ai', 'human'], required: true },
    provider: { type: String, required: true },
    category: { type: String, enum: CATEGORIES, required: true },
    previousCategory: { type: String, enum: CATEGORIES, default: null },
    confidence: { type: Number, min: 0, max: 1, default: null },
    reason: { type: String, required: true },
    actorUserId: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
    note: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'classification_events' },
);

classificationEventSchema.index({ organisationId: 1, transactionId: 1, createdAt: 1 });
classificationEventSchema.plugin(tenantScopePlugin);

export const ClassificationEventModel = model<ClassificationEventDocument>(
  'ClassificationEvent',
  classificationEventSchema,
);

export interface NewClassificationEvent {
  transactionId: string;
  source: ClassificationSource;
  provider: string;
  category: Category;
  previousCategory: Category | null;
  confidence: number | null;
  reason: string;
  actorUserId?: string;
  note?: string;
}

export function insertEvent(
  organisationId: string,
  event: NewClassificationEvent,
): Promise<ClassificationEventDocument> {
  return ClassificationEventModel.create({ organisationId, ...event }).then((doc) => doc.toObject());
}

export function listEventsForTransaction(
  organisationId: string,
  transactionId: string,
): Promise<ClassificationEventDocument[]> {
  return ClassificationEventModel.find({ organisationId, transactionId }).sort({ createdAt: 1 }).lean();
}
