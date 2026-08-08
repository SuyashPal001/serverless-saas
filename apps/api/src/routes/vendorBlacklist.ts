export interface VendorBlacklistInput {
  isBlacklisted: boolean;
  blacklistReason: string | null;
}

export interface VendorBlacklistResult {
  blocked: boolean;
  reason: string | null;
}

export function checkVendorBlacklist(vendor: VendorBlacklistInput | null): VendorBlacklistResult {
  if (!vendor) return { blocked: false, reason: null };
  if (!vendor.isBlacklisted) return { blocked: false, reason: null };
  return { blocked: true, reason: vendor.blacklistReason ?? 'Vendor is blacklisted' };
}
