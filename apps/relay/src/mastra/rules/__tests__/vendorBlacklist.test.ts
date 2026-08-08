import { describe, it, expect } from 'vitest';
import { checkVendorBlacklist } from '../vendorBlacklist.js';

describe('checkVendorBlacklist', () => {
  it('does not block when no vendor is linked', () => {
    expect(checkVendorBlacklist(null)).toEqual({ blocked: false, reason: null });
  });

  it('does not block a non-blacklisted vendor', () => {
    expect(checkVendorBlacklist({ isBlacklisted: false, blacklistReason: null })).toEqual({ blocked: false, reason: null });
  });

  it('blocks a blacklisted vendor and surfaces the reason', () => {
    expect(checkVendorBlacklist({ isBlacklisted: true, blacklistReason: 'Debarred' })).toEqual({ blocked: true, reason: 'Debarred' });
  });

  it('blocks a blacklisted vendor with a null reason using a default message', () => {
    expect(checkVendorBlacklist({ isBlacklisted: true, blacklistReason: null })).toEqual({ blocked: true, reason: 'Vendor is blacklisted' });
  });
});
