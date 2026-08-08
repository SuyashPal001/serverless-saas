import { describe, it, expect } from 'vitest';
import { checkVendorBlacklist } from '../vendorBlacklist.js';

describe('checkVendorBlacklist', () => {
  it('does not block when no vendor is linked', () => {
    const result = checkVendorBlacklist(null);
    expect(result).toEqual({ blocked: false, reason: null });
  });

  it('does not block a non-blacklisted vendor', () => {
    const result = checkVendorBlacklist({ isBlacklisted: false, blacklistReason: null });
    expect(result).toEqual({ blocked: false, reason: null });
  });

  it('blocks a blacklisted vendor and surfaces the reason', () => {
    const result = checkVendorBlacklist({ isBlacklisted: true, blacklistReason: 'Debarred by CVC order dated 2026-01-15' });
    expect(result).toEqual({ blocked: true, reason: 'Debarred by CVC order dated 2026-01-15' });
  });

  it('blocks a blacklisted vendor with a null reason using a default message', () => {
    const result = checkVendorBlacklist({ isBlacklisted: true, blacklistReason: null });
    expect(result).toEqual({ blocked: true, reason: 'Vendor is blacklisted' });
  });
});
