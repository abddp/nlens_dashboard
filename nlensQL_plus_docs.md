# Nealens Internal Analytics Query API (`nlensql_plus` v1)

> **Audience:** External backend developers, dashboard engineers, data scientists, ETL pipelines, and BI tools.  
> **Purpose:** Query, aggregate, and cross-reference multi-tenant SaaS data from a single high-performance analytical endpoint without direct database access.

---

## 1. Overview & Authentication

The `nlensql_plus` engine provides a structured, SQL-like query language executed server-side across Nealens platform data. It removes the need to fetch large JSON collections over REST or perform client-side filtering.

### Endpoint URL
```http
POST https://<YOUR_SAAS_DOMAIN>/api/internal/v1/nlensql-plus/
```

### Authentication Headers
Every request must include the secret internal service key in the headers:

```http
X-Internal-Service-Key: <YOUR_NLENS_INTERNAL_API_KEY>
Content-Type: application/json
```

---

## 2. Request & Response Format

### Request Payload
Requests take a JSON object with a single mandatory string field `"query"`:

```json
{
  "query": "FROM shops SELECT sector, COUNT(*) AS total, RATE(on_trial, id) AS trial_pct GROUP BY sector ORDER BY total DESC"
}
```

### Success Response (`200 OK`)
```json
{
  "resource": "shops",
  "count": 3,
  "fields": ["sector", "total", "trial_pct"],
  "includes": [],
  "data": [
    {
      "sector": "fashion_apparel",
      "total": 142,
      "trial_pct": 34.5
    },
    {
      "sector": "beauty_personal_care",
      "total": 98,
      "trial_pct": 28.0
    },
    {
      "sector": "electronics_gadgets",
      "total": 45,
      "trial_pct": 12.2
    }
  ]
}
```

#### Response Structure Dissected:
| Field | Type | Description |
|---|---|---|
| `resource` | `string` | The primary resource queried (e.g. `"shops"`). |
| `count` | `integer` | Total number of row items in `data`. |
| `fields` | `array[string]` | All scalar and aggregate column names returned in each row. |
| `includes` | `array[string]` | List of relational object keys attached to each row via `INCLUDE`. |
| `data` | `array[object]` | Array of row records matching the requested fields and relations. |

### Error Response (`400 Bad Request` or `500 Internal Server Error`)
```json
{
  "error": "Field 'unknown_col' is not allowed on resource 'shops'",
  "error_type": "NlensQLPlusFieldError"
}
```

#### Error Types:
- `NlensQLPlusSyntaxError`: Malformed query, invalid clause ordering, or missing arguments.
- `NlensQLPlusResourceError`: Unknown resource name in `FROM`.
- `NlensQLPlusFieldError`: Unrecognized or forbidden field in `SELECT`, `WHERE`, `GROUP BY`, or `ORDER BY`.
- `NlensQLPlusRelationError`: Unrecognized relation name in `INCLUDE`.
- `NlensQLPlusAggregationError`: Non-aggregatable field used in an aggregate function.

---

## 3. Query Language Grammar & Canonical Ordering

A query **must always begin with `FROM <resource>`**. Clauses should follow in the canonical order below:

```sql
FROM <resource>
  [SELECT <field|aggregate> [AS <alias>], ...]
  [INCLUDE <relation>, ...]
  [WHERE <condition> [AND|OR <condition>...]]
  [GROUP BY <field>, ...]
  [ORDER BY <field|alias> [ASC|DESC]]
  [LIMIT <integer>]
  [SINCE <date_string> [UNTIL <date_string>]]
```

### Clause Reference:
| Clause | Required? | Purpose | Example |
|---|---|---|---|
| `FROM` | **Yes** | Target resource table (must be first). | `FROM shops` |
| `SELECT` | Optional | Fields and aggregates to project. Defaults to all basic fields. | `SELECT id, name, COUNT(*) AS total` |
| `INCLUDE` | Optional | Eager-loads and embeds related objects (1-to-1 or 1-to-many). For non-grouped queries. | `INCLUDE owner, subscriptions` |
| `WHERE` | Optional | Filters records using boolean logic, operators, and subqueries. | `WHERE is_active = true AND on_trial = false` |
| `GROUP BY`| Optional | Groups records for aggregate calculations. | `GROUP BY sector, country__code` |
| `ORDER BY`| Optional | Sorts results. Accepts sortable fields or aggregate aliases. | `ORDER BY total DESC` |
| `LIMIT` | Optional | Caps the returned rows. Default fallback is 10,000 if omitted. | `LIMIT 50` |
| `SINCE`/`UNTIL`| Optional | Date range filter on the resource's primary date column. | `SINCE 2026-01-01 UNTIL 2026-06-30` |

---

## 4. Key Semantics, Formulas & In-Depth Rules

### 4.1 Terminology: `Shop` vs `Store`
> [!NOTE]
> In the Nealens database, **"Shop"** and **"Store"** refer to the **exact same entity** (a merchant boutique).  
> - The primary resource is `shops` (with primary key `id`).  
> - Related resources reference it via `store_id` (in `billing_transactions`, `billing_subscriptions`, `ai_credit_usages`, `ai_request_categories`) or `shop_id` (in `user_session_events`, `feedbacks`).  
> - All `store_id` and `shop_id` foreign keys map directly to `shops.id`.

---

### 4.2 Aggregate Functions & Math Formulas

| Function | Signature | Mathematical Definition / Behavior |
|---|---|---|
| `COUNT` | `COUNT(*)` or `COUNT(field)` or `COUNT(DISTINCT field)` | Returns row count or non-null distinct count. |
| `SUM` | `SUM(numeric_or_bool_field)` | Sum of values. If applied to a boolean, automatically casts `true=1, false=0` and returns the count of `true` records. |
| `AVG` | `AVG(numeric_or_bool_field)` | Arithmetic mean. If applied to a boolean, returns the ratio between `0.0` and `1.0` (e.g. `0.42` for 42% true). |
| `MIN` / `MAX` | `MIN(field)` / `MAX(field)` | Minimum or maximum value. For booleans, returns `false` or `true`. |
| `MEDIAN` | `MEDIAN(numeric_field)` | Computes the median (50th percentile) of numeric values. |
| `RATE` | `RATE(numerator, denominator)` | Computes a **percentage (0.0 to 100.0)**: $$\text{RATE}(a, b) = \frac{\sum a}{\text{DENOM}} \times 100.0$$ <br>• **Numerator $a$**: Can be a boolean field (e.g. `on_trial`, `onboarding_completed`) or a numeric field. Boolean fields are automatically cast to integer (`true=1, false=0`).<br>• **Denominator $b$**: If $b$ is `id` or a non-numeric field, $\text{DENOM} = \text{COUNT}(b)$. If $b$ is numeric, $\text{DENOM} = \text{SUM}(b)$.<br>• Safe from division by zero (returns `null` if denominator is 0). |
| `RATIO` | `RATIO(field1, field2)` | Computes an **average per distinct entity**: $$\text{RATIO}(a, b) = \frac{\sum a}{\text{COUNT}(\text{DISTINCT } b)}$$ <br>• Safe from division by zero (returns `null` if distinct count is 0). |

#### RATE & RATIO Concrete Examples:
- **Conversion / Onboarding Percentage (Boolean Numerator):**
  ```sql
  -- Computes: (SUM(onboarding_completed) * 100.0) / COUNT(id)
  FROM shops SELECT sector, RATE(onboarding_completed, id) AS onboarding_pct GROUP BY sector
  ```
- **Financial Refund Rate (Numeric Numerator & Denominator):**
  ```sql
  -- Computes: (SUM(refunded_amount) * 100.0) / SUM(total_amount)
  FROM billing_transactions SELECT RATE(refunded_amount, amount) AS refund_pct
  ```
- **Average Tokens Consumed Per Active Store:**
  ```sql
  -- Computes: SUM(total_tokens) / COUNT(DISTINCT store_id)
  FROM ai_credit_usages SELECT RATIO(total_tokens, store_id) AS avg_tokens_per_store
  ```

---

### 4.3 Pattern Matching (`LIKE` Operator)
> [!IMPORTANT]
> In `nlensql_plus`, `LIKE` performs a **case-insensitive substring match** (`contains`).  
> **Do NOT use SQL `%` wildcards** unless you literally want to search for the percent character.
>
> - `WHERE name LIKE "shoes"` $\rightarrow$ matches `"Nike Shoes"`, `"Shoes Outlet"`, `"running_shoes"`.
> - `WHERE email LIKE "gmail.com"` $\rightarrow$ matches any email containing `"gmail.com"`.

---

### 4.4 Date Filtering, `__date` Suffix & Time Zones

#### 1. Time Zone Reference
All timestamps across Nealens databases are stored in **UTC** (`YYYY-MM-DD HH:MM:SS+00`). Date truncation and comparison operate on UTC time.

#### 2. The `__date` Suffix
You can append `__date` to any datetime field in `SELECT`, `WHERE`, and `GROUP BY`:
- **In `WHERE`:** `WHERE created_at__date = "2026-09-01"` or `WHERE created_at__date >= "2026-01-01"` filters strictly by the calendar day.
- **In `GROUP BY` & `SELECT`:** `GROUP BY created_at__date` groups records into daily buckets (`YYYY-MM-DD`).

> [!NOTE]
> Only the `__date` suffix is supported (e.g. `created_at__date`, `joined_on__date`, `started_at__date`). Other suffixes like `__month` or `__week` are not supported.

#### 3. Primary Date Column (`SINCE` / `UNTIL`)
`SINCE "YYYY-MM-DD"` and `UNTIL "YYYY-MM-DD"` filter inclusive date boundaries (`>=` and `<=`) directly on the resource's primary date column:
- `shops`: `created_on >= SINCE` and `created_on <= UNTIL`
- `users`: `joined_on >= SINCE` and `joined_on <= UNTIL`
- `user_sessions`: `started_at >= SINCE` and `started_at <= UNTIL`
- `user_session_events`, `billing_transactions`, `billing_subscriptions`, `ai_credit_usages`, `ai_request_categories`, `feedbacks`, `feedback_attachments`: `created_at >= SINCE` and `created_at <= UNTIL`

#### 4. Interaction between `SINCE`/`UNTIL` and explicit `WHERE`
`SINCE`/`UNTIL` and `WHERE` conditions **combine via logical AND** (they do not override each other).
```sql
-- Filters for: status = "paid" AND created_at >= "2026-01-01" AND created_at__date >= "2026-06-01"
FROM billing_transactions
  SELECT SUM(amount) AS revenue
  WHERE status = "paid" AND created_at >= "2026-01-01"
  SINCE 2026-06-01
```

---

### 4.5 Subqueries in `WHERE <field> IN (...)`

Subqueries are supported exclusively inside `WHERE <field> IN (<subquery>)`:

#### Grammar:
```sql
WHERE <field> IN (FROM <subquery_resource> SELECT <subquery_field> [WHERE <subquery_condition>])
```

#### Rules & Limitations:
1. **Single Projected Field:** The subquery must select exactly one field (e.g. `SELECT id`).
2. **Own `WHERE` Clause:** The subquery can have its own `WHERE` filters with full boolean logic (`AND`, `OR`, `LIKE`, `=`, etc.).
3. **Nesting:** Subqueries can be nested inside the `WHERE` of another subquery.
4. **Forbidden Clauses in Subqueries:** Subqueries cannot contain `GROUP BY`, `ORDER BY`, `LIMIT`, `INCLUDE`, or `SINCE`/`UNTIL`.

#### Example:
```sql
-- Find total revenue from stores currently on trial
FROM billing_transactions
  SELECT SUM(amount) AS trial_revenue
  WHERE status = "paid"
    AND store_id IN (FROM shops SELECT id WHERE on_trial = true)
```

---

### 4.6 `GROUP BY` & `INCLUDE` Interactions

1. **`INCLUDE` with `GROUP BY`:**  
   `GROUP BY` produces aggregated summary buckets, not individual model instances. Therefore, `INCLUDE` is designed for **non-grouped queries** (e.g. `FROM shops SELECT id, name INCLUDE owner`). If `INCLUDE` is passed with `GROUP BY`, the relations cannot attach to summary buckets and are omitted from the row output.

2. **Selecting Non-Grouped Fields in `GROUP BY`:**  
   When `GROUP BY` is present, `SELECT` should only include fields listed in `GROUP BY` and aggregate functions. If a scalar field is not in `GROUP BY` and not aggregated, it is excluded from the returned row data.

---

### 4.7 Result Limits & Pagination Strategy

- **Default & Fallback Limit:** If `LIMIT` is omitted, the engine applies a default safety cap of **10,000 rows** (`HARD_LIMIT = 10,000`).
- **Explicit `LIMIT`:** When specified (`LIMIT 50`), returns up to 50 rows.
- **Pagination Strategy:**  
  `nlensql_plus` is an analytical query engine (focused on aggregations, KPIs, and top-N lists) and does not support an `OFFSET` keyword. For progressive data retrieval beyond 10,000 records, use **keyset range pagination**:
  ```sql
  -- Page 1:
  FROM shops SELECT id, name, created_on ORDER BY id ASC LIMIT 5000
  -- Page 2 (pass last seen ID):
  FROM shops SELECT id, name, created_on WHERE id > 5000 ORDER BY id ASC LIMIT 5000
  ```

---

### 4.8 Logical Operators & Grouping Precedence
- **Supported operators:** `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`, `BETWEEN <val1> AND <val2>`.
- **Connectors:** `AND`, `OR`.
- **Precedence:** `AND` takes precedence over `OR`. Use parentheses `(...)` to define explicit groupings:
  ```sql
  WHERE (is_active = true OR on_trial = true) AND country__code = "US"
  ```

---

## 5. Complete Resource Catalog (10 Resources)

Below is the exhaustive specification of every queryable resource on the SaaS platform.

---

### 5.1 `shops`
Represents customer boutiques/stores created on the Nealens SaaS platform.

- **Primary Date Field:** `created_on`
- **Fields (Direct Columns):**
  - `id` (int, PK)
  - `name` (string) — Store title
  - `phone` (string)
  - `email` (string)
  - `is_active` (boolean) — Is store enabled
  - `free_access` (boolean) — Grandfathered / free access tier
  - `on_trial` (boolean) — Currently in trial period
  - `trial_ended` (boolean) — Is trial period finished/expired
  - `created_on` (datetime)
  - `trial_ends_on` (datetime)
  - `paid_until` (datetime)
  - `monthly_credits` (decimal) — AI credit quota
  - `language` (string) — Available choices:
    - `"fr"` (French)
    - `"en"` (English)
  - `time_zone` (string) — e.g. `"UTC"`, `"Europe/Paris"`, `"America/New_York"`
  - `business_model` (string) — Available choices:
    - `"owned_inventory"` (Owned Inventory)
    - `"dropshipping"` (Dropshipping)
    - `"print_on_demand"` (Print on Demand)
    - `"marketplace"` (Marketplace)
    - `"digital_products"` (Digital Products)
  - `sector` (string) — Available choices:
    - `"general"` (General)
    - `"fashion_apparel"` (Fashion & Apparel)
    - `"beauty_personal_care"` (Beauty & Personal Care)
    - `"health_wellness"` (Health & Wellness)
    - `"electronics_gadgets"` (Electronics & Gadgets)
    - `"home_living"` (Home & Living)
    - `"jewelry_accessories"` (Jewelry & Accessories)
    - `"food_beverage"` (Food & Beverage)
    - `"kids_baby"` (Kids & Baby)
    - `"sports_outdoor"` (Sports & Outdoor)
    - `"automotive_accessories"` (Automotive & Accessories)
    - `"digital_products"` (Digital Products)
    - `"art_crafts_handmade"` (Art, Crafts & Handmade)
    - `"pet_supplies"` (Pet Supplies)
    - `"office_professional"` (Office & Professional Supplies)
    - `"other"` (Other)
  - `onboarding_completed` (boolean)
  - `owner_id` (int, FK $\rightarrow$ `users.id`)
  - `country_id` (int, FK)
  - `tenant_id` (int, FK)
  - `address_id` (int, FK)
  - `country__code` (string) — ISO-2 country code (e.g. `"US"`, `"FR"`)
  - `country__name` (string)
- **Computed Fields (Virtual):**
  - `schema_name` (string) — Store unique system identifier (e.g. `"store_abc"`)
  - `owner_email` (string) — Email address of store owner
  - `country_code` (string) — Store country code
  - `currency` (string) — Store currency code (e.g. `"EUR"`, `"USD"`)
  - `primary_domain` (string) — Custom or primary domain string
  - `subdomain` (string) — Assigned `.nealens.com` subdomain
  - `trial_days_remaining` (int) — Remaining trial days
  - `total_credit_balance` (float) — Live remaining AI credits (total across free, monthly, and top-ups)
  - `total_ai_free_credits` (float) — Live remaining free AI granted credits across all reasons
  - `total_trial_credits` (float) — Live remaining free trial AI credits (reason='free_trial')
- **Aggregatable Fields:** `id`, `monthly_credits`, `is_active`, `free_access`, `on_trial`, `trial_ended`, `onboarding_completed`, `sector`, `business_model`, `language`, `time_zone`, `country__code`, `owner_id`.
- **Sortable Fields:** `id`, `name`, `created_on`, `trial_ends_on`, `paid_until`, `monthly_credits`, `sector`, `business_model`, `onboarding_completed`, `is_active`, `on_trial`, `trial_ended`.
- **Relations Available with `INCLUDE`:**
  - `owner` $\rightarrow$ `{id, email, first_name, last_name, full_name, is_active, joined_on}`
  - `tenant` $\rightarrow$ `{id, schema_name, created_on}`
  - `country` $\rightarrow$ `{id, name, code}`
  - `address` $\rightarrow$ `{id, line1, line2, city, state, postal_code, country_code}`
  - `subscriptions` (array) $\rightarrow$ `[{id, status, stripe_subscription_id, current_period_end}]`
  - `billing_transactions` (array) $\rightarrow$ `[{id, amount, status, type, created_at}]`
  - `ai_credit_usages` (array) $\rightarrow$ `[{id, credits_used, total_tokens, model_name, created_at}]`
  - `ai_free_credit_grants` (array) $\rightarrow$ `[{id, reason, credits_granted, credits_remaining, priority, expires_at, created_at}]`
  - `store_credit_topups` (array) $\rightarrow$ `[{id, credits_purchased, credits_remaining, purchased_at, expires_at}]`
  - `platform_feedbacks` (array) $\rightarrow$ `[{id, feedback_type, title, status, created_at}]`

---

### 5.2 `users`
Registered platform user accounts.

- **Primary Date Field:** `joined_on`
- **Fields:** `id`, `email`, `first_name`, `last_name`, `is_active`, `is_staff`, `is_superuser`, `joined_on`.
- **Computed Fields:** `full_name`, `initial`.
- **Aggregatable Fields:** `id`, `is_active`, `is_staff`, `is_superuser`.
- **Sortable Fields:** `id`, `email`, `first_name`, `last_name`, `is_active`, `is_staff`, `joined_on`.
- **Relations Available with `INCLUDE`:**
  - `sessions` (array) $\rightarrow$ `[{id, session_id, is_active, started_at, active_duration_seconds, ip_address, country_name}]`
  - `session_events` (array) $\rightarrow$ `[{id, event_type, page_type, path, created_at}]`
  - `platform_feedbacks` (array) $\rightarrow$ `[{id, feedback_type, title, status, created_at}]`

---

### 5.3 `user_sessions`
Web analytics and dashboard login sessions.

- **Primary Date Field:** `started_at`
- **Fields:**
  - `id` (int, PK)
  - `session_id` (uuid)
  - `user_id` (int, FK $\rightarrow$ `users.id`)
  - `is_active` (boolean) — Is session active in real time
  - `started_at` (datetime)
  - `last_heartbeat_at` (datetime)
  - `ended_at` (datetime)
  - `active_duration_seconds` (int) — Measured active engagement duration
  - `total_duration_seconds` (int) — Global session span
  - `end_reason` (string) — Available choices:
    - `"logout"` (User logged out)
    - `"timeout"` (Inactivity / 30-min timeout)
    - `"tab_close"` (Browser tab closed)
    - `"new_session"` (New session initiated)
  - `ip_address` (string)
  - `country_code` (string)
  - `country_name` (string)
  - `city` (string)
  - `device_type` (string) — Available choices:
    - `"desktop"`
    - `"mobile"`
    - `"tablet"`
  - `browser` (string)
  - `os` (string)
  - `landing_page` (string)
  - `referrer` (string)
  - `utm_source` (string)
  - `utm_medium` (string)
  - `utm_campaign` (string)
  - `utm_term` (string)
  - `utm_content` (string)
- **Computed Fields:** `current_total_duration_seconds`.
- **Aggregatable Fields:** `id`, `session_id`, `user_id`, `is_active`, `active_duration_seconds`, `total_duration_seconds`, `device_type`, `browser`, `os`, `country_code`, `end_reason`, `utm_source`, `utm_medium`, `utm_campaign`.
- **Sortable Fields:** `id`, `started_at`, `last_heartbeat_at`, `ended_at`, `active_duration_seconds`, `total_duration_seconds`, `country_code`, `device_type`, `is_active`.
- **Relations Available with `INCLUDE`:**
  - `user` $\rightarrow$ `{id, email, full_name, is_active}`
  - `events` (array) $\rightarrow$ `[{id, event_type, actor, page_type, created_at}]`

---

### 5.4 `user_session_events`
Fine-grained clickstream and tracking events inside dashboard sessions.

- **Primary Date Field:** `created_at`
- **Fields:**
  - `id` (int, PK)
  - `session_id` (int, FK $\rightarrow$ `user_sessions.id`)
  - `user_id` (int, FK $\rightarrow$ `users.id`)
  - `shop_id` (int, FK $\rightarrow$ `shops.id`)
  - `actor` (string) — Available choices:
    - `"user"` (Action by human merchant)
    - `"ai_agent"` (Action executed by AI Agent)
    - `"system"` (Automated platform background event)
  - `event_type` (string) — Available choices:
    - *Auth & Navigation (Passive):* `"login"`, `"logout"`, `"signup"`, `"page_view"`, `"switch_store"`
    - *Consultations & Funnel (Passive):* `"see_mockups"`, `"see_storefront_preview"`, `"upgrade_plan_modal_view"`, `"checkout_view"`
    - *System & AI State (Passive):* `"ai_trial_credit_exhausted"`, `"ai_credit_exhausted"`, `"mockups_presented"`
    - *Artificial Intelligence (Active):* `"start_new_ai_chat"`, `"prompt_agent"`, `"buy_ai_credits"`, `"approve_ai_proposal"`, `"approve_all_ai_proposal"`, `"reject_ai_proposal"`, `"reject_all_ai_proposal"`
    - *Catalog & Products (Active):* `"create_product"`, `"edit_product"`, `"delete_product"`, `"create_collection"`, `"edit_collection"`, `"delete_collection"`
    - *Coupons & Customers (Active):* `"create_coupon"`, `"edit_coupon"`, `"delete_coupon"`, `"create_customer"`, `"edit_customer"`, `"delete_customer"`
    - *Orders & Payments (Active):* `"fullfill_order"`, `"cancel_order"`, `"refund_order"`, `"capture_payment"`
    - *Storefront & Design (Active):* `"create_storefront"`, `"edit_storefront"`, `"publish_storefront"`, `"storefront_unpublished"`
    - *Settings & Domain (Active):* `"create_store"`, `"onboarding_completed"`, `"update_store_configuration"`, `"update_nealens_subdomain"`, `"connect_domain"`
    - *Payment Methods (Active):* `"add_payment_method"`, `"update_payment_method"`, `"delete_payment_method"`
    - *Shipping Zones (Active):* `"create_shipping_zone"`, `"edit_shipping_zone"`, `"delete_shipping_zone"`
    - *Business & Feedback (Active):* `"subscribe_to_plan"`, `"submit_feedback"`
  - `page_type` (string) — e.g. `"products"`, `"orders"`, `"ai_chat"`, `"settings"`
  - `page_label` (string)
  - `path` (string)
  - `metadata` (object/json)
  - `created_at` (datetime)
- **Aggregatable Fields:** `id`, `session_id`, `user_id`, `shop_id`, `event_type`, `actor`, `page_type`.
- **Sortable Fields:** `id`, `created_at`, `event_type`, `actor`, `page_type`.
- **Relations Available with `INCLUDE`:**
  - `session` $\rightarrow$ `{id, session_id, device_type, browser, os, is_active}`
  - `user` $\rightarrow$ `{id, email, full_name}`
  - `shop` $\rightarrow$ `{id, name, sector}`

---

### 5.5 `billing_transactions`
Payment records, credit top-ups, and subscription charges.

- **Primary Date Field:** `created_at`
- **Fields:**
  - `id` (int, PK)
  - `store_id` (int, FK $\rightarrow$ `shops.id`)
  - `subscription_id` (int, FK $\rightarrow$ `billing_subscriptions.id`)
  - `type` (string) — Available choices:
    - `"subscription"` (Monthly / Annual recurring subscription fee)
    - `"topup"` (One-time AI credit pack top-up)
  - `status` (string) — Available choices:
    - `"paid"` (Payment captured successfully)
    - `"pending"` (Payment in progress)
    - `"failed"` (Payment attempted and failed)
  - `amount` (decimal) — Transaction amount in EUR/USD
  - `stripe_payment_id` (string)
  - `stripe_checkout_session_id` (string)
  - `created_at` (datetime)
- **Aggregatable Fields:** `id`, `store_id`, `subscription_id`, `type`, `status`, `amount`.
- **Sortable Fields:** `id`, `created_at`, `amount`, `status`, `type`.
- **Relations Available with `INCLUDE`:**
  - `store` $\rightarrow$ `{id, name, email, sector, is_active}`
  - `subscription` $\rightarrow$ `{id, status, stripe_subscription_id, current_period_end}`

---

### 5.6 `billing_subscriptions`
Recurring SaaS plans and Stripe subscriptions.

- **Primary Date Field:** `created_at`
- **Fields:**
  - `id` (int, PK)
  - `store_id` (int, FK $\rightarrow$ `shops.id`)
  - `status` (string) — Available choices:
    - `"active"` (Subscription currently active and in good standing)
    - `"past_due"` (Payment failed, retry grace period)
    - `"canceled"` (Subscription terminated)
  - `stripe_subscription_id` (string)
  - `stripe_customer_id` (string)
  - `current_period_start` (datetime)
  - `current_period_end` (datetime)
  - `canceled_at` (datetime)
  - `cancel_at_period_end` (boolean)
  - `cancel_reason` (string) — Available choices:
    - `"payment_failed"` (Canceled automatically due to payment failure)
    - `"user_request"` (Canceled manually by user request)
  - `cancel_reason_detail` (string)
  - `created_at` (datetime)
- **Aggregatable Fields:** `id`, `store_id`, `status`, `cancel_at_period_end`, `cancel_reason`.
- **Sortable Fields:** `id`, `created_at`, `current_period_start`, `current_period_end`, `canceled_at`, `status`.
- **Relations Available with `INCLUDE`:**
  - `store` $\rightarrow$ `{id, name, email, sector}`
  - `transactions` (array) $\rightarrow$ `[{id, amount, status, type, created_at}]`

---

### 5.7 `ai_credit_usages`
Detailed logs of LLM tokens and AI generation costs consumed per store.

- **Primary Date Field:** `created_at`
- **Fields:** `id`, `store_id` (FK $\rightarrow$ `shops.id`), `chat_id`, `input_tokens`, `cached_tokens`, `output_tokens`, `total_tokens`, `input_items_count`, `output_items_count`, `model_name`, `credits_used`, `created_at`.
- **Aggregatable Fields:** `id`, `store_id`, `input_tokens`, `cached_tokens`, `output_tokens`, `total_tokens`, `input_items_count`, `output_items_count`, `credits_used`, `model_name`.
- **Sortable Fields:** `id`, `created_at`, `credits_used`, `total_tokens`, `model_name`.
- **Relations Available with `INCLUDE`:**
  - `store` $\rightarrow$ `{id, name, sector}`

---

### 5.8 `ai_request_categories`
Categorization of prompt intents and AI tool tasks.

- **Primary Date Field:** `created_at`
- **Fields:** `id`, `store_id` (FK $\rightarrow$ `shops.id`), `chat_id`, `category`, `created_at`.
- **Aggregatable Fields:** `id`, `store_id`, `category`.
- **Sortable Fields:** `id`, `created_at`, `category`.
- **Relations Available with `INCLUDE`:**
  - `store` $\rightarrow$ `{id, name, sector}`

---

### 5.9 `feedbacks`
Merchant user feedback, bug reports, and rating submissions.

- **Primary Date Field:** `created_at`
- **Fields:**
  - `id` (int, PK)
  - `user_id` (int, FK $\rightarrow$ `users.id`)
  - `shop_id` (int, FK $\rightarrow$ `shops.id`)
  - `feedback_type` (string) — Available choices:
    - `"feedback"` (General user feedback / opinion)
    - `"feature"` (Feature request)
    - `"bug"` (Bug report)
  - `title` (string)
  - `message` (string)
  - `page_url` (string)
  - `user_agent` (string)
  - `screen_resolution` (string)
  - `metadata` (object/json)
  - `status` (string) — Available choices:
    - `"pending"` (Submitted, waiting for review)
    - `"in_review"` (Under analysis by engineering team)
    - `"resolved"` (Resolved / Implemented)
    - `"dismissed"` (Closed / Not retained)
  - `admin_notes` (string)
  - `created_at` (datetime)
  - `updated_at` (datetime)
- **Computed Fields:** `attachments_count`.
- **Aggregatable Fields:** `id`, `user_id`, `shop_id`, `feedback_type`, `status`.
- **Sortable Fields:** `id`, `created_at`, `updated_at`, `feedback_type`, `status`.
- **Relations Available with `INCLUDE`:**
  - `user` $\rightarrow$ `{id, email, full_name}`
  - `shop` $\rightarrow$ `{id, name, sector}`
  - `attachments` (array) $\rightarrow$ `[{id, file_url, created_at}]`

---

### 5.10 `feedback_attachments`
Screenshots and log attachments attached to feedback reports.

- **Primary Date Field:** `created_at`
- **Fields:** `id`, `feedback_id`, `created_at`.
- **Computed Fields:** `file_url` (Public URL to download/view the attachment).
- **Aggregatable Fields:** `id`, `feedback_id`.
- **Sortable Fields:** `id`, `created_at`.
- **Relations Available with `INCLUDE`:**
  - `feedback` $\rightarrow$ `{id, feedback_type, title, status}`

---

### 5.11 `store_credit_topups`
Paid top-up credit packs purchased by merchants (1-year validity).

- **Primary Date Field:** `purchased_at`
- **Fields:** `id`, `store_id` (FK $\rightarrow$ `shops.id`), `transaction_id` (FK $\rightarrow$ `billing_transactions.id`), `credits_purchased`, `credits_remaining`, `purchased_at`, `expires_at`.
- **Aggregatable Fields:** `id`, `store_id`, `credits_purchased`, `credits_remaining`.
- **Sortable Fields:** `id`, `purchased_at`, `expires_at`, `credits_purchased`, `credits_remaining`.
- **Relations Available with `INCLUDE`:**
  - `store` $\rightarrow$ `{id, name, sector}`
  - `transaction` $\rightarrow$ `{id, amount, status, type, created_at}`

---

### 5.12 `ai_free_credit_grants`
Granted free AI credits (free trial, promotional campaigns, referral bonuses, compensation, or staff grants).

- **Primary Date Field:** `created_at`
- **Fields:**
  - `id` (int, PK)
  - `store_id` (int, FK $\rightarrow$ `shops.id`)
  - `reason` (string) — Available choices:
    - `"free_trial"` (Free trial credits)
    - `"promotional"` (Promotional credits)
    - `"referral"` (Referral credits)
    - `"compensation"` (Compensation)
    - `"staff"` (Staff grant)
    - `"other"` (Other)
  - `priority` (int) — Consumption priority (lower number consumed first)
  - `credits_granted` (decimal)
  - `credits_remaining` (decimal)
  - `expires_at` (datetime)
  - `note` (string) — Internal note
  - `granted_by_id` (int, FK $\rightarrow$ `users.id`)
  - `created_at` (datetime)
- **Aggregatable Fields:** `id`, `store_id`, `reason`, `priority`, `credits_granted`, `credits_remaining`.
- **Sortable Fields:** `id`, `created_at`, `expires_at`, `priority`, `credits_granted`, `credits_remaining`, `reason`.
- **Relations Available with `INCLUDE`:**
  - `store` $\rightarrow$ `{id, name, sector}`
  - `granted_by` $\rightarrow$ `{id, email, full_name}`

---

## 6. Ready-to-Use Analytical Queries Cookbook

### 6.1 SaaS KPIs & Onboarding Funnel

**Trial Conversion Rate & Onboarding Completion by Sector:**
```sql
FROM shops
  SELECT sector, COUNT(*) AS total_stores, RATE(onboarding_completed, id) AS onboarding_pct, RATE(on_trial, id) AS trial_pct
  WHERE is_active = true
  GROUP BY sector
  ORDER BY total_stores DESC
```

**New Stores Daily Signup Trend (Last 30 Days):**
```sql
FROM shops
  SELECT created_on__date AS day, COUNT(*) AS signups
  GROUP BY created_on__date
  ORDER BY day ASC
  SINCE 2026-08-15
```

---

### 6.2 Financial & Revenue Analytics

**Monthly Recurring Revenue (MRR) Breakdown by Type:**
```sql
FROM billing_transactions
  SELECT type, SUM(amount) AS total_revenue, COUNT(*) AS tx_count
  WHERE status = "paid"
  GROUP BY type
  SINCE 2026-09-01
```

**Churn Analysis: Cancel Reasons on Paid Subscriptions:**
```sql
FROM billing_subscriptions
  SELECT cancel_reason, COUNT(*) AS count
  WHERE status = "canceled"
  GROUP BY cancel_reason
  ORDER BY count DESC
```

---

### 6.3 AI Consumption & Cost Attribution

**Top 10 Stores by LLM Credit & Token Consumption:**
```sql
FROM ai_credit_usages
  SELECT store_id, SUM(credits_used) AS total_credits, SUM(total_tokens) AS tokens, RATIO(total_tokens, chat_id) AS avg_tokens_per_chat
  GROUP BY store_id
  ORDER BY total_credits DESC
  LIMIT 10
  SINCE 2026-09-01
```

**Daily AI Token Consumption Trend:**
```sql
FROM ai_credit_usages
  SELECT created_at__date AS day, SUM(total_tokens) AS daily_tokens, SUM(credits_used) AS daily_credits, COUNT(DISTINCT store_id) AS active_merchants
  GROUP BY created_at__date
  ORDER BY day ASC
  SINCE 2026-08-15
```

---

### 6.4 Platform Analytics & Support Operations

**Unresolved Bugs with Attachments & User Contact Info:**
```sql
FROM feedbacks
  SELECT id, title, feedback_type, created_at
  INCLUDE user, attachments
  WHERE status = "pending" AND feedback_type = "bug"
  ORDER BY created_at DESC
  LIMIT 20
```

---

## 7. Client Code Integration Examples

### Python (`requests`)
```python
import requests

API_URL = "https://saas.nealens.com/api/internal/v1/nlensql-plus/"
HEADERS = {
    "X-Internal-Service-Key": "YOUR_SECRET_SERVICE_KEY",
    "Content-Type": "application/json",
}

query = """
FROM shops
  SELECT sector, COUNT(*) AS total, RATE(on_trial, id) AS trial_rate
  WHERE is_active = true
  GROUP BY sector
  ORDER BY total DESC
"""

response = requests.post(API_URL, json={"query": query}, headers=HEADERS)
data = response.json()

print(f"Returned {data['count']} groups:")
for row in data["data"]:
    print(f"- {row['sector']}: {row['total']} stores ({row['trial_rate']:.1f}% on trial)")
```

### Node.js (`fetch`)
```javascript
const API_URL = 'https://saas.nealens.com/api/internal/v1/nlensql-plus/';

async function runQuery(query) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Service-Key': process.env.NLENS_INTERNAL_API_KEY,
    },
    body: JSON.stringify({ query }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`[${body.error_type}] ${body.error}`);
  }
  return body.data;
}

// Example: Daily AI tokens
runQuery(`
  FROM ai_credit_usages
  SELECT created_at__date AS day, SUM(total_tokens) AS tokens
  GROUP BY created_at__date
  ORDER BY day ASC
  SINCE 2026-09-01
`).then(console.log);
```
