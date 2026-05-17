/**
 * lib/forms.ts
 * Manages FormSchema persistence.
 * Schema JSON → uploaded to Walrus → blobId stored in localStorage index.
 */

import { uploadToWalrus, downloadFromWalrus, normalizeWalrusBlobId, type WalrusUploadOptions } from "./walrus";
import type { FormSchema, FormSubmission } from "@/types";

const FORMS_INDEX_KEY = "sealedsurvey:forms"; // localStorage key for blobId list
const SUBMISSIONS_INDEX_KEY = "sealedsurvey:submissions";

// ─── Forms ────────────────────────────────────────────────────────────────────

function getFormsIndex(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(FORMS_INDEX_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveFormsIndex(index: Record<string, string>) {
  localStorage.setItem(FORMS_INDEX_KEY, JSON.stringify(index));
}

/**
 * Save a form schema to Walrus, store the blobId locally.
 */
export async function saveForm(
  schema: FormSchema,
  uploadOptions?: WalrusUploadOptions
): Promise<{ blobId: string }> {
  const result = await uploadToWalrus(schema, {
    identifier: "sealedsurvey-form-schema.json",
    tags: {
      app: "sealedsurvey",
      kind: "form-schema",
      formId: schema.id,
    },
    ...uploadOptions,
  });
  const index = getFormsIndex();
  index[schema.id] = result.blobId;
  saveFormsIndex(index);
  return { blobId: result.blobId };
}

/**
 * Load a form schema from Walrus by form id (looks up blobId in localStorage).
 */
export async function loadForm(formId: string): Promise<FormSchema | null> {
  const index = getFormsIndex();
  const blobId = index[formId];
  if (!blobId) return null;
  try {
    return await downloadFromWalrus<FormSchema>(blobId);
  } catch {
    return null;
  }
}

/**
 * Load a form schema by its public share slug.
 */
export async function loadFormBySlug(slug: string): Promise<FormSchema | null> {
  const forms = await loadAllForms();
  return forms.find((form) => form.shareSlug === slug) ?? null;
}

export function extractFormBlobId(identifier: string): string {
  const trimmed = identifier.trim();
  let source = trimmed;

  try {
    const url = new URL(trimmed);
    source = url.pathname.split("/").filter(Boolean).pop() ?? trimmed;
  } catch {
    source = trimmed.split("?")[0].split("#")[0];
  }

  return normalizeWalrusBlobId(source);
}

/**
 * Load a public form by local slug, raw Walrus blobId, or readable alias:
 * /form/customer-feedback--<blobId>
 *
 * BlobId links work across browsers because the schema is fetched directly
 * from Walrus instead of relying on the admin browser's localStorage index.
 */
export async function loadPublicForm(identifier: string): Promise<FormSchema | null> {
  const localForm = await loadFormBySlug(identifier);
  if (localForm) return localForm;

  try {
    const blobId = extractFormBlobId(identifier);
    const form = await downloadFromWalrus<FormSchema>(blobId);
    if (!form || typeof form !== "object" || !Array.isArray(form.fields)) {
      return null;
    }
    return { ...form, walrusBlobId: blobId };
  } catch {
    return null;
  }
}

/**
 * Load all locally-known forms from Walrus.
 */
export async function loadAllForms(): Promise<FormSchema[]> {
  const index = getFormsIndex();
  const results = await Promise.allSettled(
    Object.entries(index).map(async ([formId, blobId]) => ({
      formId,
      blobId,
      form: await downloadFromWalrus<FormSchema>(blobId),
    }))
  );
  return results
    .filter(
      (r): r is PromiseFulfilledResult<{ formId: string; blobId: string; form: FormSchema }> =>
        r.status === "fulfilled"
    )
    .map((r) => ({
      ...r.value.form,
      id: r.value.form.id || r.value.formId,
      walrusBlobId: r.value.blobId,
    }));
}

// ─── Submissions ──────────────────────────────────────────────────────────────

function getSubmissionsIndex(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(SUBMISSIONS_INDEX_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSubmissionsIndex(blobIds: string[]) {
  localStorage.setItem(SUBMISSIONS_INDEX_KEY, JSON.stringify(blobIds));
}

/**
 * Upload a submission to Walrus, track its blobId locally.
 */
export async function saveSubmission(
  submission: FormSubmission,
  uploadOptions?: WalrusUploadOptions
): Promise<{ blobId: string }> {
  const result = await uploadToWalrus(submission, {
    identifier: "sealedsurvey-submission.json",
    tags: {
      app: "sealedsurvey",
      kind: "submission",
      formId: submission.formId,
      submissionId: submission.id,
    },
    ...uploadOptions,
  });
  const idx = getSubmissionsIndex();
  if (!idx.includes(result.blobId)) {
    idx.push(result.blobId);
    saveSubmissionsIndex(idx);
  }
  return { blobId: result.blobId };
}

/**
 * Load all locally-known submissions from Walrus.
 */
export async function loadAllSubmissions(): Promise<FormSubmission[]> {
  const blobIds = getSubmissionsIndex();
  const results = await Promise.allSettled(
    blobIds.map(async (blobId) => ({
      blobId,
      submission: await downloadFromWalrus<FormSubmission>(blobId),
    }))
  );
  return results
    .filter(
      (r): r is PromiseFulfilledResult<{ blobId: string; submission: FormSubmission }> =>
        r.status === "fulfilled"
    )
    .map((r) => ({
      ...r.value.submission,
      walrusBlobId: r.value.submission.walrusBlobId || r.value.blobId,
    }))
    .sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

export function submissionsToCSV(submissions: FormSubmission[]): string {
  if (submissions.length === 0) return "";

  const headers = [
    "id",
    "formTitle",
    "submittedAt",
    "priority",
    "status",
    "encrypted",
    "walrusBlobId",
    "formWalrusBlobId",
    "suiFormObjectId",
    "submitterChainSubmissionId",
    "submitterAddress",
    "formOwnerAddress",
    "registryTxDigest",
    "reviewTxDigest",
    "answers",
  ];

  const rows = submissions.map((s) => [
    s.id,
    s.formTitle,
    s.submittedAt,
    s.priority ?? "",
    s.status ?? "new",
    s.encrypted ? "yes" : "no",
    s.walrusBlobId,
    s.formWalrusBlobId ?? "",
    s.suiFormObjectId ?? "",
    s.chainSubmissionId ?? "",
    s.submitterAddress ?? "",
    s.formOwnerAddress ?? "",
    s.registryTxDigest ?? "",
    s.reviewTxDigest ?? "",
    JSON.stringify(s.answers),
  ]);

  const escape = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join(
    "\n"
  );
}
