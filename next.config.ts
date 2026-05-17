import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  transpilePackages: [
    "@mysten/bcs",
    "@mysten/dapp-kit",
    "@mysten/seal",
    "@mysten/sui",
    "@mysten/utils",
    "@mysten/wallet-standard",
    "@mysten/walrus",
    "@mysten/walrus-wasm",
    "@mysten/zksend",
  ],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;
