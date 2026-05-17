"use client";

import { useState, useCallback } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import {
  Plus, Save, Link2, Copy, Check, Trash2, Lock, LockOpen,
  AlignLeft, ChevronDown, CheckSquare, Star, Image, Video, Globe, Mail,
  GripVertical, Shield, Database, Loader2
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

function makeField(type: FieldType): FormField {
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
  };
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

function validateFormSchema(title: string, fields: FormField[]): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!title.trim()) issues.push({ message: "Form title is required." });
  if (fields.length === 0) issues.push({ message: "Add at least one field." });

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
  const [fields, setFields] = useState<FormField[]>([makeField("richtext")]);
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

  const slug = title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "untitled-form";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const schemaIssues = validateFormSchema(title, fields);
  const getPublicUrl = (identifier: string) => `${origin}/form/${slug}--${encodeURIComponent(identifier)}`;
  const shareIdentifier = savedFormObjectId ?? savedBlobId;
  const shareUrl = shareIdentifier ? getPublicUrl(shareIdentifier) : "Save to generate a public Walrus/Sui link";

  const selectedField = fields.find((f) => f.id === selected);

  const markDirty = () => {
    setSavedBlobId(null);
    setCopied(false);
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
    const issues = validateFormSchema(title, fields);
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
      shareSlug: slug,
      ownerAddress: account?.address,
      suiFormObjectId: savedFormObjectId ?? undefined,
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
      setSaveError(err instanceof Error ? err.message : "Save failed");
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

      const copiedFields = sourceForm.fields.map((field) => ({
        ...field,
        id: uuidv4(),
        options: field.options ? [...field.options] : undefined,
      }));

      const nextFields = copiedFields.length > 0 ? copiedFields : [makeField("richtext")];

      setFormId(uuidv4());
      setTitle(`Copy of ${sourceForm.title}`);
      setFields(nextFields);
      setSelected(nextFields[0].id);
      setSealEnabled(sourceForm.sealEncrypted);
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
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Builder</p>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            className="w-full max-w-sm border-0 bg-transparent text-2xl font-semibold tracking-tight text-slate-950 outline-none"
            placeholder="Form title..."
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={copyLink} disabled={saving} className="btn btn-secondary text-xs">
            {saving ? <Loader2 size={13} className="animate-spin" /> : copied ? <Check size={13} /> : <Link2 size={13} />}
            {saving ? "Saving..." : copied ? "Copied!" : "Copy public link"}
          </button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary text-xs">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? "Uploading to Walrus…" : "Save to Walrus"}
          </button>
        </div>
      </div>

      {/* Save result */}
      {savedBlobId && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Database size={14} className="text-emerald-600 shrink-0" />
            <span className="text-emerald-900 font-medium">Saved to Walrus</span>
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

      {/* 3-column layout */}
      <div className="panel grid min-h-[560px] overflow-hidden lg:grid-cols-[220px_1fr_260px]">
        {/* Left: field types */}
        <div className="border-b border-slate-200 bg-white/70 p-4 lg:border-b-0 lg:border-r">
          <p className="section-label mb-3">Field types</p>
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
        </div>

        {/* Center: canvas */}
        <div className="bg-slate-50/70 p-5">
          <p className="mb-4 text-xs text-slate-400">Canvas - click a field to edit</p>
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

          {/* Share URL */}
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Link2 size={13} className="text-slate-400 shrink-0" />
            <span className="text-xs text-slate-400 font-mono flex-1 truncate">{shareUrl}</span>
            <button onClick={copyLink} disabled={saving} className="text-xs text-slate-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 shrink-0">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>

        {/* Right: properties */}
        <div className="border-t border-slate-200 bg-white/70 p-4 lg:border-l lg:border-t-0">
          <p className="section-label">Field properties</p>
          {selectedField ? (
            <div className="space-y-4">
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
                        options: e.target.value.split("\n").filter(Boolean),
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
    </div>
    </AdminGate>
  );
}
