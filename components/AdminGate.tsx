"use client";

import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import { Wallet } from "lucide-react";

export function AdminGate({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount();

  if (!account) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-xl items-center justify-center px-4">
        <div className="panel p-6 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
            <Wallet size={22} />
          </div>
          <h1 className="mb-2 text-xl font-semibold tracking-tight text-slate-950">
            Connect wallet
          </h1>
          <p className="mb-5 text-sm leading-6 text-slate-500">
            Form builder access requires a connected Sui wallet.
          </p>
          <ConnectButton connectText="Connect wallet" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
