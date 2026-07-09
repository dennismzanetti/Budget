# Budget App — Data Model

## Overview

The Budget app uses **Cloud Firestore** (Firebase project: `budget-2d6a0`) as its backend database. All data is scoped per authenticated user via Google Sign-In. The top-level Firestore structure follows a `users/{userId}/...` hierarchy so each user's data is fully isolated.

---

## Firestore Collection Structure

```
users/
  {userId}/
    profile/          ← single document with user metadata
    accounts/         ← bank/credit/cash accounts
    categories/       ← budget categories (income & expense)
    transactions/     ← individual financial transactions
    budgets/          ← monthly budget targets per category
    settings/         ← user preferences and app configuration
```

---

## Document Schemas

### `users/{userId}/profile`

A single document storing the user's profile, synced from Google Auth on first login.

| Field | Type | Description |
|-------|------|-------------|
| `uid` | `string` | Firebase Auth UID |
| `displayName` | `string` | Google display name |
| `email` | `string` | Google account email |
| `photoURL` | `string` | Google profile photo URL |
| `createdAt` | `timestamp` | Account creation date |
| `lastLoginAt` | `timestamp` | Most recent sign-in |

---

### `users/{userId}/accounts/{accountId}`

Represents a financial account (checking, savings, credit card, cash, etc.).

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Auto-generated document ID |
| `name` | `string` | Account name (e.g., "Chase Checking") |
| `type` | `string` | `checking` \| `savings` \| `credit` \| `cash` \| `investment` |
| `institution` | `string` | Bank or institution name |
| `balance` | `number` | Current balance in cents (avoids float rounding) |
| `currency` | `string` | ISO 4217 currency code (default: `"USD"`) |
| `isActive` | `boolean` | Whether the account is visible/active |
| `createdAt` | `timestamp` | When the account was added |
| `updatedAt` | `timestamp` | Last modification time |

**Notes:**
- Balances are stored as **integer cents** (e.g., `$12.50` → `1250`) to avoid floating-point precision issues.
- Credit accounts: `balance` represents the amount owed (positive = debt).

---

### `users/{userId}/categories/{categoryId}`

Budget categories for classifying transactions.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Auto-generated document ID |
| `name` | `string` | Category name (e.g., "Groceries") |
| `type` | `string` | `income` \| `expense` |
| `icon` | `string` | Lucide icon name (e.g., `"shopping-cart"`) |
| `color` | `string` | Hex color code for UI display |
| `parentId` | `string \| null` | ID of parent category (null = top-level) |
| `isDefault` | `boolean` | Whether this is a system-provided default category |
| `isActive` | `boolean` | Whether the category is available for use |
| `createdAt` | `timestamp` | Creation time |

**Default Categories (seeded on first login):**

*Expense:* Housing, Groceries, Dining, Transportation, Utilities, Healthcare, Entertainment, Clothing, Personal Care, Education, Savings, Miscellaneous

*Income:* Salary, Freelance, Investment, Gift, Other Income

---

### `users/{userId}/transactions/{transactionId}`

Individual financial transactions — the core data entity.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Auto-generated document ID |
| `accountId` | `string` | Reference to `accounts/{accountId}` |
| `categoryId` | `string` | Reference to `categories/{categoryId}` |
| `type` | `string` | `income` \| `expense` \| `transfer` |
| `amount` | `number` | Transaction amount in cents (always positive) |
| `description` | `string` | User-provided note or merchant name |
| `date` | `timestamp` | Transaction date (not necessarily entry date) |
| `payee` | `string \| null` | Payee or payer name |
| `isRecurring` | `boolean` | Whether this is part of a recurring series |
| `recurringId` | `string \| null` | ID linking to a recurring rule (future feature) |
| `transferGroupId` | `string \| null` | Links the two sides of a transfer together |
| `tags` | `array<string>` | Optional user-defined tags |
| `createdAt` | `timestamp` | When the record was created |
| `updatedAt` | `timestamp` | Last modification time |

**Transfer transactions:**
A transfer between accounts creates **two** transaction documents:
- One `expense` from the source account
- One `income` on the destination account
- Both share a common `transferGroupId` field to link them.

---

### `users/{userId}/budgets/{budgetId}`

Monthly budget targets for a category.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Auto-generated document ID |
| `categoryId` | `string` | Reference to `categories/{categoryId}` |
| `month` | `string` | Budget period in `YYYY-MM` format (e.g., `"2026-07"`) |
| `targetAmount` | `number` | Budgeted amount in cents |
| `rollover` | `boolean` | Whether unspent funds roll over to next month |
| `createdAt` | `timestamp` | Creation time |
| `updatedAt` | `timestamp` | Last modification time |

**Querying pattern:** To load all budgets for a given month, query with `where("month", "==", "2026-07")`.

---

### `users/{userId}/settings`

A single document storing user preferences.

| Field | Type | Description |
|-------|------|-------------|
| `theme` | `string` | `"light"` \| `"dark"` \| `"system"` |
| `currency` | `string` | Default ISO 4217 currency code (e.g., `"USD"`) |
| `startOfMonth` | `number` | Day of month budget periods start (default: `1`) |
| `defaultAccountId` | `string \| null` | Pre-selected account for new transactions |
| `notifications` | `boolean` | Whether to enable budget alert notifications |
| `updatedAt` | `timestamp` | Last settings update |

---

## Relationships Diagram

```
users/{userId}
│
├── profile (1 doc)
│
├── accounts (collection)
│       └── {accountId}
│
├── categories (collection)
│       └── {categoryId}
│               └── parentId → {categoryId}  (self-reference for subcategories)
│
├── transactions (collection)
│       └── {transactionId}
│               ├── accountId  → accounts/{accountId}
│               └── categoryId → categories/{categoryId}
│
├── budgets (collection)
│       └── {budgetId}
│               └── categoryId → categories/{categoryId}
│
└── settings (1 doc)
```

---

## Firestore Security Rules (Recommended)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## Indexing Recommendations

Firestore requires composite indexes for multi-field queries. Create the following in the Firebase console:

| Collection | Fields | Order | Purpose |
|------------|--------|-------|---------|
| `transactions` | `accountId`, `date` | `date DESC` | Transactions by account, sorted by date |
| `transactions` | `categoryId`, `date` | `date DESC` | Transactions by category, sorted by date |
| `transactions` | `type`, `date` | `date DESC` | Income vs. expense reports |
| `budgets` | `month`, `categoryId` | — | Budget lookup by period |

---

## Conventions

- **Timestamps:** All `timestamp` fields use Firestore `serverTimestamp()` on create/update — never client-side `Date.now()`.
- **Amounts:** All monetary values stored as **integer cents**. Display layer divides by 100. This prevents floating-point rounding errors.
- **Soft deletes:** Records are never hard-deleted. Use `isActive: false` to hide without data loss.
- **IDs:** All document IDs are Firestore auto-generated unless noted otherwise.
