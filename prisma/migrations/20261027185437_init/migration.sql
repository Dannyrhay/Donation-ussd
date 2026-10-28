-- CreateTable
CREATE TABLE "donors" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "network" TEXT NOT NULL DEFAULT 'unknown',
    "totalDonated" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "donationCount" INTEGER NOT NULL DEFAULT 0,
    "firstDonationAt" TIMESTAMP(3),
    "lastDonationAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "donors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "channel" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'once',
    "subscriptionId" TEXT,
    "reference" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "description" TEXT NOT NULL DEFAULT 'Donation to Jesus Mission Fund',
    "hubtelTransactionId" TEXT,
    "hubtelSessionId" TEXT,
    "hubtelOrderId" TEXT,
    "hubtelResponse" JSONB,
    "callbackData" JSONB,
    "errorMessage" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'ussd',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "channel" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recurringInvoiceId" TEXT,
    "hubtelRequestId" TEXT,
    "hubtelVerificationType" TEXT,
    "hubtelResponseCode" TEXT,
    "nextPaymentDate" TIMESTAMP(3),
    "lastPaymentDate" TIMESTAMP(3),
    "paymentsCompleted" INTEGER NOT NULL DEFAULT 0,
    "paymentsFailed" INTEGER NOT NULL DEFAULT 0,
    "totalCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoiceEndDate" TIMESTAMP(3),
    "statusReason" TEXT,
    "originalSessionId" TEXT,
    "clientReference" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ussd',
    "managedByHubtel" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "donors_phoneNumber_key" ON "donors"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "donations_reference_key" ON "donations"("reference");

-- CreateIndex
CREATE INDEX "donations_donorId_idx" ON "donations"("donorId");

-- CreateIndex
CREATE INDEX "donations_phoneNumber_idx" ON "donations"("phoneNumber");

-- CreateIndex
CREATE INDEX "donations_status_idx" ON "donations"("status");

-- CreateIndex
CREATE INDEX "donations_subscriptionId_idx" ON "donations"("subscriptionId");

-- CreateIndex
CREATE INDEX "donations_hubtelSessionId_idx" ON "donations"("hubtelSessionId");

-- CreateIndex
CREATE INDEX "donations_hubtelOrderId_idx" ON "donations"("hubtelOrderId");

-- CreateIndex
CREATE INDEX "donations_createdAt_idx" ON "donations"("createdAt");

-- CreateIndex
CREATE INDEX "subscriptions_donorId_idx" ON "subscriptions"("donorId");

-- CreateIndex
CREATE INDEX "subscriptions_phoneNumber_status_idx" ON "subscriptions"("phoneNumber", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_recurringInvoiceId_idx" ON "subscriptions"("recurringInvoiceId");

-- CreateIndex
CREATE INDEX "subscriptions_clientReference_idx" ON "subscriptions"("clientReference");

-- CreateIndex
CREATE INDEX "subscriptions_nextPaymentDate_idx" ON "subscriptions"("nextPaymentDate");

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "donors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "donors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data integrity: allowed values (hand-written; Prisma has no CHECK support).
-- Mirrors the enums the Mongoose schemas enforced.
-- ---------------------------------------------------------------------------
ALTER TABLE "donors" ADD CONSTRAINT "donors_network_check"
  CHECK ("network" IN ('mtn', 'telecel', 'airteltigo', 'unknown'));
ALTER TABLE "donors" ADD CONSTRAINT "donors_totals_check"
  CHECK ("totalDonated" >= 0 AND "donationCount" >= 0);

ALTER TABLE "donations" ADD CONSTRAINT "donations_amount_check" CHECK ("amount" > 0);
ALTER TABLE "donations" ADD CONSTRAINT "donations_channel_check"
  CHECK ("channel" IN ('mtn-gh', 'vodafone-gh', 'tigo-gh', 'mtn_gh_rec', 'vodafone_gh_rec'));
ALTER TABLE "donations" ADD CONSTRAINT "donations_frequency_check"
  CHECK ("frequency" IN ('once', 'weekly', 'monthly', 'annually'));
ALTER TABLE "donations" ADD CONSTRAINT "donations_status_check"
  CHECK ("status" IN ('pending', 'processing', 'completed', 'fulfilled', 'Success', 'failed', 'cancelled', 'refunded'));
ALTER TABLE "donations" ADD CONSTRAINT "donations_source_check"
  CHECK ("source" IN ('ussd', 'web', 'app', 'subscription', 'hubtel_recurring'));

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_amount_check" CHECK ("amount" > 0);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_channel_check"
  CHECK ("channel" IN ('mtn-gh', 'vodafone-gh', 'tigo-gh', 'mtn_gh_rec', 'vodafone_gh_rec'));
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_frequency_check"
  CHECK ("frequency" IN ('weekly', 'monthly', 'annually'));
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_check"
  CHECK ("status" IN ('pending', 'active', 'paused', 'cancelled', 'expired', 'failed'));
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_source_check"
  CHECK ("source" IN ('ussd', 'web', 'app'));
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_counters_check"
  CHECK ("paymentsCompleted" >= 0 AND "paymentsFailed" >= 0 AND "totalCollected" >= 0);
