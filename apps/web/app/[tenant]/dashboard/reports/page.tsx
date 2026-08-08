"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";

interface ReportCardProps {
  title: string;
  description: string;
  endpoint: string;
  fromDate: string;
  toDate: string;
}

function ReportCard({ title, description, endpoint, fromDate, toDate }: ReportCardProps) {
  function buildUrl(format: "csv" | "html") {
    const params = new URLSearchParams({ format });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    return `/api/proxy/api/v1${endpoint}?${params.toString()}`;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex gap-2">
        <a href={buildUrl("csv")} download>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </a>
        <a href={buildUrl("html")} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs">
            <Printer className="w-3.5 h-3.5" /> Print / Export PDF
          </Button>
        </a>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold text-foreground">MIS Reports</h1>

      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground">
          From
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="ml-2 text-xs bg-background border border-border rounded px-2 py-1 text-foreground" />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="ml-2 text-xs bg-background border border-border rounded px-2 py-1 text-foreground" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ReportCard
          title="Major Contracts / POs"
          description="Awarded contracts with vendor details, bid counts, and contract value."
          endpoint="/reports/contracts"
          fromDate={fromDate}
          toDate={toDate}
        />
        <ReportCard
          title="Spend by Category"
          description="Total contract spend grouped by procurement category."
          endpoint="/reports/spend-by-category"
          fromDate={fromDate}
          toDate={toDate}
        />
      </div>
    </div>
  );
}
