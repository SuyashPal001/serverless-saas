"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

interface Vendor {
  id: string; name: string; category: string; countryOfOrigin: string | null;
  isBlacklisted: boolean; isOemAuthorized: boolean;
}

const CATEGORIES = ["cpsu", "spsu", "mse", "self_help_group", "govt_body", "civil_contractor", "other"];
const CATEGORY_LABELS: Record<string, string> = {
  cpsu: "CPSU", spsu: "SPSU", mse: "MSE", self_help_group: "Self-Help Group",
  govt_body: "Govt Body", civil_contractor: "Civil Contractor", other: "Other",
};

async function fetchVendors(category: string): Promise<Vendor[]> {
  const qs = category ? `?category=${category}` : "";
  const res = await fetch(`/api/proxy/api/v1/vendors${qs}`);
  if (!res.ok) throw new Error("Failed to load vendors");
  const data = await res.json();
  return data.vendors ?? [];
}

export function VendorList({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId: string | null }) {
  const [filterCat, setFilterCat] = useState("");
  const { data: vendorList = [], isLoading } = useQuery({
    queryKey: ["vendors", filterCat],
    queryFn: () => fetchVendors(filterCat),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setFilterCat("")} className={`text-xs px-2 py-0.5 rounded-full border ${!filterCat ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>All</button>
        {CATEGORIES.map(cat => (
          <button key={cat} onClick={() => setFilterCat(f => f === cat ? "" : cat)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${filterCat === cat ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

      <div className="space-y-1.5">
        {vendorList.map(v => (
          <div key={v.id} onClick={() => onSelect(v.id)}
            className={`p-2.5 rounded border cursor-pointer ${selectedId === v.id ? "border-primary bg-primary/5" : "border-border/50 hover:border-border bg-muted/10"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{v.name}</span>
              <div className="flex items-center gap-1.5">
                {v.isBlacklisted && <Badge className="text-xs border border-red-500/30 bg-red-500/10 text-red-400">Blacklisted</Badge>}
                {v.isOemAuthorized && <Badge className="text-xs border border-blue-500/30 bg-blue-500/10 text-blue-400">OEM</Badge>}
                <Badge className="text-xs border border-border/50 bg-muted/30 text-muted-foreground">{CATEGORY_LABELS[v.category] ?? v.category}</Badge>
              </div>
            </div>
            {v.countryOfOrigin && <p className="text-xs text-muted-foreground mt-0.5">{v.countryOfOrigin}</p>}
          </div>
        ))}
        {!isLoading && vendorList.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No vendors in this category.</p>
        )}
      </div>
    </div>
  );
}
