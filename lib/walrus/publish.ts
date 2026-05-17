import { WALRUS_CONFIG } from "./client";
import type { WalrusUploadResult } from "./types";
import { blobUrl, normalizeWalrusBlobId } from "./util";

function parsePublisherResult(result: any, size: number): WalrusUploadResult {
  if (result.newlyCreated) {
    const { blobObject, resourceOperation } = result.newlyCreated;
    const blobId = normalizeWalrusBlobId(blobObject.blobId);
    return {
      blobId,
      blobUrl: blobUrl(blobId),
      suiRef: resourceOperation?.registerBlob?.blobObject?.id?.id,
      alreadyCertified: false,
      size,
      storage: "publisher",
    };
  }

  if (result.alreadyCertified) {
    const blobId = normalizeWalrusBlobId(result.alreadyCertified.blobId);
    return {
      blobId,
      blobUrl: blobUrl(blobId),
      alreadyCertified: true,
      size,
      storage: "publisher",
    };
  }

  throw new Error("Unexpected Walrus response: " + JSON.stringify(result));
}

export async function publishBytesToWalrus({
  bytes,
  contentType = "application/octet-stream",
  epochs = WALRUS_CONFIG.epochs,
}: {
  bytes: Uint8Array | Blob;
  contentType?: string;
  epochs?: number;
}): Promise<WalrusUploadResult> {
  const url = `${WALRUS_CONFIG.publisherUrl}/v1/blobs?epochs=${epochs}`;
  const body =
    bytes instanceof Blob
      ? bytes
      : new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown error");
    throw new Error(`Walrus publisher upload failed (${response.status}): ${errText}`);
  }

  const result = await response.json();
  const size = bytes instanceof Blob ? bytes.size : bytes.length;
  return parsePublisherResult(result, size);
}
