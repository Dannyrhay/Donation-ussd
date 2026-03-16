// tests/models/donation.test.js
'use strict';

// We test the schema shape without a live DB — just instantiate a model
// and inspect its schema paths and enum values.
const mongoose = require('mongoose');

// Prevent mongoose from trying to connect during tests
jest.mock('../../src/config/database', () => ({
  connectDatabase: jest.fn().mockResolvedValue(null),
  disconnectDatabase: jest.fn().mockResolvedValue(null)
}));

const Donation = require('../../src/models/Donation');

describe('Donation model schema', () => {
  test('status enum includes fulfilled', () => {
    const statusEnum = Donation.schema.path('status').enumValues;
    expect(statusEnum).toContain('fulfilled');
  });

  test('fulfilledAt field exists as a Date', () => {
    const fulfilledAtPath = Donation.schema.path('fulfilledAt');
    expect(fulfilledAtPath).toBeDefined();
    expect(fulfilledAtPath.instance).toBe('Date');
  });
});
