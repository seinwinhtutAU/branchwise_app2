# User guide (Retail)

This was the in-app Help Center for the **Retail** side of the app. **The Help page has
been removed from the app** — the chat assistant, now a floating button on every retail
screen, is where a user asks these questions instead. The text is kept here as written
reference, and as the material the assistant's answers should agree with.

It explains how retail data is imported, how sales and profit are calculated, how warnings work, what each setting does, and how to use the chat assistant.

> **Scope:** This Help Center only covers the Retail workflow, as its original title says. The
> Wholesale workflow was an empty placeholder when this text was written (2026-09-11, while it
> was being redesigned from scratch) but has since been rebuilt into a real multi-screen
> workflow — see [../wholesale/](../wholesale/) for that documentation instead of assuming this
> page's "empty page" description still holds.

---

# UI Design Instructions

The Help Center should be designed as a **real in-app Help Center**, not as one long documentation page.

## General Design

- Use a clean, modern, easy-to-scan layout.
- Do not show all help content on one page.
- Organize content into clear categories and separate articles.
- Users should be able to choose a topic and read only the information they need.
- Use a left sidebar or category navigation on desktop.
- Add a search box at the top so users can quickly find an article.
- Use cards or sections for major Help categories.
- Each article should have a clear title, short description, and readable content.
- Use tables, callouts, examples, and bullet points where they make information easier to understand.
- Avoid large blocks of text.

## Help Categories

Organize the Retail Help Center into these sections:

1. **Getting Started**
2. **Import & Data**
3. **Costing & Profit**
4. **Data Quality & Warnings**
5. **Settings**
6. **Chat Assistant**
7. **Known Limitations**

## Article Layout

Each article should follow a consistent structure:

- Article title
- Short explanation
- Main content
- Examples where useful
- **Good to know** callout for important tips
- **Warning** callout for common mistakes or limitations
- Related articles when applicable

The UI should make it easy for users to understand the answer without needing to read the entire Help Center.

---

# Getting Started

## How Data Gets Into BranchWise

Retail branches upload their POS exports as **CSV, XLS, or XLSX** files.

BranchWise processes each file through the same basic flow:

**Upload → Clean & Review → Confirm & Save**

### 1. Upload

Upload a Sale, Inventory, or Purchase file exported from the POS system.

### 2. Clean & Review

BranchWise automatically cleans the file before saving it.

This can include:

- Fixing printed-report formatting.
- Handling mixed Myanmar text encoding.
- Cleaning common formatting problems.
- Converting the file into a format the system can process.

The cleaned data is shown to the user so they can review it before confirming.

### 3. Confirm & Save

After reviewing the data, confirm the import.

Only after confirmation is the data saved to the Retail database.

---

## Sale / Purchase Pages vs Data Overview

The **Sale**, **Purchase**, and **Data Overview** pages use the same underlying data, but they are designed for different purposes.

### Sale & Purchase

The Sale and Purchase pages show a **recent date range by default**.

The default is **90 days**, but an admin can change this in:

**Settings → Sale & Purchase List Default Range**

The date filter can be used to view older records.

You can also clear the date filter to return to the default range.

This default range exists to keep the pages fast as more historical data is imported.

### Data Overview

Data Overview shows **all imported sale lines**, with no date limit.

It also combines sales with inventory and purchase pricing information.

Use Data Overview when you need:

- Full historical data.
- Long-term analysis.
- Full-history exports.

Because it loads more data, it may take longer to load when a branch has several years of history.

### Inventory

Inventory works differently from Sale, Purchase, and Data Overview.

It does **not show inventory history**.

Instead, it shows only the **most recent inventory count for each product**.

The **Last Updated** column tells you when that product's latest inventory count was recorded.

Filtering by Last Updated means:

> "Show products whose latest inventory count happened during this period."

It does **not** mean:

> "Show what was in stock during this period."

For example, if a product was last counted three months ago, it may not appear when you filter for the last 30 days, even though the product still has stock.

### Rule of Thumb

If a number or record seems to disappear after applying a date filter, it is usually **outside the selected date range**, not deleted.

Try widening the date range or clearing the filter before assuming the data is missing.

---

# Import History

## Fixing a Bad Import

Every confirmed Sale, Inventory, or Purchase import appears as a separate row in **Import History**.

A successfully confirmed import normally has the status:

**Completed**

Click an import row to see what data was added by that import.

If an import was incorrect, there are two ways to fix it.

### Reimport

Use **Reimport** when you have a corrected file.

Reimport will:

1. Remove the data from the original import.
2. Import the corrected file.
3. Confirm the new data as part of the replacement.

The import history remains available, and the status changes to:

**Reimported**

Use this when the original file had problems such as:

- Wrong branch.
- Wrong date.
- Incorrect values.
- Other file-level errors.

### Remove

Use **Remove** when you want to delete the data from an import without replacing it.

A confirmation dialog is shown before the data is removed.

The import history row is **not deleted**.

Instead, its status changes to:

**Removed**

This keeps a record that the import happened.

---

## Import Time Limit

Retail users can only **Reimport** or **Remove** an import within **1 day** after it was imported.

After that, the actions are replaced with:

**Locked**

Admins do not have this 1-day restriction.

---

## Important: Do Not Re-upload a Purchase File

Sale and Purchase imports behave differently.

### Sale

Sale imports can be safely uploaded again because already-imported sale slips are automatically skipped.

### Purchase

Purchase imports do **not** automatically detect that the same purchase has already been imported.

If you upload the same Purchase file again, the data can be added a second time.

This can cause purchase quantities and costs to be double-counted.

### Correct Way to Fix a Purchase Import

If a Purchase file was incorrect:

1. Open **Import History**.
2. Find the incorrect Purchase import.
3. Select **Reimport**.
4. Upload the corrected file.

Do not simply upload the corrected Purchase file through the normal Import page.

---

# Costing & Profit

## Buying Price, Profit & Buying Price Source

### Buying Price

**Buying Price** is the cost that BranchWise determines for a product **as of the date it was sold**.

It is not necessarily the product's current buying price.

Profit and Profit Margin % are calculated using this buying price.

If BranchWise cannot determine a suitable buying price, it does not guess.

In that case:

- Buying Price is blank.
- Profit is blank.
- Profit Margin % is blank.

---

## Buying Price Source

The **Buying Price Source** tells you where BranchWise got the buying price.

### Purchase

A purchase record for the product existed before or on the sale date and was recent enough to be used.

This is the most reliable source.

### Stock Count

There was no suitable purchase record, but an inventory count was available and recent enough to be used.

### Later Recount (Est.)

There was no suitable purchase or inventory record available as of the sale date.

BranchWise therefore used an inventory recount that happened **after the sale**, within the configured forward-day window.

This is an **estimate**, not an exact historical cost.

### —

No suitable buying price could be found.

In this case, Buying Price and Profit remain blank.

---

## Inventory Price Forward Days

**Settings → Inventory Price Forward Days**

Sometimes a product is sold before the physical inventory is recounted.

For example:

- **1 August:** Product is sold.
- **3 August:** The branch performs an inventory recount.

If the Inventory Price Forward Days setting allows 3 days, BranchWise can use the 3 August recount as an estimated buying price for the 1 August sale.

This setting controls **how many days after a sale** BranchWise is allowed to use a later inventory recount.

### Set Forward Days to 0

Setting this value to **0** disables the later-recount fallback.

Only records matching the sale date can then be used.

A sale without a suitable buying price on its own date will remain blank.

### Related Settings

There are three settings that control how far BranchWise can search for a buying price:

- **Purchase Price Lookback Days** — how far back BranchWise can look for a purchase record.
- **Inventory Price Lookback Days** — how far back BranchWise can look for an inventory count.
- **Inventory Price Forward Days** — how far forward BranchWise can look for a later inventory recount.

These pricing settings are business-wide and apply to everyone.

---

# Data Quality & Warnings

## What Each Warning Tab Checks

The Warning section helps identify possible data problems.

### Sale

Checks Sale records for obviously incorrect values, such as:

- Negative prices.
- Zero quantities.
- Other invalid values.

### Inventory

Checks two things:

1. Problems in each product's **latest inventory count**.
2. Products that were recently sold or purchased but still have **no inventory record**.

The Inventory warning does not use a single calendar range for the latest inventory check because it always looks at the latest count.

### Purchase

Checks Purchase records for obviously incorrect values, similar to the Sale warning.

### Daily Check

Compares the latest inventory count with the stock that BranchWise expects based on previous inventory, purchases, and sales.

The basic calculation is:

**Expected Stock = Previous Stock + Purchases − Sales**

If the expected stock does not match the latest stock count, BranchWise shows a warning.

A mismatch may mean:

- A recount is needed.
- An import is missing.
- A stock count is incorrect.
- Another data problem exists.

---

## Why Sale/Purchase Warnings Can Look Empty

By default, Sale and Purchase warnings only check **today's data**.

They do not automatically check the entire history.

This keeps the warning checks fast as more data is added.

The Sale and Purchase warning windows are independent.

For example:

- Changing the Sale warning window does not change the Purchase warning window.
- Changing the Purchase warning window does not change the Sale warning window.

If you are checking older data and the warning tab is empty, the problem may simply be outside the current check window.

Go to:

**Settings → Daily Check Windows**

and increase the relevant window.

### Important

The missing-inventory part of the Inventory warning also uses the Sale and Purchase check windows.

This means an old product that has not been sold or purchased recently may disappear from the missing-inventory list until it becomes active again.

The following checks are **not affected** by these calendar windows:

- Latest Inventory check.
- Daily Check.

---

# Settings

## What Each Setting Does

Only **Admin** accounts can change Retail settings.

The permission is enforced by the server, not only by hiding the Settings page from users.

Settings changes apply to everyone immediately.

### Appearance

Controls the application theme:

- Light.
- Dark.
- Match device/system setting.

### Daily Check Windows

Controls how many days back the Sale and Purchase warning checks look.

See:

**What Each Warning Tab Checks**

### Sale & Purchase List Default Range

Controls how many days of Sale and Purchase data are loaded by default before the user changes the date filter.

See:

**Sale / Purchase Pages vs Data Overview**

### Buying Price Source Column

Controls whether the **Buying Price Source** column is shown in:

- Sale.
- Data Overview.

### Purchase Price Lookback Days

Controls how old a purchase record can be before BranchWise considers it too old to use when calculating a sale's buying price.

### Inventory Price Lookback Days

Controls how old an inventory count can be before BranchWise considers it too old to use when calculating a sale's buying price.

### Inventory Price Forward Days

Controls how many days after a sale BranchWise can use a later inventory recount as an estimated buying price.

See:

**Inventory Price Forward Days**

### Branch Date Formats

Date format settings are configured **per branch**.

They control whether the POS file uses:

- Day-first dates.
- Month-first dates.

Sale and Inventory files have separate date-format settings.

Sale files usually detect the date format automatically.

This setting is mainly needed when a file contains ambiguous dates that cannot be identified automatically.

---

# Chat Assistant

## What Can the Chat Assistant Do?

The Chat Assistant is available to:

- Retail users.
- Admin users.

It is **not available for Wholesale workflows**.

The assistant understands the Retail data model and can answer questions about:

- Sales totals.
- Top-selling products.
- Current stock.
- Low-stock products.
- Purchases.
- Existing data-quality warnings.
- Other available retail data.

You can also specify a date range in your question.

If you do not provide a date range, the assistant uses the **last 30 days** by default.

### Data Access

For retail users, the assistant can only read data from **their own branch**.

For admins, it can read data across branches.

The assistant:

- Cannot change your data.
- Cannot edit imports.
- Cannot modify settings.
- Cannot perform actions on your behalf.

### Conversation Memory

The assistant does not remember previous conversations after you reload the page or navigate away.

---

# Known Limitations

These are current limitations of the Retail system. They are important to understand when reviewing numbers or data.

## Purchase Files Can Be Imported Twice

Uploading the same Purchase file again adds the data again.

It does not automatically replace the previous import.

If a Purchase total looks unusually high:

1. Open Import History.
2. Check for duplicate Purchase imports.
3. Remove or Reimport the incorrect import.

---

## Purchase Date

The Purchase date currently represents the **import/confirmation date**, not necessarily the actual supplier invoice date.

For example:

A purchase may have been made on 1 August, but if the file is confirmed in BranchWise on 5 August, the system may record 5 August as the Purchase date.

---

## Buying Price Is Not Guaranteed Accounting Cost

Buying Price and Profit are based on the **best available information** in BranchWise.

They should not automatically be treated as a guaranteed-accurate accounting cost.

Check the **Buying Price Source** to understand where the cost came from.

In particular:

- Purchase = strongest source.
- Stock Count = reliable historical reference.
- Later Recount (Est.) = estimated.
- — = no cost available.

---

## Units Are Free Text

Quantity units are currently stored as free text.

For example:

- Each.
- Box.
- Pack.

The system does not currently enforce consistent units across records.

In the current business process, units are reportedly always **Each**, so this is not normally a problem.

However, inconsistent units have not been completely ruled out and could affect data quality in the future.
