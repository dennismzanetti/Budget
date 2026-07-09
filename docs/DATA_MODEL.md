# Budget App — Data Model

All user data lives under a single Firestore path:

```
users/{userId}/
```

Every sub-collection or document below is scoped to the authenticated user's UID.

---

## Collections & Documents

### `users/{userId}` — Profile Document

A **single document** created on first sign-in via Google Auth.

| Field | Type | Description |
|---|---|---|
| `uid` | `string` | Firebase Auth UID |
| `displayName` | `string` | From Google Auth |
| `email` | `string` | From Google Auth |
| `photoURL` | `string` | Google profile photo URL |
| `createdAt` | `timestamp` | `serverTimestamp()` on first login |
| `lastLoginAt` | `timestamp` | Updated on every login |

---

### `users/{userId}/accounts/{accountId}` — Accounts

Represents a financial account (bank, credit card, cash, etc.).

| Field | Type | Description |
|---|---|---|
| `name` | `string` | e.g. "Chase Checking" |
| `type` | `string` | `checking` \| `savings` \| `credit` \| `cash` \| `investment` |
| `institution` | `string` | Bank or institution name |
| `balanceCents` | `number` | Current balance in **integer cents** (avoids float errors) |
| `currency` | `string` | ISO 4217 code, default `"USD"` |
| `isActive` | `boolean` | Soft-delete flag; `false` = archived |
| `createdAt` | `timestamp` | `serverTimestamp()` |
| `updatedAt` | `timestamp` | `serverTimestamp()` on every write |

---

### `users/{userId}/categories/{categoryId}` — Categories

Income and expense categories. Supports one level of subcategories via `parentId`.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | e.g. "Groceries" |
| `type` | `string` | `income` \| `expense` |
| `parentId` | `string \| null` | ID of parent category, or `null` for top-level |
| `icon` | `string` | Lucide icon name (e.g. `"shopping-cart"`) |
| `color` | `string` | Hex color for charts (e.g. `"#01696f"`) |
| `isActive` | `boolean` | Soft-delete flag |
| `createdAt` | `timestamp` | `serverTimestamp()` |

---

### `users/{userId}/transactions/{transactionId}` — Transactions

Core financial record. Each row is one debit, credit, or transfer leg.

| Field | Type | Description |
|---|---|---|
| `date` | `timestamp` | Transaction date (user-selected or parsed from import) |
| `amountCents` | `number` | Amount in **integer cents**; always positive |
| `type` | `string` | `income` \| `expense` \| `transfer` |
| `accountId` | `string` | Reference to `accounts/{accountId}` |
| `categoryId` | `string \| null` | Reference to `categories/{categoryId}`; `null` until categorized |
| `payee` | `string` | Merchant or payee name |
| `notes` | `string` | Optional free-text memo |
| `transferGroupId` | `string \| null` | Shared ID linking the two legs of a transfer |
| `isCleared` | `boolean` | Reconciliation flag |
| `isActive` | `boolean` | Soft-delete flag |
| `source` | `string \| null` | Import source identifier: `"bofa_csv"` for BofA imports, `null` for manual entries |
| `sourceId` | `string \| null` | Deduplication key for imported rows (see Import section); `null` for manual entries |
| `createdAt` | `timestamp` | `serverTimestamp()` |
| `updatedAt` | `timestamp` | `serverTimestamp()` on every write |

> **Transfer rule:** A transfer between two accounts creates **two** transaction documents sharing the same `transferGroupId`. The source account leg is `type: "transfer"` with a negative effect on balance; the destination leg is `type: "transfer"` with a positive effect.

---

### `users/{userId}/budgets/{budgetId}` — Budgets

Monthly spending target per category.

| Field | Type | Description |
|---|---|---|
| `categoryId` | `string` | Reference to `categories/{categoryId}` |
| `month` | `string` | ISO month string `"YYYY-MM"` (e.g. `"2026-07"`) |
| `amountCents` | `number` | Monthly target in **integer cents** |
| `rollover` | `boolean` | Whether unspent balance rolls into next month |
| `createdAt` | `timestamp` | `serverTimestamp()` |
| `updatedAt` | `timestamp` | `serverTimestamp()` on every write |

> **Index required:** Composite index on `categoryId ASC, month DESC` for efficient monthly budget queries.

---

### `users/{userId}/settings` — Settings Document

A **single document** holding user preferences.

| Field | Type | Description |
|---|---|---|
| `currency` | `string` | ISO 4217 code, default `"USD"` |
| `theme` | `string` | `"light"` \| `"dark"` \| `"system"` |
| `startOfMonth` | `number` | Day of month the budget period starts (1–28) |
| `startOfWeek` | `number` | `0` = Sunday, `1` = Monday |
| `updatedAt` | `timestamp` | `serverTimestamp()` on every write |

---

## Conventions

- **All monetary values are stored as integer cents.** Display layer divides by 100. This eliminates floating-point rounding errors.
- **Soft deletes only.** Set `isActive: false` instead of calling `.delete()`. This preserves historical data and makes undo trivial.
- **All timestamps use `serverTimestamp()`.** Never use `Date.now()` or `new Date()` for Firestore writes.
- **IDs are Firestore auto-IDs** (`.doc()` with no argument) unless noted otherwise.

---

## Bank of America CSV Import

BofA checking/savings exports include a 6-line metadata header before the data rows. The actual column header appears on row 7. Credit card exports have a similar header but drop `Running Bal.` and may include a `Reference Number` column (ignored).

### BofA CSV Column Mapping

| BofA Column | Maps To | Notes |
|---|---|---|
| `Date` | `date` | Format `MM/DD/YYYY` — parsed to JS `Date`, stored as Firestore `Timestamp` |
| `Description` | `payee` | Raw merchant string; no enrichment at import time |
| `Amount` | `amountCents` | Negative = expense, Positive = income; multiplied by 100 and rounded |
| `Running Bal.` | _(ignored)_ | Balance is computed from transactions, not stored directly |
| `Reference Number` | _(ignored)_ | Credit card only; not stored |

### Type Derivation

- `Amount < 0` → `type: "expense"`, `amountCents = Math.round(Math.abs(amount) * 100)`
- `Amount > 0` → `type: "income"`, `amountCents = Math.round(amount * 100)`
- `Amount === 0` → row skipped

### Deduplication

Each imported transaction receives a `sourceId` computed as:

```
sourceId = "bofa__" + date_YYYYMMDD + "__" + description_trimmed + "__" + amountCents
```

Before writing, the importer queries:
```js
where("sourceId", "==", sourceId)
```
and skips the row if a matching document already exists. This makes re-importing the same CSV file safe.

### Recommended Additional Index

| Collection | Fields | Order | Purpose |
|---|---|---|---|
| `transactions` | `sourceId` | ASC | Fast deduplication lookup during import |

---

## Firestore Security Rules (Recommended)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## Recommended Composite Indexes

| Collection | Fields | Order | Purpose |
|---|---|---|---|
| `transactions` | `accountId`, `date` | ASC, DESC | Transactions by account, newest first |
| `transactions` | `categoryId`, `date` | ASC, DESC | Transactions by category |
| `transactions` | `date`, `type` | DESC, ASC | Filtered transaction list |
| `transactions` | `sourceId` | ASC | Import deduplication lookup |
| `budgets` | `categoryId`, `month` | ASC, DESC | Monthly budget lookup |
