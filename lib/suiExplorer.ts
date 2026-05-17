export function suiTxUrl(digest: string) {
  return `https://suivision.xyz/txblock/${digest}?network=testnet`;
}

export function suiObjectUrl(objectId: string) {
  return `https://suivision.xyz/object/${objectId}?network=testnet`;
}
