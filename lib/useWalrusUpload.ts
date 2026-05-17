"use client";

import { useState, useCallback } from "react";
import {
  uploadToWalrus,
  uploadFileToWalrus,
  type WalrusUploadResult,
} from "@/lib/walrus";

interface UseWalrusUploadState {
  uploading: boolean;
  result: WalrusUploadResult | null;
  error: string | null;
}

export function useWalrusUpload() {
  const [state, setState] = useState<UseWalrusUploadState>({
    uploading: false,
    result: null,
    error: null,
  });

  const upload = useCallback(async (data: unknown): Promise<WalrusUploadResult | null> => {
    setState({ uploading: true, result: null, error: null });
    try {
      const result = await uploadToWalrus(data);
      setState({ uploading: false, result, error: null });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setState({ uploading: false, result: null, error: message });
      return null;
    }
  }, []);

  const uploadFile = useCallback(async (file: File): Promise<WalrusUploadResult | null> => {
    setState({ uploading: true, result: null, error: null });
    try {
      const result = await uploadFileToWalrus(file);
      setState({ uploading: false, result, error: null });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "File upload failed";
      setState({ uploading: false, result: null, error: message });
      return null;
    }
  }, []);

  return { ...state, upload, uploadFile };
}
