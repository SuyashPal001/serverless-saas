"use client";

import { useState } from "react";
import { VendorList } from "./VendorList";
import { VendorDetail } from "./VendorDetail";

export default function VendorsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Vendor Database</h1>
      <div className="flex gap-4">
        <div className="w-1/2">
          <VendorList onSelect={setSelectedId} selectedId={selectedId} />
        </div>
        <div className="w-1/2 rounded-lg border border-border bg-card p-4">
          {selectedId ? <VendorDetail vendorId={selectedId} /> : <p className="text-sm text-muted-foreground">Select a vendor to view details.</p>}
        </div>
      </div>
    </div>
  );
}
