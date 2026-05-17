// types/index.ts

export type FieldType =
  | "text"
  | "richtext"
  | "dropdown"
  | "checkbox"
  | "rating"
  | "screenshot"
  | "video"
  | "email"
  | "url";

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  required: boolean;
  encrypted: boolean; // encrypt this field via Seal
  options?: string[]; // for dropdown / checkbox
  maxRating?: number; // for rating (default 5)
}

export interface FormSchema {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
  sealEncrypted: boolean; // global Seal toggle
  createdAt: string; // ISO date
  walrusBlobId?: string; // blob storing this schema
  suiFormObjectId?: string; // shared Sui object that points at the schema blob
  shareSlug: string; // URL-safe slug
  ownerAddress?: string; // admin wallet that created this form
}

export interface FieldAnswer {
  fieldId: string;
  value: string | string[] | number | null;
  fileBlobId?: string; // for screenshot/video uploaded to Walrus
  encrypted?: boolean;
  encryption?: "seal";
  sealId?: string;
}

export interface FormSubmission {
  id: string;
  formId: string;
  formTitle: string;
  answers: FieldAnswer[];
  submittedAt: string; // ISO date
  walrusBlobId: string; // blob storing this submission
  formWalrusBlobId?: string; // blob storing the public form schema used for this submission
  suiFormObjectId?: string;
  formShareSlug?: string;
  encrypted: boolean;
  priority?: "low" | "medium" | "high";
  status?: "new" | "reviewing" | "done";
  submitterAddress?: string;
  formOwnerAddress?: string;
  registryTxDigest?: string;
  chainSubmissionId?: string;
  reviewTxDigest?: string;
}
