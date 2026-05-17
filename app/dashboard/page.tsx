"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSignPersonalMessage, useSuiClient } from "@mysten/dapp-kit";
import { Check, Copy, Download, Database, Lock, LockOpen, RefreshCw, Loader2, ExternalLink, Wallet, Star } from "lucide-react";
import { checkSealKeyServerReachable, readableSealError, SealAnswerPreview } from "@/components/SealAnswerPreview";
import type { FormSchema, FormSubmission } from "@/types";
import { loadAllForms, loadAllSubmissions, submissionsToCSV } from "@/lib/forms";
import { shortenAddress } from "@/lib/admin";
import {
  buildSetSubmissionReviewTx,
  isSuiRegistryConfigured,
  loadRegisteredForms,
  loadRegisteredSubmissions,
} from "@/lib/submissionRegistry";
import { shortenBlobId, blobUrl } from "@/lib/walrus";
import { createSignedSealSessionKey, formatDecryptedSealValue, sealDecryptValueWithSession } from "@/lib/seal";

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

function submissionIdentity(submission: FormSubmission) {
  if (submission.suiFormObjectId && submission.chainSubmissionId) {
    return `${submission.suiFormObjectId}:${submission.chainSubmissionId}`;
  }
  return submission.walrusBlobId || submission.id;
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
  const [copiedFormId, setCopiedFormId] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [source, setSource] = useState<"sui" | "local" | "demo">("demo");
  const [updatingReviewId, setUpdatingReviewId] = useState<string | null>(null);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [decryptingSubmissionId, setDecryptingSubmissionId] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [decryptedAnswers, setDecryptedAnswers] = useState<Record<string, string>>({});
  const autoDecryptAttempted = useRef<Set<string>>(new Set());
  const address = account?.address.toLowerCase();

  const load = async () => {
    setLoading(true);
    try {
      const [registered, registeredForms, localForms] = await Promise.all([
        loadRegisteredSubmissions(suiClient),
        loadRegisteredForms(suiClient),
        loadAllForms().catch(() => []),
      ]);
      const data = dedupeSubmissions(registered.length > 0 ? registered : await loadAllSubmissions());
      const registryFormSchemas: FormSchema[] = registeredForms.map((entry) => ({
        id: entry.formId,
        title: entry.formTitle,
        fields: [],
        sealEncrypted: false,
        createdAt: entry.timestamp,
        walrusBlobId: entry.formBlobId,
        suiFormObjectId: entry.suiFormObjectId,
        shareSlug: entry.shareSlug,
        ownerAddress: entry.ownerAddress,
      }));
      const formsById = new Map<string, FormSchema>();
      for (const form of localForms) formsById.set(form.id, form);
      for (const form of registryFormSchemas) formsById.set(form.id, form);
      setForms([...formsById.values()]);
      if (data.length === 0) {
        setSubmissions(DEMO_SUBMISSIONS);
        setIsDemo(true);
        setSource("demo");
      } else {
        setSubmissions(data);
        setIsDemo(false);
        setSource(registered.length > 0 && isSuiRegistryConfigured() ? "sui" : "local");
      }
    } catch {
      setForms([]);
      setSubmissions(DEMO_SUBMISSIONS);
      setIsDemo(true);
      setSource("demo");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const canViewSubmission = (submission: FormSubmission) => {
    if (!address) return false;
    if (submission.formOwnerAddress) {
      return submission.formOwnerAddress.toLowerCase() === address;
    }
    return false;
  };

  const visibleSubmissions = submissions.filter(canViewSubmission);
  const mySubmissions = submissions.filter(
    (submission) => submission.submitterAddress?.toLowerCase() === address
  );
  const ownedForms = forms.filter(
    (form) => form.ownerAddress?.toLowerCase() === address
  );
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

  const filtered = visibleSubmissions.filter((s) => {
    if (selectedFormId && s.formId !== selectedFormId) return false;
    if (filter === "all") return true;
    if (filter === "high") return s.priority === "high";
    return s.status === filter;
  });
  const selectedSubmission =
    filtered.find((submission) => submissionIdentity(submission) === selectedSubmissionId) ??
    filtered[0] ??
    null;
  const selectedSubmissionForm = selectedSubmission
    ? forms.find((form) => form.id === selectedSubmission.formId)
    : undefined;
  const selectedEncryptedAnswers = selectedSubmission?.answers.filter((answer) => answer.encrypted && answer.encryption === "seal" && answer.sealId) ?? [];
  const selectedSubmissionIdentity = selectedSubmission ? submissionIdentity(selectedSubmission) : null;

  const exportCSV = () => {
    const csv = submissionsToCSV(visibleSubmissions);
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sealedsurvey-export-${Date.now()}.csv`;
    a.click();
  };

  const updateReview = async (
    submission: FormSubmission,
    patch: Pick<FormSubmission, "status" | "priority">
  ) => {
    if (!submission.suiFormObjectId || !submission.chainSubmissionId) return;
    const nextStatus = patch.status ?? submission.status ?? "new";
    const nextPriority = patch.priority ?? submission.priority ?? "medium";
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

  const answerDecryptKey = (submission: FormSubmission, answer: FormSubmission["answers"][number]) =>
    `${submissionIdentity(submission)}:${answer.fieldId}:${answer.sealId ?? ""}`;

  const decryptSelectedSubmission = async () => {
    if (!selectedSubmission || !account || selectedEncryptedAnswers.length === 0) return;
    setDecryptError(null);
    setDecryptingSubmissionId(submissionIdentity(selectedSubmission));

    try {
      if (selectedSubmission.formOwnerAddress && selectedSubmission.formOwnerAddress.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error("Only the form owner wallet can decrypt this answer.");
      }

      await checkSealKeyServerReachable();
      const sessionKey = await createSignedSealSessionKey({
        accountAddress: account.address,
        signPersonalMessage,
        suiClient,
      });

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
      setDecryptError(readableSealError(err));
    } finally {
      setDecryptingSubmissionId(null);
    }
  };

  useEffect(() => {
    if (!selectedSubmission || !selectedSubmissionIdentity || !account) return;
    if (selectedEncryptedAnswers.length === 0) return;
    if (autoDecryptAttempted.current.has(selectedSubmissionIdentity)) return;
    const allDecrypted = selectedEncryptedAnswers.every((answer) =>
      Boolean(decryptedAnswers[answerDecryptKey(selectedSubmission, answer)])
    );
    if (allDecrypted) return;

    autoDecryptAttempted.current.add(selectedSubmissionIdentity);
    decryptSelectedSubmission();
  }, [account?.address, selectedSubmissionIdentity, selectedEncryptedAnswers.length]);

  const stats = hasOwnedForms ? [
    { label: "My forms", value: ownedForms.length },
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
            {hasOwnedForms ? "Admin dashboard" : "My submissions"}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Connected as <span className="font-mono">{shortenAddress(account.address)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn btn-secondary text-xs">
            <RefreshCw size={13} /> Refresh
          </button>
          {hasOwnedForms && (
            <button onClick={exportCSV} disabled={visibleSubmissions.length === 0} className="btn btn-secondary text-xs">
              <Download size={13} /> Export CSV
            </button>
          )}
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
          {source === "sui"
            ? "Showing submissions discovered from the Sui registry."
            : "Showing local fallback submissions. Configure Sui registry env to enable global discovery."}
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
            {mySubmissions.map((submission) => (
              <div key={submissionIdentity(submission)} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-800">{submission.formTitle}</div>
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
      <div className="mb-4 flex flex-wrap gap-2">
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

      {/* Owner-only table */}
      <div className="panel overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Respondent reports</h2>
          <p className="mt-1 text-xs text-slate-400">
            Detailed answers are hidden unless this wallet created the form.
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={submissionIdentity(s)}
                  onClick={() => setSelectedSubmissionId(submissionIdentity(s))}
                  className={`cursor-pointer border-b border-slate-100/80 transition-colors hover:bg-slate-50/80 ${
                    selectedSubmission && submissionIdentity(selectedSubmission) === submissionIdentity(s) ? "bg-sky-50/50" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-slate-800 font-medium">
                    <div className="flex flex-col gap-1">
                      <span>{answerValuePreview(s.answers[0] ?? { fieldId: "", value: null }).slice(0, 64)}</span>
                      <span className="text-xs font-normal text-slate-400">{s.answers.length} answer{s.answers.length === 1 ? "" : "s"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{s.formTitle}</td>
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
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">
                    No detailed reports available for this wallet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
      {selectedSubmission && (
        <div className="mt-4 panel overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Submission detail</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {selectedSubmission.formTitle} · {new Date(selectedSubmission.submittedAt).toLocaleString("id-ID")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedEncryptedAnswers.length > 0 && (
                  <button
                    type="button"
                    onClick={decryptSelectedSubmission}
                    disabled={decryptingSubmissionId === submissionIdentity(selectedSubmission)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:border-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {decryptingSubmissionId === submissionIdentity(selectedSubmission) ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <LockOpen size={12} />
                    )}
                    {decryptingSubmissionId === submissionIdentity(selectedSubmission)
                      ? "Decrypting"
                      : "Decrypt all"}
                  </button>
                )}
                {selectedSubmission.suiFormObjectId ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                    Sui object {shortObjectId(selectedSubmission.suiFormObjectId)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    Walrus-only
                  </span>
                )}
                {selectedSubmission.chainSubmissionId && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500">
                    Submission #{selectedSubmission.chainSubmissionId}
                  </span>
                )}
              </div>
            </div>
            {decryptError && (
              <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                {decryptError}
              </div>
            )}
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_260px]">
            <div className="space-y-3">
              {selectedSubmission.answers.map((answer, index) => (
                <div key={`${answer.fieldId}-${index}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {fieldLabel(selectedSubmission, answer.fieldId)}
                    </span>
                    {fieldForAnswer(selectedSubmission, answer.fieldId)?.type && (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                        {fieldForAnswer(selectedSubmission, answer.fieldId)?.type}
                      </span>
                    )}
                    {answer.encrypted && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                        <Lock size={10} /> Seal
                      </span>
                    )}
                  </div>
                  <div className="text-sm leading-6 text-slate-600">
                    <DetailAnswerValue
                      answer={answer}
                      submission={selectedSubmission}
                      field={fieldForAnswer(selectedSubmission, answer.fieldId)}
                      decryptedValue={decryptedAnswers[answerDecryptKey(selectedSubmission, answer)]}
                    />
                  </div>
                  {answer.fileBlobId && (
                    <a
                      href={blobUrl(answer.fileBlobId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900"
                    >
                      <ExternalLink size={12} />
                      Open media blob {shortenBlobId(answer.fileBlobId)}
                    </a>
                  )}
                </div>
              ))}
              {selectedSubmission.answers.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
                  No answers in this submission.
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
              <div>
                <div className="mb-1 font-medium text-slate-700">Submitter</div>
                <div className="break-all font-mono">{selectedSubmission.submitterAddress ?? "-"}</div>
              </div>
              <div>
                <div className="mb-1 font-medium text-slate-700">Walrus submission</div>
                <a
                  href={blobUrl(selectedSubmission.walrusBlobId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900"
                >
                  {shortenBlobId(selectedSubmission.walrusBlobId)}
                  <ExternalLink size={10} />
                </a>
              </div>
              {selectedSubmission.formWalrusBlobId && (
                <div>
                  <div className="mb-1 font-medium text-slate-700">Form schema blob</div>
                  <a
                    href={blobUrl(selectedSubmission.formWalrusBlobId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900"
                  >
                    {shortenBlobId(selectedSubmission.formWalrusBlobId)}
                    <ExternalLink size={10} />
                  </a>
                </div>
              )}
              <div>
                <div className="mb-1 font-medium text-slate-700">Review state</div>
                <div className="capitalize">{selectedSubmission.status ?? "new"} · {selectedSubmission.priority ?? "medium"}</div>
              </div>
              {selectedSubmission.reviewTxDigest && (
                <div>
                  <div className="mb-1 font-medium text-slate-700">Last review tx</div>
                  <div className="break-all font-mono">{selectedSubmission.reviewTxDigest}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
