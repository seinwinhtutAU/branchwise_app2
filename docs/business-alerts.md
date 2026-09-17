# Business Alerts — every condition, explained

A reading guide to the alerts the app raises about the **business**: what each one
means, the exact number that makes it fire, and a worked example with real arithmetic.

Where they appear:

- **Business Alerts** (its own nav item) — every alert for every retail branch in one
  table, the "what needs my attention today" page.
- **Dashboard → Overview** — the same alerts for the one branch on screen, sitting next
  to the measure each one is talking about.

Where they don't: the **Warning** page is a different job. Business Alerts is _the
business going wrong_; Warning is _the imported data being wrong_. Data-quality alerts
are computed (see rule 7 below) but hidden on the Business Alerts page, because Warning
already lists those row by row with the tools to fix them.

This doc is the plain-language companion to [`branch_health.md`](./branch_health.md),
which covers the engine's design and the 0–100 health score. The rules themselves live
in `backend/app/retail/services/early_warning.py`, and the "why it happened" arithmetic in
`backend/app/retail/services/explanation.py`.

---

## 1. How an alert is produced

1. **The page asks for each branch's overview.** Business Alerts issues no requests of
   its own — it reads the same `GET /api/dashboard/overview?branch_id=…&period=30d`
   payload the Dashboard branch cards already fetch, one per retail branch, through the
   shared cache.
2. **The backend picks two windows** — the selected period, and the window of the same
   length immediately before it (`dashboard.resolve_period`).
3. **It gathers the raw numbers once** into a `BranchSnapshot`
   (`branch_health.py`): revenue, transactions, average sale, estimated cost and margin,
   stock counts, dead stock, basket composition, data-quality counts — each for both
   windows. Every one of these delegates to the helper the matching dashboard tab
   already uses, so no figure on the Overview page is computed twice by two different
   pieces of code.
4. **It loads the thresholds** — the admin-tunable values from Settings, falling back to
   the defaults listed in this doc.
5. **Seven rules run over that snapshot.** Each is one small function; each owns one
   subject; each returns zero or more alerts.
6. **A rule compares its number to its bands.** Inside the healthy band it returns
   nothing at all.
7. **A firing rule writes the alert** — title, the sentence with the real figures, the
   worked-out "why", the figures it was built from, a recommended action, and which tab
   holds the evidence.
8. **Sorted worst first** (critical, then warning, then normal; ties broken by rule
   order: money, stock, shoppers, then the data underneath) and returned.

**Every sentence in an alert is a template filled with figures from the snapshot.**
Nothing here asks a model what it thinks — which is why an alert can always show its
own arithmetic.

## 2. The period, and what "previous" means

Overview defaults to **30 days**, unlike the other dashboard tabs which default to
today. The alerts are built on movement against the previous period, and one day against
the day before is mostly noise — a single quiet Tuesday would read as a sales collapse.

"The previous period" is always the same number of days immediately before the selected
window. A custom range of 1–14 March compares against 15–28 February.

**One exception: stock.** Current stock is a point-in-time fact with no period control
on its own tab, so the stockout and dead-stock rules always describe _today's_ shelf,
whichever period the rest of the page is showing.

## 3. The three severities

The three levels say **whether the alert requires a decision** — not how quickly someone
should move. Two alerts can both need attention this week and still sit at different
levels, because one leaves the business a choice about when and the other doesn't.

| Severity     | Means                                                            | Counted anywhere? |
| ------------ | ---------------------------------------------------------------- | ----------------- |
| **critical** | A decision is required now                                       | Yes               |
| **warning**  | A decision is required, but you choose when                      | Yes               |
| **normal**   | No decision required — a drift, shown so it can be seen starting | **No**            |

A third level is usually how an alert list turns into noise. It doesn't here because
nothing counts `normal`: the nav badge, the branch tiles and the Overview cards all
count criticals and warnings only. So the number a manager reacts to means "decisions
waiting", while the list itself can still show the drift that would otherwise be
invisible. Every `normal` alert's recommended action starts with "Nothing to act on
yet."

## 4. Quick reference — all conditions

Default thresholds; all of them are tunable in Settings.

| #   | Alert                         | Fires when                                                                              | Severity                    |
| --- | ----------------------------- | --------------------------------------------------------------------------------------- | --------------------------- |
| 1   | No sales recorded             | No sales at all this period, after a period that had them                               | critical                    |
| 2   | Revenue decline               | Revenue growth ≤ −5% (≤ −10% and ≤ −20% escalate)                                       | normal / warning / critical |
| 3a  | Low margin                    | Gross margin < 15% (< 10% and < 5% escalate)                                            | normal / warning / critical |
| 3b  | Margin lower than last period | Margin fell ≥ 1% (≥ 3% escalates)                                                       | normal / warning            |
| 4a  | Stockout risk                 | Any product with ≤ 3 days of stock left                                                 | critical                    |
| 4b  | Low stock                     | Any product with ≤ 7 days of stock left                                                 | warning                     |
| 4c  | Watch stock                   | Any product with 7–14 days of stock left                                                | normal                      |
| 5   | Dead stock                    | ≥ 5% of stocked products with no sale in 90 days (≥ 10% and ≥ 25% escalate)             | normal / warning / critical |
| 6   | Traffic decline               | Transactions down ≥ 10% while the average sale rose **and** revenue itself stayed quiet | warning                     |
| 7   | Data quality                  | Any Warning-page check found rows for this branch and period                            | that check's own severity   |

A branch can raise at most one alert from each numbered group: 3a and 3b are one margin
rule reporting whichever is worse, and 4a/4b/4c is one stock rule reporting the worst
band that has anything in it. A margin below the floor and a margin slipping are the
same conversation, and two cards about one number would bury everything else.

---

## 5. The rules, one by one

### Rule 1 — No sales recorded (critical)

**Fires when** this period has zero net revenue and the previous period had some.

**Why it's separate from a revenue fall.** An empty period is almost always a file
nobody imported, not a shop that sold nothing. Reporting it as a 100% revenue collapse
would send a manager to investigate the shop floor over a missing upload.

> _No sales recorded in this period — not a single sale is recorded for this branch in
> this period, after the previous 30 days had sales._
> **Do:** check Import History for this branch; this period's sales file has most likely
> not been imported yet.

There is no mild version of this one. It's either a missing import or a closed shop.

### Rule 2 — Revenue decline (normal / warning / critical)

**The number.** Growth against the previous period:

```
growth % = (revenue now − revenue before) ÷ revenue before × 100
```

**Bands.** Above −5%: nothing. −5% to −10%: `normal`. −10% to −20%: `warning`. −20% or
worse: `critical`.

**Silent when** there is no previous revenue to grow from — a branch's first measured
period has no growth, and calling that 0% would score it as merely flat.

**The why.** Revenue = transactions × average sale, and that identity splits exactly:

```
Δrevenue = (ΔT × B₀) + (ΔB × T₀) + (ΔT × ΔB)
            transactions  average-sale  both at once
```

The three parts add back to the total change exactly, which is why the alert can show
them as evidence rather than as an opinion. If one side accounts for 65% or more of the
movement it is named as the cause; otherwise the alert says both.

**Worked example.**

|              | Now (30 days) | Before (30 days) |
| ------------ | ------------- | ---------------- |
| Net revenue  | 7,920,000 Ks  | 10,000,000 Ks    |
| Transactions | 800           | 1,000            |
| Average sale | 9,900 Ks      | 10,000 Ks        |

Growth = (7,920,000 − 10,000,000) ÷ 10,000,000 = **−20.8%** → critical.

Split:

| Part                 | Arithmetic    | Amount            |
| -------------------- | ------------- | ----------------- |
| Fewer transactions   | −200 × 10,000 | −2,000,000 Ks     |
| Smaller average sale | −100 × 1,000  | −100,000 Ks       |
| Both at once         | −200 × −100   | +20,000 Ks        |
| **Total**            |               | **−2,080,000 Ks** |

The three parts add to the actual change exactly. Transactions account for 95% of it,
comfortably past the 65% mark, so transactions are named as the cause:

> _Revenue has fallen sharply — net revenue is down 20.8% against the previous 30 days.
> Transactions are down 20.0% and the average sale is down 1.0%. Both are down, but fewer
> transactions account for most of the fall — this is a footfall problem first and an
> average-sale problem second._
> **Do:** open the Revenue tab's daily trend to see when the drop started, then compare
> top products against the previous period.

The same −20.8% with transactions flat and the average sale down 20% would print the
opposite diagnosis — people still coming in but buying less each time, which is a
pricing and placement problem rather than a footfall one.

### Rule 3 — Margin (normal / warning)

Two conditions, one rule, whichever is worse.

**Gate first: cost coverage ≥ 50%.** The margin rests on estimated costs (the
point-in-time buying price, `app/retail/services/pricing.py`). If under half of the period's
revenue has any cost estimate behind it, the rule stays silent rather than raising an
alarm on a figure describing a minority of the business.

**3a — Low margin (a level).** Fires when gross margin < 15%. Under 10% → `warning`;
under 5% → `critical`.

The useful "why" for a level is _whether it is new_: a margin thin for months is a
pricing decision to revisit; one that was healthy last period is an event to find. A
move under 1% counts as unchanged (drift that small on an estimated figure is noise).

**Worked example.** Revenue 8,000,000 Ks, estimated cost 7,400,000 Ks, 82% of revenue
priced. Margin = (8,000,000 − 7,400,000) ÷ 8,000,000 = **7.5%** → under 10, at or above
5 → `warning`. Previous period was 12.0%, so the change is −4.5%:

> _Margin is below a healthy level — estimated gross margin is 7.5%, under the 10% level
> this business treats as healthy. Margin fell 4.5%, from 12.0% to 7.5%.
> This is a recent move, so it is worth finding what changed this period rather than
> treating it as the branch's normal level._
> **Do:** open the Cost tab's profit ranking; the products dragging it down sit at the
> bottom.

**3b — Margin lower than last period (a movement).** Only checked when the margin is
_not_ already below 15%. Fires when the margin fell ≥ 1% against the previous period;
≥ 3% → `warning`, otherwise `normal`. Needs a previous margin that also passed the
50% coverage gate.

The why is a race between two growth rates — what the branch sold for, and what it paid
for what it sold — which says more than any algebraic split of the ratio would.

**Worked example.** Margin 18.2% now, 21.5% before → −3.3% → `warning`. Revenue
grew 4% while estimated cost grew 9%:

> _Margin lower than last period — estimated gross margin fell 3.3% against the
> previous 30 days, from 21.5% to 18.2%. Revenue is up 4.0% and cost of goods is up 9.0%.
> Costs grew faster than sales, so the branch is selling more without keeping more of it
> — that points at buying prices or the mix of what sold, not at demand._
> **Do:** open the Cost tab's revenue-versus-cost chart — the gap between the two lines
> is the margin.

### Rule 4 — Stock running out (critical / warning / normal)

**The number.** For every product on the latest inventory snapshot, using a fixed
30-day selling rate:

```
days left = stock on hand ÷ (units sold in the last 30 days ÷ 30)
```

**Bands** (the same three the Inventory tab uses, so the page and the alerts can never
drift apart): **Critical** ≤ 3 days, **Low** ≤ 7 days, **Watch** ≤ 14 days.

**Which one fires.** The worst band that has anything in it, and only that one: any
Critical → `critical`; else any Low → `warning`; else any Watch → `normal`.

**Excluded:** a product with no sales in the window has no selling rate, so it has no
days-left figure at all. That's a dead-stock question, not a stockout one — and it means
a product can never appear in both rules.

**The why.** Just how long the stock lasts: "at the rate they sold this month, each of
these has less than 7 days of stock left — the point where a product is worth putting on
the next order."

The alert used to go further and split the products into two orders — the ones selling
faster than before (order _more_) and the ones simply run down (order _sooner_), measured
by comparing each product's recent 30-day rate against its own earlier 60-day rate. That
was removed at the business's request. At this shop's volumes the comparison rests on a
handful of sales — one product's "0.6× its earlier rate" came from 5 sales against 18 —
and the sentence read far firmer than the evidence beneath it. What the alert shows now is
only what is solidly measured: what is on the shelf, what sold, and how long that lasts.

**Worked example.** Latest snapshot, three products:

| Product    | On hand | Sold in 30d | Days left | Band     |
| ---------- | ------- | ----------- | --------- | -------- |
| Coffee mix | 10      | 150         | 2 days    | Critical |
| Soap 200g  | 40      | 195         | 6 days    | Low      |
| Rice 5kg   | 60      | 150         | 12 days   | Watch    |

One Critical → `critical`. The alert names both the Critical and the Low product (Watch
raises no alert of its own), soonest to run out first:

> _Products are about to run out — 1 product has 3 days of stock or less left at its
> recent selling rate._
>
> | Product             | In shop | Sold 30d | Lasts  |
> | ------------------- | ------- | -------- | ------ |
> | CM-100 · Coffee mix | 10      | 150      | 2 days |
> | SOP-200 · Soap 200g | 40      | 195      | 6 days |
>
> _At the rate they sold this month, each of these has less than 3 days of stock left —
> the point where a product is worth putting on the next order._
> **Do:** open the Inventory tab's low-stock table — it is sorted by days left.

### Rule 5 — Dead stock (normal / warning / critical)

**The number.** A product is dead if it still has stock on the shelf (on hand > 0) and
sold **zero** units in **90 days**. 90 rather than 30, because a month without a sale is
routine for a slow-but-fine product.

```
share = dead products ÷ products with stock on hand × 100
```

**Bands.** Under 5%: nothing — every shop carries some. 5–10%: `normal`. 10–25%:
`warning`. 25% or more: `critical`.

**Judged as a share, not a count**, because 60 dead products means something different
in a 400-product shop than in a 6,000-product one.

**No "why" section**, deliberately: a count of non-moving products has no two components
to split it into, and inventing a cause for one would be worse than staying quiet.

**Worked example.** 420 products with stock on hand, 63 of them with no sale in 90 days.
63 ÷ 420 = **15%** → past 10, under 25 → `warning`.

> _Too much stock is not moving — 63 of 420 products (15%) still have stock on the shelf
> but have not sold once in 90 days._
> **Do:** open the Inventory tab's dead-stock table. These are the candidates for a
> clearance price, and the ones not to reorder.

### Rule 6 — Traffic decline (warning)

The narrow, genuinely hidden case: **the headline looks fine because bigger baskets
covered for the customers who stopped coming.**

**Fires when all three hold:**

1. Revenue itself stayed quiet — growth above −5%, quiet enough that rule 2 said nothing
   at all, including at its `normal` tier.
2. Transactions are down 10% or more.
3. The average sale went _up_.

**Why the first condition.** When revenue is visibly falling, rule 2 already decomposes
it and says whether transactions or the average sale caused it. A second card repeating
that word for word would be exactly the duplication this engine avoids. There is no mild
version of this rule either — a milder "the headline looks fine" is indistinguishable
from an ordinary week.

**Worked example.**

|              | Now          | Before        |
| ------------ | ------------ | ------------- |
| Net revenue  | 9,900,000 Ks | 10,000,000 Ks |
| Transactions | 880          | 1,000         |
| Average sale | 11,250 Ks    | 10,000 Ks     |

Revenue −1% (quiet ✓), transactions −12% (≤ −10 ✓), average sale +12.5% (up ✓) →
`warning`. Split: fewer transactions = −120 × 10,000 = −1,200,000 Ks; bigger average
sale = +1,250 × 1,000 = +1,250,000 Ks; both at once = −150,000 Ks. They add to the
−100,000 Ks the revenue line actually moved.

> _Fewer customers than before — net revenue is down 1.0% against the
> previous 30 days, so the headline doesn't look alarming — but the two movements
> underneath it are pulling in opposite directions. Transactions are down 12.0% and the
> average sale is up 12.5%. The fall is driven by fewer transactions — a larger average
> sale partly offset it. The branch served fewer people, rather than the same people
> spending less._
> **Do:** open the Customer tab's busy-hours heatmap to see which days and hours lost
> footfall.

### Rule 7 — Data quality (that check's own severity)

One alert per Warning-page check that found rows for this branch in this period, carrying
**that check's own title and severity**. This engine holds no second opinion about what
counts as a data problem or how bad one is — it surfaces what Warning already found and
links back to it.

| Warning check                          | Severity     |
| -------------------------------------- | ------------ |
| Sale — fix these numbers               | warning      |
| Inventory — fix these numbers          | warning      |
| Purchase — fix these numbers           | warning      |
| Inventory — add missing records        | warning      |
| Daily inventory check — verify by hand | warning      |
| Daily inventory check — recount these  | **critical** |

**Worked example.** The daily reconciliation check found 4 products whose latest snapshot
doesn't match previous snapshot + purchases − sales:

> _Daily inventory check — recount these: 4 rows flagged. The latest inventory snapshot
> doesn't match what it should be (previous snapshot + purchases − sales since then) —
> recount the stock or check for a missing import._
> **Do:** open the Warning page. Most of these are fixed by reverting the import that
> carried them and confirming a corrected file.

These appear on the Dashboard Overview but **not** on the Business Alerts page, so one
job doesn't get split across two screens.

---

## 6. When nothing fires at all

Silence is a designed answer here, not a gap. A rule says nothing when:

- **The measure is healthy** — inside the band, as above.
- **There is no previous period to compare against.** A branch's first imported week has
  no growth. The app records that as _unmeasured_, never as 0% — saying "0%" would score
  a brand-new branch as merely flat.
- **Cost coverage is under 50%** — both margin conditions stay quiet.
- **Another rule owns the subject.** Traffic decline stands down when revenue is
  visibly falling; the margin movement alert stands down when the margin is already below the
  floor; low stock stands down when something is Critical.
- **The branch is wholesale.** These alerts are retail-only — the wholesale branch runs
  the customer-order / factory-voucher workflow and has no sales, inventory or purchase
  data to check.

A branch with nothing wrong still appears on the Business Alerts page as a tile in the
strip above the table, carrying its health score and status band. Without it the page is
a list of problems in which a healthy branch is simply absent, and "not listed" reads as
"not loaded" rather than "nothing to act on".

## 7. Changing the thresholds

Every number in the reference table is admin-tunable on the **Settings** page and is read
fresh on each request; the values in this doc are the defaults. The rules take the
thresholds as an argument, so changing one changes when an alert fires and the sentence
it prints ("under the 10% level this business treats as healthy" quotes the current
setting), with no code change.

## 8. Where the numbers come from

Every figure an alert prints traces back to imported POS data, through the same code the
dashboard tabs use:

| Figure                                      | Source                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Net revenue, transactions, average sale     | Confirmed sales imports, over the selected period                            |
| Estimated cost, gross margin, cost coverage | Sales lines priced at the point-in-time buying price from purchase imports   |
| Stock on hand, days left, dead stock        | The branch's newest inventory snapshot, plus 30-day and 90-day selling rates |
| Basket composition                          | Line counts per sales slip                                                   |
| Data-quality counts                         | The Warning page's own checks, scoped to this branch and period              |

Related: [`branch_health.md`](./branch_health.md) (the health score and the engine's
design), [`retail_dashboard.md`](./retail_dashboard.md) (each tab's numbers),
[`known-limitations.md`](./known-limitations.md) (what is deliberately not measured yet).
