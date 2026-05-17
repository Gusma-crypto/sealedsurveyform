import { WALRUS_CONFIG, getWalrusClient } from "./client";
import type { WalrusUploadOptions, WalrusUploadResult } from "./types";
import { blobUrl, normalizeWalrusBlobId } from "./util";

export async function uploadBytesWithWalrusSdk({
  bytes,
  options,
}: {
  bytes: Uint8Array;
  options: WalrusUploadOptions;
}): Promise<WalrusUploadResult> {
  if (!options.signer) {
    throw new Error("Walrus SDK upload requires a connected wallet signer.");
  }

  const client = await getWalrusClient();
  const { WalrusFile } = await import("@mysten/walrus");
  const identifier = options.identifier ?? "sealedsurvey-data";
  const tags = {
    "content-type": options.contentType ?? "application/octet-stream",
    ...(options.tags ?? {}),
  };

  const [result] = await client.writeFiles({
    files: [WalrusFile.from({ contents: bytes, identifier, tags })],
    deletable: options.deletable ?? false,
    epochs: options.epochs ?? WALRUS_CONFIG.epochs,
    signer: options.signer,
  });

  if (!result) {
    throw new Error("Walrus SDK upload did not return a file reference.");
  }

  const blobId = normalizeWalrusBlobId(result.id || result.blobId);
  return {
    blobId,
    blobUrl: blobUrl(blobId),
    suiRef: result.blobObject.id.id,
    alreadyCertified: false,
    size: bytes.length,
    storage: "sdk",
  };
}
