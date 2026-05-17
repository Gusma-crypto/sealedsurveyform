import { Transaction } from "@mysten/sui/transactions";
import type { FormSubmission } from "@/types";
import { downloadFromWalrus } from "@/lib/walrus";

const REGISTRY_INDEX_KEY = "sealedsurvey:registry:submissions";
const FORM_REGISTRY_INDEX_KEY = "sealedsurvey:registry:forms";

export interface SubmissionRegistryEntry {
  formId: string;
  formTitle: string;
  submissionBlobId: string;
  submitterAddress?: string;
  encrypted: boolean;
  timestamp: string;
  txDigest?: string;
  suiFormObjectId?: string;
  chainSubmissionId?: string;
}

export interface FormRegistryEntry {
  formId: string;
  formTitle: string;
  formBlobId: string;
  ownerAddress?: string;
  shareSlug: string;
  timestamp: string;
  txDigest?: string;
  suiFormObjectId?: string;
}

export interface ReviewRegistryEntry {
  suiFormObjectId: string;
  formId: string;
  chainSubmissionId: string;
  status: FormSubmission["status"];
  priority: FormSubmission["priority"];
  timestamp: string;
  txDigest?: string;
}

export function getRegistryConfig() {
  const packageId =
    process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ||
    process.env.NEXT_PUBLIC_SUI_REGISTRY_PACKAGE_ID;
  const module = process.env.NEXT_PUBLIC_SUI_REGISTRY_MODULE || "submission_registry";

  return {
    packageId,
    registryObjectId:
      process.env.NEXT_PUBLIC_REGISTRY_ID ||
      process.env.NEXT_PUBLIC_SUI_REGISTRY_OBJECT_ID,
    module,
    registerFunction: process.env.NEXT_PUBLIC_SUI_REGISTRY_REGISTER_FUNCTION || "register_submission",
    upsertFormFunction: process.env.NEXT_PUBLIC_SUI_FORM_UPSERT_FUNCTION || "upsert_form",
    eventType:
      process.env.NEXT_PUBLIC_SUI_REGISTRY_EVENT_TYPE ||
      (packageId ? `${packageId}::${module}::SubmissionRegistered` : undefined),
    formEventType:
      process.env.NEXT_PUBLIC_SUI_FORM_EVENT_TYPE ||
      (packageId ? `${packageId}::${module}::FormUpserted` : undefined),
    formObjectEventType:
      process.env.NEXT_PUBLIC_SUI_FORM_OBJECT_EVENT_TYPE ||
      (packageId ? `${packageId}::${module}::FormObjectUpserted` : undefined),
    formObjectSubmissionEventType:
      process.env.NEXT_PUBLIC_SUI_FORM_OBJECT_SUBMISSION_EVENT_TYPE ||
      (packageId ? `${packageId}::${module}::FormObjectSubmissionRegistered` : undefined),
    reviewEventType:
      process.env.NEXT_PUBLIC_SUI_REVIEW_EVENT_TYPE ||
      (packageId ? `${packageId}::${module}::SubmissionReviewUpdated` : undefined),
    createFormObjectFunction:
      process.env.NEXT_PUBLIC_SUI_CREATE_FORM_OBJECT_FUNCTION || "create_form_object",
    updateFormObjectFunction:
      process.env.NEXT_PUBLIC_SUI_UPDATE_FORM_OBJECT_FUNCTION || "update_form_object",
    submitFormObjectFunction:
      process.env.NEXT_PUBLIC_SUI_SUBMIT_FORM_OBJECT_FUNCTION || "submit_to_form_object",
    reviewFunction:
      process.env.NEXT_PUBLIC_SUI_REVIEW_FUNCTION || "set_submission_review",
  };
}

export function isSuiRegistryConfigured() {
  const config = getRegistryConfig();
  return Boolean(config.packageId && config.registryObjectId);
}

export function loadLocalSubmissionRegistryEntries(): SubmissionRegistryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(REGISTRY_INDEX_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalRegistryEntries(entries: SubmissionRegistryEntry[]) {
  localStorage.setItem(REGISTRY_INDEX_KEY, JSON.stringify(entries));
}

export function recordLocalSubmissionEntry(entry: SubmissionRegistryEntry) {
  const entries = loadLocalSubmissionRegistryEntries();
  if (!entries.some((item) => item.submissionBlobId === entry.submissionBlobId)) {
    saveLocalRegistryEntries([entry, ...entries]);
  }
}

export function findLocalSubmissionEntry(blobId: string): SubmissionRegistryEntry | null {
  return loadLocalSubmissionRegistryEntries().find((entry) => entry.submissionBlobId === blobId) ?? null;
}

export function loadLocalFormRegistryEntries(): FormRegistryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(FORM_REGISTRY_INDEX_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalFormRegistryEntries(entries: FormRegistryEntry[]) {
  localStorage.setItem(FORM_REGISTRY_INDEX_KEY, JSON.stringify(entries));
}

export function recordLocalFormEntry(entry: FormRegistryEntry) {
  const entries = loadLocalFormRegistryEntries().filter((item) => item.formId !== entry.formId);
  saveLocalFormRegistryEntries([entry, ...entries]);
}

export function buildRegisterSubmissionTx(entry: SubmissionRegistryEntry) {
  const config = getRegistryConfig();
  if (!config.packageId || !config.registryObjectId) {
    throw new Error("Sui registry is not configured.");
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::${config.module}::${config.registerFunction}`,
    arguments: [
      tx.object(config.registryObjectId),
      tx.pure.string(entry.formId),
      tx.pure.string(entry.formTitle),
      tx.pure.string(entry.submissionBlobId),
      tx.pure.string(entry.submitterAddress ?? ""),
      tx.pure.bool(entry.encrypted),
      tx.pure.string(entry.timestamp),
    ],
  });
  return tx;
}

export function appendRegisterSubmissionCall(tx: Transaction, entry: SubmissionRegistryEntry) {
  const config = getRegistryConfig();
  if (!config.packageId || !config.registryObjectId) return false;

  tx.moveCall({
    target: `${config.packageId}::${config.module}::${config.registerFunction}`,
    arguments: [
      tx.object(config.registryObjectId),
      tx.pure.string(entry.formId),
      tx.pure.string(entry.formTitle),
      tx.pure.string(entry.submissionBlobId),
      tx.pure.string(entry.submitterAddress ?? ""),
      tx.pure.bool(entry.encrypted),
      tx.pure.string(entry.timestamp),
    ],
  });
  return true;
}

export function buildUpsertFormTx(entry: FormRegistryEntry) {
  const config = getRegistryConfig();
  if (!config.packageId || !config.registryObjectId) {
    throw new Error("Sui registry is not configured.");
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::${config.module}::${config.upsertFormFunction}`,
    arguments: [
      tx.object(config.registryObjectId),
      tx.pure.string(entry.formId),
      tx.pure.string(entry.formTitle),
      tx.pure.string(entry.formBlobId),
      tx.pure.string(entry.shareSlug),
      tx.pure.string(entry.timestamp),
    ],
  });
  return tx;
}

export function buildCreateFormObjectTx(entry: FormRegistryEntry) {
  const config = getRegistryConfig();
  if (!config.packageId) {
    throw new Error("Sui package is not configured.");
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::${config.module}::${config.createFormObjectFunction}`,
    arguments: [
      tx.pure.string(entry.formId),
      tx.pure.string(entry.formTitle),
      tx.pure.string(entry.formBlobId),
      tx.pure.string(entry.shareSlug),
      tx.pure.string(entry.timestamp),
    ],
  });
  return tx;
}

export function buildUpdateFormObjectTx(entry: FormRegistryEntry & { suiFormObjectId: string }) {
  const config = getRegistryConfig();
  if (!config.packageId) {
    throw new Error("Sui package is not configured.");
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::${config.module}::${config.updateFormObjectFunction}`,
    arguments: [
      tx.object(entry.suiFormObjectId),
      tx.pure.string(entry.formTitle),
      tx.pure.string(entry.formBlobId),
      tx.pure.string(entry.shareSlug),
      tx.pure.string(entry.timestamp),
    ],
  });
  return tx;
}

export function buildSubmitFormObjectTx(entry: SubmissionRegistryEntry & { suiFormObjectId: string }) {
  const config = getRegistryConfig();
  if (!config.packageId) {
    throw new Error("Sui package is not configured.");
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::${config.module}::${config.submitFormObjectFunction}`,
    arguments: [
      tx.object(entry.suiFormObjectId),
      tx.pure.string(entry.submissionBlobId),
      tx.pure.bool(entry.encrypted),
      tx.pure.string(entry.timestamp),
    ],
  });
  return tx;
}

export function buildSetSubmissionReviewTx(entry: ReviewRegistryEntry) {
  const config = getRegistryConfig();
  if (!config.packageId) {
    throw new Error("Sui package is not configured.");
  }

  const statusCode: Record<NonNullable<FormSubmission["status"]>, number> = {
    new: 0,
    reviewing: 1,
    done: 2,
  };
  const priorityCode: Record<NonNullable<FormSubmission["priority"]>, number> = {
    low: 0,
    medium: 1,
    high: 2,
  };

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::${config.module}::${config.reviewFunction}`,
    arguments: [
      tx.object(entry.suiFormObjectId),
      tx.pure.u64(entry.chainSubmissionId),
      tx.pure.u8(statusCode[entry.status ?? "new"]),
      tx.pure.u8(priorityCode[entry.priority ?? "medium"]),
      tx.pure.string(entry.timestamp),
    ],
  });
  return tx;
}

export function findCreatedFormObjectId(tx: any): string | undefined {
  const config = getRegistryConfig();
  const expected = config.packageId
    ? `${config.packageId}::${config.module}::FormObject`.toLowerCase()
    : "::FormObject";
  const changes = tx?.objectChanges ?? tx?.effects?.objectChanges ?? [];
  const created = changes.find((change: any) => {
    const type = String(change.objectType ?? "").toLowerCase();
    return change.type === "created" && type.endsWith("::formobject") && type === expected;
  }) ?? changes.find((change: any) => {
    const type = String(change.objectType ?? "").toLowerCase();
    return change.type === "created" && type.endsWith("::formobject");
  });

  return created?.objectId;
}

export function findSubmissionEventId(tx: any): string | undefined {
  const config = getRegistryConfig();
  const expected = config.formObjectSubmissionEventType?.toLowerCase();
  const events = tx?.events ?? [];
  const event = events.find((item: any) => !expected || String(item.type ?? "").toLowerCase() === expected);
  const json = event?.parsedJson ?? {};
  const value = json.submissionId ?? json.submission_id;
  return value === undefined || value === null ? undefined : String(value);
}

function moveString(value: any): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const fields = value.fields;
  return moveString(fields?.contents ?? fields?.bytes ?? fields?.value ?? value.value);
}

export async function loadFormSchemaFromSuiObject(client: any, objectId: string): Promise<FormRegistryEntry | null> {
  const response = await client.getObject({
    id: objectId,
    options: { showContent: true },
  });
  const content = response.data?.content;
  if (!content || content.dataType !== "moveObject") return null;
  if (!String(content.type ?? "").endsWith("::submission_registry::FormObject")) return null;

  const fields = content.fields ?? {};
  const formBlobId = moveString(fields.form_blob_id);
  const formId = moveString(fields.form_id);
  if (!formBlobId || !formId) return null;

  return {
    formId,
    formTitle: moveString(fields.form_title) || "Untitled form",
    formBlobId,
    ownerAddress: moveString(fields.owner),
    shareSlug: moveString(fields.share_slug) || "untitled-form",
    timestamp: new Date().toISOString(),
    suiFormObjectId: objectId,
  };
}

export async function loadFormEntriesFromSui(client: any): Promise<FormRegistryEntry[]> {
  const config = getRegistryConfig();
  const eventTypes = [config.formObjectEventType, config.formEventType].filter(Boolean) as string[];
  if (eventTypes.length === 0) return [];

  const pages = await Promise.all(
    eventTypes.map((eventType) =>
      client.queryEvents({
        query: { MoveEventType: eventType },
        limit: 100,
        order: "descending",
      }).catch(() => ({ data: [] }))
    )
  );

  return pages.flatMap((page) => page.data ?? [])
    .map((event: any) => {
      const json = event.parsedJson ?? {};
      const formBlobId = json.formBlobId ?? json.form_blob_id ?? json.blobId;
      const formId = json.formId ?? json.form_id;
      if (!formId || !formBlobId) return null;

      return {
        formId,
        formTitle: json.formTitle ?? json.form_title ?? "Untitled form",
        formBlobId,
        ownerAddress: json.owner ?? json.ownerAddress ?? json.owner_address,
        shareSlug: json.shareSlug ?? json.share_slug ?? "untitled-form",
        timestamp: json.timestamp ?? new Date(Number(event.timestampMs ?? Date.now())).toISOString(),
        txDigest: event.id?.txDigest,
        suiFormObjectId: json.formObjectId ?? json.form_object_id,
      } satisfies FormRegistryEntry;
    })
    .filter(Boolean) as FormRegistryEntry[];
}

export async function loadRegisteredForms(client?: any): Promise<FormRegistryEntry[]> {
  const entries = client ? await loadFormEntriesFromSui(client).catch(() => []) : [];
  const sourceEntries = entries.length > 0 ? entries : loadLocalFormRegistryEntries();
  const latestByForm = new Map<string, FormRegistryEntry>();

  for (const entry of sourceEntries) {
    const existing = latestByForm.get(entry.formId);
    if (!existing || new Date(entry.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
      latestByForm.set(entry.formId, entry);
    }
  }

  return [...latestByForm.values()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export async function loadSubmissionEntriesFromSui(client: any): Promise<SubmissionRegistryEntry[]> {
  const config = getRegistryConfig();
  const eventTypes = [config.formObjectSubmissionEventType, config.eventType].filter(Boolean) as string[];
  if (eventTypes.length === 0) return [];

  const pages = await Promise.all(
    eventTypes.map((eventType) =>
      client.queryEvents({
        query: { MoveEventType: eventType },
        limit: 100,
        order: "descending",
      }).catch(() => ({ data: [] }))
    )
  );

  return pages.flatMap((page) => page.data ?? [])
    .map((event: any) => {
      const json = event.parsedJson ?? {};
      const submissionBlobId = json.submissionBlobId ?? json.submission_blob_id ?? json.blobId;
      if (!submissionBlobId) return null;
      return {
        formId: json.formId ?? json.form_id ?? "",
        formTitle: json.formTitle ?? json.form_title ?? "Untitled form",
        submissionBlobId,
        submitterAddress: json.submitterAddress ?? json.submitter_address,
        encrypted: Boolean(json.encrypted),
        timestamp: json.timestamp ?? new Date(Number(event.timestampMs ?? Date.now())).toISOString(),
        txDigest: event.id?.txDigest,
        suiFormObjectId: json.formObjectId ?? json.form_object_id,
        chainSubmissionId:
          json.submissionId === undefined && json.submission_id === undefined
            ? undefined
            : String(json.submissionId ?? json.submission_id),
      } satisfies SubmissionRegistryEntry;
    })
    .filter(Boolean) as SubmissionRegistryEntry[];
}

export async function loadReviewEntriesFromSui(client: any): Promise<ReviewRegistryEntry[]> {
  const config = getRegistryConfig();
  if (!config.reviewEventType) return [];

  const page = await client.queryEvents({
    query: { MoveEventType: config.reviewEventType },
    limit: 100,
    order: "descending",
  }).catch(() => ({ data: [] }));

  const statusFromCode: Record<string, FormSubmission["status"]> = {
    "0": "new",
    "1": "reviewing",
    "2": "done",
  };
  const priorityFromCode: Record<string, FormSubmission["priority"]> = {
    "0": "low",
    "1": "medium",
    "2": "high",
  };

  return (page.data ?? [])
    .map((event: any) => {
      const json = event.parsedJson ?? {};
      const chainSubmissionId = json.submissionId ?? json.submission_id;
      const suiFormObjectId = json.formObjectId ?? json.form_object_id;
      if (chainSubmissionId === undefined || !suiFormObjectId) return null;
      return {
        suiFormObjectId,
        formId: json.formId ?? json.form_id ?? "",
        chainSubmissionId: String(chainSubmissionId),
        status: statusFromCode[String(json.status)] ?? "new",
        priority: priorityFromCode[String(json.priority)] ?? "medium",
        timestamp: json.timestamp ?? new Date(Number(event.timestampMs ?? Date.now())).toISOString(),
        txDigest: event.id?.txDigest,
      } satisfies ReviewRegistryEntry;
    })
    .filter(Boolean) as ReviewRegistryEntry[];
}

export async function loadRegisteredSubmissions(client?: any): Promise<FormSubmission[]> {
  const entries = client ? await loadSubmissionEntriesFromSui(client).catch(() => []) : [];
  const sourceEntries = entries.length > 0 ? entries : loadLocalSubmissionRegistryEntries();
  const reviewEntries = client ? await loadReviewEntriesFromSui(client).catch(() => []) : [];
  const latestReview = new Map<string, ReviewRegistryEntry>();

  for (const review of reviewEntries) {
    const key = `${review.suiFormObjectId}:${review.chainSubmissionId}`;
    const existing = latestReview.get(key);
    if (!existing || new Date(review.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
      latestReview.set(key, review);
    }
  }

  const results = await Promise.allSettled(
    sourceEntries.map(async (entry) => ({
      entry,
      submission: await downloadFromWalrus<FormSubmission>(entry.submissionBlobId),
    }))
  );

  return results
    .filter(
      (result): result is PromiseFulfilledResult<{ entry: SubmissionRegistryEntry; submission: FormSubmission }> =>
        result.status === "fulfilled"
    )
    .map(({ value }) => ({
      ...value.submission,
      walrusBlobId: value.entry.submissionBlobId,
      submitterAddress: value.submission.submitterAddress ?? value.entry.submitterAddress,
      formOwnerAddress: value.submission.formOwnerAddress,
      registryTxDigest: value.submission.registryTxDigest ?? value.entry.txDigest,
      suiFormObjectId: value.submission.suiFormObjectId ?? value.entry.suiFormObjectId,
      chainSubmissionId: value.submission.chainSubmissionId ?? value.entry.chainSubmissionId,
      ...(value.entry.suiFormObjectId && value.entry.chainSubmissionId
        ? (() => {
            const review = latestReview.get(`${value.entry.suiFormObjectId}:${value.entry.chainSubmissionId}`);
            return review
              ? {
                  status: review.status,
                  priority: review.priority,
                  reviewTxDigest: review.txDigest,
                }
              : {};
          })()
        : {}),
    }))
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}
