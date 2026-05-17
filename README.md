# SealedSurvey

SealedSurvey is a Walrus-native feedback and form platform for teams and
communities that need structured submissions, private answers, review workflows,
and exportable feedback data.

The app lets an owner build shareable forms for bug reports, feature requests,
surveys, applications, and other feedback flows. Form schemas and submissions are
stored as Walrus blobs. Sui is used as a registry layer for discoverable form and
submission metadata. Seal can encrypt private text answers so the form owner can
decrypt responses from the dashboard.

## Hackathon Fit

SealedSurvey targets the Walrus feedback/forms challenge:

- Custom form builder with required and optional fields.
- Rich input support: text, long text, dropdown, checkbox, star rating,
  screenshot upload, video upload, URL, and required fields.
- Shareable public form links.
- Walrus storage for form schemas, submissions, and media attachments.
- Optional Seal encryption for private text answers.
- Sui registry events for form and submission metadata.
- Owner dashboard for filtering, reviewing, prioritizing, decrypting, and
  exporting responses as CSV or JSON.
- Respondent receipt page and "My Submission" profile menu.

## Tech Stack

- Next.js App Router, React, TypeScript
- Sui wallet integration with `@mysten/dapp-kit`
- Walrus Testnet storage with `@mysten/walrus`
- Seal Protocol with `@mysten/seal`
- Sui Move registry package
- Tailwind CSS

## Core Features

### Form Builder

Owners can create forms with:

- Title and description
- Open date and close date schedule
- Required and optional fields
- Dropdown and checkbox options
- Rating fields
- Screenshot and video upload fields
- URL fields
- Seal encryption toggle
- Draft save/load
- Preview before publish
- Publish to Walrus and register metadata on Sui

Respondent identity fields are not added manually to the form. Username and
email are taken from the connected wallet profile. If the profile is incomplete,
the user must complete it before submitting.

### Public Form Submit

Respondents can open a shared form link, fill answers, upload allowed media, and
submit once per form. The app enforces:

- One wallet address can submit once.
- One email can submit once.
- Wallet and email are normalized to lowercase.
- Duplicate validation happens before transaction execution.
- Successful submissions keep the Walrus blob ID and Sui transaction digest.

Text/private answers can be Seal encrypted. Media files are uploaded to Walrus
for preview and download.

### Dashboard

The owner dashboard is optimized for demo and real usage:

- Loads metadata from Sui/local registry first.
- Shows respondent list quickly without downloading every Walrus blob.
- Lazy-loads submission details only when the owner clicks detail.
- Caches loaded blobs in the browser.
- Caches form schemas so field labels do not need repeated fetches.
- Filters by email, wallet, form, date, transaction status, and sort order.
- Exports filtered results as CSV or JSON.
- Supports review status and priority.
- Decrypts Seal answers for authorized owner access.

### Profile and My Submission

Connected users get a profile dropdown with:

- Profile: username, email, connected address
- My Submission: grouped receipts by form title
- Setting: local social links for X, Telegram, and Discord
- Disconnect action

Profile data is stored locally in the browser for the demo.

## Product Flow

### 1. Owner Publishes A Form

```text
Owner opens Form Builder
  -> completes profile if needed
  -> creates form fields and schedule
  -> previews form
  -> publishes form schema to Walrus
  -> emits form metadata to Sui registry
  -> receives shareable public form link
```

Stored data:

- Full form schema: Walrus blob
- Form metadata: Sui registry event/object metadata
- Optional local cache: browser localStorage for faster demo UX

### 2. User Submits A Response

```text
User opens shared form link
  -> connects Sui wallet
  -> completes profile username and email
  -> fills form answers
  -> uploads media to Walrus when needed
  -> app validates duplicate wallet/email before transaction
  -> text/private answers are Seal encrypted when enabled
  -> full submission is uploaded to Walrus
  -> submission metadata is emitted to Sui registry
  -> user receives receipt link with tx digest and blob ID
```

Stored data:

- Full submission payload: Walrus blob
- Media attachments: Walrus blobs
- Submission metadata: Sui registry event/object metadata
- Transaction digest: saved in the submission receipt and dashboard

### 3. Owner Reviews Responses

```text
Owner opens Dashboard
  -> app loads Sui/local metadata first
  -> respondent list appears quickly
  -> owner filters or sorts submissions
  -> owner clicks Detail
  -> app downloads the selected Walrus submission blob
  -> app decrypts Seal answers when authorized
  -> owner reviews, prioritizes, and exports data
```

This keeps the dashboard fast because it does not download every submission
detail from Walrus during the first page load.

## Architecture

```text
Next.js App
  |
  |-- Form Builder
  |     |-- uploads form schema to Walrus
  |     |-- registers form metadata to Sui
  |
  |-- Public Form Page
  |     |-- validates profile and duplicate rules
  |     |-- uploads media to Walrus
  |     |-- encrypts private text answers with Seal
  |     |-- uploads submission JSON to Walrus
  |     |-- registers submission metadata to Sui
  |
  |-- Dashboard
  |     |-- reads Sui/local metadata
  |     |-- lazy-loads Walrus blobs on detail click
  |     |-- decrypts authorized Seal answers
  |     |-- filters, reviews, exports
  |
  |-- Receipt
        |-- shows submitter receipt, blob links, tx links, and own submission data
```

## Sui / Walrus / Seal Flow

### Walrus

Walrus stores the durable content:

- Form schemas
- Submission JSON
- Screenshot files
- Video files

Testnet endpoints used by the app:

| Service | URL |
| --- | --- |
| Publisher | `https://publisher.walrus-testnet.walrus.space` |
| Aggregator | `https://aggregator.walrus-testnet.walrus.space` |
| Upload relay | `https://upload-relay.testnet.walrus.space` |

### Sui Registry

The Move package stores and emits metadata needed for fast discovery:

- Form ID
- Form title
- Form schema blob ID
- Share slug
- Submission blob ID
- Submitter wallet
- Submitter email
- Seal IDs for authorized decrypt
- Review status and priority

The registry also enforces anti-duplicate submission constraints per form.

### Seal

Seal is used for optional private text answers. The approval policy allows:

- Form owner to decrypt responses.
- Submitter to decrypt their own encrypted submission when their Seal IDs were
  registered during submission.

Media uploads are stored on Walrus for preview/download and are not presented as
Seal-encrypted media in this demo.

## Project Structure

```text
app/
  page.tsx              Landing page
  builder/              Form builder
  dashboard/            Owner dashboard
  form/[slug]/          Public form page
  receipt/[blobId]/     Submission receipt page

components/
  ui/Navbar.tsx         Navigation, profile, My Submission, settings
  SealAnswerPreview.tsx Seal decrypt UI
  ui/WalrusStatusBadge.tsx

lib/
  forms.ts              Local form/submission helpers and CSV utilities
  profile.ts            Local wallet profile helpers
  seal.ts               Seal encryption/decryption helpers
  submissionRegistry.ts Sui registry transaction and event helpers
  walrus/               Walrus upload/download clients

move/
  submission_registry/  Sui Move registry and Seal approval policy

types/
  index.ts              Shared form and submission types
```

## Environment Variables

Create `.env.local` from `.env.example`.

```env
NEXT_PUBLIC_SUI_RPC_URL=https://fullnode.testnet.sui.io:443
NEXT_PUBLIC_SUI_GRAPHQL_URL=https://sui-testnet.mystenlabs.com/graphql

NEXT_PUBLIC_ADMIN_WALLETS=

NEXT_PUBLIC_SUI_PACKAGE_ID=0xYOUR_PACKAGE_ID
NEXT_PUBLIC_REGISTRY_ID=0xYOUR_SHARED_REGISTRY_ID
NEXT_PUBLIC_SEAL_APPROVE_TARGET=0xYOUR_PACKAGE_ID::submission_registry::seal_approve

NEXT_PUBLIC_SEAL_KEY_SERVERS=0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98|1|https://seal-aggregator-testnet.mystenlabs.com
NEXT_PUBLIC_SEAL_THRESHOLD=1
```

Optional upload limits:

```env
NEXT_PUBLIC_MAX_IMAGE_UPLOAD_BYTES=15728640
NEXT_PUBLIC_MAX_VIDEO_UPLOAD_BYTES=104857600
NEXT_PUBLIC_WALRUS_PREFER_WALLET_UPLOAD=true
```

## Run Locally

Requirements:

- Node.js `>=20.9.0`
- npm
- Sui wallet configured for Testnet
- Testnet SUI/WAL for publishing and transactions

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Build:

```bash
npm run build
```

## Move Package

Build the Move package:

```bash
cd move/submission_registry
sui move build
```

Publish to Testnet:

```bash
sui client publish
```

After publish:

1. Copy the package ID into `NEXT_PUBLIC_SUI_PACKAGE_ID`.
2. Copy the shared registry object ID into `NEXT_PUBLIC_REGISTRY_ID`.
3. Set `NEXT_PUBLIC_SEAL_APPROVE_TARGET` to
   `<packageId>::submission_registry::seal_approve`.
4. Restart the Next.js dev server.

## Demo Script For Hackathon Video

Recommended video flow under 3 minutes:

1. Open the landing page and connect wallet.
2. Open profile dropdown and set username/email.
3. Go to Form Builder.
4. Create a bug report or feature request form with required fields, rating,
   screenshot/video, and URL.
5. Set open and close date.
6. Preview the form.
7. Publish the form to Walrus and Sui.
8. Copy/open the public form link.
9. Submit one real response with text and media.
10. Show the receipt page with Walrus blob and Sui explorer link.
11. Open dashboard.
12. Filter the response, open detail, decrypt private answers, review priority,
    and export CSV.

## Submission Checklist

- Public app link
- Public GitHub repository
- Short explanation of the product
- At least one real feedback submission made with the tool
- Demo video under 3 minutes uploaded to Walrus
- Screenshot or thread showing the product
- Sui transaction digest and Walrus blob links available in the app

## Notes

- The dashboard is designed to lazy-load Walrus details for speed.
- Profile and social settings are local browser data for this demo.
- Text/private answers can use Seal encryption.
- Media files are stored on Walrus for preview and download.
- Anti-duplicate rules are enforced by normalized wallet and email per form.
