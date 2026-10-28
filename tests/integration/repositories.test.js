'use strict';

/**
 * Repository integration tests against a real PostgreSQL database.
 *
 * Runs only when TEST_DATABASE_URL is set (CI provides a Postgres service;
 * locally: docker run -p 55432:5432 ... then `prisma migrate deploy`).
 * The tables are truncated before each test — never point this at production.
 */

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const { createClient, setClient } = require('../../src/db/prisma');
const { Donor, Donation, Subscription, isUniqueViolation } = require('../../src/models');

describeDb('PostgreSQL repositories', () => {
  let prisma;

  beforeAll(() => {
    prisma = createClient(url);
    setClient(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "donations", "subscriptions", "donors" CASCADE');
  });

  // Resolves to the rejection error (fails the test if the promise resolves)
  async function rejectionOf(promise) {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('Expected promise to reject');
  }

  async function makeDonation(overrides = {}) {
    const donor = await Donor.findOrCreateByPhone(overrides.phoneNumber || '233244000001', 'mtn');
    return Donation.create({
      donorId: donor.id,
      phoneNumber: donor.phoneNumber,
      amount: 10,
      channel: 'mtn-gh',
      frequency: 'once',
      reference: `DON-${Math.random().toString(36).slice(2)}`,
      ...overrides
    });
  }

  async function makeSubscription(overrides = {}) {
    const donor = await Donor.findOrCreateByPhone('233244000009', 'mtn');
    return Subscription.create({
      donorId: donor.id,
      phoneNumber: donor.phoneNumber,
      amount: 50,
      channel: 'mtn_gh_rec',
      frequency: 'monthly',
      status: 'active',
      recurringInvoiceId: 'INV-1',
      ...overrides
    });
  }

  describe('Donor', () => {
    test('findOrCreateByPhone is idempotent and normalises legacy network names', async () => {
      const a = await Donor.findOrCreateByPhone('233200000001', 'vodafone');
      const b = await Donor.findOrCreateByPhone('233200000001', 'mtn');

      expect(a.id).toBe(b.id);
      expect(a.network).toBe('telecel');
      expect(a._id).toBe(a.id); // compatibility alias
      expect(await Donor.count()).toBe(1);
    });

    test('setNameIfMissing fills empty/placeholder names but never overwrites a real one', async () => {
      await Donor.findOrCreateByPhone('233200000002');

      expect(await Donor.setNameIfMissing('233200000002', 'Ama Mensah')).toBe(true);
      expect(await Donor.setNameIfMissing('233200000002', 'Someone Else')).toBe(false);
      expect((await Donor.findByPhone('233200000002')).name).toBe('Ama Mensah');
    });
  });

  describe('Donation', () => {
    test('duplicate reference is rejected as a unique violation', async () => {
      await makeDonation({ reference: 'DUP-1' });

      expect(isUniqueViolation(await rejectionOf(makeDonation({ reference: 'DUP-1' })))).toBe(true);
    });

    test('CHECK constraint rejects an unknown channel', async () => {
      const error = await rejectionOf(makeDonation({ channel: 'bitcoin' }));
      expect(JSON.stringify(error.meta)).toContain('donations_channel_check');
    });

    test('amounts are stored exactly and returned as numbers', async () => {
      const d = await makeDonation({ amount: 0.1 + 0.2 });
      expect(typeof d.amount).toBe('number');
      expect(d.amount).toBe(0.3); // DECIMAL(12,2) rounds the float noise away
    });

    test('markCompleted counts the donor total once, even for repeated callbacks', async () => {
      const d = await makeDonation({ amount: 25 });

      await Donation.markCompleted(d.id, { Data: { TransactionId: 'T-1' } });
      const again = await Donation.markCompleted(d.id, { Data: { TransactionId: 'T-1' } });

      const donor = await Donor.findById(d.donorId);
      expect(again.status).toBe('completed');
      expect(again.hubtelTransactionId).toBe('T-1');
      expect(donor.totalDonated).toBe(25);
      expect(donor.donationCount).toBe(1);
      expect(donor.firstDonationAt).toBeInstanceOf(Date);
    });

    test('markFulfilled sets completedAt only when missing and fulfils only once', async () => {
      const d = await makeDonation({ hubtelSessionId: 'HS-1' });

      expect(await Donation.markFulfilledByHubtelSessionId('HS-1')).toBe(d.id);
      expect(await Donation.markFulfilledByHubtelSessionId('HS-1')).toBeNull();

      const after = await Donation.findById(d.id);
      expect(after.status).toBe('fulfilled');
      expect(after.completedAt).toBeInstanceOf(Date);
      expect(after.fulfilledAt).toBeInstanceOf(Date);
    });

    test('findLatestPendingOnceByPhone returns the newest pending one-time donation', async () => {
      await makeDonation({ reference: 'OLD' });
      await new Promise((r) => setTimeout(r, 10));
      await makeDonation({ reference: 'NEW' });

      expect((await Donation.findLatestPendingOnceByPhone('233244000001')).reference).toBe('NEW');
    });

    test('getTotalForPeriod sums completed and fulfilled donations', async () => {
      const a = await makeDonation({ amount: 10 });
      const b = await makeDonation({ amount: 15.5, hubtelSessionId: 'HS-2' });
      await makeDonation({ amount: 99 }); // pending — excluded
      await Donation.markCompleted(a.id, {});
      await Donation.markFulfilledByHubtelSessionId('HS-2');

      const start = new Date(Date.now() - 60000);
      expect(await Donation.getTotalForPeriod(start, new Date())).toEqual({ total: 25.5, count: 2 });
      expect(b.id).toBeDefined();
    });

    test('list filters by phone substring and includes the donor', async () => {
      await makeDonation({ phoneNumber: '233244111111' });
      await makeDonation({ phoneNumber: '233200222222' });

      const rows = await Donation.list({ phoneContains: '111' }, { includeDonor: true });
      expect(rows).toHaveLength(1);
      expect(rows[0].donor.phoneNumber).toBe('233244111111');
    });
  });

  describe('Subscription', () => {
    test('recordRecurringPayment records once; a retried callback rolls back cleanly', async () => {
      const sub = await makeSubscription();
      const payment = { amount: 50, reference: 'REC-TXN-1', transactionId: 'TXN-1' };

      const first = await Subscription.recordRecurringPayment(sub, payment);
      expect(isUniqueViolation(await rejectionOf(Subscription.recordRecurringPayment(sub, payment)))).toBe(true);

      const after = await Subscription.findById(sub.id);
      expect(first.donation.status).toBe('Success');
      expect(after.paymentsCompleted).toBe(1);
      expect(after.totalCollected).toBe(50);
      expect(await Donation.count({ subscriptionId: sub.id })).toBe(1);
    });

    test('recordFailure pauses after 3 consecutive failures', async () => {
      const sub = await makeSubscription();

      await Subscription.recordFailure(sub.id, 'Insufficient funds');
      const second = await Subscription.recordFailure(sub.id, 'Insufficient funds');
      const third = await Subscription.recordFailure(sub.id, 'Insufficient funds');

      expect(second.status).toBe('active');
      expect(third.status).toBe('paused');
      expect(third.paymentsFailed).toBe(3);
      expect(third.statusReason).toBe('Paused after 3 failed payments: Insufficient funds');
    });

    test('resume reactivates and resets failures', async () => {
      const sub = await makeSubscription({ status: 'paused', paymentsFailed: 3, nextPaymentDate: new Date('2020-01-01') });

      const resumed = await Subscription.resume(sub);

      expect(resumed.status).toBe('active');
      expect(resumed.paymentsFailed).toBe(0);
      expect(resumed.nextPaymentDate.getTime()).toBeGreaterThan(Date.now());
    });

    test('findByRecurringInvoiceId, findActiveByPhone and getStats', async () => {
      const sub = await makeSubscription();
      await makeSubscription({ status: 'cancelled', recurringInvoiceId: 'INV-2', amount: 20 });

      expect((await Subscription.findByRecurringInvoiceId('INV-1')).id).toBe(sub.id);
      expect(await Subscription.findActiveByPhone('233244000009')).toHaveLength(1);

      const stats = await Subscription.getStats();
      expect(stats.active).toEqual({ count: 1, totalAmount: 50 });
      expect(stats.cancelled).toEqual({ count: 1, totalAmount: 20 });
      expect(stats.paused).toEqual({ count: 0, totalAmount: 0 });
    });

    test('setStatus rejects unknown statuses', async () => {
      const sub = await makeSubscription();
      await expect(Subscription.setStatus(sub.id, 'deleted')).rejects.toThrow('Invalid subscription status');
    });
  });
});
