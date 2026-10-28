#!/usr/bin/env node
/**
 * One-time data migration: MongoDB (Atlas) → PostgreSQL (Railway)
 *
 *   MONGODB_URI=... DATABASE_URL=... node scripts/migrate-mongo-to-postgres.js            # dry run (default)
 *   MONGODB_URI=... DATABASE_URL=... node scripts/migrate-mongo-to-postgres.js --execute  # write
 *
 * - Reads MongoDB only (never writes to it).
 * - Keeps each document's ObjectId (hex) as the Postgres `id`, so all
 *   donor ↔ donation ↔ subscription links are preserved.
 * - Idempotent: re-running skips rows that already exist (by id), and donors
 *   already created by the new app are matched by phone number.
 * - Rows that would violate Postgres constraints (unknown channel, missing
 *   donor, ...) are reported and skipped, never silently altered.
 * - Run `npx prisma migrate deploy` against DATABASE_URL first.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { createClient } = require('../src/db/prisma');

const EXECUTE = process.argv.includes('--execute');
const BATCH_SIZE = 500;

const ALLOWED = {
  network: ['mtn', 'telecel', 'airteltigo', 'unknown'],
  channel: ['mtn-gh', 'vodafone-gh', 'tigo-gh', 'mtn_gh_rec', 'vodafone_gh_rec'],
  donationFrequency: ['once', 'weekly', 'monthly', 'annually'],
  subscriptionFrequency: ['weekly', 'monthly', 'annually'],
  donationStatus: ['pending', 'processing', 'completed', 'fulfilled', 'Success', 'failed', 'cancelled', 'refunded'],
  subscriptionStatus: ['pending', 'active', 'paused', 'cancelled', 'expired', 'failed'],
  donationSource: ['ussd', 'web', 'app', 'subscription', 'hubtel_recurring'],
  subscriptionSource: ['ussd', 'web', 'app']
};

const idOf = (value) => (value ? String(value) : null);
const dateOf = (value) => (value ? new Date(value) : null);
const str = (value) => (value === undefined || value === null ? null : String(value));
const num = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

function mapDonor(doc) {
  const legacy = { vodafone: 'telecel', tigo: 'airteltigo' };
  const raw = legacy[doc.network] || doc.network;
  const network = ALLOWED.network.includes(raw) ? raw : 'unknown';
  return {
    id: idOf(doc._id),
    phoneNumber: String(doc.phoneNumber),
    name: doc.name && doc.name !== 'Donor' ? String(doc.name) : '',
    email: str(doc.email) || '',
    network,
    totalDonated: Math.max(0, num(doc.totalDonated)),
    donationCount: Math.max(0, Math.trunc(num(doc.donationCount))),
    firstDonationAt: dateOf(doc.firstDonationAt),
    lastDonationAt: dateOf(doc.lastDonationAt),
    isActive: doc.isActive !== false,
    notes: str(doc.notes) || '',
    createdAt: dateOf(doc.createdAt) || new Date(),
    updatedAt: dateOf(doc.updatedAt) || new Date()
  };
}

function mapSubscription(doc) {
  return {
    id: idOf(doc._id),
    donorId: idOf(doc.donor),
    phoneNumber: String(doc.phoneNumber),
    amount: num(doc.amount),
    channel: doc.channel,
    frequency: doc.frequency,
    status: doc.status || 'pending',
    recurringInvoiceId: str(doc.recurringInvoiceId),
    hubtelRequestId: str(doc.hubtelRequestId),
    hubtelVerificationType: str(doc.hubtelVerificationType),
    hubtelResponseCode: str(doc.hubtelResponseCode),
    nextPaymentDate: dateOf(doc.nextPaymentDate),
    lastPaymentDate: dateOf(doc.lastPaymentDate),
    paymentsCompleted: Math.max(0, Math.trunc(num(doc.paymentsCompleted))),
    paymentsFailed: Math.max(0, Math.trunc(num(doc.paymentsFailed))),
    totalCollected: Math.max(0, num(doc.totalCollected)),
    invoiceEndDate: dateOf(doc.invoiceEndDate),
    statusReason: str(doc.statusReason),
    originalSessionId: str(doc.originalSessionId),
    clientReference: str(doc.clientReference),
    source: doc.source || 'ussd',
    managedByHubtel: doc.managedByHubtel !== false,
    createdAt: dateOf(doc.createdAt) || new Date(),
    updatedAt: dateOf(doc.updatedAt) || new Date()
  };
}

function mapDonation(doc) {
  return {
    id: idOf(doc._id),
    donorId: idOf(doc.donor),
    phoneNumber: String(doc.phoneNumber),
    amount: num(doc.amount),
    channel: doc.channel,
    frequency: doc.frequency || 'once',
    subscriptionId: idOf(doc.subscription),
    reference: String(doc.reference),
    sessionId: str(doc.sessionId),
    status: doc.status || 'pending',
    description: str(doc.description) || 'Donation to Jesus Mission Fund',
    hubtelTransactionId: str(doc.hubtelTransactionId),
    hubtelSessionId: str(doc.hubtelSessionId),
    hubtelOrderId: str(doc.hubtelOrderId),
    hubtelResponse: doc.hubtelResponse ?? undefined,
    callbackData: doc.callbackData ?? undefined,
    errorMessage: str(doc.errorMessage),
    initiatedAt: dateOf(doc.initiatedAt) || dateOf(doc.createdAt) || new Date(),
    completedAt: dateOf(doc.completedAt),
    fulfilledAt: dateOf(doc.fulfilledAt),
    source: doc.source || 'ussd',
    createdAt: dateOf(doc.createdAt) || new Date(),
    updatedAt: dateOf(doc.updatedAt) || new Date()
  };
}

/** Returns a list of problems with a mapped row (empty = valid) */
function validate(kind, row, donorIds, subscriptionIds) {
  const problems = [];
  if (kind !== 'donor' && !donorIds.has(row.donorId)) problems.push(`donor ${row.donorId} not found`);
  if (kind !== 'donor' && !(row.amount > 0)) problems.push(`amount ${row.amount} must be > 0`);
  if (kind !== 'donor' && !ALLOWED.channel.includes(row.channel)) problems.push(`channel "${row.channel}"`);

  if (kind === 'subscription') {
    if (!ALLOWED.subscriptionFrequency.includes(row.frequency)) problems.push(`frequency "${row.frequency}"`);
    if (!ALLOWED.subscriptionStatus.includes(row.status)) problems.push(`status "${row.status}"`);
    if (!ALLOWED.subscriptionSource.includes(row.source)) problems.push(`source "${row.source}"`);
  }

  if (kind === 'donation') {
    if (!ALLOWED.donationFrequency.includes(row.frequency)) problems.push(`frequency "${row.frequency}"`);
    if (!ALLOWED.donationStatus.includes(row.status)) problems.push(`status "${row.status}"`);
    if (!ALLOWED.donationSource.includes(row.source)) problems.push(`source "${row.source}"`);
    if (row.subscriptionId && !subscriptionIds.has(row.subscriptionId)) {
      problems.push(`subscription ${row.subscriptionId} not found (will be set to null)`);
    }
  }

  return problems;
}

async function insertInBatches(model, rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const result = await model.createMany({ data: rows.slice(i, i + BATCH_SIZE), skipDuplicates: true });
    inserted += result.count;
  }
  return inserted;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  if (!process.env.MONGODB_URI || !process.env.DATABASE_URL) {
    console.error('Set both MONGODB_URI (source) and DATABASE_URL (target).');
    process.exit(1);
  }

  console.log(EXECUTE ? '*** EXECUTE MODE — writing to PostgreSQL ***' : '--- DRY RUN (pass --execute to write) ---');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const prisma = createClient(process.env.DATABASE_URL);

  try {
    const [donorDocs, subscriptionDocs, donationDocs] = await Promise.all([
      db.collection('donors').find({}).toArray(),
      db.collection('subscriptions').find({}).toArray(),
      db.collection('donations').find({}).toArray()
    ]);

    console.log(`MongoDB: ${donorDocs.length} donors, ${subscriptionDocs.length} subscriptions, ${donationDocs.length} donations`);

    const donors = donorDocs.map(mapDonor);
    const donorIds = new Set(donors.map((d) => d.id));
    const subscriptionIds = new Set(subscriptionDocs.map((s) => idOf(s._id)));

    const skipped = [];
    const keep = (kind, rows) => rows.filter((row) => {
      const problems = validate(kind, row, donorIds, subscriptionIds);
      const fatal = problems.filter((p) => !p.includes('will be set to null'));
      if (problems.length) skipped.push({ kind, id: row.id, problems, kept: fatal.length === 0 });
      if (fatal.length) return false;
      if (kind === 'donation' && row.subscriptionId && !subscriptionIds.has(row.subscriptionId)) {
        row.subscriptionId = null;
      }
      return true;
    });

    const subscriptions = keep('subscription', subscriptionDocs.map(mapSubscription));
    const donations = keep('donation', donationDocs.map(mapDonation));

    const placeholderNames = donorDocs.filter((d) => d.name === 'Donor').length;
    const legacyManaged = subscriptions.filter((s) => !s.managedByHubtel).length;

    console.log('');
    console.log(`Ready: ${donors.length} donors, ${subscriptions.length} subscriptions, ${donations.length} donations`);
    console.log(`Donor names cleared from placeholder "Donor": ${placeholderNames}`);
    console.log(`Subscriptions NOT managed by Hubtel (processed by the scheduler): ${legacyManaged}`);

    if (skipped.length) {
      console.log('');
      console.log(`Rows with problems: ${skipped.length}`);
      skipped.forEach((s) => console.log(`  [${s.kept ? 'fixed' : 'SKIPPED'}] ${s.kind} ${s.id}: ${s.problems.join('; ')}`));
    }

    if (!EXECUTE) {
      console.log('');
      console.log('Dry run complete — nothing written. Re-run with --execute to migrate.');
      return;
    }

    console.log('');
    const insertedDonors = await insertInBatches(prisma.donor, donors);

    // A donor may already exist in Postgres under a different id (e.g. they gave
    // through the new app before this import ran). Phone numbers are unique, so
    // that MongoDB donor was skipped above — point its rows at the existing donor.
    const existing = await prisma.donor.findMany({
      where: { phoneNumber: { in: donors.map((d) => d.phoneNumber) } },
      select: { id: true, phoneNumber: true }
    });
    const idByPhone = new Map(existing.map((d) => [d.phoneNumber, d.id]));
    const donorIdMap = new Map(donors.map((d) => [d.id, idByPhone.get(d.phoneNumber) || d.id]));
    const remapped = donors.filter((d) => donorIdMap.get(d.id) !== d.id).length;
    if (remapped) console.log(`Matched ${remapped} donor(s) by phone to rows created by the new app`);
    subscriptions.forEach((row) => { row.donorId = donorIdMap.get(row.donorId) || row.donorId; });
    donations.forEach((row) => { row.donorId = donorIdMap.get(row.donorId) || row.donorId; });

    const insertedSubscriptions = await insertInBatches(prisma.subscription, subscriptions);
    const insertedDonations = await insertInBatches(prisma.donation, donations);
    console.log(`Inserted: ${insertedDonors} donors, ${insertedSubscriptions} subscriptions, ${insertedDonations} donations (existing rows skipped)`);

    // Verification: counts and money totals must match what we meant to copy
    const [pgDonors, pgSubs, pgDonations, pgSum] = await Promise.all([
      prisma.donor.count(),
      prisma.subscription.count(),
      prisma.donation.count(),
      prisma.donation.aggregate({ _sum: { amount: true } })
    ]);
    const expectedSum = round2(donations.reduce((total, d) => total + d.amount, 0));
    const actualSum = pgSum._sum.amount ? pgSum._sum.amount.toNumber() : 0;

    console.log('');
    console.log('Verification (PostgreSQL vs migrated rows):');
    console.log(`  donors:        ${pgDonors} / ${donors.length}`);
    console.log(`  subscriptions: ${pgSubs} / ${subscriptions.length}`);
    console.log(`  donations:     ${pgDonations} / ${donations.length}`);
    console.log(`  donation sum:  GHS ${actualSum} / GHS ${expectedSum}`);

    const ok = pgDonors >= donors.length && pgSubs >= subscriptions.length &&
      pgDonations >= donations.length && actualSum >= expectedSum;
    console.log(ok ? '  ✔ OK' : '  ✘ MISMATCH — investigate before switching traffic');
    if (!ok) process.exitCode = 2;

  } finally {
    await mongoose.disconnect();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
