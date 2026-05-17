import { DemType, EncryptedObject, SealClient, type KeyServerConfig } from "@mysten/seal";
import { SessionKey } from "@mysten/seal";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";

const DEFAULT_TESTNET_KEY_SERVERS: KeyServerConfig[] = [
  {
    objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
    weight: 1,
  },
  {
    objectId: "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8",
    weight: 1,
  },
];

export interface SealEncryptedValue {
  kind: "seal";
  id: string;
  ciphertext: string;
}

export interface SealDecryptOptions {
  ciphertextBase64: string;
  id: string;
  formId: string;
  accountAddress: string;
  signPersonalMessage: {
    mutateAsync: (input: { message: Uint8Array }) => Promise<{ signature: string }>;
  };
  txBuildClient: any;
}

export interface SealSessionDecryptOptions {
  ciphertextBase64: string;
  id: string;
  formId: string;
  accountAddress: string;
  sessionKey: SessionKey;
  txBuildClient: any;
}

let sealSuiClient: SuiGraphQLClient | null = null;

function getCompatibleSealClient(preferredClient?: any) {
  return preferredClient?.core?.getObject ? preferredClient : getSealSuiClient();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToBytes(hex: string): number[] {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return clean.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [];
}

export function createSealIdentity(...parts: string[]): string {
  return bytesToHex(new TextEncoder().encode(parts.join(":")));
}

export function getSealConfig() {
  const packageId =
    process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ||
    process.env.NEXT_PUBLIC_SEAL_PACKAGE_ID;
  const threshold = Number(process.env.NEXT_PUBLIC_SEAL_THRESHOLD || "1");
  const configuredServers = (process.env.NEXT_PUBLIC_SEAL_KEY_SERVERS || "")
    .split(",")
    .map((server): KeyServerConfig | null => {
      const [objectId, weight = "1", aggregatorUrl] = server.split("|").map((part) => part.trim());
      if (!objectId) return null;
      return {
        objectId,
        weight: Number(weight || "1"),
        aggregatorUrl: aggregatorUrl || undefined,
      };
    })
    .filter(Boolean) as KeyServerConfig[];
  const serverConfigs = configuredServers.length > 0 ? configuredServers : DEFAULT_TESTNET_KEY_SERVERS;

  const approveTarget = process.env.NEXT_PUBLIC_SEAL_APPROVE_TARGET;
  const registryObjectId =
    process.env.NEXT_PUBLIC_REGISTRY_ID ||
    process.env.NEXT_PUBLIC_SUI_REGISTRY_OBJECT_ID;

  return { packageId, threshold, serverConfigs, approveTarget, registryObjectId };
}

export function getSealSuiClient() {
  if (!sealSuiClient) {
    sealSuiClient = new SuiGraphQLClient({
      url: process.env.NEXT_PUBLIC_SUI_GRAPHQL_URL || "https://sui-testnet.mystenlabs.com/graphql",
      network: "testnet",
    });
  }

  return sealSuiClient;
}

export function isSealConfigured() {
  const config = getSealConfig();
  return Boolean(config.packageId && config.serverConfigs.length > 0 && config.threshold > 0);
}

export async function sealEncryptValue({
  suiClient,
  value,
  id,
}: {
  suiClient: any;
  value: unknown;
  id: string;
}): Promise<SealEncryptedValue> {
  const config = getSealConfig();
  if (!config.packageId || config.serverConfigs.length === 0) {
    throw new Error("Seal is not configured. Set NEXT_PUBLIC_SUI_PACKAGE_ID and NEXT_PUBLIC_SEAL_KEY_SERVERS.");
  }

  const client = new SealClient({
    suiClient: getCompatibleSealClient(suiClient),
    serverConfigs: config.serverConfigs,
    verifyKeyServers: false,
  });

  const data = new TextEncoder().encode(JSON.stringify(value));
  const { encryptedObject } = await client.encrypt({
    packageId: config.packageId,
    threshold: config.threshold,
    id,
    data,
    demType: DemType.AesGcm256,
  });

  return {
    kind: "seal",
    id,
    ciphertext: bytesToBase64(encryptedObject),
  };
}

export async function sealDecryptValue({
  ciphertextBase64,
  id,
  formId,
  accountAddress,
  signPersonalMessage,
  txBuildClient,
}: SealDecryptOptions): Promise<unknown> {
  const config = getSealConfig();
  if (!config.packageId) {
    throw new Error("Seal package ID is missing.");
  }
  if (!config.approveTarget) {
    throw new Error("Missing NEXT_PUBLIC_SEAL_APPROVE_TARGET.");
  }
  if (!config.registryObjectId) {
    throw new Error("Missing NEXT_PUBLIC_REGISTRY_ID.");
  }

  const sealSuiClient = getCompatibleSealClient(txBuildClient);
  const sessionKey = await SessionKey.create({
    address: accountAddress,
    packageId: config.packageId,
    ttlMin: 10,
    suiClient: sealSuiClient as any,
  });

  const signed = await signPersonalMessage.mutateAsync({
    message: sessionKey.getPersonalMessage(),
  });
  await sessionKey.setPersonalMessageSignature(signed.signature);

  const tx = new Transaction();
  tx.setSender(accountAddress);
  tx.moveCall({
    target: config.approveTarget,
    arguments: [
      tx.object(config.registryObjectId),
      tx.pure.string(formId),
      tx.pure.vector("u8", hexToBytes(id)),
    ],
  });
  const txBytes = await tx.build({ client: txBuildClient });

  const client = new SealClient({
    suiClient: sealSuiClient as any,
    serverConfigs: config.serverConfigs,
    verifyKeyServers: false,
  });

  const plaintext = await client.decrypt({
    data: base64ToBytes(ciphertextBase64),
    sessionKey,
    txBytes,
  });

  const text = new TextDecoder().decode(plaintext);
  return JSON.parse(text);
}

export async function createSignedSealSessionKey({
  accountAddress,
  signPersonalMessage,
  suiClient,
}: {
  accountAddress: string;
  signPersonalMessage: {
    mutateAsync: (input: { message: Uint8Array }) => Promise<{ signature: string }>;
  };
  suiClient?: any;
}) {
  const config = getSealConfig();
  if (!config.packageId) {
    throw new Error("Seal package ID is missing.");
  }

  const sealSuiClient = getCompatibleSealClient(suiClient);
  const sessionKey = await SessionKey.create({
    address: accountAddress,
    packageId: config.packageId,
    ttlMin: 10,
    suiClient: sealSuiClient as any,
  });

  const signed = await signPersonalMessage.mutateAsync({
    message: sessionKey.getPersonalMessage(),
  });
  await sessionKey.setPersonalMessageSignature(signed.signature);
  return sessionKey;
}

export async function sealDecryptValueWithSession({
  ciphertextBase64,
  id,
  formId,
  accountAddress,
  sessionKey,
  txBuildClient,
}: SealSessionDecryptOptions): Promise<unknown> {
  const config = getSealConfig();
  if (!config.packageId) {
    throw new Error("Seal package ID is missing.");
  }
  if (!config.approveTarget) {
    throw new Error("Missing NEXT_PUBLIC_SEAL_APPROVE_TARGET.");
  }
  if (!config.registryObjectId) {
    throw new Error("Missing NEXT_PUBLIC_REGISTRY_ID.");
  }

  const tx = new Transaction();
  tx.setSender(accountAddress);
  tx.moveCall({
    target: config.approveTarget,
    arguments: [
      tx.object(config.registryObjectId),
      tx.pure.string(formId),
      tx.pure.vector("u8", hexToBytes(id)),
    ],
  });
  const txBytes = await tx.build({ client: txBuildClient });

  const client = new SealClient({
    suiClient: getCompatibleSealClient(txBuildClient) as any,
    serverConfigs: config.serverConfigs,
    verifyKeyServers: false,
  });

  const plaintext = await client.decrypt({
    data: base64ToBytes(ciphertextBase64),
    sessionKey,
    txBytes,
  });

  const text = new TextDecoder().decode(plaintext);
  return JSON.parse(text);
}

export function formatDecryptedSealValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export function inspectSealCiphertext(ciphertextBase64: string) {
  try {
    const encryptedObject = EncryptedObject.parse(base64ToBytes(ciphertextBase64));
    return {
      packageId: encryptedObject.packageId,
      id: encryptedObject.id,
      threshold: encryptedObject.threshold,
      services: encryptedObject.services.map(([objectId]) => objectId),
    };
  } catch {
    return null;
  }
}
