"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSignPersonalMessage, useSuiClient } from "@mysten/dapp-kit";
import { AlertCircle, Check, ChevronDown, Copy, Download, Database, Lock, LockOpen, RefreshCw, Loader2, ExternalLink, Wallet, Star, Filter as FilterIcon } from "lucide-react";
import { checkSealKeyServerReachable, readableSealError, SealAnswerPreview } from "@/components/SealAnswerPreview";
import type { FormSchema, FormSubmission } from "@/types";
import { loadAllForms, loadAllSubmissions, loadPublicForm } from "@/lib/forms";
import { isAdminAddress, shortenAddress } from "@/lib/admin";
import {
  buildSetSubmissionReviewTx,
  isSuiRegistryConfigured,
  loadLocalFormRegistryEntries,
  loadLocalSubmissionRegistryEntries,
  loadReviewEntriesFromSui,
  loadRegisteredForms,
  loadSubmissionEntriesFromSui,
  type FormRegistryEntry,
  type ReviewRegistryEntry,
  type SubmissionRegistryEntry,
} from "@/lib/submissionRegistry";
import { downloadFromWalrus, shortenBlobId, blobUrl } from "@/lib/walrus";
import { createSignedSealSessionKey, formatDecryptedSealValue, sealDecryptValueWithSession } from "@/lib/seal";
// import { suiObjectUrl, suiTxUrl } from "@/lib/suiExplorer";
import { suiScanObjectUrl, suiScanTxUrl } from "@/lib/suiExplorer";


type Filter = "all" | "new" | "reviewing" | "done" | "high";

type FormSummary = {
  id: string;
  title: string;
  count: number;
  owned: boolean;
  blobId?: string;
  suiFormObjectId?: string;
  shareSlug?: string;
};

const PRIORITY_STYLE = {
  high: "bg-red-50 text-red-700 border-red-100",
  medium: "bg-amber-50 text-amber-700 border-amber-100",
  low: "bg-green-50 text-green-700 border-green-100",
};

const STATUS_DOT = {
  new: "bg-blue-500",
  reviewing: "bg-amber-500",
  done: "bg-green-500",
};

function shortObjectId(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function answerValuePreview(answer: FormSubmission["answers"][number]) {
  if (answer.encrypted) return "Encrypted answer";
  if (Array.isArray(answer.value)) return answer.value.join(", ");
  if (answer.value === null || answer.value === "") return "-";
  return String(answer.value);
}

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function submissionIdentity(submission: FormSubmission) {
  if (submission.walrusBlobId) {
    return submission.walrusBlobId;
  }
  if (submission.suiFormObjectId && submission.chainSubmissionId) {
    return `${submission.suiFormObjectId}:${submission.chainSubmissionId}`;
  }
  return submission.id;
}

function dedupeSubmissions(items: FormSubmission[]) {
  const seen = new Set<string>();
  const unique: FormSubmission[] = [];
  for (const item of items) {
    const key = submissionIdentity(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function answerDecryptKey(submission: FormSubmission, answer: FormSubmission["answers"][number]) {
  return `${submissionIdentity(submission)}:${answer.fieldId}:${answer.sealId ?? ""}`;
}

function formSchemaFromRegistryEntry(entry: FormRegistryEntry): FormSchema {
  return {
    id: entry.formId,
    title: entry.formTitle,
    fields: [],
    sealEncrypted: false,
    createdAt: entry.timestamp,
    walrusBlobId: entry.formBlobId,
    suiFormObjectId: entry.suiFormObjectId,
    suiPackageId: entry.suiPackageId,
    shareSlug: entry.shareSlug,
    ownerAddress: entry.ownerAddress,
  };
}

async function hydrateFormSchemaFromRegistryEntry(entry: FormRegistryEntry): Promise<FormSchema> {
  const schema = await loadPublicForm(entry.formBlobId).catch(() => null);
  return {
    ...formSchemaFromRegistryEntry(entry),
    ...(schema ?? {}),
    id: entry.formId,
    title: schema?.title ?? entry.formTitle,
    fields: schema?.fields ?? [],
    walrusBlobId: entry.formBlobId,
    suiFormObjectId: entry.suiFormObjectId,
    suiPackageId: entry.suiPackageId,
    shareSlug: entry.shareSlug,
    ownerAddress: entry.ownerAddress ?? schema?.ownerAddress,
  };
}

function submissionFromRegistryEntry(
  entry: SubmissionRegistryEntry,
  formsById: Map<string, FormRegistryEntry>
): FormSubmission {
  const form = formsById.get(entry.formId);
  return {
    id: entry.chainSubmissionId ?? entry.submissionBlobId,
    formId: entry.formId,
    formTitle: entry.formTitle,
    answers: [],
    submittedAt: entry.timestamp,
    walrusBlobId: entry.submissionBlobId,
    formWalrusBlobId: form?.formBlobId,
    suiFormObjectId: entry.suiFormObjectId,
    suiPackageId: entry.suiPackageId,
    formShareSlug: form?.shareSlug,
    encrypted: entry.encrypted,
    priority: "low",
    status: "new",
    submitterAddress: entry.submitterAddress,
    submitterEmail: entry.submitterEmail,
    formOwnerAddress: form?.ownerAddress,
    registryTxDigest: entry.txDigest,
    chainSubmissionId: entry.chainSubmissionId,
  };
}

function applyReviewMetadata(submissions: FormSubmission[], reviews: ReviewRegistryEntry[]) {
  const latestReview = new Map<string, ReviewRegistryEntry>();
  for (const review of reviews) {
    const key = `${review.suiFormObjectId}:${review.chainSubmissionId}`;
    const existing = latestReview.get(key);
    if (!existing || new Date(review.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
      latestReview.set(key, review);
    }
  }

  return submissions.map((submission) => {
    if (!submission.suiFormObjectId || !submission.chainSubmissionId) return submission;
    const review = latestReview.get(`${submission.suiFormObjectId}:${submission.chainSubmissionId}`);
    return review
      ? {
          ...submission,
          status: review.status,
          priority: review.priority,
          reviewTxDigest: review.txDigest,
        }
      : submission;
  });
}

function DetailAnswerValue({
  answer,
  submission,
  field,
  decryptedValue,
}: {
  answer: FormSubmission["answers"][number];
  submission: FormSubmission;
  field?: FormSchema["fields"][number];
  decryptedValue?: string;
}) {
  if (answer.encrypted) {
    if (decryptedValue) {
      return <span className="text-slate-800">{decryptedValue}</span>;
    }

    return (
      <SealAnswerPreview
        answer={answer}
        ownerAddress={submission.formOwnerAddress}
        formId={submission.formId}
        maxLength={400}
      />
    );
  }

  if (field?.type === "rating" && typeof answer.value === "number") {
    const rating = answer.value;
    return (
      <span className="inline-flex items-center gap-1 text-amber-400">
        {Array.from({ length: field.maxRating ?? 5 }).map((_, index) => (
          <Star key={index} size={16} fill={index < rating ? "currentColor" : "none"} />
        ))}
        <span className="ml-2 text-sm text-slate-500">{rating}/{field.maxRating ?? 5}</span>
      </span>
    );
  }

  if (Array.isArray(answer.value)) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {answer.value.length > 0
          ? answer.value.map((item) => (
              <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                {item}
              </span>
            ))
          : "-"}
      </span>
    );
  }

  return <span>{answer.value === null || answer.value === "" ? "-" : String(answer.value)}</span>;
}

function MediaAnswerAttachment({
  answer,
  field,
}: {
  answer: FormSubmission["answers"][number];
  field?: FormSchema["fields"][number];
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  if (!answer.fileBlobId) return null;

  const url = blobUrl(answer.fileBlobId);
  const isImage = field?.type === "screenshot";
  const isVideo = field?.type === "video";
  const mediaLabel = isImage ? "image" : isVideo ? "video" : "media";
  const filename = typeof answer.value === "string" && answer.value.trim()
    ? answer.value.trim()
    : `sealedsurvey-${mediaLabel}-${shortenBlobId(answer.fileBlobId)}`;

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
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {isImage && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block bg-slate-50">
          <img
            src={url}
            alt={field?.label ?? "Uploaded image"}
            className="max-h-72 w-full object-contain"
            loading="lazy"
          />
        </a>
      )}
      {isVideo && (
        <video controls className="max-h-72 w-full bg-black" preload="metadata">
          <source src={url} />
        </video>
      )}
      {!isImage && !isVideo && (
        <div className="bg-slate-50 px-3 py-3 text-xs text-slate-500">
          Uploaded media: {shortenBlobId(answer.fileBlobId)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900"
        >
          <ExternalLink size={12} />
          View {mediaLabel}
        </a>
        <button
          type="button"
          onClick={downloadMedia}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {downloading ? "Downloading" : `Download ${mediaLabel}`}
        </button>
        <span className="font-mono text-[11px] text-slate-400">
          {shortenBlobId(answer.fileBlobId)}
        </span>
      </div>
      {downloadError && (
        <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          {downloadError}
        </div>
      )}
    </div>
  );
}

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
  return Promise.resolve();
}

// Demo submissions shown when no real Walrus submissions exist yet
const DEMO_SUBMISSIONS: FormSubmission[] = [
  {
    id: "demo-1",
    formId: "f1",
    formTitle: "Bug report",
    answers: [{ fieldId: "f1", value: "Login fails after update" }],
    submittedAt: new Date(Date.now() - 3600000).toISOString(),
    walrusBlobId: "demo-blob-0x3f8ad92c",
    encrypted: true,
    priority: "high",
    status: "new",
  },
  {
    id: "demo-2",
    formId: "f2",
    formTitle: "Feature request",
    answers: [{ fieldId: "f1", value: "Add dark mode support" }],
    submittedAt: new Date(Date.now() - 86400000).toISOString(),
    walrusBlobId: "demo-blob-0x7c2ba11f",
    encrypted: false,
    priority: "medium",
    status: "reviewing",
  },
  {
    id: "demo-3",
    formId: "f1",
    formTitle: "Bug report",
    answers: [{ fieldId: "f1", value: "Slow performance on mobile" }],
    submittedAt: new Date(Date.now() - 172800000).toISOString(),
    walrusBlobId: "demo-blob-0x91de3c7a",
    encrypted: true,
    priority: "high",
    status: "new",
  },
  {
    id: "demo-4",
    formId: "f3",
    formTitle: "Employee survey",
    answers: [{ fieldId: "f1", value: "Q2 2026 satisfaction survey" }],
    submittedAt: new Date(Date.now() - 345600000).toISOString(),
    walrusBlobId: "demo-blob-0x44fa8e02",
    encrypted: true,
    priority: "low",
    status: "done",
  },
];

export default function DashboardPage() {
  const suiClient = useSuiClient();
  const account = useCurrentAccount();
  const signAndExecute = useSignAndExecuteTransaction();
  const signPersonalMessage = useSignPersonalMessage();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [forms, setForms] = useState<FormSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [emailFilter, setEmailFilter] = useState("");
  const [walletFilter, setWalletFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [txStatusFilter, setTxStatusFilter] = useState<"all" | "onchain" | "walrus" | "reviewed">("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const [preparingFilters, setPreparingFilters] = useState(false);
  const [copiedFormId, setCopiedFormId] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [source, setSource] = useState<"sui" | "local" | "demo">("demo");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingReviewId, setUpdatingReviewId] = useState<string | null>(null);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [decryptingSubmissionId, setDecryptingSubmissionId] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [decryptedAnswers, setDecryptedAnswers] = useState<Record<string, string>>({});
  const autoDecryptAttempted = useRef<Set<string>>(new Set());
  const sealSessionRef = useRef<{
    address: string;
    sessionKey: Awaited<ReturnType<typeof createSignedSealSessionKey>>;
  } | null>(null);
  const address = account?.address.toLowerCase();
  const isConfiguredAdmin = isAdminAddress(account?.address);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const registryConfigured = isSuiRegistryConfigured();
      const localFormEntries = loadLocalFormRegistryEntries();
      const localSubmissionEntries = loadLocalSubmissionRegistryEntries();
      if (localFormEntries.length > 0 || localSubmissionEntries.length > 0) {
        const localFormsById = new Map(localFormEntries.map((entry) => [entry.formId, entry]));
        const quickForms = localFormEntries.map(formSchemaFromRegistryEntry);
        const quickSubmissions = dedupeSubmissions(
          localSubmissionEntries.map((entry) => submissionFromRegistryEntry(entry, localFormsById))
        );
        setForms(quickForms);
        setSubmissions(quickSubmissions.length > 0 ? quickSubmissions : DEMO_SUBMISSIONS);
        setIsDemo(quickSubmissions.length === 0);
        setSource(quickSubmissions.length > 0 ? "local" : "demo");
        setLoading(false);
      }

      const [registeredEntries, registeredForms, reviewEntries, localForms] = await Promise.all([
        registryConfigured ? loadSubmissionEntriesFromSui(suiClient).catch(() => []) : Promise.resolve([]),
        registryConfigured ? loadRegisteredForms(suiClient) : Promise.resolve([]),
        registryConfigured ? loadReviewEntriesFromSui(suiClient).catch(() => []) : Promise.resolve([]),
        loadAllForms().catch(() => []),
      ]);
      const registryFormSchemas = await Promise.all(
        registeredForms.map(hydrateFormSchemaFromRegistryEntry)
      );
      const registryFormsById = new Map(registeredForms.map((entry) => [entry.formId, entry]));
      const localFormsById = new Map(localFormEntries.map((entry) => [entry.formId, entry]));
      const metadataSubmissions =
        registeredEntries.length > 0
          ? applyReviewMetadata(
              dedupeSubmissions(registeredEntries.map((entry) => submissionFromRegistryEntry(entry, registryFormsById))),
              reviewEntries
            )
          : localSubmissionEntries.length > 0
            ? dedupeSubmissions(localSubmissionEntries.map((entry) => submissionFromRegistryEntry(entry, localFormsById)))
            : [];
      const data = metadataSubmissions.length > 0
        ? metadataSubmissions
        : dedupeSubmissions(await loadAllSubmissions().catch(() => []));
      const formsById = new Map<string, FormSchema>();
      for (const form of localForms) formsById.set(form.id, form);
      for (const form of registryFormSchemas) {
        const existing = formsById.get(form.id);
        formsById.set(form.id, {
          ...existing,
          ...form,
          fields: existing?.fields.length ? existing.fields : form.fields,
          sealEncrypted: existing?.sealEncrypted ?? form.sealEncrypted,
          description: existing?.description,
        });
      }
      setForms([...formsById.values()]);
      if (data.length === 0) {
        setSubmissions(DEMO_SUBMISSIONS);
        setIsDemo(true);
        setSource("demo");
      } else {
        setSubmissions(data);
        setIsDemo(false);
        setSource(registeredEntries.length > 0 && registryConfigured ? "sui" : "local");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unable to load dashboard data.");
      const [localForms, localSubmissions] = await Promise.all([
        loadAllForms().catch(() => []),
        loadAllSubmissions().catch(() => []),
      ]);
      setForms(localForms);
      setSubmissions(localSubmissions);
      setIsDemo(false);
      setSource("local");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    sealSessionRef.current = null;
    autoDecryptAttempted.current.clear();
  }, [account?.address]);

  const canViewSubmission = (submission: FormSubmission) => {
    if (!address) return false;
    if (isConfiguredAdmin) return true;
    if (submission.formOwnerAddress) {
      return submission.formOwnerAddress.toLowerCase() === address;
    }
    return false;
  };

  const canDecryptSubmission = (submission: FormSubmission) => {
    if (!address) return false;
    return Boolean(submission.formOwnerAddress && submission.formOwnerAddress.toLowerCase() === address);
  };

  const visibleSubmissions = submissions.filter(canViewSubmission);
  const mySubmissions = submissions.filter(
    (submission) => submission.submitterAddress?.toLowerCase() === address
  );
  const ownedForms = isConfiguredAdmin
    ? forms
    : forms.filter((form) => form.ownerAddress?.toLowerCase() === address);
  const hasOwnedForms = ownedForms.length > 0 || visibleSubmissions.length > 0;

  const selectedForm = selectedFormId
    ? forms.find((form) => form.id === selectedFormId) ??
      visibleSubmissions.find((submission) => submission.formId === selectedFormId)
    : null;
  const selectedFormTitle = selectedForm
    ? "title" in selectedForm
      ? selectedForm.title
      : selectedForm.formTitle
    : null;

  function fieldForAnswerValue(submission: FormSubmission, fieldId: string) {
    const form = forms.find((item) => item.id === submission.formId);
    return form?.fields.find((field) => field.id === fieldId);
  }

  function emailForSubmission(submission: FormSubmission) {
    if (submission.submitterEmail) return submission.submitterEmail.toLowerCase();
    const emailAnswer = submission.answers.find((answer) => {
      const field = fieldForAnswerValue(submission, answer.fieldId);
      return field?.type === "email" || field?.label.toLowerCase().includes("email");
    });
    if (!emailAnswer) return "";
    const value = emailAnswer.encrypted
      ? decryptedAnswers[answerDecryptKey(submission, emailAnswer)]
      : emailAnswer.value;
    return typeof value === "string" ? value.toLowerCase() : "";
  }

  const matchesAdvancedFilters = (submission: FormSubmission) => {
    const normalizedWallet = walletFilter.trim().toLowerCase();
    if (normalizedWallet && !submission.submitterAddress?.toLowerCase().includes(normalizedWallet)) return false;
    if (dateFilter && submission.submittedAt.slice(0, 10) !== dateFilter) return false;
    if (txStatusFilter === "onchain" && !(submission.registryTxDigest || submission.chainSubmissionId)) return false;
    if (txStatusFilter === "walrus" && (submission.registryTxDigest || submission.chainSubmissionId)) return false;
    if (txStatusFilter === "reviewed" && !submission.reviewTxDigest) return false;
    const normalizedEmail = emailFilter.trim().toLowerCase();
    if (normalizedEmail) {
      if (submission.answers.length === 0) return true;
      const emailValue = emailForSubmission(submission);
      if (!emailValue.includes(normalizedEmail)) return false;
    }
    return true;
  };

  const filtered = visibleSubmissions.filter((s) => {
    if (selectedFormId && s.formId !== selectedFormId) return false;
    if (filter === "all") return true;
    if (filter === "high") return s.priority === "high";
    return s.status === filter;
  })
    .filter(matchesAdvancedFilters)
    .sort((a, b) => {
      const diff = new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
      return sortOrder === "newest" ? diff : -diff;
    });
  const selectedSubmission =
    selectedSubmissionId
      ? filtered.find((submission) => submissionIdentity(submission) === selectedSubmissionId) ?? null
      : null;
  const selectedEncryptedAnswers = selectedSubmission?.answers.filter((answer) => answer.encrypted && answer.encryption === "seal" && answer.sealId) ?? [];
  const selectedSubmissionIdentity = selectedSubmission ? submissionIdentity(selectedSubmission) : null;

  const updateReview = async (
    submission: FormSubmission,
    patch: Pick<FormSubmission, "status" | "priority">
  ) => {
    const nextStatus = patch.status ?? submission.status ?? "new";
    const nextPriority = patch.priority ?? submission.priority ?? "medium";
    if (!submission.suiFormObjectId || !submission.chainSubmissionId) {
      setSubmissions((current) =>
        current.map((item) =>
          submissionIdentity(item) === submissionIdentity(submission)
            ? { ...item, status: nextStatus, priority: nextPriority }
            : item
        )
      );
      return;
    }

    setUpdatingReviewId(submission.id);
    setReviewError(null);
    try {
      const tx = buildSetSubmissionReviewTx({
        suiFormObjectId: submission.suiFormObjectId,
        formId: submission.formId,
        chainSubmissionId: submission.chainSubmissionId,
        status: nextStatus,
        priority: nextPriority,
        timestamp: new Date().toISOString(),
      });
      const transaction = await tx.toJSON({ client: suiClient as any });
      const result = await signAndExecute.mutateAsync({ transaction });
      const digest = "digest" in result ? result.digest : undefined;
      setSubmissions((current) =>
        current.map((item) =>
          submissionIdentity(item) === submissionIdentity(submission)
            ? { ...item, status: nextStatus, priority: nextPriority, reviewTxDigest: digest }
            : item
        )
      );
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Unable to update review state.");
      throw err;
    } finally {
      setUpdatingReviewId(null);
    }
  };

  const loadSubmissionDetail = async (submission: FormSubmission) => {
    const identity = submissionIdentity(submission);
    if (submission.answers.length > 0) return;

    setLoadingDetailId(identity);
    setDetailError(null);
    try {
      const detail = await downloadFromWalrus<FormSubmission>(submission.walrusBlobId);
      setSubmissions((current) =>
        current.map((item) =>
          submissionIdentity(item) === identity
            ? {
                ...item,
                ...detail,
                id: item.id,
                formId: item.formId || detail.formId,
                formTitle: item.formTitle || detail.formTitle,
                walrusBlobId: item.walrusBlobId,
                formWalrusBlobId: item.formWalrusBlobId ?? detail.formWalrusBlobId,
                suiFormObjectId: item.suiFormObjectId ?? detail.suiFormObjectId,
                suiPackageId: item.suiPackageId ?? detail.suiPackageId,
                formShareSlug: item.formShareSlug ?? detail.formShareSlug,
                submitterAddress: detail.submitterAddress ?? item.submitterAddress,
                submitterUsername: detail.submitterUsername ?? item.submitterUsername,
                submitterEmail: detail.submitterEmail ?? item.submitterEmail,
                formOwnerAddress: detail.formOwnerAddress ?? item.formOwnerAddress,
                registryTxDigest: item.registryTxDigest ?? detail.registryTxDigest,
                chainSubmissionId: item.chainSubmissionId ?? detail.chainSubmissionId,
                reviewTxDigest: item.reviewTxDigest ?? detail.reviewTxDigest,
                status: item.status ?? detail.status,
                priority: item.priority ?? detail.priority,
              }
            : item
        )
      );
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to load respondent detail from Walrus.");
    } finally {
      setLoadingDetailId(null);
    }
  };

  const toggleSubmissionDetail = (submission: FormSubmission) => {
    const identity = submissionIdentity(submission);
    if (selectedSubmissionId === identity) {
      setSelectedSubmissionId(null);
      setDetailError(null);
      return;
    }
    setSelectedSubmissionId(identity);
    loadSubmissionDetail(submission);
  };

  useEffect(() => {
    if (!emailFilter.trim()) return;
    const missingDetails = visibleSubmissions.filter((submission) => submission.answers.length === 0);
    if (missingDetails.length === 0) return;
    missingDetails.slice(0, 50).forEach((submission) => {
      loadSubmissionDetail(submission);
    });
  }, [emailFilter]);

  const ensureSubmissionDetails = async (items: FormSubmission[]) => {
    const results = await Promise.all(
      items.map(async (submission) => {
        if (submission.answers.length > 0 || submission.walrusBlobId.startsWith("demo-")) return submission;
        try {
          const detail = await downloadFromWalrus<FormSubmission>(submission.walrusBlobId);
          return {
            ...submission,
            ...detail,
            id: submission.id,
            formId: submission.formId || detail.formId,
            formTitle: submission.formTitle || detail.formTitle,
            walrusBlobId: submission.walrusBlobId,
            submitterAddress: detail.submitterAddress ?? submission.submitterAddress,
            submitterUsername: detail.submitterUsername ?? submission.submitterUsername,
            submitterEmail: detail.submitterEmail ?? submission.submitterEmail,
            formOwnerAddress: detail.formOwnerAddress ?? submission.formOwnerAddress,
            registryTxDigest: submission.registryTxDigest ?? detail.registryTxDigest,
            chainSubmissionId: submission.chainSubmissionId ?? detail.chainSubmissionId,
            reviewTxDigest: submission.reviewTxDigest ?? detail.reviewTxDigest,
            status: submission.status ?? detail.status,
            priority: submission.priority ?? detail.priority,
          } satisfies FormSubmission;
        } catch {
          return submission;
        }
      })
    );
    setSubmissions((current) =>
      current.map((item) => {
        const found = results.find((result) => submissionIdentity(result) === submissionIdentity(item));
        return found ?? item;
      })
    );
    return results;
  };

  const exportRowsForSubmissions = (items: FormSubmission[]) =>
    items.map((submission) => {
      const answers = submission.answers.map((answer) => {
        const field = fieldForAnswerValue(submission, answer.fieldId);
        return {
          fieldId: answer.fieldId,
          label: field?.label ?? answer.fieldId,
          value: answer.encrypted
            ? decryptedAnswers[answerDecryptKey(submission, answer)] ?? "Encrypted answer"
            : answer.value,
          encrypted: Boolean(answer.encrypted),
          fileBlobId: answer.fileBlobId,
        };
      });
      return {
        respondentId: submission.chainSubmissionId ?? submission.id,
        email: emailForSubmission(submission),
        walletAddress: submission.submitterAddress ?? "",
        txDigest: submission.registryTxDigest ?? submission.reviewTxDigest ?? "",
        walrusBlobId: submission.walrusBlobId,
        submittedAt: submission.submittedAt,
        txStatus: submission.registryTxDigest || submission.chainSubmissionId ? "onchain" : "walrus-only",
        formAnswers: answers,
      };
    });

  const exportFiltered = async (format: "csv" | "json") => {
    setExporting(format);
    try {
      const detailed = (await ensureSubmissionDetails(filtered)).filter(matchesAdvancedFilters);
      const rows = exportRowsForSubmissions(detailed);
      const content = format === "json"
        ? JSON.stringify(rows, null, 2)
        : [
            ["respondent id", "email", "wallet address", "tx digest", "walrus blob id", "submitted at", "tx status", "form answers"].map(csvEscape).join(","),
            ...rows.map((row) =>
              [
                row.respondentId,
                row.email,
                row.walletAddress,
                row.txDigest,
                row.walrusBlobId,
                row.submittedAt,
                row.txStatus,
                JSON.stringify(row.formAnswers),
              ].map(csvEscape).join(",")
            ),
          ].join("\n");
      const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sealedsurvey-filtered-${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(null);
    }
  };

  const clearAdvancedFilters = () => {
    setEmailFilter("");
    setWalletFilter("");
    setDateFilter("");
    setTxStatusFilter("all");
    setSortOrder("newest");
    setSelectedFormId(null);
  };

  const getSignedSealSessionKey = async () => {
    if (!account) {
      throw new Error("Connect the form owner wallet to decrypt responses.");
    }

    const cached = sealSessionRef.current;
    if (
      cached &&
      cached.address.toLowerCase() === account.address.toLowerCase() &&
      !cached.sessionKey.isExpired()
    ) {
      return cached.sessionKey;
    }

    const sessionKey = await createSignedSealSessionKey({
      accountAddress: account.address,
      signPersonalMessage,
      suiClient,
    });
    sealSessionRef.current = {
      address: account.address,
      sessionKey,
    };
    return sessionKey;
  };

  const decryptSubmissionsForFilter = async (items: FormSubmission[]) => {
    if (!account) return;
    const decryptable = items
      .filter((submission) => {
        if (!canDecryptSubmission(submission)) return false;
        return submission.answers.some((answer) =>
          answer.encrypted &&
          answer.encryption === "seal" &&
          answer.sealId &&
          !decryptedAnswers[answerDecryptKey(submission, answer)]
        );
      });

    if (decryptable.length === 0) return;

    setDecryptError(null);
    setDecryptingSubmissionId("filter-bulk-decrypt");
    try {
      await checkSealKeyServerReachable();
      const sessionKey = await getSignedSealSessionKey();
      const next: Record<string, string> = {};

      for (const submission of decryptable) {
        for (const answer of submission.answers) {
          if (!answer.encrypted || answer.encryption !== "seal" || !answer.sealId) continue;
          const key = answerDecryptKey(submission, answer);
          if (decryptedAnswers[key] || next[key]) continue;
          const parsed = await sealDecryptValueWithSession({
            ciphertextBase64: String(answer.value ?? ""),
            id: answer.sealId,
            formId: submission.formId,
            accountAddress: account.address,
            sessionKey,
            txBuildClient: suiClient as any,
          });
          next[key] = formatDecryptedSealValue(parsed);
        }
      }

      if (Object.keys(next).length > 0) {
        setDecryptedAnswers((current) => ({ ...current, ...next }));
      }
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes("expired")) {
        sealSessionRef.current = null;
      }
      setDecryptError(readableSealError(err));
    } finally {
      setDecryptingSubmissionId(null);
    }
  };

  const prepareFilterData = async () => {
    if (!hasOwnedForms || preparingFilters) return;
    setPreparingFilters(true);
    try {
      const detailed = await ensureSubmissionDetails(visibleSubmissions);
      await decryptSubmissionsForFilter(detailed);
    } finally {
      setPreparingFilters(false);
    }
  };

  const toggleFilterPanel = () => {
    const opening = !showFilterPanel;
    setShowFilterPanel(opening);
    if (opening) {
      prepareFilterData();
    }
  };

  const decryptSelectedSubmission = async () => {
    if (!selectedSubmission || !account || selectedEncryptedAnswers.length === 0) return;
    setDecryptError(null);
    setDecryptingSubmissionId(submissionIdentity(selectedSubmission));

    try {
    if (!canDecryptSubmission(selectedSubmission)) {
      throw new Error("Only the form owner wallet can decrypt this answer.");
    }

      await checkSealKeyServerReachable();
      const sessionKey = await getSignedSealSessionKey();

      const next: Record<string, string> = {};
      for (const answer of selectedEncryptedAnswers) {
        const parsed = await sealDecryptValueWithSession({
          ciphertextBase64: String(answer.value ?? ""),
          id: answer.sealId!,
          formId: selectedSubmission.formId,
          accountAddress: account.address,
          sessionKey,
          txBuildClient: suiClient as any,
        });
        next[answerDecryptKey(selectedSubmission, answer)] = formatDecryptedSealValue(parsed);
      }
      setDecryptedAnswers((current) => ({ ...current, ...next }));
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes("expired")) {
        sealSessionRef.current = null;
      }
      setDecryptError(readableSealError(err));
    } finally {
      setDecryptingSubmissionId(null);
    }
  };

  useEffect(() => {
    if (!selectedSubmission || !selectedSubmissionIdentity || !account) return;
    if (selectedEncryptedAnswers.length === 0) return;
    if (!canDecryptSubmission(selectedSubmission)) return;
    if (autoDecryptAttempted.current.has(selectedSubmissionIdentity)) return;
    const allDecrypted = selectedEncryptedAnswers.every((answer) =>
      Boolean(decryptedAnswers[answerDecryptKey(selectedSubmission, answer)])
    );
    if (allDecrypted) return;

    autoDecryptAttempted.current.add(selectedSubmissionIdentity);
    decryptSelectedSubmission();
  }, [account?.address, selectedSubmissionIdentity, selectedEncryptedAnswers.length]);

  const stats = hasOwnedForms ? [
    { label: isConfiguredAdmin ? "Managed forms" : "My forms", value: ownedForms.length },
    { label: "Visible reports", value: visibleSubmissions.length },
    { label: "New", value: visibleSubmissions.filter((s) => s.status === "new").length },
    { label: "High priority", value: visibleSubmissions.filter((s) => s.priority === "high").length },
  ] : [
    { label: "My submissions", value: mySubmissions.length },
    { label: "Encrypted", value: mySubmissions.filter((s) => s.encrypted).length },
    { label: "Forms answered", value: new Set(mySubmissions.map((s) => s.formId)).size },
    { label: "Receipts", value: mySubmissions.filter((s) => s.walrusBlobId).length },
  ];

  const getFormPublicUrl = (form: FormSummary) => {
    const identifier = form.suiFormObjectId ?? form.blobId;
    if (!identifier) return;
    const slug = form.shareSlug || form.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "untitled-form";
    return `${origin}/form/${slug}--${encodeURIComponent(identifier)}`;
  };

  const copyFormLink = async (form: FormSummary) => {
    const publicUrl = getFormPublicUrl(form);
    if (!publicUrl) return;
    await copyText(publicUrl).catch(() => {});
    setCopiedFormId(form.id);
    setTimeout(() => setCopiedFormId(null), 1500);
  };

  const formCounts = visibleSubmissions.reduce<Record<string, FormSummary>>(
    (acc, submission) => {
      const key = submission.formId || submission.formTitle;
      const existing = acc[key] ?? {
        id: key,
        title: submission.formTitle || "Untitled form",
        count: 0,
        owned: canViewSubmission(submission),
      };
      existing.count += 1;
      existing.owned = existing.owned || canViewSubmission(submission);
      existing.blobId = existing.blobId ?? submission.formWalrusBlobId;
      existing.suiFormObjectId = existing.suiFormObjectId ?? submission.suiFormObjectId;
      existing.shareSlug = existing.shareSlug ?? submission.formShareSlug;
      acc[key] = existing;
      return acc;
    },
    {}
  );

  for (const form of ownedForms) {
    const key = form.id;
    const existing = formCounts[key] ?? {
      id: key,
      title: form.title || "Untitled form",
      count: 0,
      owned: true,
    };
    existing.title = form.title || existing.title;
    existing.blobId = form.walrusBlobId;
    existing.suiFormObjectId = form.suiFormObjectId;
    existing.shareSlug = form.shareSlug;
    existing.owned = true;
    formCounts[key] = existing;
  }

  const fieldLabel = (submission: FormSubmission, fieldId: string) => {
    const form = forms.find((item) => item.id === submission.formId);
    return form?.fields.find((field) => field.id === fieldId)?.label ?? `Field ${fieldId.slice(0, 8)}`;
  };
  const fieldForAnswer = (submission: FormSubmission, fieldId: string) => {
    const form = forms.find((item) => item.id === submission.formId);
    return form?.fields.find((field) => field.id === fieldId);
  };
  const formForSubmission = (submission: FormSubmission) =>
    forms.find((item) => item.id === submission.formId);
  const formTitleForSubmission = (submission: FormSubmission) =>
    formForSubmission(submission)?.title ??
    formCounts[submission.formId]?.title ??
    submission.formTitle ??
    "Untitled form";
  const detailRowsForSubmission = (submission: FormSubmission) => {
    const form = formForSubmission(submission);
    const emailField = form?.fields.find(
      (field) => field.type === "email" || field.label.toLowerCase().includes("email")
    );
    const emailAnswer = emailField
      ? submission.answers.find((answer) => answer.fieldId === emailField.id)
      : submission.answers.find((answer) => fieldLabel(submission, answer.fieldId).toLowerCase().includes("email"));
    const fieldRows = form?.fields.length
      ? form.fields
          .filter((field) => field.id !== emailField?.id)
          .map((field) => ({
            key: field.id,
            label: field.label,
            field,
            answer: submission.answers.find((answer) => answer.fieldId === field.id),
          }))
      : submission.answers
          .filter((answer) => answer.fieldId !== emailAnswer?.fieldId)
          .map((answer) => ({
            key: answer.fieldId,
            label: fieldLabel(submission, answer.fieldId),
            field: fieldForAnswer(submission, answer.fieldId),
            answer,
          }));

    return {
      email: {
        key: "email",
        label: "email",
        field: emailField ?? (emailAnswer ? fieldForAnswer(submission, emailAnswer.fieldId) : undefined),
        answer: emailAnswer,
      },
      fields: fieldRows,
    };
  };

  const mySubmissionGroups = Object.values(
    mySubmissions.reduce<Record<string, { id: string; title: string; latestAt: string; submissions: FormSubmission[] }>>(
      (acc, submission) => {
        const key = submission.formId || submission.formTitle || "untitled-form";
        const existing = acc[key] ?? {
          id: key,
          title: formTitleForSubmission(submission),
          latestAt: submission.submittedAt,
          submissions: [],
        };
        existing.title = formTitleForSubmission(submission);
        existing.latestAt =
          new Date(submission.submittedAt).getTime() > new Date(existing.latestAt).getTime()
            ? submission.submittedAt
            : existing.latestAt;
        existing.submissions.push(submission);
        acc[key] = existing;
        return acc;
      },
      {}
    )
  )
    .map((group) => ({
      ...group,
      submissions: group.submissions.sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      ),
    }))
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());

  if (!account) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-xl items-center justify-center px-4">
        <div className="panel p-6 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
            <Wallet size={22} />
          </div>
          <h1 className="mb-2 text-xl font-semibold tracking-tight text-slate-950">
            Connect wallet
          </h1>
          <p className="mb-5 text-sm leading-6 text-slate-500">
            Connect a Sui wallet to view response counts. Form owners can also view full respondent reports.
          </p>
          <ConnectButton connectText="Connect wallet" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            {hasOwnedForms ? "Operations" : "Submissions"}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            {hasOwnedForms ? (isConfiguredAdmin ? "Admin dashboard" : "Owner dashboard") : "My submissions"}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Connected as <span className="font-mono">{shortenAddress(account.address)}</span>
          </p>
        </div>
      </div>

      {isDemo && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 shadow-sm">
          <Database size={14} className="shrink-0" />
          Showing demo data - submit a real form to see live Walrus submissions here.
        </div>
      )}

      {!isDemo && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-4 py-2.5 text-sm text-sky-800 shadow-sm">
          <Database size={14} className="shrink-0" />
          {isConfiguredAdmin
            ? "Admin access active from NEXT_PUBLIC_ADMIN_WALLETS. Showing all discoverable submissions."
            : source === "sui"
            ? "Showing submissions discovered from the Sui registry."
            : "Showing local fallback submissions. Configure Sui registry env to enable global discovery."}
        </div>
      )}
      {loadError && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 shadow-sm">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          Sui/Walrus discovery failed: {loadError}. Showing local data only.
        </div>
      )}

      <div className="mb-5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
        {hasOwnedForms
          ? "Only forms created by this wallet are shown. Respondent details for other owners are hidden."
          : "This wallet has not created a form yet. Showing submissions sent by this wallet."}
      </div>
      {reviewError && (
        <div className="mb-5 rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-700 shadow-sm">
          {reviewError}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className="text-xs text-slate-400 mb-1">{s.label}</div>
            <div className="text-2xl font-semibold text-slate-950">{s.value}</div>
          </div>
        ))}
      </div>

      {hasOwnedForms ? (
      <div className="mb-6 panel overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Response counts by form</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {Object.entries(formCounts).map(([formId, item]) => (
            <div
              key={formId}
              className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                selectedFormId === formId ? "bg-sky-50/60" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedFormId(formId)}
                className="min-w-0 text-left"
              >
                <div className="truncate text-sm font-medium text-slate-800">{item.title}</div>
                <div className="text-xs text-slate-400">
                  {item.owned ? "Click for respondent detail" : "Count only"}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {item.suiFormObjectId ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                      <Check size={11} /> Sui object {shortObjectId(item.suiFormObjectId)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      Walrus-only
                    </span>
                  )}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {item.blobId ? (
                  <>
                  <button
                    type="button"
                    onClick={() => copyFormLink(item)}
                    className="btn btn-secondary px-3 py-1.5 text-xs"
                  >
                    <Copy size={12} />
                    {copiedFormId === formId ? "Copied" : "Copy public link"}
                  </button>
                  <a
                    href={getFormPublicUrl(item)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary px-3 py-1.5 text-xs"
                  >
                    <ExternalLink size={12} />
                    Open public
                  </a>
                  </>
                ) : (
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-400">
                    Public link unavailable
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedFormId(formId)}
                  className="btn btn-secondary px-3 py-1.5 text-xs"
                >
                  Detail
                </button>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-700">
                  {item.count}
                </div>
              </div>
            </div>
          ))}
          {!loading && Object.keys(formCounts).length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              No response counts yet.
            </div>
          )}
        </div>
      </div>
      ) : (
        <div className="mb-6 panel overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">My submission receipts</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {mySubmissionGroups.map((group) => (
              <div key={group.id} className="px-4 py-4">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{group.title}</div>
                    <div className="text-xs text-slate-400">
                      {group.submissions.length} receipt{group.submissions.length === 1 ? "" : "s"} · Latest{" "}
                      {new Date(group.latestAt).toLocaleDateString("id-ID", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </div>
                  </div>
                  <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500">
                    {group.submissions.length}
                  </span>
                </div>
                <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {group.submissions.map((submission, index) => (
                    <div key={submissionIdentity(submission)} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-medium text-slate-800">
                          Submission #{group.submissions.length - index}
                        </div>
                        <div className="text-xs text-slate-400">
                          {new Date(submission.submittedAt).toLocaleDateString("id-ID", {
                            day: "numeric", month: "short", year: "numeric",
                          })}
                        </div>
                      </div>
                      <a
                        href={`/receipt/${encodeURIComponent(submission.walrusBlobId)}`}
                        className="btn btn-secondary px-3 py-1.5 text-xs"
                      >
                        <ExternalLink size={12} />
                        Receipt
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!loading && mySubmissions.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                No submissions found for this wallet.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      {hasOwnedForms && (
      <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {selectedFormId && (
            <button
              onClick={() => setSelectedFormId(null)}
              className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-700 shadow-sm transition-colors hover:border-sky-300"
            >
              {`Form: ${selectedFormTitle ?? "Selected"} x`}
            </button>
          )}
          {(["all", "new", "reviewing", "done", "high"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1.5 text-xs capitalize shadow-sm transition-colors ${
                filter === f
                  ? "bg-slate-950 text-white border-slate-950"
                  : "bg-white/80 text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-950"
              }`}
            >
              {f === "high" ? "High priority" : f === "all" ? "All" : f}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs text-slate-500 shadow-sm">
            {filtered.length} filtered
          </span>
          <button
            type="button"
            onClick={toggleFilterPanel}
            className={`btn px-3 py-1.5 text-xs ${showFilterPanel ? "btn-primary" : "btn-secondary"}`}
          >
            {preparingFilters ? <Loader2 size={13} className="animate-spin" /> : <FilterIcon size={13} />}
            {preparingFilters ? "Preparing" : "Filter"}
          </button>
          <button
            type="button"
            onClick={load}
            className="btn btn-secondary px-3 py-1.5 text-xs"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => exportFiltered("csv")}
            disabled={exporting !== null || filtered.length === 0}
            className="btn btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting === "csv" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => exportFiltered("json")}
            disabled={exporting !== null || filtered.length === 0}
            className="btn btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting === "json" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Export JSON
          </button>
        </div>
      </div>

      {showFilterPanel && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-medium text-slate-500">
              Search email
              <input
                value={emailFilter}
                onChange={(event) => setEmailFilter(event.target.value)}
                placeholder="email@example.com"
                className="input mt-1 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-500">
              Search wallet address
              <input
                value={walletFilter}
                onChange={(event) => setWalletFilter(event.target.value)}
                placeholder="0x..."
                className="input mt-1 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-500">
              Form
              <select
                value={selectedFormId ?? ""}
                onChange={(event) => setSelectedFormId(event.target.value || null)}
                className="input mt-1 text-sm"
              >
                <option value="">All forms</option>
                {Object.entries(formCounts).map(([formId, item]) => (
                  <option key={formId} value={formId}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">
              Submission date
              <input
                type="date"
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value)}
                className="input mt-1 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-500">
              Tx status
              <select
                value={txStatusFilter}
                onChange={(event) => setTxStatusFilter(event.target.value as typeof txStatusFilter)}
                className="input mt-1 text-sm"
              >
                <option value="all">All tx statuses</option>
                <option value="onchain">Onchain</option>
                <option value="walrus">Walrus-only</option>
                <option value="reviewed">Reviewed onchain</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">
              Sort
              <select
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}
                className="input mt-1 text-sm"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {emailFilter.trim() && loadingDetailId
                ? "Loading respondent details for email filter..."
                : preparingFilters || decryptingSubmissionId === "filter-bulk-decrypt"
                  ? "Loading and decrypting respondent details for filter..."
                : `${filtered.length} of ${visibleSubmissions.length} respondent reports match.`}
            </span>
            <button
              type="button"
              onClick={clearAdvancedFilters}
              className="btn btn-secondary w-full px-3 py-1.5 text-xs sm:w-auto"
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      {/* Owner-only table */}
      <div className="panel overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Respondent reports</h2>
          <p className="mt-1 text-xs text-slate-400">
            Detailed answers are visible to form owners and configured admins. Seal decrypt still requires owner authorization.
          </p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Loading from Walrus…
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80">
                <th className="text-left px-4 py-3 font-medium text-xs text-slate-400">Title</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-slate-400">Form</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-slate-400">Priority</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-slate-400">Status</th>
	                <th className="text-left px-4 py-3 font-medium text-xs text-slate-400">Enc</th>
	                <th className="text-left px-4 py-3 font-medium text-xs text-slate-400">Walrus blob</th>
	                <th className="text-left px-4 py-3 font-medium text-xs text-slate-400">Date</th>
	                <th className="text-right px-4 py-3 font-medium text-xs text-slate-400">Detail</th>
	              </tr>
	            </thead>
	            <tbody>
	              {filtered.map((s) => {
	                const identity = submissionIdentity(s);
	                const expanded = selectedSubmissionId === identity;
	                const detailRows = detailRowsForSubmission(s);
	                const displayFormTitle = formTitleForSubmission(s);
	                return (
	                <Fragment key={identity}>
	                <tr
	                  className={`border-b border-slate-100/80 transition-colors hover:bg-slate-50/80 ${
	                    expanded ? "bg-sky-50/50" : ""
	                  }`}
	                >
	                  <td className="px-4 py-3 text-slate-800 font-medium">
	                    <div className="flex flex-col gap-1">
	                      <span>{displayFormTitle}</span>
                      <span className="text-xs font-normal text-slate-400">{s.answers.length} answer{s.answers.length === 1 ? "" : "s"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{displayFormTitle}</td>
                  <td className="px-4 py-3">
                    {s.suiFormObjectId && s.chainSubmissionId ? (
                      <select
                        value={s.priority ?? "medium"}
                        disabled={updatingReviewId === s.id}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          updateReview(s, {
                            priority: event.target.value as FormSubmission["priority"],
                            status: s.status ?? "new",
                          }).catch(() => {})
                        }
                        className={`rounded-full border px-2 py-1 text-xs capitalize ${PRIORITY_STYLE[s.priority ?? "medium"]}`}
                      >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    ) : s.priority ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${PRIORITY_STYLE[s.priority]}`}>
                        {s.priority}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {s.suiFormObjectId && s.chainSubmissionId ? (
                      <select
                        value={s.status ?? "new"}
                        disabled={updatingReviewId === s.id}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          updateReview(s, {
                            status: event.target.value as FormSubmission["status"],
                            priority: s.priority ?? "medium",
                          }).catch(() => {})
                        }
                        className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs capitalize text-slate-600"
                      >
                        <option value="new">new</option>
                        <option value="reviewing">reviewing</option>
                        <option value="done">done</option>
                      </select>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-slate-500 capitalize">
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s.status ?? "new"]}`} />
                        {s.status ?? "new"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {s.encrypted
                      ? <Lock size={13} className="text-sky-500" />
                      : <LockOpen size={13} className="text-slate-300" />}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {s.walrusBlobId.startsWith("demo-") ? (
                      <span>{s.walrusBlobId.slice(5, 17)}…</span>
                    ) : (
                      <a
                        href={blobUrl(s.walrusBlobId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="flex items-center gap-1 transition-colors hover:text-sky-600"
                      >
                        {shortenBlobId(s.walrusBlobId)}
                        <ExternalLink size={10} />
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
	                    {new Date(s.submittedAt).toLocaleDateString("id-ID", {
	                      day: "numeric", month: "short", year: "numeric",
	                    })}
	                  </td>
	                  <td className="px-4 py-3 text-right">
	                    <button
	                      type="button"
	                      onClick={() => toggleSubmissionDetail(s)}
	                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-sky-200 hover:text-sky-700"
	                    >
	                      {loadingDetailId === identity ? (
	                        <Loader2 size={12} className="animate-spin" />
	                      ) : (
	                        <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
	                      )}
	                      {loadingDetailId === identity ? "Loading" : expanded ? "Collapse" : "Detail"}
	                    </button>
	                  </td>
	                </tr>
	                {expanded && (
	                  <tr className="border-b border-slate-100 bg-white">
	                    <td colSpan={8} className="px-4 py-4">
	                      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
	                        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
	                          <div>
	                            <h3 className="text-sm font-semibold text-slate-900">Submission detail</h3>
	                            <p className="mt-1 text-xs text-slate-400">
	                              {s.formTitle} · {new Date(s.submittedAt).toLocaleString("id-ID")}
	                            </p>
	                          </div>
	                          <div className="flex flex-wrap gap-2">
                            {canDecryptSubmission(s) && s.answers.some((answer) => answer.encrypted && answer.encryption === "seal" && answer.sealId) && (
	                              <button
	                                type="button"
	                                onClick={decryptSelectedSubmission}
	                                disabled={decryptingSubmissionId === identity}
	                                className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:border-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
	                              >
	                                {decryptingSubmissionId === identity ? (
	                                  <Loader2 size={12} className="animate-spin" />
	                                ) : (
	                                  <LockOpen size={12} />
	                                )}
	                                {decryptingSubmissionId === identity ? "Decrypting" : "Decrypt all"}
	                              </button>
	                            )}
	                            {s.suiFormObjectId ? (
	                              <a
	                                href={suiScanObjectUrl(s.suiFormObjectId)}
	                                target="_blank"
	                                rel="noopener noreferrer"
	                                className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:border-sky-200"
	                              >
	                                Sui object {shortObjectId(s.suiFormObjectId)}
	                                <ExternalLink size={10} />
	                              </a>
	                            ) : (
	                              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
	                                Walrus-only
	                              </span>
	                            )}
	                            {s.chainSubmissionId && (
	                              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500">
	                                Submission #{s.chainSubmissionId}
	                              </span>
	                            )}
	                            {s.registryTxDigest && (
	                              <a
	                                href={suiScanTxUrl(s.registryTxDigest)}
	                                target="_blank"
	                                rel="noopener noreferrer"
	                                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 transition-colors hover:border-sky-200 hover:text-sky-700"
	                              >
	                                Sui tx
	                                <ExternalLink size={10} />
	                              </a>
	                            )}
	                            {s.reviewTxDigest && (
	                              <a
	                                href={suiScanTxUrl(s.reviewTxDigest)}
	                                target="_blank"
	                                rel="noopener noreferrer"
	                                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 transition-colors hover:border-sky-200 hover:text-sky-700"
	                              >
	                                Review tx
	                                <ExternalLink size={10} />
	                              </a>
	                            )}
	                          </div>
	                        </div>
	                        {detailError && selectedSubmissionId === identity && (
	                          <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
	                            {detailError}
	                          </div>
	                        )}
	                        {decryptError && selectedSubmissionId === identity && (
	                          <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
	                            {decryptError}
	                          </div>
	                        )}
	                        <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
	                          {loadingDetailId === identity && s.answers.length === 0 && (
	                            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-400">
	                              <Loader2 size={14} className="animate-spin" />
	                              Loading detail from Walrus...
	                            </div>
	                          )}
                          <div className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_1fr]">
                            <div className="text-xs font-medium uppercase text-slate-400">wallet</div>
                            <div className="break-all font-mono text-xs text-slate-700">{s.submitterAddress ?? "-"}</div>
                          </div>
                          <div className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_1fr]">
                            <div className="text-xs font-medium uppercase text-slate-400">username</div>
                            <div className="text-sm text-slate-700">{s.submitterUsername || "-"}</div>
                          </div>
                          <div className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_1fr]">
                            <div className="text-xs font-medium uppercase text-slate-400">email</div>
                            <div className="text-sm text-slate-700">
                              {s.submitterEmail ? (
                                s.submitterEmail
                              ) : detailRows.email.answer ? (
                                <DetailAnswerValue
                                  answer={detailRows.email.answer}
	                                  submission={s}
	                                  field={detailRows.email.field}
	                                  decryptedValue={decryptedAnswers[answerDecryptKey(s, detailRows.email.answer)]}
	                                />
	                              ) : (
	                                <span className="text-slate-400">-</span>
	                              )}
	                            </div>
	                          </div>
	                          {detailRows.fields.map(({ key, label, field, answer }) => (
	                            <div key={key} className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_1fr]">
	                              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium uppercase text-slate-400">
	                                <span>{label}</span>
	                                {field?.type && (
	                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-normal normal-case text-slate-400">
	                                    {field.type}
	                                  </span>
	                                )}
	                                {answer?.encrypted && (
	                                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[10px] font-medium normal-case text-sky-700">
	                                    <Lock size={9} /> Seal
	                                  </span>
	                                )}
	                              </div>
	                              <div className="space-y-2 text-sm text-slate-700">
	                                {answer ? (
	                                  <>
	                                    <DetailAnswerValue
	                                      answer={answer}
	                                      submission={s}
	                                      field={field}
	                                      decryptedValue={decryptedAnswers[answerDecryptKey(s, answer)]}
	                                    />
	                                    {answer.fileBlobId && (
	                                      <MediaAnswerAttachment answer={answer} field={field} />
	                                    )}
	                                  </>
	                                ) : (
	                                  <span className="text-slate-400">-</span>
	                                )}
	                              </div>
	                            </div>
	                          ))}
	                          {s.answers.length === 0 && (
	                            <div className="px-4 py-6 text-center text-sm text-slate-400">
	                              No answers in this submission.
	                            </div>
	                          )}
	                        </div>
	                      </div>
	                    </td>
	                  </tr>
	                )}
	                </Fragment>
	                );
	              })}
	              {filtered.length === 0 && (
	                <tr>
	                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400 text-sm">
	                    No detailed reports available for this wallet.
	                  </td>
	                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
	      </>
      )}
    </div>
  );
}
