# SealedSurvey 🔒

Private feedback platform built on Walrus decentralized storage with optional Seal encryption.

## Tech stack

- **Next.js 15** (App Router, TypeScript)
- **Walrus Testnet** — decentralized blob storage for all form schemas + submissions
- **Seal Protocol** — end-to-end encryption for sensitive submissions
- **Tailwind CSS** — styling
- **Sui / @mysten/walrus** — on-chain integration

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Run dev server
npm run dev

# 3. Open http://localhost:3000
```

## Walrus endpoints (testnet)

| Service    | URL                                                        |
|------------|------------------------------------------------------------|
| Publisher  | https://publisher.walrus-testnet.walrus.space              |
| Aggregator | https://aggregator.walrus-testnet.walrus.space             |
| Upload relay | https://upload-relay.testnet.walrus.space               |

Wallet uploads use `@mysten/walrus` with the Testnet fan-out upload relay.
If the wallet has SUI but not enough WAL, the app falls back to the Testnet publisher for demo continuity. Downloads use the Walrus SDK first, then the aggregator as fallback.

## How it works

1. **Create a form** in `/builder` → form schema uploaded to Walrus → returns a `blobId`
2. **Share the link** → `/form/{alias}--{blobId}` — anyone with the link can submit
3. **Submit** → answers uploaded to Walrus; private fields are Seal-encrypted when Seal env is configured
4. **Dashboard** → `/dashboard` loads submissions from the Sui registry when configured, otherwise local fallback data

## Seal IBE setup

The app already includes `@mysten/dapp-kit` wallet connect and `@mysten/seal` encryption/decryption wiring. To enable full Seal IBE on Testnet:

1. Deploy the Move package that contains `submission_registry::seal_approve`.

```bash
cd move/submission_registry
sui move build
sui client publish
```

2. Copy the published package ID into `.env.local`.

```env
NEXT_PUBLIC_SUI_PACKAGE_ID=0xYOUR_PUBLISHED_PACKAGE_ID
NEXT_PUBLIC_REGISTRY_ID=0xYOUR_SHARED_REGISTRY_OBJECT_ID
NEXT_PUBLIC_SEAL_APPROVE_TARGET=0xYOUR_PUBLISHED_PACKAGE_ID::submission_registry::seal_approve
```

3. Use the verified decentralized Testnet key server from Seal docs.

```env
NEXT_PUBLIC_SEAL_KEY_SERVERS=0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98|1|https://seal-aggregator-testnet.mystenlabs.com
NEXT_PUBLIC_SEAL_THRESHOLD=1
```

The demo `seal_approve` function currently approves any caller. Replace it with admin role checks before production use.

## Project structure

```
app/
  page.tsx          # Home / landing
  builder/          # Form builder
  dashboard/        # Admin dashboard
  form/[slug]/      # Public form page
  receipt/[blobId]/ # Respondent receipt page
components/
  ui/               # Navbar, WalrusStatusBadge
lib/
  walrus/           # Walrus SDK client, publisher fallback, upload/read helpers
  seal.ts           # Seal encryption helpers and key server config
  forms.ts          # saveForm, loadAllForms, saveSubmission, loadAllSubmissions, submissionsToCSV
  useWalrusUpload.ts # React hook for upload state
move/
  submission_registry/ # Sui Move registry + seal_approve policy package
types/
  index.ts          # FormField, FormSchema, FormSubmission types
```

## Next steps

- [ ] Publish `move/submission_registry` to Testnet
- [ ] Replace demo `seal_approve` with production admin/role checks
- [ ] Configure Sui registry env for global submission discovery
- [ ] Run end-to-end Seal encrypt/decrypt demo with a real wallet
