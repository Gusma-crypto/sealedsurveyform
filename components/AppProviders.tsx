"use client";

import "@mysten/dapp-kit/dist/index.css";

import { createNetworkConfig, SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

const { networkConfig } = createNetworkConfig({
  testnet: {
    network: "testnet",
    url: process.env.NEXT_PUBLIC_SUI_RPC_URL || getJsonRpcFullnodeUrl("testnet"),
  },
  mainnet: {
    network: "mainnet",
    url: getJsonRpcFullnodeUrl("mainnet"),
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
