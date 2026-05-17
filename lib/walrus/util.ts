import { WALRUS_CONFIG } from "./client";

export function normalizeWalrusBlobId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  let source = trimmed;
  try {
    const url = new URL(trimmed);
    source = url.pathname.split("/").filter(Boolean).pop() ?? trimmed;
  } catch {
    source = trimmed.split("?")[0].split("#")[0];
  }

  const decoded = decodeURIComponent(source);
  const aliasDelimiter = "--";
  const aliasIndex = decoded.lastIndexOf(aliasDelimiter);
  const rawBlobId = aliasIndex >= 0 ? decoded.slice(aliasIndex + aliasDelimiter.length) : decoded;
  const canonical = rawBlobId.replace(/\s/g, "").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");

  if (canonical.startsWith("0x")) {
    throw new Error("Expected a Walrus blobId, not a Sui object id.");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(canonical)) {
    throw new Error("Invalid Walrus blobId format.");
  }

  return canonical;
}

export function shortenBlobId(blobId: string, chars = 4): string {
  const normalized = normalizeWalrusBlobId(blobId);
  if (!normalized || normalized.length <= chars * 2 + 2) return normalized;
  return `${normalized.slice(0, chars + 2)}...${normalized.slice(-chars)}`;
}

export function blobUrl(blobId: string): string {
  return `${WALRUS_CONFIG.aggregatorUrl}/v1/blobs/${encodeURIComponent(normalizeWalrusBlobId(blobId))}`;
}
