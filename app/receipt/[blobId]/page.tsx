"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import {
  AlertCircle,
  Check,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Download,
  Radio,
} from "lucide-react";
import { SealAnswerPreview } from "@/components/SealAnswerPreview";
import type { FieldAnswer, FormSubmission } from "@/types";
import { blobUrl, downloadFromWalrus, shortenBlobId } from "@/lib/walrus";
import { findLocalSubmissionEntry } from "@/lib/submissionRegistry";
// import { suiObjectUrl, suiTxUrl } from "@/lib/suiExplorer";
import { suiScanObjectUrl, suiScanTxUrl } from "@/lib/suiExplorer";

function formatAnswer(answer: FieldAnswer) {
  if (Array.isArray(answer.value)) return answer.value.join(", ");
  if (answer.value === null || answer.value === "") return "No answer";
  return String(answer.value);
}

function normalizeAddress(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function ReceiptMediaAttachment({ answer }: { answer: FieldAnswer }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  if (!answer.fileBlobId) return null;

  const url = blobUrl(answer.fileBlobId);
  const filename = typeof answer.value === "string" && answer.value.trim()
    ? answer.value.trim()
    : `sealedsurvey-media-${shortenBlobId(answer.fileBlobId)}`;

  const downloadMedia = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Walrus file download failed (${response.status}).`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Unable to download media.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900"
      >
        View uploaded file
        <ExternalLink size={12} />
      </a>
      <button
        type="button"
        onClick={downloadMedia}
        disabled={downloading}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        {downloading ? "Downloading" : "Download file"}
      </button>
      <span className="font-mono text-[11px] text-slate-400">
        {shortenBlobId(answer.fileBlobId)}
      </span>
      {downloadError && <span className="basis-full text-xs text-red-600">{downloadError}</span>}
    </div>
  );
}

function Step({
  done,
  title,
  detail,
  href,
}: {
  done: boolean;
  title: string;
  detail: string;
  href?: string;
}) {
  return (
    <div className="flex gap-3">
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
        done ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-slate-200 bg-white text-slate-300"
      }`}>
        {done ? <Check size={14} /> : <Clock size={14} />}
      </div>
      <div className="min-w-0 pb-5">
        <div className="text-sm font-medium text-slate-900">{title}</div>
        <div className="mt-1 break-words text-xs leading-5 text-slate-500">{detail}</div>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900"
          >
            Open proof
            <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

export default function ReceiptPage() {
  const params = useParams<{ blobId: string }>();
  const account = useCurrentAccount();
  const blobId = useMemo(() => decodeURIComponent(params.blobId), [params.blobId]);
  const [submission, setSubmission] = useState<FormSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadReceipt() {
      setLoading(true);
      setError(null);
      try {
        const loaded = await downloadFromWalrus<FormSubmission>(blobId);
        const localEntry = findLocalSubmissionEntry(blobId);
        if (!active) return;
        setSubmission({
          ...loaded,
          walrusBlobId: loaded.walrusBlobId || blobId,
          registryTxDigest: loaded.registryTxDigest ?? localEntry?.txDigest,
          suiFormObjectId: loaded.suiFormObjectId ?? localEntry?.suiFormObjectId,
          chainSubmissionId: loaded.chainSubmissionId ?? localEntry?.chainSubmissionId,
          submitterAddress: loaded.submitterAddress ?? localEntry?.submitterAddress,
        });
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load receipt.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadReceipt();
    return () => {
      active = false;
    };
  }, [blobId]);

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl items-center justify-center px-4">
        <div className="panel flex items-center gap-3 px-5 py-4 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          Loading receipt...
        </div>
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl items-center justify-center px-4">
        <div className="panel max-w-md p-6 text-center">
          <AlertCircle size={26} className="mx-auto mb-3 text-amber-500" />
          <h1 className="mb-2 text-lg font-semibold text-slate-950">Receipt unavailable</h1>
          <p className="text-sm leading-6 text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  const submitterAddress = normalizeAddress(submission.submitterAddress);
  const connectedAddress = normalizeAddress(account?.address);
  const canReviewSubmission = Boolean(submitterAddress && connectedAddress && submitterAddress === connectedAddress);
  const requiresSubmitterWallet = Boolean(submitterAddress);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <div className="panel overflow-hidden">
        <div className="border-b border-slate-100 bg-white p-6">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Check size={22} />
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Submission Receipt
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            Response submitted
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Your response for {submission.formTitle} was uploaded to Walrus. Keep this page as your receipt.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {submission.registryTxDigest && (
              <a
                href={suiScanTxUrl(submission.registryTxDigest)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary px-3 py-1.5 text-xs"
              >
                <ExternalLink size={12} />
                Open Sui tx
              </a>
            )}
            {submission.suiFormObjectId && (
              <a
                href={suiScanObjectUrl(submission.suiFormObjectId)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary px-3 py-1.5 text-xs"
              >
                <ExternalLink size={12} />
                Open Sui object
              </a>
            )}
            <a
              href={blobUrl(blobId)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary px-3 py-1.5 text-xs"
            >
              <ExternalLink size={12} />
              Open Walrus blob
            </a>
          </div>
        </div>

        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/70 p-5 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
              <Database size={13} />
              Walrus Blob
            </div>
            <div className="font-mono text-sm font-medium text-slate-900">
              {shortenBlobId(blobId, 6)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
              <Clock size={13} />
              Submitted
            </div>
            <div className="text-sm font-medium text-slate-900">
              {new Date(submission.submittedAt).toLocaleString("id-ID", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
              <Lock size={13} />
              Privacy
            </div>
            <div className="text-sm font-medium text-slate-900">
              {submission.encrypted ? "Seal encrypted" : "Public"}
            </div>
          </div>
        </div>

        <div className="border-b border-slate-100 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Radio size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Transaction tracking</h2>
              <p className="text-xs text-slate-400">Walrus and Sui proofs for this response.</p>
            </div>
          </div>

          <div className="relative">
            <div className="absolute left-[13px] top-8 h-[calc(100%-3rem)] w-px bg-slate-100" />
            <Step
              done
              title="Submission uploaded to Walrus"
              detail={`Receipt blob ${shortenBlobId(blobId, 6)} is available on Walrus Testnet.`}
              href={blobUrl(blobId)}
            />
            <Step
              done={Boolean(submission.formWalrusBlobId)}
              title="Form schema linked"
              detail={
                submission.formWalrusBlobId
                  ? `Form schema blob ${shortenBlobId(submission.formWalrusBlobId, 6)} was referenced by this submission.`
                  : "Schema blob metadata was not found in this receipt."
              }
              href={submission.formWalrusBlobId ? blobUrl(submission.formWalrusBlobId) : undefined}
            />
            <Step
              done={Boolean(submission.suiFormObjectId)}
              title="Sui form object"
              detail={
                submission.suiFormObjectId
                  ? `Form object ${submission.suiFormObjectId} links the public form to its Walrus schema.`
                  : "This response used a Walrus-only link, or local metadata for the Sui object is unavailable."
              }
              href={submission.suiFormObjectId ? suiScanObjectUrl(submission.suiFormObjectId) : undefined}
            />
            <Step
              done={Boolean(submission.chainSubmissionId || submission.registryTxDigest)}
              title="Submission event recorded"
              detail={
                submission.chainSubmissionId
                  ? `Submission #${submission.chainSubmissionId} was emitted by the Sui form object.`
                  : submission.registryTxDigest
                    ? "A registry transaction digest is available for this submission."
                    : "No Sui submission event metadata was found for this receipt."
              }
              href={submission.registryTxDigest ? suiScanTxUrl(submission.registryTxDigest) : undefined}
            />
            <Step
              done={Boolean(submission.reviewTxDigest)}
              title="Admin review update"
              detail={
                submission.reviewTxDigest
                  ? `Latest review state: ${submission.status ?? "new"} / ${submission.priority ?? "medium"}.`
                  : `Current local review state: ${submission.status ?? "new"} / ${submission.priority ?? "medium"}.`
              }
              href={submission.reviewTxDigest ? suiScanTxUrl(submission.reviewTxDigest) : undefined}
            />
          </div>
        </div>

        {(submission.suiFormObjectId || submission.chainSubmissionId || submission.registryTxDigest) && (
          <div className="grid gap-3 border-b border-slate-100 bg-white p-5 sm:grid-cols-3">
            <div className="rounded-lg border border-sky-100 bg-sky-50 p-4 shadow-sm">
              <div className="mb-2 text-xs font-medium text-sky-700">Sui form object</div>
              <div className="break-all font-mono text-xs text-sky-900">
                {submission.suiFormObjectId ?? "-"}
              </div>
              {submission.suiFormObjectId && (
                <a
                  href={suiScanObjectUrl(submission.suiFormObjectId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900"
                >
                  Explorer
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 text-xs font-medium text-slate-500">Chain submission id</div>
              <div className="font-mono text-sm text-slate-900">
                {submission.chainSubmissionId ?? "-"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 text-xs font-medium text-slate-500">Sui tx digest</div>
              <div className="break-all font-mono text-xs text-slate-900">
                {submission.registryTxDigest ?? "-"}
              </div>
              {submission.registryTxDigest && (
                <a
                  href={suiScanTxUrl(submission.registryTxDigest)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900"
                >
                  Explorer
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3 p-5">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="section-label">Submitted answers</p>
            {requiresSubmitterWallet && !canReviewSubmission && <ConnectButton connectText="Connect submitter wallet" />}
          </div>
          {requiresSubmitterWallet && !canReviewSubmission ? (
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
              Connect the submitter wallet to review this submission. Other wallets cannot view these answers.
            </div>
          ) : (
            submission.answers.map((answer, index) => (
              <div key={`${answer.fieldId}-${index}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                  <FileText size={12} />
                  Field {index + 1}
                </div>
                <p className="text-sm leading-6 text-slate-800">
                  {answer.encrypted ? (
                    <SealAnswerPreview
                      answer={answer}
                      formId={submission.formId}
                      maxLength={180}
                    />
                  ) : (
                    formatAnswer(answer)
                  )}
                </p>
                {answer.fileBlobId && <ReceiptMediaAttachment answer={answer} />}
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-slate-500">
            This receipt is loaded directly from the Walrus submission blob.
          </p>
          <a
            href={blobUrl(blobId)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary text-xs"
          >
            <ExternalLink size={13} />
            View Walrus blob
          </a>
        </div>
      </div>
    </div>
  );
}
