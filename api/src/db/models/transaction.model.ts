import { Schema, Types, model } from 'mongoose';
import { CATEGORIES, type Category } from '../../modules/transactions/categories.js';
import { tenantScopePlugin } from '../tenantPlugin.js';

export type Direction = 'credit' | 'debit';
export type ClassificationStatus = 'pending' | 'processing' | 'classified' | 'failed';
export type ClassificationSource = 'rule' | 'ai' | 'human';
export type ReviewStatus = 'none' | 'open' | 'resolved';

export interface TransactionCategory {
  value: Category;
  source: ClassificationSource;
  confidence: number;
  eventId: Types.ObjectId;
}

export interface TransactionClassificationState {
  status: ClassificationStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lockedUntil: Date | null;
  lastError: string | null;
}

export interface TransactionDocument {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  accountId: Types.ObjectId;
  externalReference: string;
  amountKobo: bigint;
  direction: Direction;
  currency: 'NGN';
  narration: string;
  merchant: string | null;
  date: Date;
  category: TransactionCategory | null;
  classification: TransactionClassificationState;
  reviewStatus: ReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<TransactionCategory>(
  {
    value: { type: String, enum: CATEGORIES, required: true },
    source: { type: String, enum: ['rule', 'ai', 'human'], required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    eventId: { type: Schema.Types.ObjectId, required: true, ref: 'ClassificationEvent' },
  },
  { _id: false },
);

const classificationSchema = new Schema<TransactionClassificationState>(
  {
    status: {
      type: String,
      enum: ['pending', 'processing', 'classified', 'failed'],
      required: true,
      default: 'pending',
    },
    attempts: { type: Number, required: true, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date() },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { _id: false },
);

const transactionSchema = new Schema<TransactionDocument>(
  {
    organisationId: { type: Schema.Types.ObjectId, required: true, ref: 'Organisation' },
    accountId: { type: Schema.Types.ObjectId, required: true, ref: 'Account' },
    externalReference: { type: String, required: true },
    amountKobo: { type: Schema.Types.BigInt, required: true }, // BSON Long, see db/connection.ts
    direction: { type: String, enum: ['credit', 'debit'], required: true },
    currency: { type: String, enum: ['NGN'], required: true, default: 'NGN' },
    narration: { type: String, required: true },
    merchant: { type: String, default: null },
    date: { type: Date, required: true },
    category: { type: categorySchema, default: null },
    classification: { type: classificationSchema, required: true, default: () => ({}) },
    reviewStatus: { type: String, enum: ['none', 'open', 'resolved'], required: true, default: 'none' },
  },
  { timestamps: true, collection: 'transactions' },
);

// This is what actually decides a duplicate import — transactions.service.ts
// always attempts the insert and reacts to the E11000 this throws, rather
// than checking existence first.
transactionSchema.index({ organisationId: 1, accountId: 1, externalReference: 1 }, { unique: true });
transactionSchema.index({ organisationId: 1, date: -1, _id: -1 });
transactionSchema.index({ organisationId: 1, accountId: 1, date: -1, _id: -1 });
transactionSchema.index({ organisationId: 1, 'category.value': 1, date: -1 });
transactionSchema.index({ organisationId: 1, reviewStatus: 1, date: -1 });
transactionSchema.index({ organisationId: 1, accountId: 1, direction: 1, amountKobo: 1, date: 1 });
transactionSchema.index({ organisationId: 1, narration: 'text', merchant: 'text' });
transactionSchema.index({ 'classification.status': 1, 'classification.nextAttemptAt': 1 });

transactionSchema.plugin(tenantScopePlugin);

export const TransactionModel = model<TransactionDocument>('Transaction', transactionSchema);
