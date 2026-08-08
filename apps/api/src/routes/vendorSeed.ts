import { db, vendors } from '@serverless-saas/database';
import { eq } from 'drizzle-orm';

export const SEED_VENDORS = [
  { name: 'Bharat Steel & Engineering Works', category: 'cpsu' as const, countryOfOrigin: 'India', contactEmail: 'contracts@bharatsteel.example', isOemAuthorized: false },
  { name: 'Rajasthan Infra Development Corp', category: 'spsu' as const, countryOfOrigin: 'India', contactEmail: 'tenders@rajinfra.example', isOemAuthorized: false },
  { name: 'Nirman Micro Enterprises', category: 'mse' as const, countryOfOrigin: 'India', contactEmail: 'admin@nirmanmicro.example', isOemAuthorized: false },
  { name: 'Sahyog Self Help Producer Group', category: 'self_help_group' as const, countryOfOrigin: 'India', contactEmail: 'sahyog.shg@example.org', isOemAuthorized: false },
  { name: 'District Rural Development Agency', category: 'govt_body' as const, countryOfOrigin: 'India', contactEmail: 'drda.office@example.gov', isOemAuthorized: false },
  { name: 'Prakash Civil Contractors', category: 'civil_contractor' as const, countryOfOrigin: 'India', contactEmail: 'prakash.civil@example.com', isOemAuthorized: false },
  { name: 'Meridian Instrumentation Pvt Ltd', category: 'other' as const, countryOfOrigin: 'India', contactEmail: 'sales@meridianinst.example', isOemAuthorized: true, oemProducts: 'Flow meters, pressure transmitters (authorized OEM dealer)' },
  { name: 'Global Valve Systems India', category: 'other' as const, countryOfOrigin: 'India', contactEmail: 'info@globalvalve.example', isOemAuthorized: true, oemProducts: 'Industrial control valves, actuators' },
  { name: 'Suryoday MSE Fabricators', category: 'mse' as const, countryOfOrigin: 'India', contactEmail: 'suryoday.fab@example.com', isOemAuthorized: false },
  { name: 'Coastal Corrosion Solutions', category: 'civil_contractor' as const, countryOfOrigin: 'India', contactEmail: 'contact@coastalcorrosion.example', isOemAuthorized: false },
  { name: 'Vindhya Power Equipment Ltd', category: 'cpsu' as const, countryOfOrigin: 'India', contactEmail: 'tenders@vindhyapower.example', isOemAuthorized: false },
  {
    name: 'Ashoka General Suppliers', category: 'other' as const, countryOfOrigin: 'India', contactEmail: 'sales@ashokasuppliers.example',
    isOemAuthorized: false,
    isBlacklisted: true, blacklistReason: 'Debarred following CVC inquiry into bid-rigging on tender ref. GT-2024-0091 (illustrative demo record)',
  },
];

export async function ensureVendors(tenantId: string): Promise<void> {
  const [existing] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.tenantId, tenantId)).limit(1);
  if (existing) return;

  await db.insert(vendors).values(SEED_VENDORS.map(v => ({
    tenantId,
    name: v.name,
    category: v.category,
    countryOfOrigin: v.countryOfOrigin,
    contactEmail: v.contactEmail,
    isOemAuthorized: v.isOemAuthorized,
    oemProducts: 'oemProducts' in v ? v.oemProducts : null,
    isBlacklisted: 'isBlacklisted' in v ? v.isBlacklisted : false,
    blacklistReason: 'blacklistReason' in v ? v.blacklistReason : null,
    blacklistedAt: 'isBlacklisted' in v && v.isBlacklisted ? new Date() : null,
  })));
}
