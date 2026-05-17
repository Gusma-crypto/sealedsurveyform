"use client";

import { useMemo, useState } from "react";
import { useCurrentAccount, useSignPersonalMessage, useSuiClient } from "@mysten/dapp-kit";
import { Lock, Loader2, Unlock } from "lucide-react";
import type { FieldAnswer } from "@/types";
import { formatDecryptedSealValue, getSealConfig, isSealConfigured, sealDecryptValue } from "@/lib/seal";

function formatAnswerValue(value: FieldAnswer["value"]) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === "") return "-";
  return String(value);
}

export function readableSealError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch|NetworkError|Load failed|Could not resolve/i.test(message)) {
    return "Seal key server tidak bisa diakses dari browser. Cek koneksi, Brave Shields/ad blocker, atau NEXT_PUBLIC_SEAL_KEY_SERVERS.";
  }
  if (/NoAccess|not.*authorized|EFormNotFound|ENotFormOwner|MoveAbort/i.test(message)) {
    return "Wallet ini belum punya akses decrypt. Gunakan wallet owner form dan pastikan registry/form sudah tercatat di Sui.";
  }
  if (/signature|rejected|denied|cancel/i.test(message)) {
    return "Signature decrypt dibatalkan di wallet.";
  }
  return message || "Decrypt failed";
}

export async function checkSealKeyServerReachable() {
  const requireHealthcheck = process.env.NEXT_PUBLIC_SEAL_REQUIRE_HEALTHCHECK === "true";
  const explicitUrl = process.env.NEXT_PUBLIC_SEAL_HEALTHCHECK_URL;
  if (explicitUrl) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      await fetch(explicitUrl, {
        method: "GET",
        signal: controller.signal,
      });
    } catch (err) {
      if (requireHealthcheck) {
        throw new Error(`Seal key server unreachable: ${err instanceof Error ? err.message : "network error"}`);
      }
    } finally {
      window.clearTimeout(timeout);
    }
    return;
  }

  const config = getSealConfig();
  const server = config.serverConfigs.find((item) => item.aggregatorUrl);
  if (!server?.aggregatorUrl) return;

  const serviceUrl = `${server.aggregatorUrl.replace(/\/$/, "")}/v1/service?service_id=${server.objectId}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    await fetch(serviceUrl, {
      method: "GET",
      signal: controller.signal,
    });
  } catch (err) {
    if (requireHealthcheck) {
      throw new Error(`Seal key server unreachable: ${err instanceof Error ? err.message : "network error"}`);
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

export function SealAnswerPreview({
  answer,
  ownerAddress,
  formId,
  maxLength = 48,
}: {
  answer?: FieldAnswer;
  ownerAddress?: string;
  formId?: string;
  maxLength?: number;
}) {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const signPersonalMessage = useSignPersonalMessage();
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);

  const isOwner = !ownerAddress || account?.address.toLowerCase() === ownerAddress.toLowerCase();
  const canDecrypt = useMemo(
    () => Boolean(answer?.encrypted && answer.encryption === "seal" && answer.sealId && formId && isSealConfigured() && isOwner),
    [answer, formId, isOwner]
  );

  if (!answer) return <span>-</span>;
  if (!answer.encrypted) return <span>{formatAnswerValue(answer.value).slice(0, maxLength)}</span>;

  async function decrypt() {
    if (!answer?.sealId || !account || !formId) return;

    setDecrypting(true);
    setError(null);
    try {
      const config = getSealConfig();
      if (!config.packageId || !config.approveTarget || !config.registryObjectId) {
        throw new Error("Seal decrypt env is incomplete.");
      }
      if (ownerAddress && account.address.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new Error("Only the form owner wallet can decrypt this answer.");
      }

      await checkSealKeyServerReachable();
      const parsed = await sealDecryptValue({
        ciphertextBase64: String(answer.value ?? ""),
        id: answer.sealId,
        formId,
        accountAddress: account.address,
        signPersonalMessage,
        txBuildClient: suiClient as any,
      });
      setDecrypted(formatDecryptedSealValue(parsed));
    } catch (err) {
      setError(readableSealError(err));
    } finally {
      setDecrypting(false);
    }
  }

  if (decrypted) {
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-800">
        <Unlock size={13} className="text-emerald-600" />
        {decrypted.slice(0, maxLength)}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={decrypt}
        disabled={!canDecrypt || !account || decrypting}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        {decrypting ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
        {decrypting ? "Decrypting" : "Decrypt"}
      </button>
      {error && <span className="max-w-xs text-xs text-red-600">{error}</span>}
      {!canDecrypt && (
        <span className="max-w-xs text-xs text-slate-400">
          {!isOwner ? "Owner wallet required" : "Seal approval env required"}
        </span>
      )}
    </span>
  );
}
