-- Initial schema. The CREATE TYPE / TABLE / INDEX statements mirror
-- prisma/schema.prisma. Everything after "Rules Prisma's schema can't
-- express" is extra: CHECK constraints, the append-only trigger and
-- row-level security.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('REVENUE', 'PAYROLL', 'SOFTWARE', 'MARKETING', 'TRAVEL', 'UTILITIES', 'RENT', 'TAX', 'TRANSFERS', 'BANKING_FEES', 'OTHER');

-- CreateEnum
CREATE TYPE "ClassificationStatus" AS ENUM ('pending', 'processing', 'classified', 'failed');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('rule', 'ai', 'human');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('none', 'open', 'resolved');

-- CreateEnum
CREATE TYPE "ReviewFlagType" AS ENUM ('POSSIBLE_DUPLICATE', 'UNUSUALLY_LARGE', 'LOW_CONFIDENCE', 'CLASSIFICATION_FAILED');

-- CreateEnum
CREATE TYPE "ReviewFlagStatus" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "organisations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "large_payment_multiple" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number_last4" CHAR(4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "external_reference" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "direction" "Direction" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "narration" TEXT NOT NULL,
    "merchant" TEXT,
    "date" TIMESTAMPTZ(3) NOT NULL,
    "category" "Category",
    "category_source" "ClassificationSource",
    "category_confidence" DOUBLE PRECISION,
    "category_event_id" UUID,
    "classification_status" "ClassificationStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "invalid_responses" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'none',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_events" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "source" "ClassificationSource" NOT NULL,
    "provider" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "previous_category" "Category",
    "confidence" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_flags" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "type" "ReviewFlagType" NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB,
    "status" "ReviewFlagStatus" NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "review_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisations_name_key" ON "organisations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organisation_id_idx" ON "users"("organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organisation_id_id_key" ON "accounts"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organisation_id_account_number_last4_key" ON "accounts"("organisation_id", "account_number_last4");

-- CreateIndex
CREATE INDEX "transactions_organisation_id_date_id_idx" ON "transactions"("organisation_id", "date" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "transactions_organisation_id_account_id_date_idx" ON "transactions"("organisation_id", "account_id", "date" DESC);

-- CreateIndex
CREATE INDEX "transactions_organisation_id_category_date_idx" ON "transactions"("organisation_id", "category", "date");

-- CreateIndex
CREATE INDEX "transactions_organisation_id_review_status_date_idx" ON "transactions"("organisation_id", "review_status", "date");

-- CreateIndex
CREATE INDEX "transactions_org_account_direction_amount_date_idx" ON "transactions"("organisation_id", "account_id", "direction", "amount_kobo", "date");

-- CreateIndex
CREATE INDEX "transactions_classification_status_next_attempt_at_idx" ON "transactions"("classification_status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "transactions_narration_idx" ON "transactions" USING GIN ("narration" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "transactions_merchant_idx" ON "transactions" USING GIN ("merchant" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "transactions_external_reference_idx" ON "transactions" USING GIN ("external_reference" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_organisation_id_account_id_external_reference_key" ON "transactions"("organisation_id", "account_id", "external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_organisation_id_id_key" ON "transactions"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "classification_events_org_transaction_created_idx" ON "classification_events"("organisation_id", "transaction_id", "created_at");

-- CreateIndex
CREATE INDEX "review_flags_organisation_id_status_created_at_idx" ON "review_flags"("organisation_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "review_flags_transaction_id_type_key" ON "review_flags"("transaction_id", "type");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organisation_id_account_id_fkey" FOREIGN KEY ("organisation_id", "account_id") REFERENCES "accounts"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_events" ADD CONSTRAINT "classification_events_organisation_id_transaction_id_fkey" FOREIGN KEY ("organisation_id", "transaction_id") REFERENCES "transactions"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_organisation_id_transaction_id_fkey" FOREIGN KEY ("organisation_id", "transaction_id") REFERENCES "transactions"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma's schema can't express
-- ---------------------------------------------------------------------------

-- Money. Amounts are whole kobo and always positive; direction carries the
-- sign. NGN only, at both the account and the transaction level.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_kobo_positive" CHECK ("amount_kobo" > 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currency_ngn" CHECK ("currency" = 'NGN');
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_ngn" CHECK ("currency" = 'NGN');
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_number_last4_digits" CHECK ("account_number_last4" ~ '^[0-9]{4}$');

-- A category, its source and its confidence are set together or not at all.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_complete" CHECK (
    ("category" IS NULL AND "category_source" IS NULL AND "category_confidence" IS NULL)
    OR ("category" IS NOT NULL AND "category_source" IS NOT NULL AND "category_confidence" IS NOT NULL)
);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_confidence_range" CHECK ("category_confidence" BETWEEN 0 AND 1);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_attempts_not_negative" CHECK ("attempts" >= 0 AND "invalid_responses" >= 0);
ALTER TABLE "classification_events" ADD CONSTRAINT "classification_events_confidence_range" CHECK ("confidence" BETWEEN 0 AND 1);
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_large_payment_multiple_min" CHECK ("large_payment_multiple" >= 2);

-- Emails are compared case-insensitively by storing them lower-cased.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- The classification history can only grow. Corrections insert a new row.
CREATE FUNCTION "classification_events_append_only"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'classification_events is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "classification_events_no_update_or_delete"
    BEFORE UPDATE OR DELETE ON "classification_events"
    FOR EACH ROW EXECUTE FUNCTION "classification_events_append_only"();

-- Row-level security. Every tenant table only shows and accepts rows whose
-- organisation_id matches app.organisation_id, which the API sets at the
-- start of each transaction (see src/db/tenant.ts). With the setting
-- missing, current_setting(..., true) is NULL and nothing matches, so a
-- forgotten scope returns no rows instead of everyone's rows.
--
-- FORCE makes the policies apply to the table owner too. Roles that need to
-- work across organisations (the worker's claim query, the health check,
-- login by email, the seed script) connect as a role with BYPASSRLS; see
-- prisma/init/roles.sql.
ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organisations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "organisations_tenant_isolation" ON "organisations"
    USING ("id" = nullif(current_setting('app.organisation_id', true), '')::uuid)
    WITH CHECK ("id" = nullif(current_setting('app.organisation_id', true), '')::uuid);

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "users_tenant_isolation" ON "users"
    USING ("organisation_id" = nullif(current_setting('app.organisation_id', true), '')::uuid)
    WITH CHECK ("organisation_id" = nullif(current_setting('app.organisation_id', true), '')::uuid);

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "accounts_tenant_isolation" ON "accounts"
    USING ("organisation_id" = nullif(current_setting('app.organisation_id', true), '')::uuid)
    WITH CHECK ("organisation_id" = nullif(current_setting('app.organisation_id', true), '')::uuid);

ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "transactions_tenant_isolation" ON "transactions"
    USING ("organisation_id" = nullif(current_setting('app.organisation_id', true), '')::uuid)
    WITH CHECK ("organisation_id" = nullif(current_setting('app.organisation_id', true), '')::uuid);

ALTER TABLE "classification_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "classification_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "classification_events_tenant_isolation" ON "classification_events"
    USING ("organisation_id" = nullif(current_setting('app.organisation_id', true), '')::uuid)
    WITH CHECK ("organisation_id" = nullif(current_setting('app.organisation_id', true), '')::uuid);

ALTER TABLE "review_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_flags" FORCE ROW LEVEL SECURITY;
CREATE POLICY "review_flags_tenant_isolation" ON "review_flags"
    USING ("organisation_id" = nullif(current_setting('app.organisation_id', true), '')::uuid)
    WITH CHECK ("organisation_id" = nullif(current_setting('app.organisation_id', true), '')::uuid);
