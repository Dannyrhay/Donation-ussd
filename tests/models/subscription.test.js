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
