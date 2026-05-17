export const WALRUS_CONFIG = {
  publisherUrl: "https://publisher.walrus-testnet.walrus.space",
  aggregatorUrl: "https://aggregator.walrus-testnet.walrus.space",
  uploadRelayUrl: "https://upload-relay.testnet.walrus.space",
  rpcUrl: process.env.NEXT_PUBLIC_SUI_RPC_URL || "https://fullnode.testnet.sui.io:443",
  epochs: 5,
} as const;

let walrusClient: any = null;

export async function getWalrusClient() {
  if (!walrusClient) {
    const [{ SuiGrpcClient }, { walrus }] = await Promise.all([
      import("@mysten/sui/grpc"),
      import("@mysten/walrus"),
    ]);

    const suiClient = new SuiGrpcClient({
      network: "testnet",
      baseUrl: WALRUS_CONFIG.rpcUrl,
    });

    walrusClient = suiClient.$extend(walrus({
      storageNodeClientOptions: {
        timeout: 60_000,
      },
      uploadRelay: {
        host: WALRUS_CONFIG.uploadRelayUrl,
        sendTip: { max: 1_000 },
      },
    })).walrus;
  }

  return walrusClient;
}

export function createWalletWalrusSigner({
  address,
  signAndExecuteTransaction,
}: {
  address: string;
  signAndExecuteTransaction: {
    mutateAsync: (input: { transaction: any }) => Promise<any>;
  };
}): any {
  return {
    toSuiAddress: () => address,
    sign: async () => {
      throw new Error("Raw signing is not supported for Walrus wallet uploads.");
    },
    signWithIntent: async () => {
      throw new Error("Intent signing is not supported for Walrus wallet uploads.");
    },
    signTransaction: async () => {
      throw new Error("Use signAndExecuteTransaction for Walrus wallet uploads.");
    },
    signPersonalMessage: async () => {
      throw new Error("Personal message signing is not supported for Walrus wallet uploads.");
    },
    signAndExecuteTransaction: async ({ transaction }: any) => {
      const result = await signAndExecuteTransaction.mutateAsync({ transaction });
      if (result.Transaction || result.FailedTransaction) return result;

      const digest =
        result.digest ??
        result.effects?.transactionDigest ??
        result.effects?.TransactionEffects?.transactionDigest;
      if (!digest) {
        throw new Error("Walrus SDK upload transaction did not return a digest.");
      }

      return {
        Transaction: {
          digest,
          effects: typeof result.effects === "object" ? result.effects : undefined,
        },
      };
    },
    getKeyScheme: () => "ED25519",
    getPublicKey: () => {
      throw new Error("Public key is not needed for Walrus wallet uploads.");
    },
  };
}
