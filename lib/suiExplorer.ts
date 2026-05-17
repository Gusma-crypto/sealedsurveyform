const NETWORK: string = "testnet";

const SUIVISION_BASE =
  NETWORK === "mainnet"
    ? "https://suivision.xyz"
    : `https://${NETWORK}.suivision.xyz`;

const SUISCAN_BASE =
  NETWORK === "mainnet"
    ? "https://suiscan.xyz"
    : `https://suiscan.xyz/${NETWORK}`;

export function suiVisionTxUrl(digest: string) {
  return `${SUIVISION_BASE}/txblock/${digest}`;
}

export function suiVisionObjectUrl(objectId: string) {
  return `${SUIVISION_BASE}/object/${objectId}`;
}

export function suiScanTxUrl(digest: string) {
  return `${SUISCAN_BASE}/tx/${digest}`;
}

export function suiScanObjectUrl(objectId: string) {
  return `${SUISCAN_BASE}/object/${objectId}`;
}