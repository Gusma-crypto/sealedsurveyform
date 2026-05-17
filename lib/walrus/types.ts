export interface WalrusUploadResult {
  blobId: string;
  blobUrl: string;
  suiRef?: string;
  alreadyCertified: boolean;
  size: number;
  storage: "sdk" | "publisher";
}

export interface WalrusUploadOptions {
  epochs?: number;
  signer?: any;
  contentType?: string;
  identifier?: string;
  tags?: Record<string, string>;
  deletable?: boolean;
  fallbackToPublisher?: boolean;
  preferWalletUpload?: boolean;
}

export interface WalrusError {
  code: string;
  message: string;
}
