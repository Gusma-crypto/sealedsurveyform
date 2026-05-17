"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import {
  AlertCircle,
  ChevronDown,
  FileUp,
  Loader2,
  Lock,
  Send,
  Star,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { FieldAnswer, FormField, FormSchema, FormSubmission } from "@/types";
import { loadPublicForm, saveSubmission } from "@/lib/forms";
import { createWalletWalrusSigner, uploadFileToWalrus } from "@/lib/walrus";
import { createSealIdentity, isSealConfigured, sealEncryptValue } from "@/lib/seal";
import { hasRequiredProfile, loadStoredProfile, normalizedProfileEmail } from "@/lib/profile";
import {
  appendRegisterSubmissionCall,
  buildRegisterSubmissionTx,
  buildSubmitFormObjectTx,
  findSubmissionEventId,
  isSuiRegistryConfigured,
  loadFormSchemaFromSuiObject,
  loadLocalSubmissionRegistryEntries,
  loadSubmissionEntriesFromSui,
  recordLocalSubmissionEntry,
  type SubmissionRegistryEntry,
} from "@/lib/submissionRegistry";

type Answers = Record<string, string | string[] | number | null>;
type Files = Record<string, File | null>;
type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "draft"; message: string };

const SUBMISSION_DRAFT_PREFIX = "sealedsurvey:submission-draft:";
const UNIQUE_SUBMISSION_KEY = "sealedsurvey:unique-submissions";
const WALRUS_MAX_BLOB_SIZE_BYTES = 14_273_391_930; // Current Walrus maximum blob size is about 13.3 GiB.
const DEFAULT_IMAGE_UPLOAD_LIMIT_BYTES = 15 * 1024 * 1024;
const DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;
const IMAGE_UPLOAD_LIMIT_BYTES = Number(process.env.NEXT_PUBLIC_MAX_IMAGE_UPLOAD_BYTES || DEFAULT_IMAGE_UPLOAD_LIMIT_BYTES);
const VIDEO_UPLOAD_LIMIT_BYTES = Number(process.env.NEXT_PUBLIC_MAX_VIDEO_UPLOAD_BYTES || DEFAULT_VIDEO_UPLOAD_LIMIT_BYTES);

type SubmissionDraft = {
  formId: string;
  answers: Answers;
  fileNames: Record<string, string>;
  savedAt: string;
};

type UniqueSubmissionRecord = {
  formId: string;
  walletAddress: string;
  email: string;
  blobId: string;
  txDigest?: string;
  submittedAt: string;
};

function normalizeUniqueValue(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function loadUniqueSubmissionRecords(): UniqueSubmissionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(UNIQUE_SUBMISSION_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveUniqueSubmissionRecord(record: UniqueSubmissionRecord) {
  const records = loadUniqueSubmissionRecords().filter(
    (item) =>
      !(
        item.formId === record.formId &&
        (item.walletAddress === record.walletAddress || item.email === record.email)
      )
  );
  localStorage.setItem(UNIQUE_SUBMISSION_KEY, JSON.stringify([record, ...records]));
}

function emptyValueFor(field: FormField) {
  if (field.type === "checkbox") return [];
  if (field.type === "rating") return null;
  return "";
}

function isEmpty(value: string | string[] | number | null) {
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === "";
}

function isValidEmail(value: string | string[] | number | null) {
  if (typeof value !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function findDuplicateSubmission({
  form,
  walletAddress,
  email,
  suiClient,
}: {
  form: FormSchema;
  walletAddress: string;
  email: string;
  suiClient: any;
}) {
  const localUnique = loadUniqueSubmissionRecords();
  if (localUnique.some((record) => record.formId === form.id && record.walletAddress === walletAddress)) {
    return "This wallet has already submitted this form.";
  }
  if (email && localUnique.some((record) => record.formId === form.id && record.email === email)) {
    return "This email has already submitted this form.";
  }

  const localRegistryDuplicate = loadLocalSubmissionRegistryEntries().some(
    (entry) =>
      entry.formId === form.id &&
      normalizeUniqueValue(entry.submitterAddress) === walletAddress
  );
  if (localRegistryDuplicate) {
    return "This wallet has already submitted this form.";
  }

  if (isSuiRegistryConfigured()) {
    const chainEntries = await loadSubmissionEntriesFromSui(suiClient).catch(() => []);
    const chainDuplicate = chainEntries.some(
      (entry) =>
        entry.formId === form.id &&
        normalizeUniqueValue(entry.submitterAddress) === walletAddress
    );
    if (chainDuplicate) {
      return "This wallet has already submitted this form on-chain.";
    }
  }

  return null;
}

function formatBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function mediaLimitForField(field: FormField) {
  if (field.type === "screenshot") return Math.min(IMAGE_UPLOAD_LIMIT_BYTES, WALRUS_MAX_BLOB_SIZE_BYTES);
  if (field.type === "video") return Math.min(VIDEO_UPLOAD_LIMIT_BYTES, WALRUS_MAX_BLOB_SIZE_BYTES);
  return WALRUS_MAX_BLOB_SIZE_BYTES;
}

function validateMediaFile(field: FormField, file: File) {
  const limit = mediaLimitForField(field);
  if (file.size > limit) {
    throw new Error(
      `${field.label || "Media file"} is ${formatBytes(file.size)}. Maximum allowed ${field.type === "screenshot" ? "image" : "video"} upload is ${formatBytes(limit)}.`
    );
  }
  if (file.size > WALRUS_MAX_BLOB_SIZE_BYTES) {
    throw new Error(`Walrus blob limit is ${formatBytes(WALRUS_MAX_BLOB_SIZE_BYTES)} per file.`);
  }
  if (field.type === "screenshot" && file.type && !file.type.startsWith("image/")) {
    throw new Error(`${field.label || "Screenshot"} must be an image file.`);
  }
  if (field.type === "video" && file.type && !file.type.startsWith("video/")) {
    throw new Error(`${field.label || "Video"} must be a video file.`);
  }
}

function readableSubmitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/EDuplicateWallet|MoveAbort.*2|abort.*2/i.test(message)) {
    return "This wallet has already submitted this form.";
  }
  if (/EDuplicateEmail|MoveAbort.*3|abort.*3/i.test(message)) {
    return "This email has already submitted this form.";
  }
  return message || "Unable to submit this response.";
}

function formatScheduleDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFormAvailability(form: FormSchema) {
  const now = Date.now();
  const openTime = form.openAt ? new Date(form.openAt).getTime() : null;
  const closeTime = form.closeAt ? new Date(form.closeAt).getTime() : null;
  if (openTime && now < openTime) {
    return {
      canSubmit: false,
      state: "not-open" as const,
      message: `This form opens on ${formatScheduleDate(form.openAt)}.`,
    };
  }
  if (closeTime && now > closeTime) {
    return {
      canSubmit: false,
      state: "closed" as const,
      message: `This form closed on ${formatScheduleDate(form.closeAt)}.`,
    };
  }
  return {
    canSubmit: true,
    state: "open" as const,
    message: form.closeAt
      ? `Last submission: ${formatScheduleDate(form.closeAt)}.`
      : form.openAt
        ? `Open since ${formatScheduleDate(form.openAt)}.`
        : "This form is open for submissions.",
  };
}

function inferPriority(answers: FieldAnswer[]): FormSubmission["priority"] {
  const combined = answers
    .flatMap((answer) => Array.isArray(answer.value) ? answer.value : [answer.value])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(urgent|critical|blocker|crash|security|login fails)/.test(combined)) return "high";
  if (/(bug|broken|slow|error|issue|problem)/.test(combined)) return "medium";
  return "low";
}

function draftKey(formId: string) {
  return `${SUBMISSION_DRAFT_PREFIX}${formId}`;
}

function extractSuiFormObjectId(identifier: string) {
  const decoded = decodeURIComponent(identifier);
  const source = decoded.includes("--") ? decoded.slice(decoded.lastIndexOf("--") + 2) : decoded;
  return /^0x[a-fA-F0-9]+$/.test(source) ? source : null;
}

function saveSubmissionDraft(form: FormSchema, answers: Answers, files: Files) {
  if (typeof window === "undefined") return;

  const draft: SubmissionDraft = {
    formId: form.id,
    answers,
    fileNames: Object.fromEntries(
      Object.entries(files)
        .filter(([, file]) => Boolean(file))
        .map(([fieldId, file]) => [fieldId, file?.name ?? ""])
    ),
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem(draftKey(form.id), JSON.stringify(draft));
}

function loadSubmissionDraft(formId: string): SubmissionDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(draftKey(formId));
    return raw ? JSON.parse(raw) as SubmissionDraft : null;
  } catch {
    return null;
  }
}

function clearSubmissionDraft(formId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(draftKey(formId));
}

function FieldControl({
  field,
  value,
  file,
  onChange,
  onFileChange,
}: {
  field: FormField;
  value: string | string[] | number | null;
  file: File | null;
  onChange: (value: string | string[] | number | null) => void;
  onFileChange: (file: File | null) => void;
}) {
  if (field.type === "richtext") {
    return (
      <textarea
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className="input min-h-32 resize-y"
        placeholder={field.placeholder || "Type your answer..."}
      />
    );
  }

  if (field.type === "dropdown") {
    return (
      <div className="relative">
        <select
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className="input appearance-none pr-9"
        >
          <option value="">Select an option</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-2.5 text-slate-400" />
      </div>
    );
  }

  if (field.type === "checkbox") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        {(field.options ?? []).map((option) => (
          <label key={option} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option)
                );
              }}
              className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-900"
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (field.type === "rating") {
    const rating = typeof value === "number" ? value : 0;
    return (
      <div className="flex gap-1.5">
        {Array.from({ length: field.maxRating ?? 5 }).map((_, index) => {
          const score = index + 1;
          return (
            <button
              key={score}
              type="button"
              onClick={() => onChange(score)}
              className="rounded-md p-1 text-amber-300 transition-colors hover:bg-amber-50"
              aria-label={`Rate ${score}`}
            >
              <Star size={22} fill={score <= rating ? "currentColor" : "none"} />
            </button>
          );
        })}
      </div>
    );
  }

  if (field.type === "screenshot" || field.type === "video") {
    const limit = mediaLimitForField(field);
    return (
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:bg-white">
        <span className="flex items-center gap-2">
          <FileUp size={16} />
          <span className="flex flex-col">
            <span>{file ? file.name : `Upload ${field.type === "screenshot" ? "image" : "video"}`}</span>
            <span className="text-xs text-slate-400">Max {formatBytes(limit)}</span>
          </span>
        </span>
        <span className="text-xs text-slate-400">Walrus blob</span>
        <input
          type="file"
          accept={field.type === "screenshot" ? "image/*" : "video/*"}
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null;
            if (nextFile) {
              try {
                validateMediaFile(field, nextFile);
              } catch (err) {
                event.target.value = "";
                onFileChange(null);
                window.alert(err instanceof Error ? err.message : "Invalid media file.");
                return;
              }
            }
            onFileChange(nextFile);
          }}
          className="hidden"
        />
      </label>
    );
  }

  return (
    <input
      type={field.type === "url" ? "url" : field.type === "email" ? "email" : "text"}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
      className="input"
      placeholder={field.placeholder || (field.type === "email" ? "name@example.com" : "Type your answer...")}
    />
  );
}

export default function PublicFormPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const suiClient = useSuiClient();
  const account = useCurrentAccount();
  const signAndExecute = useSignAndExecuteTransaction();
  const slug = params.slug;
  const [form, setForm] = useState<FormSchema | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [files, setFiles] = useState<Files>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [touchedSubmit, setTouchedSubmit] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const objectId = extractSuiFormObjectId(slug);
        const formObject = objectId ? await loadFormSchemaFromSuiObject(suiClient, objectId) : null;
        const loaded = formObject
          ? await loadPublicForm(formObject.formBlobId)
          : await loadPublicForm(slug);
        if (!active) return;

        if (!loaded) {
          setForm(null);
          setLoadError("Form not found. Check that the shared link uses the Walrus blob link generated after saving.");
          return;
        }

        setForm(formObject
          ? {
              ...loaded,
              walrusBlobId: formObject.formBlobId,
              suiFormObjectId: formObject.suiFormObjectId,
              suiPackageId: formObject.suiPackageId,
              ownerAddress: formObject.ownerAddress ?? loaded.ownerAddress,
              shareSlug: formObject.shareSlug || loaded.shareSlug,
            }
          : loaded);
        const emptyAnswers = Object.fromEntries(
          loaded.fields.map((field) => [field.id, emptyValueFor(field)])
        ) as Answers;
        const draft = loadSubmissionDraft(loaded.id);
        setAnswers({ ...emptyAnswers, ...(draft?.answers ?? {}) });
        if (draft) {
          setSubmitState({
            status: "draft",
            message: `Draft restored from ${new Date(draft.savedAt).toLocaleString()}. Connect wallet to submit.`,
          });
        }
      } catch (err) {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : "Unable to load this form.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [slug, suiClient]);

  const missingRequired = useMemo(() => {
    if (!form) return [];
    return form.fields.filter((field) => {
      if (!field.required) return false;
      if (field.type === "screenshot" || field.type === "video") return !files[field.id];
      return isEmpty(answers[field.id] ?? emptyValueFor(field));
    });
  }, [answers, files, form]);

  const invalidEmailFields = useMemo(() => {
    if (!form) return [];
    return form.fields.filter((field) => {
      if (field.type !== "email") return false;
      const value = answers[field.id] ?? emptyValueFor(field);
      if (isEmpty(value)) return false;
      return !isValidEmail(value);
    });
  }, [answers, form]);
  const availability = form ? getFormAvailability(form) : null;
  const connectedProfile = account ? loadStoredProfile(account.address) : null;
  const profileComplete = connectedProfile ? hasRequiredProfile(connectedProfile) : false;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    setTouchedSubmit(true);
    const currentAvailability = getFormAvailability(form);
    if (!currentAvailability.canSubmit) {
      setSubmitState({
        status: "error",
        message: currentAvailability.message,
      });
      return;
    }
    if (missingRequired.length > 0 || invalidEmailFields.length > 0) return;

    if (!account) {
      saveSubmissionDraft(form, answers, files);
      setSubmitState({
        status: "draft",
        message: "Wallet is not connected. Your response was saved as a local draft. Connect wallet, review the draft, then submit again.",
      });
      return;
    }

    const normalizedWalletAddress = normalizeUniqueValue(account.address);
    const profile = loadStoredProfile(account.address);
    if (!hasRequiredProfile(profile)) {
      setSubmitState({
        status: "error",
        message: "Lengkapi profile username dan email yang valid terlebih dahulu dari menu profile wallet.",
      });
      return;
    }
    const normalizedEmail = normalizedProfileEmail(profile);
    const duplicateMessage = await findDuplicateSubmission({
      form,
      walletAddress: normalizedWalletAddress,
      email: normalizedEmail,
      suiClient,
    });
    if (duplicateMessage) {
      setSubmitState({
        status: "error",
        message: duplicateMessage,
      });
      return;
    }

    setSubmitState({ status: "submitting" });

    try {
      const normalizedAnswers: FieldAnswer[] = [];
      const submissionId = uuidv4();
      const walrusSigner = createWalletWalrusSigner({
        address: normalizedWalletAddress,
        signAndExecuteTransaction: signAndExecute,
      });

      for (const field of form.fields) {
        const selectedFile = files[field.id];
        const shouldEncrypt = form.sealEncrypted || field.encrypted;
        const sealId = createSealIdentity(form.id, submissionId, field.id);
        if (selectedFile) {
          validateMediaFile(field, selectedFile);
          const uploaded = await uploadFileToWalrus(selectedFile, { signer: walrusSigner });
          normalizedAnswers.push({
            fieldId: field.id,
            value: selectedFile.name,
            fileBlobId: uploaded.blobId,
          });
        } else {
          const sourceValue = answers[field.id] ?? emptyValueFor(field);
          const rawValue =
            (field.type === "email" || field.label.trim().toLowerCase() === "email") &&
            typeof sourceValue === "string"
              ? normalizeUniqueValue(sourceValue)
              : sourceValue;
          if (shouldEncrypt && !isSealConfigured()) {
            throw new Error(
              "Seal encryption is enabled for this form, but Seal is not configured. Check NEXT_PUBLIC_SUI_PACKAGE_ID, NEXT_PUBLIC_SEAL_KEY_SERVERS, and NEXT_PUBLIC_SEAL_THRESHOLD."
            );
          }

          if (shouldEncrypt && isSealConfigured()) {
            const encrypted = await sealEncryptValue({
              suiClient,
              id: sealId,
              value: rawValue,
            });
            normalizedAnswers.push({
              fieldId: field.id,
              value: encrypted.ciphertext,
              encrypted: true,
              encryption: "seal",
              sealId: encrypted.id,
            });
            continue;
          }

          normalizedAnswers.push({
            fieldId: field.id,
            value: rawValue,
          });
        }
      }

      const submission: FormSubmission = {
        id: submissionId,
        formId: form.id,
        formTitle: form.title,
        answers: normalizedAnswers,
        submittedAt: new Date().toISOString(),
        walrusBlobId: "",
        formWalrusBlobId: form.walrusBlobId,
        suiFormObjectId: form.suiFormObjectId,
        suiPackageId: form.suiPackageId,
        formShareSlug: form.shareSlug,
        encrypted: form.sealEncrypted || form.fields.some((field) => field.encrypted),
        priority: inferPriority(normalizedAnswers),
        status: "new",
        submitterAddress: normalizedWalletAddress,
        submitterUsername: profile.username.trim(),
        submitterEmail: normalizedEmail,
        formOwnerAddress: form.ownerAddress,
      };

      const { blobId } = await saveSubmission(submission, { signer: walrusSigner });
      const registryEntry: SubmissionRegistryEntry = {
        formId: form.id,
        formTitle: form.title,
        submissionBlobId: blobId,
        submitterAddress: normalizedWalletAddress,
        submitterEmail: normalizedEmail,
        sealIds: normalizedAnswers
          .filter((answer) => answer.encrypted && answer.encryption === "seal" && answer.sealId)
          .map((answer) => answer.sealId!),
        encrypted: submission.encrypted,
        timestamp: submission.submittedAt,
        suiFormObjectId: form.suiFormObjectId,
        suiPackageId: form.suiPackageId,
      };

      if (form.suiFormObjectId) {
        const tx = buildSubmitFormObjectTx({
          ...registryEntry,
          suiFormObjectId: form.suiFormObjectId,
        });
        appendRegisterSubmissionCall(tx, registryEntry);
        const transaction = await tx.toJSON({ client: suiClient as any });
        const result = await signAndExecute.mutateAsync({ transaction });
        const digest = "digest" in result ? result.digest : undefined;
        registryEntry.txDigest = digest;
        if (digest) {
          const txDetails = await suiClient.waitForTransaction({
            digest,
            options: { showEvents: true },
          });
          registryEntry.chainSubmissionId = findSubmissionEventId(txDetails);
        }
      } else if (isSuiRegistryConfigured()) {
        const tx = buildRegisterSubmissionTx(registryEntry);
        const transaction = await tx.toJSON({ client: suiClient as any });
        const result = await signAndExecute.mutateAsync({ transaction });
        registryEntry.txDigest = "digest" in result ? result.digest : undefined;
      }

      recordLocalSubmissionEntry(registryEntry);
      saveUniqueSubmissionRecord({
        formId: form.id,
        walletAddress: normalizedWalletAddress,
        email: normalizedEmail,
        blobId,
        txDigest: registryEntry.txDigest,
        submittedAt: submission.submittedAt,
      });
      clearSubmissionDraft(form.id);
      router.push(`/receipt/${encodeURIComponent(blobId)}`);
    } catch (err) {
      setSubmitState({
        status: "error",
        message: readableSubmitError(err),
      });
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl items-center justify-center px-4">
        <div className="panel flex items-center gap-3 px-5 py-4 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          Loading form...
        </div>
      </div>
    );
  }

  if (loadError || !form) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl items-center justify-center px-4">
        <div className="panel max-w-md p-6 text-center">
          <AlertCircle size={26} className="mx-auto mb-3 text-amber-500" />
          <h1 className="mb-2 text-lg font-semibold text-slate-950">Form unavailable</h1>
          <p className="text-sm leading-6 text-slate-500">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-5">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 shadow-sm">
          <Lock size={11} />
          {form.sealEncrypted ? "Seal-ready encrypted form" : "Public form"}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{form.title}</h1>
        {form.description && (
          <p className="mt-2 text-sm leading-6 text-slate-500">{form.description}</p>
        )}
        {availability && (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-sm shadow-sm ${
            availability.canSubmit
              ? "border-sky-100 bg-sky-50 text-sky-800"
              : "border-amber-100 bg-amber-50 text-amber-800"
          }`}>
            <div className="font-medium">
              {availability.state === "closed"
                ? "Form closed"
                : availability.state === "not-open"
                  ? "Form not open yet"
                  : "Form open"}
            </div>
            <div className="mt-1 text-xs leading-5">{availability.message}</div>
            {(form.openAt || form.closeAt) && (
              <div className="mt-2 text-xs leading-5">
                Opens {formatScheduleDate(form.openAt)} · Closes {formatScheduleDate(form.closeAt)}
              </div>
            )}
          </div>
        )}
        {account && !profileComplete && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            Lengkapi username dan email yang valid di menu profile wallet sebelum submit. Data identity tidak lagi diisi dari field form.
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="panel overflow-hidden">
        <div className="space-y-5 p-5 sm:p-6">
          {form.fields.map((field) => {
            const showError =
              touchedSubmit &&
              field.required &&
              ((field.type === "screenshot" || field.type === "video")
                ? !files[field.id]
                : isEmpty(answers[field.id] ?? emptyValueFor(field)));
            const showEmailError =
              touchedSubmit &&
              field.type === "email" &&
              !isEmpty(answers[field.id] ?? emptyValueFor(field)) &&
              !isValidEmail(answers[field.id] ?? emptyValueFor(field));

            return (
              <div key={field.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-800">
                    {field.label}
                    {field.required && <span className="ml-1 text-red-500">*</span>}
                  </label>
                  {field.encrypted && <Lock size={12} className="text-sky-500" />}
                </div>
                <FieldControl
                  field={field}
                  value={answers[field.id] ?? emptyValueFor(field)}
                  file={files[field.id] ?? null}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [field.id]: value }))}
                  onFileChange={(file) => setFiles((prev) => ({ ...prev, [field.id]: file }))}
                />
                {showError && (
                  <p className="mt-2 text-xs text-red-600">This field is required.</p>
                )}
                {showEmailError && (
                  <p className="mt-2 text-xs text-red-600">Enter a valid email address.</p>
                )}
              </div>
            );
          })}

          {(submitState.status === "error" || submitState.status === "draft") && (
            <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
              submitState.status === "draft"
                ? "border-amber-100 bg-amber-50 text-amber-800"
                : "border-red-100 bg-red-50 text-red-700"
            }`}>
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {submitState.message}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs leading-5 text-slate-500">
            Text/private answers can be Seal encrypted. Media files are stored on Walrus for preview and download.
          </p>
          <button
            type="submit"
            disabled={submitState.status === "submitting" || availability?.canSubmit === false}
            className="btn btn-primary shrink-0"
          >
            {submitState.status === "submitting" ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
            {submitState.status === "submitting"
              ? "Submitting..."
              : availability?.canSubmit === false
                ? "Submissions closed"
                : "Submit response"}
          </button>
        </div>
      </form>
    </div>
  );
}
