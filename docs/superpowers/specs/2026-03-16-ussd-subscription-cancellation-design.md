# USSD Subscription Cancellation — Design Spec
**Date:** 2026-03-16
**Scope:** Allow users to cancel their active recurring subscription via the USSD frequency-selection menu

---

## Overview

Users who have an active recurring subscription currently have no self-service way to cancel. Admins can cancel via `POST /api/callback/subscriptions/:id/cancel`, but there is no USSD path. This spec adds a "Cancel subscription" option as the last item on the frequency-selection menu. Selecting it either walks the user through a confirmation flow (if they have an active subscription) or redirects them back to make a new donation (if they do not).

---

## Architecture

Two files change. No new files are created.

| File | Change |
|---|---|
| `src/services/ussdMenuService.js` | `buildFrequencyMenu()` gains a cancel option; `handleFrequencySelection()` becomes async and gains a `mobile` param to look up subscriptions; new `handleCancellationConfirmation()` function; `processRequest()` passes `Mobile` to `handleFrequencySelection` with `await`; new `'cancellation_confirmation'` case in the step switch |
| `src/models/Subscription.js` | `findActiveByPhone` static method gains `.sort({ createdAt: -1 })` so the most recently created subscription is always `[0]` |

---

## Data Flow

```
User dials → amount_selection → frequency_selection
                                       │
                       ┌───────────────┴────────────────┐
                  Selects 1-4                   Selects 5 (Cancel)
                       │                               │
               [existing flow]          Look up active subscription
                                         by formatted phone number
                                                   │
                             ┌─────────────────────┴──────────────────────┐
                          Found                                        Not found
                             │                                             │
                  step → cancellation_confirmation            Re-show frequency menu with:
                  "Your {freq} subscription of                "You have no active subscription.
                   GHS {amount} will be cancelled.
                   1. Confirm  2. Keep  0. Back"               Amount: GHS X
                             │                                Select frequency: ..."
                  ┌──────────┴──────────┐
                "1" (confirm)        "2"/"0"
                  │                    │
         donationService              step → frequency_selection
         .cancelSubscription()
                  │
          "Your subscription
           has been cancelled."
           → Release
```

---

## Session States

**Existing states (unchanged):** `amount_selection`, `custom_amount`, `frequency_selection`, `confirmation`

**New state:** `cancellation_confirmation`

When `cancellation_confirmation` is active, the session contains an additional field `cancelSubscriptionId` (the MongoDB `_id` of the subscription to cancel). This avoids re-querying the database when the user confirms.

---

## Menu Changes

### Frequency menu (updated)

```
Amount: GHS {amount}
Select frequency:
1. Weekly
2. Monthly
3. Annually
4. One-time
5. Cancel subscription
0. Back
```

`buildFrequencyMenu()` always shows option 5. The no-subscription case is handled after selection, not before display (no database query needed on menu render).

### Cancellation confirmation menu (new)

```
Your {frequency} subscription of GHS {amount} will be cancelled.

1. Confirm cancellation
2. Keep subscription
0. Back
```

---

## Implementation Details

### `buildFrequencyMenu(amount)` change

Add `'5. Cancel subscription\n'` before `'0. Back'`.

### `handleFrequencySelection(sessionId, input, session, mobile)` changes

- Signature gains `mobile` parameter
- Function becomes `async`
- **Ordering is critical.** The existing code at line 368 evaluates `!frequencies[choice]` immediately after the `'0'` guard. Because `'5'` is not a key in `config.frequencies`, it would match that invalid-input guard and be rejected before the new branch runs. The `choice === '5'` block must be inserted **between the `choice === '0'` guard and the `!frequencies[choice]` guard**, in this order:

  ```
  1. choice === '0'  →  back to amount_selection   [existing]
  2. choice === '5'  →  cancellation lookup         [new]
  3. !frequencies[choice]  →  invalid input         [existing, updated]
  4. valid frequency  →  existing flow              [existing]
  ```

- The `choice === '5'` block:
  1. Format phone: `recurringInvoiceService.formatPhoneNumber(mobile)`
  2. Query: `await donationService.getActiveSubscriptions(formattedPhone)` — returns array sorted by `{ createdAt: -1 }` (see Subscription model note below)
  3. Take `subscriptions[0]` — the most recently created active subscription
  4. If array is empty: re-show frequency menu with prepended message "You have no active subscription.\n\n"
  5. If found: store `cancelSubscriptionId: subscription._id` in session, transition to `cancellation_confirmation`, show confirmation menu with subscription's `frequency` and `amount`

- Update the invalid-choice guard: change `'Invalid choice. Select 1-4'` to `'Invalid choice. Select 1-5 or 0 to go back'`

**Note on sort order:** `Subscription.findActiveByPhone` must add `.sort({ createdAt: -1 })` so `[0]` reliably returns the most recently created subscription. Add this sort to the static method in `src/models/Subscription.js`:
```js
subscriptionSchema.statics.findActiveByPhone = function(phoneNumber) {
  return this.find({ phoneNumber, status: 'active' }).sort({ createdAt: -1 });
};
```
This is a one-line change to `Subscription.js` — the only model change in this spec.

### `handleCancellationConfirmation(sessionId, input, session)` (new function)

- `choice === '0'` or `choice === '2'`: go back to `frequency_selection`. The exact session update is `updateSession(sessionId, { step: 'frequency_selection' })` — do **not** set `amount: null` (unlike the existing back handler in `handleFrequencySelection` which clears amount when going back to `amount_selection`). `session.amount` must be preserved so the frequency menu renders correctly.
- `choice === '1'`:
  1. Call `await donationService.cancelSubscription(session.cancelSubscriptionId, 'Cancelled by user via USSD')`
  2. If `result.success`: `clearSession(sessionId)`, return `Release` with "Your subscription has been cancelled. Thank you for your support."
  3. If `!result.success`: return `Release` with "Sorry, we could not cancel your subscription. Please contact support."
- Any other input: re-show confirmation menu (invalid input handling)

### `processRequest()` change

```js
// Before:
case 'frequency_selection':
  return handleFrequencySelection(SessionId, Message, session);

// After:
case 'frequency_selection':
  return await handleFrequencySelection(SessionId, Message, session, Mobile);
```

Add new case:
```js
case 'cancellation_confirmation':
  return await handleCancellationConfirmation(SessionId, Message, session);
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| User selects 5, no active subscription | Re-show frequency menu with "You have no active subscription." prefix; user can pick a frequency or back out |
| User selects 5, multiple active subscriptions | Cancel the first result returned by `findActiveByPhone` |
| `cancelSubscription` fails | Release with error message |
| `getActiveSubscriptions` throws | Catch in `handleFrequencySelection`; re-show frequency menu with "An error occurred. Please try again." prefix |
| Invalid input on cancellation_confirmation | Re-show confirmation menu |

---

## Out of Scope

- Showing a list of subscriptions if the user has more than one (first is used)
- Pause or modify subscription
- Cancellation confirmation SMS/notification
