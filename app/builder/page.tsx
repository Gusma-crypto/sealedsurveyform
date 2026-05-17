"use client";

import { useState, useCallback } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import {
  Plus, Send, Link2, Copy, Check, Trash2, Lock, LockOpen,
  AlignLeft, ChevronDown, CheckSquare, Star, Image, Video, Globe, Mail,
  Shield, Database, Loader2, LayoutTemplate, Eye, X, FileText
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { AdminGate } from "@/components/AdminGate";
import type { FormField, FormSchema, FieldType } from "@/types";
import { extractFormBlobId, loadPublicForm, saveForm } from "@/lib/forms";
import {
  buildUpsertFormTx,
  findCreatedFormObjectId,
  getRegistryConfig,
  isSuiRegistryConfigured,
  recordLocalFormEntry,
  type FormRegistryEntry,
} from "@/lib/submissionRegistry";
import { createWalletWalrusSigner, shortenBlobId } from "@/lib/walrus";
import { Transaction } from "@mysten/sui/transactions";

const FIELD_TYPES: { type: FieldType; label: string; icon: React.ReactNode }[] = [
  { type: "richtext", label: "Rich text", icon: <AlignLeft size={14} /> },
  { type: "dropdown", label: "Dropdown", icon: <ChevronDown size={14} /> },
  { type: "checkbox", label: "Checkbox", icon: <CheckSquare size={14} /> },
  { type: "rating", label: "Star rating", icon: <Star size={14} /> },
  { type: "screenshot", label: "Screenshot", icon: <Image size={14} /> },
  { type: "video", label: "Video upload", icon: <Video size={14} /> },
  { type: "email", label: "Email", icon: <Mail size={14} /> },
  { type: "url", label: "URL", icon: <Globe size={14} /> },
  { type: "text", label: "Short text", icon: <AlignLeft size={14} /> },
];

const BUILDER_DRAFT_KEY = "sealedsurvey:builder-draft";

type BuilderDraft = {
  formId: string;
  title: string;
  fields: FormField[];
  sealEnabled: boolean;
  openAt?: string;
  closeAt?: string;
  savedAt: string;
};

type PreviewValue = string | string[] | number | null;
type PreviewAnswers = Record<string, PreviewValue>;

function makeField(type: FieldType, overrides: Partial<FormField> = {}): FormField {
  const labels: Record<FieldType, string> = {
    text: "Short answer",
    richtext: "Long answer",
    dropdown: "Select one",
    checkbox: "Select all that apply",
    rating: "Rate this",
    screenshot: "Attach screenshot",
    video: "Upload video",
    email: "Email address",
    url: "Enter URL",
  };
  return {
    id: uuidv4(),
    type,
    label: labels[type],
    placeholder: "",
    required: false,
    encrypted: false,
    options: type === "dropdown" || type === "checkbox" ? ["Option 1", "Option 2"] : undefined,
    maxRating: type === "rating" ? 5 : undefined,
    ...overrides,
  };
}

function requiredIdentityFields() {
  return [
    makeField("text", {
      label: "username",
      placeholder: "your_username",
      required: true,
    }),
    makeField("email", {
      label: "email",
      placeholder: "name@example.com",
      required: true,
    }),
  ];
}

type FormTemplate = {
  id: string;
  title: string;
  description: string;
  category: string;
  fields: Array<{ type: FieldType; label: string; placeholder?: string; required?: boolean; options?: string[]; maxRating?: number }>;
};

const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: "bug-report",
    title: "Bug report",
    category: "Issue intake",
    description: "Capture reproducible defects with environment, severity, and attachments.",
    fields: [
      { type: "text", label: "Bug title", placeholder: "Login button fails on mobile", required: true },
      { type: "richtext", label: "Steps to reproduce", placeholder: "1. Open...\n2. Click...", required: true },
      { type: "dropdown", label: "Severity", required: true, options: ["Low", "Medium", "High", "Critical"] },
      { type: "url", label: "Affected URL", placeholder: "https://..." },
      { type: "screenshot", label: "Screenshot evidence" },
    ],
  },
  {
    id: "feature-request",
    title: "Feature request",
    category: "Product feedback",
    description: "Collect feature ideas, user goals, impact, and prioritization signal.",
    fields: [
      { type: "text", label: "Feature name", placeholder: "Saved filters", required: true },
      { type: "richtext", label: "Problem this solves", placeholder: "Describe the user problem...", required: true },
      { type: "dropdown", label: "User segment", required: true, options: ["Individual", "Team", "Enterprise", "Developer"] },
      { type: "rating", label: "Priority rating", required: true, maxRating: 5 },
      { type: "checkbox", label: "Expected benefits", options: ["Save time", "Reduce errors", "Improve reporting", "Increase adoption"] },
    ],
  },
  {
    id: "customer-survey",
    title: "Customer satisfaction survey",
    category: "Survey",
    description: "Measure satisfaction and gather structured qualitative feedback.",
    fields: [
      { type: "rating", label: "Overall satisfaction", required: true, maxRating: 5 },
      { type: "dropdown", label: "How often do you use this product?", required: true, options: ["Daily", "Weekly", "Monthly", "Rarely"] },
      { type: "checkbox", label: "What do you use most?", options: ["Dashboard", "Forms", "Exports", "Encryption", "Integrations"] },
      { type: "richtext", label: "What should we improve?", placeholder: "Share specific suggestions..." },
    ],
  },
  {
    id: "grant-application",
    title: "Grant application",
    category: "Application",
    description: "Gather applicant details, project scope, budget, and public links.",
    fields: [
      { type: "text", label: "Project name", required: true },
      { type: "url", label: "Project website or repository", placeholder: "https://...", required: true },
      { type: "richtext", label: "Project summary", placeholder: "What are you building?", required: true },
      { type: "dropdown", label: "Requested funding range", required: true, options: ["< $5k", "$5k - $25k", "$25k - $100k", "> $100k"] },
      { type: "richtext", label: "Milestones", placeholder: "List expected milestones and dates..." },
    ],
  },
  {
    id: "event-registration",
    title: "Event registration",
    category: "Application",
    description: "Register participants with role, attendance type, and preferences.",
    fields: [
      { type: "text", label: "Full name", required: true },
      { type: "dropdown", label: "Attendance type", required: true, options: ["In person", "Virtual", "Waitlist"] },
      { type: "checkbox", label: "Sessions interested in", options: ["Workshops", "Panels", "Networking", "Demo day"] },
      { type: "richtext", label: "Dietary or accessibility needs", placeholder: "Optional notes..." },
    ],
  },
  {
    id: "creator-application",
    title: "Creator application",
    category: "Application",
    description: "Review creators, portfolios, experience, and sample media.",
    fields: [
      { type: "text", label: "Display name", required: true },
      { type: "url", label: "Portfolio link", placeholder: "https://...", required: true },
      { type: "dropdown", label: "Primary content type", required: true, options: ["Writing", "Video", "Design", "Development", "Community"] },
      { type: "richtext", label: "Relevant experience", placeholder: "Summarize past work...", required: true },
      { type: "video", label: "Intro video" },
    ],
  },
];

function templateFields(template: FormTemplate) {
  return [
    ...requiredIdentityFields(),
    ...template.fields.map((field) =>
      makeField(field.type, {
        label: field.label,
        placeholder: field.placeholder ?? "",
        required: field.required ?? false,
        options: field.options ? [...field.options] : undefined,
        maxRating: field.type === "rating" ? field.maxRating ?? 5 : undefined,
      })
    ),
  ];
}

function FieldPreview({ field }: { field: FormField }) {
  if (field.type === "rating") {
    return (
      <div className="flex gap-1 mt-1">
        {Array.from({ length: field.maxRating ?? 5 }).map((_, i) => (
          <Star key={i} size={16} className="text-amber-300" />
        ))}
      </div>
    );
  }
  if (field.type === "dropdown") {
    return (
      <div className="mt-1 flex justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400">
        <span>Select an option</span>
        <ChevronDown size={14} />
      </div>
    );
  }
  if (field.type === "checkbox") {
    return (
      <div className="mt-1 space-y-1">
        {(field.options ?? []).map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm text-slate-400">
            <div className="w-3.5 h-3.5 rounded border border-slate-300 bg-white" />
            {opt}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "screenshot" || field.type === "video") {
    return (
      <div className="mt-1 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 py-4 text-center text-xs text-slate-400">
        Click to upload {field.type === "screenshot" ? "image" : "video"}
      </div>
    );
  }
  return (
    <input
      readOnly
      placeholder={field.placeholder || "Type your answer…"}
      className="input mt-1 cursor-default bg-slate-50 text-sm"
    />
  );
}

function emptyPreviewValue(field: FormField): PreviewValue {
  if (field.type === "checkbox") return [];
  if (field.type === "rating") return null;
  return "";
}

function FormPreviewControl({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: PreviewValue;
  onChange: (value: PreviewValue) => void;
}) {
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

  if (field.type === "dropdown") {
    return (
      <div className="relative">
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className="input appearance-none pr-9 text-sm"
        >
          <option value="">Select an option</option>
          {(field.options ?? []).filter(Boolean).map((option) => (
            <option key={option} value={option}>{option}</option>
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
        {(field.options ?? []).filter(Boolean).map((option) => (
          <label key={option} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option)
                )
              }
              className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-900"
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (field.type === "richtext") {
    return (
      <textarea
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        className="input min-h-28 resize-y text-sm"
        placeholder={field.placeholder || "Type your answer..."}
      />
    );
  }

  if (field.type === "screenshot" || field.type === "video") {
    return (
      <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-400">
        Upload {field.type === "screenshot" ? "image" : "video"}
      </div>
    );
  }

  return (
    <input
      type={field.type === "url" ? "url" : field.type === "email" ? "email" : "text"}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      className="input text-sm"
      placeholder={field.placeholder || (field.type === "email" ? "name@example.com" : "Type your answer...")}
    />
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

type SchemaIssue = {
  fieldId?: string;
  message: string;
};

function toDateTimeLocalValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string) {
  return value ? new Date(value).toISOString() : undefined;
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

function validateFormSchema(title: string, fields: FormField[], openAt?: string, closeAt?: string): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!title.trim()) issues.push({ message: "Form title is required." });
  if (fields.length === 0) issues.push({ message: "Add at least one field." });
  if (openAt && closeAt && new Date(openAt).getTime() >= new Date(closeAt).getTime()) {
    issues.push({ message: "Close date must be later than open date." });
  }
  const usernameField = fields.find((field) => field.label.trim().toLowerCase() === "username");
  const emailField = fields.find((field) => field.type === "email" || field.label.trim().toLowerCase() === "email");
  if (!usernameField) {
    issues.push({ message: "Required field username must be present." });
  } else if (!usernameField.required) {
    issues.push({ fieldId: usernameField.id, message: "username must be marked required." });
  }
  if (!emailField) {
    issues.push({ message: "Required field email must be present." });
  } else if (!emailField.required) {
    issues.push({ fieldId: emailField.id, message: "email must be marked required." });
  }

  for (const field of fields) {
    if (!field.label.trim()) {
      issues.push({ fieldId: field.id, message: "Field label is required." });
    }

    if (field.type === "dropdown" || field.type === "checkbox") {
      const options = (field.options ?? []).map((option) => option.trim()).filter(Boolean);
      if (options.length === 0) {
        issues.push({ fieldId: field.id, message: `${field.label || "Choice field"} needs at least one option.` });
      }
      if (options.length !== new Set(options.map((option) => option.toLowerCase())).size) {
        issues.push({ fieldId: field.id, message: `${field.label || "Choice field"} has duplicate options.` });
      }
    }
  }

  return issues;
}

function isMissingFormObjectEntrypoint(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /FunctionNotFound|function.*not found|entry.*not found/i.test(message);
}

function appendUpsertFormCall(tx: Transaction, entry: FormRegistryEntry) {
  const config = getRegistryConfig();
  if (!config.packageId || !config.registryObjectId) return;

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
}

function buildSaveFormChainTx(entry: FormRegistryEntry, existingFormObjectId?: string) {
  const config = getRegistryConfig();
  if (!config.packageId) {
    throw new Error("Sui package is not configured.");
  }

  const tx = new Transaction();
  if (existingFormObjectId) {
    tx.moveCall({
      target: `${config.packageId}::${config.module}::${config.updateFormObjectFunction}`,
      arguments: [
        tx.object(existingFormObjectId),
        tx.pure.string(entry.formTitle),
        tx.pure.string(entry.formBlobId),
        tx.pure.string(entry.shareSlug),
        tx.pure.string(entry.timestamp),
      ],
    });
  } else {
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
  }

  appendUpsertFormCall(tx, entry);
  return tx;
}

function shortenObjectId(objectId: string) {
  return `${objectId.slice(0, 6)}...${objectId.slice(-4)}`;
}

export default function BuilderPage() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const signAndExecute = useSignAndExecuteTransaction();
  const [formId, setFormId] = useState(() => uuidv4());
  const [title, setTitle] = useState("Untitled form");
  const [fields, setFields] = useState<FormField[]>(() => [
    ...requiredIdentityFields(),
    makeField("richtext"),
  ]);
  const [selected, setSelected] = useState<string>(fields[0].id);
  const [sealEnabled, setSealEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedBlobId, setSavedBlobId] = useState<string | null>(null);
  const [savedFormObjectId, setSavedFormObjectId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sourceBlobId, setSourceBlobId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<PreviewAnswers>({});
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [openAt, setOpenAt] = useState<string>("");
  const [closeAt, setCloseAt] = useState<string>("");

  const slug = title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "untitled-form";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const openAtIso = fromDateTimeLocalValue(openAt);
  const closeAtIso = fromDateTimeLocalValue(closeAt);
  const schemaIssues = validateFormSchema(title, fields, openAtIso, closeAtIso);
  const getPublicUrl = (identifier: string) => `${origin}/form/${slug}--${encodeURIComponent(identifier)}`;
  const shareIdentifier = savedFormObjectId ?? savedBlobId;
  const shareUrl = shareIdentifier ? getPublicUrl(shareIdentifier) : "Publish to generate a public Walrus/Sui link";

  const selectedField = fields.find((f) => f.id === selected);

  const markDirty = () => {
    setSavedBlobId(null);
    setSavedFormObjectId(null);
    setCopied(false);
  };

  const saveDraft = () => {
    const savedAt = new Date().toISOString();
    const draft: BuilderDraft = {
      formId,
      title,
      fields,
      sealEnabled,
      openAt: openAtIso,
      closeAt: closeAtIso,
      savedAt,
    };
    localStorage.setItem(BUILDER_DRAFT_KEY, JSON.stringify(draft));
    setDraftSavedAt(savedAt);
    setDraftMessage("Draft saved locally.");
    setTimeout(() => setDraftMessage(null), 1800);
  };

  const loadDraft = () => {
    try {
      const raw = localStorage.getItem(BUILDER_DRAFT_KEY);
      if (!raw) {
        setDraftMessage("No local draft found.");
        setTimeout(() => setDraftMessage(null), 1800);
        return;
      }

      const draft = JSON.parse(raw) as BuilderDraft;
      const nextFields = draft.fields?.length ? draft.fields : [...requiredIdentityFields(), makeField("richtext")];
      setFormId(draft.formId || uuidv4());
      setTitle(draft.title || "Untitled form");
      setFields(nextFields);
      setSelected(nextFields[0].id);
      setSealEnabled(Boolean(draft.sealEnabled));
      setOpenAt(toDateTimeLocalValue(draft.openAt));
      setCloseAt(toDateTimeLocalValue(draft.closeAt));
      setDraftSavedAt(draft.savedAt);
      setSaveError(null);
      setImportError(null);
      setDraftMessage("Draft loaded.");
      markDirty();
      setTimeout(() => setDraftMessage(null), 1800);
    } catch {
      setDraftMessage("Unable to load local draft.");
      setTimeout(() => setDraftMessage(null), 1800);
    }
  };

  const openPreview = () => {
    setPreviewAnswers(
      Object.fromEntries(fields.map((field) => [field.id, previewAnswers[field.id] ?? emptyPreviewValue(field)]))
    );
    setPreviewOpen(true);
  };

  const applyTemplate = (template: FormTemplate) => {
    const nextFields = templateFields(template);
    setFormId(uuidv4());
    setTitle(template.title);
    setFields(nextFields);
    setSelected(nextFields[0].id);
    setSealEnabled(true);
    setOpenAt("");
    setCloseAt("");
    setSaveError(null);
    setImportError(null);
    markDirty();
  };

  const addField = (type: FieldType) => {
    const f = makeField(type);
    setFields((prev) => [...prev, f]);
    setSelected(f.id);
    markDirty();
  };

  const updateField = useCallback(
    (id: string, updates: Partial<FormField>) => {
      setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
      setSavedBlobId(null);
      setSavedFormObjectId(null);
      setCopied(false);
    },
    []
  );

  const removeField = (id: string) => {
    setFields((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (selected === id && next.length > 0) setSelected(next[0].id);
      return next;
    });
    markDirty();
  };

  const handleSave = async (): Promise<{ blobId: string; formObjectId?: string } | null> => {
    const issues = validateFormSchema(title, fields, openAtIso, closeAtIso);
    if (issues.length > 0) {
      setSelected(issues.find((issue) => issue.fieldId)?.fieldId ?? selected);
      setSaveError(issues[0].message);
      return null;
    }

    setSaving(true);
    setSaveError(null);
    const schema: FormSchema = {
      id: formId,
      title,
      fields: fields.map((field) => ({
        ...field,
        encrypted: sealEnabled || field.encrypted,
      })),
      sealEncrypted: sealEnabled,
      createdAt: new Date().toISOString(),
      openAt: openAtIso,
      closeAt: closeAtIso,
      shareSlug: slug,
      ownerAddress: account?.address,
      suiFormObjectId: savedFormObjectId ?? undefined,
      suiPackageId: getRegistryConfig().packageId,
    };
    try {
      const signer = account
        ? createWalletWalrusSigner({
            address: account.address,
            signAndExecuteTransaction: signAndExecute,
          })
        : undefined;
      const { blobId } = await saveForm(schema, { signer });
      const registryEntry: FormRegistryEntry = {
        formId: schema.id,
        formTitle: schema.title,
        formBlobId: blobId,
        ownerAddress: account?.address,
        shareSlug: schema.shareSlug,
        timestamp: schema.createdAt,
      };
      const config = getRegistryConfig();

      if (account && config.packageId) {
        try {
          const formObjectTx = buildSaveFormChainTx(registryEntry, savedFormObjectId ?? undefined);
          const transaction = await formObjectTx.toJSON({ client: suiClient as any });
          const result = await signAndExecute.mutateAsync({ transaction });
          const digest = "digest" in result ? result.digest : undefined;
          const formObjectId = savedFormObjectId ?? (
            digest
              ? findCreatedFormObjectId(await suiClient.waitForTransaction({
                  digest,
                  options: { showObjectChanges: true },
                }))
              : undefined
          );

          if (formObjectId) {
            registryEntry.suiFormObjectId = formObjectId;
            registryEntry.suiPackageId = config.packageId;
            registryEntry.txDigest = digest;
            setSavedFormObjectId(formObjectId);
          }
        } catch (err) {
          if (!isMissingFormObjectEntrypoint(err)) {
            setSaveError(
              `Saved to Walrus, but Sui form object failed: ${
                err instanceof Error ? err.message : "unknown error"
              }`
            );
          }
        }
      } else if (account && isSuiRegistryConfigured()) {
        try {
          const tx = buildUpsertFormTx(registryEntry);
          const transaction = await tx.toJSON({ client: suiClient as any });
          const result = await signAndExecute.mutateAsync({ transaction });
          registryEntry.txDigest = "digest" in result ? result.digest : undefined;
        } catch (err) {
          setSaveError(
            `Saved to Walrus, but Sui form registry failed: ${
              err instanceof Error ? err.message : "unknown error"
            }`
          );
        }
      }

      recordLocalFormEntry(registryEntry);
      setSavedBlobId(blobId);
      return { blobId, formObjectId: registryEntry.suiFormObjectId };
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Publish failed");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    const result = savedBlobId ? { blobId: savedBlobId, formObjectId: savedFormObjectId ?? undefined } : await handleSave();
    const identifier = result?.formObjectId ?? result?.blobId;
    if (!identifier) return;
    copyText(getPublicUrl(identifier)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copyFormFromBlob = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const blobId = extractFormBlobId(sourceBlobId);
      if (!blobId) {
        setImportError("Paste a Walrus blobId or public form link.");
        return;
      }

      const sourceForm = await loadPublicForm(blobId);
      if (!sourceForm) {
        setImportError("No form schema found for that blobId.");
        return;
      }

      const copiedFields = sourceForm.fields.map((field) => {
        const isUsername = field.label.trim().toLowerCase() === "username";
        const isEmail = field.type === "email" || field.label.trim().toLowerCase() === "email";
        return {
          ...field,
          id: uuidv4(),
          required: isUsername || isEmail ? true : field.required,
          options: field.options ? [...field.options] : undefined,
        };
      });

      const hasUsername = copiedFields.some((field) => field.label.trim().toLowerCase() === "username");
      const hasEmail = copiedFields.some((field) => field.type === "email" || field.label.trim().toLowerCase() === "email");
      const nextFields = [
        ...(hasUsername && hasEmail ? [] : requiredIdentityFields().filter((field) =>
          field.label === "username" ? !hasUsername : !hasEmail
        )),
        ...(copiedFields.length > 0 ? copiedFields : [makeField("richtext")]),
      ];

      setFormId(uuidv4());
      setTitle(`Copy of ${sourceForm.title}`);
      setFields(nextFields);
      setSelected(nextFields[0].id);
      setSealEnabled(sourceForm.sealEncrypted);
      setOpenAt(toDateTimeLocalValue(sourceForm.openAt));
      setCloseAt(toDateTimeLocalValue(sourceForm.closeAt));
      setSavedBlobId(null);
      setSavedFormObjectId(null);
      setCopied(false);
      setSaveError(null);
      setSourceBlobId(blobId);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to copy form.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <AdminGate>
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-5 rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Form Builder</p>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            className="w-full max-w-sm border-0 bg-transparent text-2xl font-semibold tracking-tight text-slate-950 outline-none"
            placeholder="Form title..."
          />
          <p className="mt-1 text-xs text-slate-400">
            Every form keeps required username and email fields for respondent identity.
          </p>
        </div>
      </div>
      {(draftMessage || draftSavedAt) && (
        <div className="mb-4 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <span>{draftMessage ?? "Local draft available."}</span>
          {draftSavedAt && (
            <span className="text-xs text-slate-400">
              Last draft {new Date(draftSavedAt).toLocaleString("id-ID")}
            </span>
          )}
        </div>
      )}

      {/* Publish result */}
      {savedBlobId && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Database size={14} className="text-emerald-600 shrink-0" />
            <span className="text-emerald-900 font-medium">Published to Walrus</span>
            <span className="text-emerald-700 font-mono text-xs">{shortenBlobId(savedBlobId)}</span>
          </div>
          <div className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            savedFormObjectId
              ? "border-sky-100 bg-sky-50 text-sky-700"
              : "border-amber-100 bg-amber-50 text-amber-700"
          }`}>
            {savedFormObjectId ? (
              <>
                <Check size={12} />
                Sui object active <span className="font-mono">{shortenObjectId(savedFormObjectId)}</span>
              </>
            ) : (
              <>
                <LockOpen size={12} />
                Walrus-only link
              </>
            )}
          </div>
          <a
            href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${savedBlobId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-700 underline sm:ml-auto"
          >
            View blob ↗
          </a>
        </div>
      )}
      {saveError && (
        <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-700 shadow-sm">
          {saveError}
        </div>
      )}
      {schemaIssues.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 shadow-sm">
          {schemaIssues[0].message}
        </div>
      )}

      <div className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Templates</h2>
            <p className="mt-1 text-xs text-slate-400">
              Insert a complete draft for bug reports, feature requests, surveys, and applications.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
            <LayoutTemplate size={12} />
            6 examples
          </span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {FORM_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => applyTemplate(template)}
              className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50/40"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{template.title}</div>
                  <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{template.category}</div>
                </div>
                <Plus size={14} className="mt-0.5 shrink-0 text-sky-600" />
              </div>
              <p className="text-xs leading-5 text-slate-500">{template.description}</p>
              <div className="mt-3 text-xs text-slate-400">
                {template.fields.length + 2} fields including username and email
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 3-column layout */}
      <div className="panel grid min-h-[620px] overflow-hidden lg:grid-cols-[260px_1fr_300px]">
        {/* Left: field types */}
        <div className="border-b border-slate-200 bg-white/70 p-4 lg:border-b-0 lg:border-r">
          <p className="section-label mb-3">Field types</p>
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            Use templates for common flows, or add individual fields manually.
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">
            {FIELD_TYPES.map((ft) => (
              <button
                key={ft.type}
                onClick={() => addField(ft.type)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
              >
                {ft.icon}
                {ft.label}
              </button>
            ))}
          </div>

          {/* Copy from blob */}
          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="section-label mb-3">Copy form</p>
            <div className="space-y-2">
              <input
                value={sourceBlobId}
                onChange={(e) => {
                  setSourceBlobId(e.target.value);
                  setImportError(null);
                }}
                className="input text-xs"
                placeholder="BlobId or public link"
              />
              <button
                onClick={copyFormFromBlob}
                disabled={importing}
                className="btn btn-secondary w-full px-3 py-2 text-xs"
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                {importing ? "Copying..." : "Copy from blobId"}
              </button>
              {importError && <p className="text-xs leading-5 text-red-600">{importError}</p>}
              <p className="text-xs leading-5 text-slate-400">
                Loads a saved Walrus form schema into this builder as a new draft.
              </p>
            </div>
          </div>

          {/* Seal toggle */}
          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="section-label mb-3">Encryption</p>
            <div className="rounded-lg border border-sky-100 bg-sky-50/80 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-sky-900 flex items-center gap-1">
                  <Shield size={11} /> Seal
                </span>
                <button
                  onClick={() => {
                    setSealEnabled((v) => !v);
                    markDirty();
                  }}
                  className={`w-8 h-4 rounded-full relative transition-colors ${sealEnabled ? "bg-sky-600" : "bg-slate-300"}`}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${sealEnabled ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </button>
              </div>
              <p className="text-xs text-sky-700 leading-relaxed">
                {sealEnabled ? "Submissions encrypted via Seal before upload." : "Submissions stored unencrypted."}
              </p>
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="section-label mb-3">Sui object</p>
            <div className={`rounded-lg border p-3 ${
              savedFormObjectId
                ? "border-sky-100 bg-sky-50/80"
                : "border-slate-200 bg-slate-50"
            }`}>
              <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                {savedFormObjectId ? (
                  <>
                    <Check size={13} className="text-sky-600" />
                    <span className="text-sky-900">Object-per-form active</span>
                  </>
                ) : (
                  <>
                    <Database size={13} className="text-slate-400" />
                    <span className="text-slate-600">Not active yet</span>
                  </>
                )}
              </div>
              <p className="text-xs leading-5 text-slate-500">
                {savedFormObjectId
                  ? "Public links use the Sui form object, and submissions can emit chain submission IDs."
                  : "Save after deploying the latest Move package to enable chain-verifiable form links."}
              </p>
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="section-label mb-3">Schedule</p>
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <label className="label">Open date</label>
                <input
                  type="datetime-local"
                  value={openAt}
                  onChange={(event) => {
                    setOpenAt(event.target.value);
                    markDirty();
                  }}
                  className="input text-xs"
                />
              </div>
              <div>
                <label className="label">Close date</label>
                <input
                  type="datetime-local"
                  value={closeAt}
                  onChange={(event) => {
                    setCloseAt(event.target.value);
                    markDirty();
                  }}
                  className="input text-xs"
                />
              </div>
              <p className="text-xs leading-5 text-slate-500">
                Public respondents can submit only within this window.
              </p>
            </div>
          </div>
        </div>

        {/* Center: canvas */}
        <div className="bg-slate-50/70 p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Canvas</p>
              <p className="mt-1 text-xs text-slate-400">Click a field to edit label, options, encryption, or required state.</p>
            </div>
            <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500">
              {fields.length} fields
            </div>
          </div>
          <div className="space-y-2">
            {fields.map((f) => (
              <div
                key={f.id}
                onClick={() => setSelected(f.id)}
                className={`group relative cursor-pointer rounded-lg border bg-white p-4 shadow-sm transition-all ${
                  selected === f.id ? "border-sky-400 ring-2 ring-sky-100" : "border-slate-200 hover:border-slate-300 hover:shadow-md"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-sm font-medium text-slate-800">{f.label}</span>
                      {f.required && <span className="text-red-400 text-base leading-none">*</span>}
                      {f.encrypted && <Lock size={11} className="text-sky-500" />}
                      {(f.label.trim().toLowerCase() === "username" || f.type === "email" || f.label.trim().toLowerCase() === "email") && (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                          required identity
                        </span>
                      )}
                    </div>
                    <FieldPreview field={f} />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeField(f.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500 transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            <button
              onClick={() => addField("text")}
              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-white/60 py-3 text-sm text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-600"
            >
              <Plus size={14} /> Add field
            </button>
          </div>

        </div>

        {/* Right: properties */}
        <div className="border-t border-slate-200 bg-white/70 p-4 lg:border-l lg:border-t-0">
          <p className="section-label">Field properties</p>
          {selectedField ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-xs font-medium text-slate-700">{selectedField.type}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {selectedField.required ? "Required field" : "Optional field"}
                </div>
              </div>
              <div>
                <label className="label">Label</label>
                <input
                  value={selectedField.label}
                  onChange={(e) => updateField(selectedField.id, { label: e.target.value })}
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="label">Placeholder</label>
                <input
                  value={selectedField.placeholder ?? ""}
                  onChange={(e) => updateField(selectedField.id, { placeholder: e.target.value })}
                  className="input text-sm"
                  placeholder="Hint text…"
                />
              </div>
              {(selectedField.type === "dropdown" || selectedField.type === "checkbox") && (
                <div>
                  <label className="label">Options (one per line)</label>
                  <textarea
                    value={(selectedField.options ?? []).join("\n")}
                    onChange={(e) =>
                      updateField(selectedField.id, {
                        options: e.target.value.split("\n"),
                      })
                    }
                    rows={4}
                    className="input text-sm resize-none"
                  />
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">Required</span>
                <button
                  onClick={() => updateField(selectedField.id, { required: !selectedField.required })}
                  className={`w-8 h-4 rounded-full relative transition-colors ${selectedField.required ? "bg-slate-950" : "bg-slate-200"}`}
                >
                  <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${selectedField.required ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700 flex items-center gap-1">
                  <Lock size={12} /> Encrypt field
                </span>
                <button
                  onClick={() => updateField(selectedField.id, { encrypted: !selectedField.encrypted })}
                  className={`w-8 h-4 rounded-full relative transition-colors ${selectedField.encrypted ? "bg-sky-600" : "bg-slate-200"}`}
                >
                  <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${selectedField.encrypted ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>
              <div className="pt-3 border-t border-slate-100 text-xs text-slate-400 leading-relaxed">
                <Database size={11} className="inline mr-1" />
                Stored as Walrus blob on submission.
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Select a field to edit its properties.</p>
          )}
        </div>
      </div>
      <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <Link2 size={13} className="shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">{shareUrl}</span>
        </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-medium text-slate-900">Ready to continue?</div>
            <div className="mt-1 text-xs text-slate-400">
              Save locally as draft, preview the respondent form, copy the public link, or publish to Walrus.
            </div>
            {(openAtIso || closeAtIso) && (
              <div className="mt-2 text-xs text-slate-500">
                Opens {formatScheduleDate(openAtIso)} · Closes {formatScheduleDate(closeAtIso)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={saveDraft} className="btn btn-secondary px-3 py-2 text-xs">
              <FileText size={13} />
              Draft
            </button>
            <button onClick={loadDraft} className="btn btn-secondary px-3 py-2 text-xs">
              <Copy size={13} />
              Load draft
            </button>
            <button onClick={openPreview} className="btn btn-secondary px-3 py-2 text-xs">
              <Eye size={13} />
              Preview
            </button>
            <button onClick={copyLink} disabled={saving} className="btn btn-secondary px-3 py-2 text-xs">
              {saving ? <Loader2 size={13} className="animate-spin" /> : copied ? <Check size={13} /> : <Link2 size={13} />}
              {saving ? "Publishing..." : copied ? "Copied!" : "Copy link"}
            </button>
            <button onClick={handleSave} disabled={saving} className="btn btn-primary px-4 py-2 text-xs">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {saving ? "Publishing..." : "Publish"}
            </button>
          </div>
        </div>
      </div>
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 sm:py-10">
          <div className="w-full max-w-3xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/90 px-5 py-4">
              <div>
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                  <Lock size={11} />
                  {sealEnabled ? "Seal-ready encrypted form" : "Public form"}
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">{title || "Untitled form"}</h2>
                {(openAtIso || closeAtIso) && (
                  <p className="mt-2 text-xs text-slate-500">
                    Opens {formatScheduleDate(openAtIso)} · Closes {formatScheduleDate(closeAtIso)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
                aria-label="Close preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              {fields.map((field) => (
                <div key={field.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <label className="text-sm font-medium text-slate-800">
                      {field.label || "Untitled field"}
                      {field.required && <span className="ml-1 text-red-500">*</span>}
                    </label>
                    {(sealEnabled || field.encrypted) && <Lock size={12} className="text-sky-500" />}
                  </div>
                  <FormPreviewControl
                    field={field}
                    value={previewAnswers[field.id] ?? emptyPreviewValue(field)}
                    onChange={(value) =>
                      setPreviewAnswers((current) => ({
                        ...current,
                        [field.id]: value,
                      }))
                    }
                  />
                </div>
              ))}
              {fields.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
                  No fields added.
                </div>
              )}
            </div>
            <div className="flex justify-end border-t border-slate-100 bg-slate-50/80 px-5 py-4">
              <button type="button" onClick={() => setPreviewOpen(false)} className="btn btn-secondary text-xs">
                Close preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AdminGate>
  );
}
