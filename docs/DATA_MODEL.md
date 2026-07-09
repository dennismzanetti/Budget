# Budget App — Firestore Data Model

## Overview

All data is stored in **Cloud Firestore** and scoped under a top-level `users` collection. Every authenticated user owns a single document at `users/{uid}`, with subcollections beneath it for accounts, budget categories, and transactions. This structure ensures Firestore security rules are simple and each user's data is fully isolated.

```
users/{uid}
  ├── (profile fields on document)
  ├── accounts/{accountId}
  ├── budgetCategories/{categoryId}
  └── transactions/{transactionId}
```

---

## Collections

### `users/{uid}` — User Profile

Stored directly on the user document. Written on first login and updated from the Settings page.

| Field | Type | Description |
|---|---|---|
| `displayName` | `string` | User's full name from Google Auth |
| `email` | `string` | User's email address |
| `photoURL` | `string` | Profile photo URL from Google Auth |
| `currency` | `string` | ISO 4217 code, e.g. `"USD"` |
| `theme` | `string` | `"light"` or `"dark"` |
| `createdAt` | `Timestamp` | Account creation time |
| `updatedAt` | `Timestamp` | Last profile update time |

---

### `users/{uid}/accounts/{accountId}` — Financial Accounts

Represents a bank account, credit card, or cash account. Balances are entered manually. Used on the **Accounts** and **Dashboard** pages.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Display name, e.g. `"Chase Checking"` |
| `type` | `string` | `checking` \| `savings` \| `credit` \| `investment` \| `cash` |
| `institution` | `string` | Optional bank or institution name |
| `balance` | `number` | Current balance (positive or negative) |
| `currency` | `string` | ISO 4217 code, e.g. `"USD"` |
| `color` | `string` | Hex color for UI card, e.g. `"#0f766e"` |
| `isActive` | `boolean` | `false` hides the account without deleting it |
| `createdAt` | `Timestamp` | Document creation time |
| `updatedAt` | `Timestamp` | Last update time |

**Example document:**
```json
{
  "name": "Chase Checking",
  "type": "checking",
  "institution": "Chase",
  "balance": 4250.00,
  "currency": "USD",
  "color": "#0f766e",
  "isActive": true,
  "createdAt": "2026-01-15T00:00:00Z",
  "updatedAt": "2026-07-01T00:00:00Z"
}
```

---

### `users/{uid}/budgetCategories/{categoryId}` — Budget Categories

Defines spending/income categories and their monthly targets. Used on the **Budget**, **Transactions**, and **Reports** pages.

> **Important:** Monthly *spent* amounts are **not stored** on the category. They are computed at runtime by summing transactions for the current month with a matching `categoryId`. This avoids synchronization bugs between transactions and category totals.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Display name, e.g. `"Groceries"` |
| `icon` | `string` | Emoji or icon identifier, e.g. `"🛒"` |
| `monthlyLimit` | `number` | Target spending cap for the month |
| `type` | `string` | `expense` \| `income` \| `savings` |
| `color` | `string` | Hex color for charts and badges |
| `sortOrder` | `number` | Integer for manual display ordering |
| `isActive` | `boolean` | `false` hides the category without deleting it |
| `createdAt` | `Timestamp` | Document creation time |
| `updatedAt` | `Timestamp` | Last update time |

**Example document:**
```json
{
  "name": "Groceries",
  "icon": "🛒",
  "monthlyLimit": 600.00,
  "type": "expense",
  "color": "#5dc1b8",
  "sortOrder": 1,
  "isActive": true,
  "createdAt": "2026-01-15T00:00:00Z",
  "updatedAt": "2026-01-15T00:00:00Z"
}
```

---

### `users/{uid}/transactions/{transactionId}` — Transactions

The core financial record. Each document represents a single expense, income event, or account transfer. Used on **Transactions**, **Budget**, **Dashboard**, and **Reports** pages.

| Field | Type | Description |
|---|---|---|
| `accountId` | `string` | Reference to `accounts/{accountId}` |
| `categoryId` | `string` | Reference to `budgetCategories/{categoryId}` |
| `amount` | `number` | **Negative = expense**, positive = income |
| `description` | `string` | Merchant name or short description |
| `date` | `Timestamp` | The transaction date (not the write time) |
| `type` | `string` | `expense` \| `income` \| `transfer` |
| `transferToAccountId` | `string\|null` | Destination account ID for `transfer` type only |
| `isRecurring` | `boolean` | Flags the transaction as a recurring entry |
| `notes` | `string` | Optional freeform user notes |
| `createdAt` | `Timestamp` | Document creation time |
| `updatedAt` | `Timestamp` | Last update time |

**Amount convention:** Using signed numbers (negative for expenses) makes reporting arithmetic trivial — summing all amounts for a period yields net cash flow directly.

**Example document:**
```json
{
  "accountId": "abc123",
  "categoryId": "xyz789",
  "amount": -52.34,
  "description": "Stop & Shop",
  "date": "2026-07-08T00:00:00Z",
  "type": "expense",
  "transferToAccountId": null,
  "isRecurring": false,
  "notes": "",
  "createdAt": "2026-07-08T10:30:00Z",
  "updatedAt": "2026-07-08T10:30:00Z"
}
```

---

## Relationships

```
users/{uid}
    │
    ├── accounts/{accountId}  ◄──────────────────────┐
    │                                                  │ accountId (FK)
    ├── transactions/{transactionId} ─────────────────┤
    │                                                  │ categoryId (FK)
    └── budgetCategories/{categoryId}  ◄──────────────┘
```

Both `accountId` and `categoryId` on a transaction are soft foreign keys — Firestore does not enforce referential integrity, so the application layer must handle orphaned references (e.g., when an account or category is deleted or deactivated).

---

## Page → Collection Mapping

| Page | Collections Read | Key Query Pattern |
|---|---|---|
| **Dashboard** | `accounts`, `transactions`, `budgetCategories` | Last 30 days of transactions; all active accounts |
| **Budget** | `budgetCategories`, `transactions` | Sum `amount` grouped by `categoryId` for current month |
| **Transactions** | `transactions`, `accounts`, `budgetCategories` | Filter by `date` range; optionally by `categoryId` or `accountId` |
| **Accounts** | `accounts` | All documents where `isActive == true` |
| **Reports** | `transactions`, `budgetCategories` | Group and sum by month and category over a date range |
| **Settings** | `users/{uid}` | Read and write the top-level user profile document |

---

## Recommended Firestore Indexes

Firestore requires composite indexes for multi-field queries. The following indexes should be created in the Firebase Console or `firestore.indexes.json`:

| Collection | Fields | Query Use Case |
|---|---|---|
| `transactions` | `date ASC`, `__name__ ASC` | Date-range queries (monthly filter) |
| `transactions` | `categoryId ASC`, `date ASC` | Budget page: sum by category for a month |
| `transactions` | `accountId ASC`, `date ASC` | Account detail: transactions for one account |
| `transactions` | `type ASC`, `date ASC` | Filter by transaction type |
| `budgetCategories` | `isActive ASC`, `sortOrder ASC` | Budget page: ordered active categories |

---

## Security Rules

All subcollections are protected by a single rule: a user may only read or write documents scoped to their own `uid`.

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

---

## Design Decisions

- **No separate monthly budget documents.** The `monthlyLimit` field lives on the category itself. If per-month budget overrides are needed in the future, a `budgetOverrides/{year_month}` subcollection can be added under each category without breaking existing queries.
- **Negative amounts for expenses.** A single `amount` field with sign convention (negative = outflow, positive = inflow) means net cash flow for any period is `sum(amount)` — no separate debit/credit fields needed.
- **`isActive` instead of deleting.** Accounts and categories are never hard-deleted; they are set to `isActive: false`. This preserves historical transaction references and avoids orphaned data.
- **`transferToAccountId` on transactions.** Transfer transactions debit one account and credit another. Storing the destination account ID on the transaction avoids needing a separate transfer collection while keeping both sides queryable.
