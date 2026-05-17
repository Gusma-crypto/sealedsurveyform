import { getWalrusClient } from "./client";
import { publishBytesToWalrus } from "./publish";
import { uploadBytesWithWalrusSdk } from "./sdk";
import type { WalrusUploadOptions, WalrusUploadResult } from "./types";
import { blobUrl, normalizeWalrusBlobId } from "./util";

function normalizeUploadOptions(optionsOrEpochs?: WalrusUploadOptions | number): WalrusUploadOptions {
  return typeof optionsOrEpochs === "number" ? { epochs: optionsOrEpochs } : optionsOrEpochs ?? {};
}

function encodeJsonPayload(data: unknown) {
  const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return new TextEncoder().encode(payload);
}

function shouldFallbackToPublisher(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /not enough coins|requested balance|::wal::WAL|insufficient|memory access out of bounds|wasm/i.test(message);
}

async function uploadBytes({
  bytes,
  options,
}: {
  bytes: Uint8Array;
  options: WalrusUploadOptions;
}) {
  const preferWalletUpload =
    options.preferWalletUpload ??
    process.env.NEXT_PUBLIC_WALRUS_PREFER_WALLET_UPLOAD === "true";

  if (options.signer && preferWalletUpload) {
    try {
      return await uploadBytesWithWalrusSdk({ bytes, options });
    } catch (err) {
      if (options.fallbackToPublisher === false || !shouldFallbackToPublisher(err)) throw err;
    }
  }

  return publishBytesToWalrus({
    bytes,
    contentType: options.contentType,
    epochs: options.epochs,
  });
}

export async function uploadToWalrus(
  data: unknown,
  optionsOrEpochs?: WalrusUploadOptions | number
): Promise<WalrusUploadResult> {
  const options = normalizeUploadOptions(optionsOrEpochs);
  const bytes = encodeJsonPayload(data);
  return uploadBytes({
    bytes,
    options: {
      contentType: "application/json",
      identifier: "sealedsurvey-data.json",
      ...options,
    },
  });
}

export async function uploadFileToWalrus(
  file: File,
  optionsOrEpochs?: WalrusUploadOptions | number
): Promise<WalrusUploadResult> {
  const options = normalizeUploadOptions(optionsOrEpochs);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return uploadBytes({
    bytes,
    options: {
      ...options,
      identifier: options.identifier ?? file.name,
      contentType: file.type || "application/octet-stream",
    },
  });
}

export async function downloadFromWalrus<T = unknown>(blobId: string): Promise<T> {
  const normalizedBlobId = normalizeWalrusBlobId(blobId);
  try {
    const client = await getWalrusClient();
    const [file] = await client.getFiles({ ids: [normalizedBlobId] });
    const bytes = file
      ? await file.bytes()
      : await client.readBlob({ blobId: normalizedBlobId });
    const text = new TextDecoder().decode(bytes);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  } catch {
    const response = await fetch(blobUrl(normalizedBlobId));
    if (!response.ok) {
      throw new Error(`Walrus download failed (${response.status}) for blob: ${normalizedBlobId}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}
