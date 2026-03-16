# USSD Subscription Cancellation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "5. Cancel subscription" as the last option on the USSD frequency-selection menu so donors can self-cancel their active recurring subscription without calling support.

**Architecture:** Two source files change. `src/models/Subscription.js` gains `.sort({ createdAt: -1 })` on `findActiveByPhone`. `src/services/ussdMenuService.js` gains the new menu option, an async subscription lookup in `handleFrequencySelection`, and a new `handleCancellationConfirmation` step wired into `processRequest`.

**Tech Stack:** Node.js/CommonJS, Mongoose, Jest

---

## File Map

| File | Action |
|---|---|
| `src/models/Subscription.js` | Modify — add `.sort({ createdAt: -1 })` to `findActiveByPhone` |
| `src/services/ussdMenuService.js` | Modify — `buildFrequencyMenu` + `handleFrequencySelection` + new `handleCancellationConfirmation` + `processRequest` wiring |
| `tests/models/subscription.test.js` | Create — schema smoke test + sort verification |
| `tests/services/ussdMenuService.test.js` | Create — cancellation flow tests |

---

## Chunk 1: Subscription sort + cancel menu option

### Task 1: Add sort to `findActiveByPhone` in the Subscription model

**Files:**
- Modify: `src/models/Subscription.js` (~line 298)
- Create: `tests/models/subscription.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/models/subscription.test.js`:

```js
'use strict';

jest.mock('../../src/config/database', () => ({
  connectDatabase: jest.fn().mockResolvedValue(null),
  disconnectDatabase: jest.fn().mockResolvedValue(null)
}));

const Subscription = require('../../src/models/Subscription');

describe('Subscription model', () => {
  describe('findActiveByPhone', () => {
    it('is a defined static method', () => {
      expect(typeof Subscription.findActiveByPhone).toBe('function');
    });

    it('passes { createdAt: -1 } to sort', async () => {
      const mockSort = jest.fn().mockResolvedValue([]);
      jest.spyOn(Subscription, 'find').mockReturnValue({ sort: mockSort });

      await Subscription.findActiveByPhone('233244000000');

      expect(mockSort).toHaveBeenCalledWith({ createdAt: -1 });
      Subscription.find.mockRestore();
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest tests/models/subscription.test.js --no-coverage
```

Expected: `passes { createdAt: -1 } to sort` FAILS — `mockSort` is never called because the current code has no `.sort()`.

- [ ] **Step 3: Implement the sort**

In `src/models/Subscription.js`, find the `findActiveByPhone` static method (around line 298):

```js
// Before:
subscriptionSchema.statics.findActiveByPhone = function(phoneNumber) {
  return this.find({
    phoneNumber,
    status: 'active'
  });
};

// After:
subscriptionSchema.statics.findActiveByPhone = function(phoneNumber) {
  return this.find({
    phoneNumber,
    status: 'active'
  }).sort({ createdAt: -1 });
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx jest tests/models/subscription.test.js --no-coverage
```

Expected: both tests PASS.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npx jest --no-coverage
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/models/Subscription.js tests/models/subscription.test.js
git commit -m "feat: sort findActiveByPhone results by createdAt descending"
```

---

### Task 2: Add "5. Cancel subscription" to the frequency menu and handle the selection

**Files:**
- Modify: `src/services/ussdMenuService.js`
- Create: `tests/services/ussdMenuService.test.js`

**Context:** The frequency menu is built by `buildFrequencyMenu(amount)` and selections are handled by `handleFrequencySelection(sessionId, input, session)`. Choice '5' is not in `config.frequencies`, so it must be checked **before** the `!frequencies[choice]` guard (otherwise it is caught as invalid input and rejected before our new branch runs). `handleFrequencySelection` must become `async` to call `donationService.getActiveSubscriptions`.

- [ ] **Step 1: Write failing tests**

Create `tests/services/ussdMenuService.test.js`:

```js
'use strict';

jest.useFakeTimers(); // prevents setInterval in ussdMenuService from leaking

jest.mock('../../src/config/database', () => ({
  connectDatabase: jest.fn().mockResolvedValue(null),
  disconnectDatabase: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/donationService', () => ({
  getActiveSubscriptions: jest.fn().mockResolvedValue([]),
  cancelSubscription: jest.fn(),
  createDonation: jest.fn().mockResolvedValue({ success: true, reference: 'DON-TEST', donation: {} }),
  createSubscription: jest.fn().mockResolvedValue({ success: true, subscription: { _id: 'SUB-1' } }),
  updateDonationStatus: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../src/services/recurringInvoiceService', () => ({
  formatPhoneNumber: jest.fn(phone =>
    phone.startsWith('0') ? '233' + phone.slice(1) : phone
  ),
  detectNetwork: jest.fn(() => 'mtn-gh'),
  createRecurringInvoice: jest.fn().mockResolvedValue({
    success: true,
    data: { recurringInvoiceId: 'INV-1', requestId: 'REQ-1', verificationType: 'USSD' }
  }),
  cancelRecurringInvoice: jest.fn()
}));

jest.mock('../../src/config', () => ({
  orgName: 'Test Org',
  donationAmounts: [5, 10, 50],
  frequencies: {
    '1': { name: 'Weekly', code: 'weekly' },
    '2': { name: 'Monthly', code: 'monthly' },
    '3': { name: 'Annually', code: 'annually' },
    '4': { name: 'One-time', code: 'once' }
  },
  recurringDefaults: { startTime: '10:00', currency: 'GHS', paymentOption: 'MobileMoney' },
  hubtelRecurring: {
    posSalesId: null,
    intervals: { weekly: 'Weekly', monthly: 'Monthly', annually: 'Yearly' }
  }
}));

const donationService = require('../../src/services/donationService');
const { processRequest, clearSession, ResponseType } = require('../../src/services/ussdMenuService');

// Helper: navigate to frequency_selection step with amount GHS 5 (choice '1')
async function navigateToFrequencyMenu(sessionId, mobile = '0244000000') {
  // Step 1: Initiation → amount_selection
  await processRequest({ SessionId: sessionId, Type: 'Initiation', Message: '', Mobile: mobile, Sequence: 1 });
  // Step 2: Select amount '1' (GHS 5) → frequency_selection
  const response = await processRequest({ SessionId: sessionId, Type: 'Response', Message: '1', Mobile: mobile });
  return response;
}

describe('USSD frequency menu — cancel subscription option', () => {
  const SESSION = 'TEST-CANCEL-001';
  const MOBILE = '0244000000';

  beforeEach(async () => {
    clearSession(SESSION);
    jest.clearAllMocks();
    await navigateToFrequencyMenu(SESSION, MOBILE);
  });

  afterAll(() => {
    clearSession(SESSION);
    jest.useRealTimers();
  });

  test('frequency menu includes "5. Cancel subscription"', async () => {
    // beforeEach already navigated to frequency_selection — the last response was the frequency menu
    // Re-request it by going back and forward to get a fresh frequency menu response
    clearSession(SESSION);
    await processRequest({ SessionId: SESSION, Type: 'Initiation', Message: '', Mobile: MOBILE, Sequence: 1 });
    const freqResponse = await processRequest({ SessionId: SESSION, Type: 'Response', Message: '1', Mobile: MOBILE });
    expect(freqResponse.Message).toContain('5. Cancel subscription');
  });

  test('selecting 5 with no active subscription re-shows frequency menu with message', async () => {
    donationService.getActiveSubscriptions.mockResolvedValue([]);

    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '5', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('no active subscription');
    expect(response.Message).toContain('Cancel subscription'); // menu is re-shown
  });

  test('selecting 5 with an active subscription transitions to cancellation_confirmation', async () => {
    donationService.getActiveSubscriptions.mockResolvedValue([{
      _id: 'SUB-ID-1',
      frequency: 'monthly',
      amount: 50
    }]);

    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '5', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('monthly');
    expect(response.Message).toContain('50');
    expect(response.Message).toContain('Confirm cancellation');
  });

  test('selecting 1-4 still works normally after adding option 5', async () => {
    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '2', Mobile: MOBILE
    });
    // Should go to confirmation step (Monthly selected)
    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('Monthly');
    expect(response.Message).toContain('Confirm');
  });

  test('invalid input shows updated error message mentioning 1-5', async () => {
    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '9', Mobile: MOBILE
    });
    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toMatch(/1-5/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/services/ussdMenuService.test.js --no-coverage
```

Expected: multiple FAILs — "5. Cancel subscription" not in menu, '5' is caught by invalid-input guard.

- [ ] **Step 3: Implement the changes in `ussdMenuService.js`**

**3a. Update `buildFrequencyMenu` to add option 5** (around line 107):

```js
function buildFrequencyMenu(amount) {
  let menu = `Amount: GHS ${amount}\n`;
  menu += 'Select frequency:\n';
  menu += '1. Weekly\n';
  menu += '2. Monthly\n';
  menu += '3. Annually\n';
  menu += '4. One-time\n';
  menu += '5. Cancel subscription\n';
  menu += '0. Back';
  return menu;
}
```

**3b. Update `handleFrequencySelection` signature, make it async, add choice '5' handler** (around line 353):

```js
async function handleFrequencySelection(sessionId, input, session, mobile) {
  const choice = input.trim();
  const frequencies = config.frequencies;

  // Handle back option — go to amount selection
  if (choice === '0') {
    updateSession(sessionId, { step: 'amount_selection', amount: null });
    return buildResponse(sessionId, ResponseType.RESPONSE, buildAmountMenu(), {
      label: 'Select Amount',
      clientState: 'amount_selection',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  // Handle cancel subscription option
  if (choice === '5') {
    const formattedPhone = recurringInvoiceService.formatPhoneNumber(mobile);
    let subscriptions;
    try {
      subscriptions = await donationService.getActiveSubscriptions(formattedPhone);
    } catch (err) {
      console.error('Error looking up subscriptions:', err);
      return buildResponse(sessionId, ResponseType.RESPONSE,
        'An error occurred. Please try again.\n\n' + buildFrequencyMenu(session.amount), {
          label: 'Error',
          clientState: 'frequency_selection',
          dataType: 'input',
          fieldType: 'number'
        });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return buildResponse(sessionId, ResponseType.RESPONSE,
        'You have no active subscription to cancel.\n\n' + buildFrequencyMenu(session.amount), {
          label: 'No Subscription',
          clientState: 'frequency_selection',
          dataType: 'input',
          fieldType: 'number'
        });
    }

    const subscription = subscriptions[0];
    updateSession(sessionId, {
      step: 'cancellation_confirmation',
      cancelSubscriptionId: subscription._id,
      cancelFrequency: subscription.frequency,
      cancelAmount: subscription.amount
    });

    const confirmMenu =
      `Your ${subscription.frequency} subscription of GHS ${subscription.amount} will be cancelled.\n\n` +
      '1. Confirm cancellation\n' +
      '2. Keep subscription\n' +
      '0. Back';

    return buildResponse(sessionId, ResponseType.RESPONSE, confirmMenu, {
      label: 'Confirm Cancellation',
      clientState: 'cancellation_confirmation',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  // Invalid input — must come AFTER all named choices
  if (!frequencies[choice]) {
    return buildResponse(sessionId, ResponseType.RESPONSE,
      'Invalid choice. Select 1-5 or 0 to go back:\n\n' + buildFrequencyMenu(session.amount), {
        label: 'Invalid Frequency',
        clientState: 'frequency_selection',
        dataType: 'input',
        fieldType: 'number'
      });
  }

  const frequency = frequencies[choice];
  updateSession(sessionId, {
    step: 'confirmation',
    frequency: frequency.name,
    frequencyCode: frequency.code
  });

  return buildResponse(sessionId, ResponseType.RESPONSE, buildConfirmationMenu(session.amount, frequency.name), {
    label: 'Confirm Donation',
    clientState: 'confirmation',
    dataType: 'input',
    fieldType: 'number'
  });
}
```

**3c. Update the `processRequest` switch to await `handleFrequencySelection` and pass `Mobile`** (around line 231):

```js
case 'frequency_selection':
  return await handleFrequencySelection(SessionId, Message, session, Mobile);
```

(Change `return handleFrequencySelection(...)` to `return await handleFrequencySelection(...)` and add `Mobile` as the fourth argument.)

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx jest tests/services/ussdMenuService.test.js --no-coverage
```

Expected: all tests in `'USSD frequency menu — cancel subscription option'` PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/ussdMenuService.js tests/services/ussdMenuService.test.js
git commit -m "feat: add cancel subscription option to USSD frequency menu"
```

---

## Chunk 2: Cancellation confirmation step

### Task 3: Add `handleCancellationConfirmation` and wire it into `processRequest`

**Files:**
- Modify: `src/services/ussdMenuService.js`
- Modify: `tests/services/ussdMenuService.test.js` (add new describe block)

- [ ] **Step 1: Write failing tests**

Append to `tests/services/ussdMenuService.test.js`:

```js
describe('USSD cancellation confirmation step', () => {
  const SESSION = 'TEST-CANCEL-002';
  const MOBILE = '0244000000';

  // Navigate to cancellation_confirmation with a mock subscription
  async function navigateToCancellationConfirmation(sessionId, mobile) {
    clearSession(sessionId);
    jest.clearAllMocks();
    await processRequest({ SessionId: sessionId, Type: 'Initiation', Message: '', Mobile: mobile, Sequence: 1 });
    await processRequest({ SessionId: sessionId, Type: 'Response', Message: '1', Mobile: mobile });

    donationService.getActiveSubscriptions.mockResolvedValue([{
      _id: 'SUB-ID-2',
      frequency: 'weekly',
      amount: 20
    }]);
    await processRequest({ SessionId: sessionId, Type: 'Response', Message: '5', Mobile: mobile });
  }

  beforeEach(async () => {
    await navigateToCancellationConfirmation(SESSION, MOBILE);
  });

  afterAll(() => {
    clearSession(SESSION);
  });

  test('replying 1 calls cancelSubscription and returns Release with success message', async () => {
    donationService.cancelSubscription.mockResolvedValue({
      success: true,
      subscription: { _id: 'SUB-ID-2', status: 'cancelled' }
    });

    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '1', Mobile: MOBILE
    });

    expect(donationService.cancelSubscription).toHaveBeenCalledWith('SUB-ID-2', 'Cancelled by user via USSD');
    expect(response.Type).toBe(ResponseType.RELEASE);
    expect(response.Message).toContain('cancelled');
  });

  test('replying 2 returns to frequency_selection', async () => {
    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '2', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('Cancel subscription'); // frequency menu re-shown
  });

  test('replying 0 returns to frequency_selection', async () => {
    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '0', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('Cancel subscription');
  });

  test('cancelSubscription failure returns Release with error message', async () => {
    donationService.cancelSubscription.mockResolvedValue({
      success: false,
      error: 'Hubtel cancel failed'
    });

    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '1', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RELEASE);
    expect(response.Message).toContain('could not cancel');
  });

  test('invalid input re-shows confirmation menu', async () => {
    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '9', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('Confirm cancellation');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/services/ussdMenuService.test.js --no-coverage -t "USSD cancellation confirmation step"
```

Expected: FAILs — `'cancellation_confirmation'` case not in switch, falls to `default` (session error Release).

- [ ] **Step 3: Implement `handleCancellationConfirmation`**

Add this new function to `src/services/ussdMenuService.js` **after** `handleFrequencySelection` and **before** `handleConfirmation`:

```js
/**
 * Handle cancellation confirmation step
 */
async function handleCancellationConfirmation(sessionId, input, session) {
  const choice = input.trim();

  // Build the confirmation menu text (used for invalid-input re-display)
  const confirmMenu =
    `Your ${session.cancelFrequency} subscription of GHS ${session.cancelAmount} will be cancelled.\n\n` +
    '1. Confirm cancellation\n' +
    '2. Keep subscription\n' +
    '0. Back';

  // Back or keep — return to frequency_selection (preserve session.amount)
  if (choice === '0' || choice === '2') {
    updateSession(sessionId, { step: 'frequency_selection' });
    return buildResponse(sessionId, ResponseType.RESPONSE, buildFrequencyMenu(session.amount), {
      label: 'Select Frequency',
      clientState: 'frequency_selection',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  // Confirm cancellation
  if (choice === '1') {
    const result = await donationService.cancelSubscription(
      session.cancelSubscriptionId,
      'Cancelled by user via USSD'
    );

    if (result.success) {
      clearSession(sessionId);
      return buildResponse(sessionId, ResponseType.RELEASE,
        'Your subscription has been cancelled. Thank you for your support.', {
          label: 'Cancelled',
          clientState: 'subscription_cancelled',
          dataType: 'display'
        });
    } else {
      clearSession(sessionId);
      return buildResponse(sessionId, ResponseType.RELEASE,
        'Sorry, we could not cancel your subscription. Please contact support.', {
          label: 'Cancel Failed',
          clientState: 'cancel_failed',
          dataType: 'display'
        });
    }
  }

  // Invalid input — re-show confirmation menu
  return buildResponse(sessionId, ResponseType.RESPONSE, confirmMenu, {
    label: 'Invalid Choice',
    clientState: 'cancellation_confirmation',
    dataType: 'input',
    fieldType: 'number'
  });
}
```

- [ ] **Step 4: Wire `handleCancellationConfirmation` into `processRequest`**

In the `switch (session.step)` block in `processRequest`, add a new case **before** `default`:

```js
case 'cancellation_confirmation':
  return await handleCancellationConfirmation(SessionId, Message, session);
```

- [ ] **Step 5: Run the tests**

```bash
npx jest tests/services/ussdMenuService.test.js --no-coverage
```

Expected: all tests PASS (both describe blocks).

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass. Note the expected output:

```
Test Suites: 4 passed, 4 total
Tests:       XX passed, XX total
```

- [ ] **Step 7: Commit**

```bash
git add src/services/ussdMenuService.js tests/services/ussdMenuService.test.js
git commit -m "feat: add USSD cancellation confirmation step"
```
