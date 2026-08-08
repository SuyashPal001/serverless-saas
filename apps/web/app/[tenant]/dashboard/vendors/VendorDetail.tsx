"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface VendorFull {
  id: string; name: string; category: string; countryOfOrigin: string | null;
  contactEmail: string | null; contactPhone: string | null;
  isBlacklisted: boolean; blacklistReason: string | null;
  isOemAuthorized: boolean; oemProducts: string | null;
}
interface ParticipationRow { tenderId: string; rfpNumber: string; tenderTitle: string; bidderStatus: string; submittedAt: string }
interface RateContractRow { id: string; contractType: string; terms: string | null; validFrom: string | null; validTo: string | null }

async function fetchVendor(id: string): Promise<VendorFull> {
  const res = await fetch(`/api/proxy/api/v1/vendors/${id}`);
  if (!res.ok) throw new Error("Failed to load vendor");
  return res.json();
}
async function fetchParticipation(id: string): Promise<ParticipationRow[]> {
  const res = await fetch(`/api/proxy/api/v1/vendors/${id}/participation`);
  if (!res.ok) throw new Error("Failed to load participation");
  const data = await res.json();
  return data.participation ?? [];
}
async function fetchRateContracts(id: string): Promise<RateContractRow[]> {
  const res = await fetch(`/api/proxy/api/v1/vendors/${id}/rate-contracts`);
  if (!res.ok) throw new Error("Failed to load rate contracts");
  const data = await res.json();
  return data.rateContracts ?? [];
}
async function toggleBlacklist(id: string, isBlacklisted: boolean, blacklistReason?: string) {
  const res = await fetch(`/api/proxy/api/v1/vendors/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isBlacklisted, blacklistReason }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
}

export function VendorDetail({ vendorId }: { vendorId: string }) {
  const qc = useQueryClient();
  const [reasonInput, setReasonInput] = useState("");
  const [showReasonInput, setShowReasonInput] = useState(false);

  const { data: vendor, isLoading } = useQuery({ queryKey: ["vendor", vendorId], queryFn: () => fetchVendor(vendorId) });
  const { data: participation = [] } = useQuery({ queryKey: ["vendor-participation", vendorId], queryFn: () => fetchParticipation(vendorId) });
  const { data: rateContractList = [] } = useQuery({ queryKey: ["vendor-rate-contracts", vendorId], queryFn: () => fetchRateContracts(vendorId) });

  const blacklistMutation = useMutation({
    mutationFn: ({ isBlacklisted, reason }: { isBlacklisted: boolean; reason?: string }) => toggleBlacklist(vendorId, isBlacklisted, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor", vendorId] }); qc.invalidateQueries({ queryKey: ["vendors"] }); setShowReasonInput(false); setReasonInput(""); },
  });

  if (isLoading || !vendor) return <p className="text-xs text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{vendor.name}</h3>
        {vendor.isBlacklisted ? (
          <Button size="sm" variant="ghost" onClick={() => blacklistMutation.mutate({ isBlacklisted: false })} disabled={blacklistMutation.isPending} className="text-xs text-green-400">
            Remove from Blacklist
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setShowReasonInput(v => !v)} className="text-xs text-red-400">
            Blacklist Vendor
          </Button>
        )}
      </div>

      {vendor.isBlacklisted && (
        <div className="p-2.5 rounded border border-red-500/30 bg-red-500/10 text-xs text-red-300">
          <b>Blacklisted:</b> {vendor.blacklistReason}
        </div>
      )}

      {showReasonInput && (
        <div className="space-y-2 p-2.5 rounded border border-border/50">
          <input value={reasonInput} onChange={e => setReasonInput(e.target.value)} placeholder="Reason for blacklisting (required)"
            className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground" />
          <Button size="sm" onClick={() => blacklistMutation.mutate({ isBlacklisted: true, reason: reasonInput })}
            disabled={!reasonInput.trim() || blacklistMutation.isPending} className="text-xs">
            {blacklistMutation.isPending ? "Saving…" : "Confirm Blacklist"}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-muted-foreground">Category:</span> {vendor.category}</div>
        <div><span className="text-muted-foreground">Country:</span> {vendor.countryOfOrigin ?? "—"}</div>
        <div><span className="text-muted-foreground">Email:</span> {vendor.contactEmail ?? "—"}</div>
        {vendor.isOemAuthorized && <div className="col-span-2"><Badge className="text-xs border border-blue-500/30 bg-blue-500/10 text-blue-400">OEM Authorized</Badge> {vendor.oemProducts}</div>}
      </div>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-1.5">Participation History</h4>
        {participation.length === 0 && <p className="text-xs text-muted-foreground">No tender participation linked yet.</p>}
        {participation.map(p => (
          <div key={p.tenderId} className="text-xs flex justify-between py-1 border-b border-border/20">
            <span>{p.rfpNumber} — {p.tenderTitle}</span>
            <span className="text-muted-foreground">{p.bidderStatus}</span>
          </div>
        ))}
      </div>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-1.5">Rate / Framework Contracts</h4>
        {rateContractList.length === 0 && <p className="text-xs text-muted-foreground">None on record.</p>}
        {rateContractList.map(rc => (
          <div key={rc.id} className="text-xs py-1 border-b border-border/20">
            <span className="font-medium">{rc.contractType}</span> — {rc.terms ?? "no terms recorded"}
            {rc.validFrom && rc.validTo && <span className="text-muted-foreground"> ({new Date(rc.validFrom).toLocaleDateString()} – {new Date(rc.validTo).toLocaleDateString()})</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
