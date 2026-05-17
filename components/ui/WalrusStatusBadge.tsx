"use client";

import { useEffect, useState } from "react";
import { Database, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { WALRUS_CONFIG } from "@/lib/walrus";

type Status = "checking" | "online" | "offline";

export function WalrusStatusBadge() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    async function check() {
      try {
        // Walrus does not expose /v1/health on this endpoint. A 404 from a
        // harmless blob lookup still proves the aggregator is reachable.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${WALRUS_CONFIG.aggregatorUrl}/v1/blobs/sealedsurvey-status-probe`, {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        setStatus(res.status < 500 ? "online" : "offline");
      } catch {
        setStatus("offline");
      }
    }
    check();
  }, []);

  const config = {
    checking: {
      icon: <Loader2 size={12} className="animate-spin" />,
      label: "Checking Walrus…",
      className: "bg-slate-100 text-slate-500 border-slate-200",
    },
    online: {
      icon: <CheckCircle size={12} />,
      label: "Walrus Testnet online",
      className: "bg-emerald-50 text-emerald-700 border-emerald-100",
    },
    offline: {
      icon: <XCircle size={12} />,
      label: "Walrus unreachable",
      className: "bg-red-50 text-red-600 border-red-100",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium shadow-sm ${config.className}`}
    >
      <Database size={11} />
      {config.icon}
      {config.label}
    </span>
  );
}
