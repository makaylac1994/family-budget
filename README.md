# Family Budget

A React budgeting app (dashboard, ledger, accounts, budgets, savings buckets, recurring bills), synced across devices via Firebase, with real per-family-member login and optional bank connections via Plaid.

## Run it locally
```
npm install
npm run dev
```

## Deploy the frontend (GitHub Pages)
Push to `main` — GitHub Actions builds and publishes automatically.

## Deploy the backend (Cloud Functions, for Plaid)
Requires the Firebase CLI and your project on the Blaze plan.
```
npm install -g firebase-tools
firebase login
firebase functions:secrets:set PLAID_CLIENT_ID
firebase functions:secrets:set PLAID_SECRET
firebase deploy --only functions
firebase deploy --only firestore:rules
```
`functions/index.js` is set to Plaid's `production` environment, which is what Plaid's free plan actually uses for real (but limited) bank connections — Plaid's `sandbox` environment is fake test banks only, for development. If you ever want to test changes without touching real accounts, temporarily set `PLAID_ENV` to `'sandbox'` in `functions/index.js`, then switch it back to `'production'` before redeploying for real use.
