# Branch Health Score

The "Overview" tab of the retail dashboard, and the first half of turning BranchWise
from a set of charts into a decision support system. Where the Revenue / Cost /
Inventory / Customer tabs each answer "what are the numbers," Overview answers **"is
this branch healthy, and if not, which part of it isn't"** — one 0-100 score per
dimension plus one overall score, so a manager reads `Inventory 54 — critical` and
clicks straight through to the Inventory tab for the evidence, instead of opening four
tabs and interpreting them by hand.

Backed by `GET /api/dashboard/overview` (`app/retail/routers/dashboard.py`), computed in
`app/retail/services/branch_health.py` (the score), `app/retail/services/early_warning.py` (the
alerts), rendered by
`frontend/renderer/src/components/features/dashboard/OverviewTab.tsx`.

## Two rules the whole design rests on

**1. Nothing is measured twice.** Every raw number comes from the helper that the
matching dashboard tab itself uses — `_revenue_totals`, `_cost_totals_and_products`,
`_stock_summary`, `_basket_stats` in `app/services/dashboard.py`, and
`build_warning_sections` in `app/retail/services/data_quality.py`. Overview is a second
_reading_ of the pillars' figures, never a second _computation_ of them. If a red
Inventory score sent a manager to an Inventory tab that reported a different dead-stock
count, neither number would ever be trusted again. `test_overview_reports_the_same_figures_as_the_tabs_it_links_to`
exists specifically to keep that true.

Two small refactors in `dashboard.py` were made to serve this rather than duplicate it:
`_cost_totals_and_products` now also returns `priced_net_revenue` (the cost-coverage
denominator), and `_stock_summary` was split out of `build_inventory_dashboard` so the
score can read the same stock figures without paying for a second warnings pass.

**2. A number that can't be known is `null`, never `0`.** A branch with no
sales on the same days last year has no computable growth. A branch whose products have no buying
price has no computable margin. Scoring either as 0 would tell a manager their branch is
failing when the truth is that it hasn't been measured — the single most damaging thing
a health score can do. Instead the sub-metric drops out, the remaining weights within
its dimension are re-normalised, the dimension's `insufficient_data_reason` says in
plain English what's missing (usually: import the missing records), and if a whole
dimension drops out, the remaining dimensions re-normalise to share 100% of the overall
score between them. `scored_weight` reports how much of the weight table was actually
measurable, and each dimension's `effective_weight` reports what it really contributed.

## What growth is compared with

Every growth figure (revenue, average sale, quantity sold, transactions) is compared with **the same dates one year earlier**, not with the window right before. This business's sales follow the calendar (festivals, rainy season, school term), so last month is a noisy baseline, and it is the same comparison the Revenue, Cost and Customer tabs use, so the Overview and those pages agree. The Overview header says "vs the same month/dates last year". A window of a week or less (a chosen day or week) is lined up by weekday instead — 52 weeks back — so a Wednesday is not set against a Saturday; see `resolve_period` and `docs/retail/dashboard.md`.

A branch with no sales on those days last year (AungThitSar has data only from December 2025) has no growth to score: those measures are unscored, and their dimension is dropped or re-weighted like any other unmeasured one. It is never quietly compared with the previous month instead, which would put two branches on different yardsticks. Level measures (gross margin, dead stock, aged stock, stockout risk, conversion rate, data quality) do not compare with anything and are unaffected.

## The scoring table

Five dimensions, weighted:

| Dimension    | Weight | Question it answers                                                         |
| ------------ | -----: | --------------------------------------------------------------------------- |
| Sales        |    25% | Is the branch selling more than it was, and still selling across its range? |
| Profit       |    25% | Is what it sells actually making money?                                     |
| Inventory    |    25% | Is stock moving, and is it about to run out of anything that sells?         |
| Customer     |    15% | Are customers still coming in, and do they buy when they do?                |
| Data Quality |    10% | Can the four scores above be trusted?                                       |

Each dimension is a weighted average of its sub-metrics:

| Dimension    | Sub-metric                    | Weight | Score bands (value → score)                     |
| ------------ | ----------------------------- | -----: | ----------------------------------------------- |
| Sales        | Revenue growth %              |    50% | -20→0, -10→40, 0→70, +10→100                    |
| Sales        | Average sale value growth %   |    30% | -15→0, -5→50, 0→75, +5→100                      |
| Sales        | Quantity sold growth %        |    20% | -20→0, -10→40, 0→70, +10→100                    |
| Profit       | Gross margin %                |   100% | 0→0, 10→40, 20→80, 30→100                       |
| Inventory    | Dead stock %                  |    40% | 20→100, 35→85, 50→60, 65→30, 80→0               |
| Inventory    | Stockout risk %               |    35% | 0→100, 2→85, 5→60, 10→20, 20→0                  |
| Inventory    | Aged stock %                  |    25% | 0→100, 10→80, 25→50, 40→20, 60→0                |
| Customer     | Transaction growth %          |    50% | -20→0, -10→40, 0→70, +10→100                    |
| Customer     | Conversion rate %             |    50% | 30→0, 45→40, 60→70, 75→85, 85→100               |
| Data Quality | Issues per 100 records        |    70% | 0→100, 1→80, 3→50, 10→10, 20→0                  |
| Data Quality | Stock mismatches (count)      |    30% | 0→100, 1→70, 5→30, 20→0                         |

Each sub-metric also carries a `unit` telling the frontend how to render its raw
value. `pct_change` and `pct_points` are movements and get a green/red ▲/▼ arrow and a signed
number — the same arrows and colours the stat tiles use, so "this went up" looks the same
across the app — while `pct` is a plain level (`30.0%`); the rest are `days`, `count` and
`rate`. The colour follows the direction rather than whether the movement was good: on a
share where a rise is a problem, green still only means "went up", and the score beside it
is what judges. A `pct_points` movement is written as a plain "%" rather than "percentage
points" or `pp`, so it reads the same as every other percentage on the screen.

A value between two breakpoints is linearly interpolated; a value past either end is
clamped. Because the score is stated _per breakpoint_ rather than derived from the
value's direction, one mechanism covers "higher is better" (revenue growth, conversion rate)
and "lower is better" (dead stock, stockout risk). Dead stock reflects realistic
shoe-retail inventory carryover: up to 20% dead stock scores 100, with 80% scoring 0.
Conversion rate evaluates footfall conversion on tracked zero-selling days: under 30% scores 0,
50% scores ~53 (average), and 85%+ scores 100. If no zero-selling records exist for the period,
conversion rate is dropped and the other two Customer metrics share the dimension equally.

Status bands, used identically by the gauge, the dimension bars and (later) the alerts:
**≥ 80 healthy**, **≥ 60 needs attention**, **below 60 critical**.

### Choices worth defending

- **0% growth scores 70, not 100.** Flat is acceptable, not excellent.
- **Transactions count once, under Customer; average sale value counts once, under
  Sales.** Transaction count is a footfall idea and Customer already holds conversion, so
  the two sit side by side there; the average sale is what a sale is worth, so it sits
  with revenue. Neither is scored twice, so one bad week cannot hit the overall score
  through two doors at once.
- **Data quality is a rate, not a count.** 40 warnings across 40,000 rows is a clean
  import; 40 across 200 is a broken one. The denominator (`records_checked`) is the
  period's sale lines + purchase lines + the branch's current SKU count.
- **Profit is gated on cost coverage.** Costs are _estimates_ from
  `app/retail/services/pricing.py`'s point-in-time buying price, and a product with no cost
  estimate is simply not costed. Below `MIN_COST_COVERAGE_PCT` (50%) of period revenue
  having any cost estimate at all, the margin figure describes a minority of the
  business and is not worth a quarter of the score, so the dimension is dropped with a
  reason naming the actual coverage. `cost_coverage_pct` is always reported in
  `metrics` regardless.

**Aged stock** is the share of products on the shelf now that were last bought more than 180 days ago, out of the products that have a purchase record. Using the *last* purchase means a product that was restocked recently is not counted as aged. It is the same list the "Inventory aging" alert shows, so the alert and the score always agree. A product with no purchase on file is left out of both the count and the total: a stock file only says when this app first saw a product, not when it was bought, so its age is unknown and would only ever look young. With no purchase records at all the measure is unscored, and the Inventory score is worked out from the other two.

## The Early Warning engine

The score says _which part_ of a branch is unhealthy. `app/retail/services/early_warning.py`
answers the next question — **what specifically is wrong, and what should I do about
it** — as a severity-ranked list of named problems on the same payload.

Each rule is a pure `BranchSnapshot -> list[Alert]` function registered in one
`RULES` tuple. Every alert carries `title`, `what_happened`,
`recommended_action`, a `severity`, the `dimension` it belongs to, and the `link`
naming the operational screen holding its evidence.

The engine is intentionally limited to operational alerts: daily Sale and Inventory
imports, sale and purchase data validation, urgent reorder, physical stock checking,
stock allocation, footwear aging, and known seasonal or weekly demand. General revenue,
margin, low-stock/watch-stock, generic dead-stock, traffic-decline, and duplicate
Warning-page alerts are not Business Alerts.

See [Business Alerts](./business-alerts.md) for the active rule catalogue and actions.

Alerts are computed, never generated — every sentence is a template filled with figures
from the snapshot. Nothing in this engine asks a model what it thinks.

## Why it happened

Alerts do not carry an automatic "why" any more. An earlier version broke a revenue drop into
visits versus average sale, and a margin drop into selling prices versus buying prices, in
`app/retail/services/explanation.py`. No alert ended up using it — the stock version was
removed at the business's request, because at this shop's volumes it rested on a handful of
sales — so the module and its tests were deleted. The figures rows below carry the evidence
instead, and the `driver`/`interpretation` fields on `Alert` were removed with it.

In the UI (`AlertExplanation` in `dashboard/shared.tsx`) an opened alert shows its
figures laid out and labelled, in the order a reader asks for them:

1. **The dates** (`Alert.context`) — "9 Aug – 7 Sep 2026 vs 10 Jul – 8 Aug 2026" for the
   rules that follow the period control, and "stock count of 6 Sep · sold in the last 30
   days" for the stock rules, which deliberately ignore it (current stock is a
   point-in-time fact, so they read the latest count and a fixed sales window whatever
   period is on screen). Without this line a reader comparing a July period against a
   stock alert has no way to know they are not the same days.
2. **The figures** (`Alert.facts`), as tables. This is the panel's main content, and it
   exists because the business asked to _see the data_: a sentence saying the margin fell
   is a claim, while sales, cost of goods, what was kept and the margin — each with its
   previous value — is that claim with its working attached, checkable against the shop's
   own books. Two shapes, because the two kinds of row do not share columns:
   **movements** get a four-column table headed _Same days last year · This period · Change_, and
   **plain facts** ("Products affected · 3 of 908") a two-column key-value table with no
   header, since the left column already is the label. An alert producing both (fewer
   customers than before) shows the movements first, as that is what it is claiming. The headers stay
   "Same days last year"/"This period" whatever period is selected — the exact days are named in
   the line above, and a header that changed with the period would restate them worse.
   Both tables are width-capped: the row this panel expands inside is as wide as the
   Business Alerts table, and a four-column figure table stretched across all of it puts a
   label at one edge and its number at the other. They are built from the app's own
   `TableContainer`/`Thead`/`Th`/`Td` — bordered, tinted header, gridlines between cells —
   so a figure block looks like the Sale and Inventory tables the same person reads all
   day, and like the spreadsheet the numbers came out of.

   **The change cell carries an arrow for the direction and its colour from the verdict.**
   Cost of goods rising 14% is an up arrow (that is what the number did) painted red (for
   that figure, up is the wrong way) — so `Alert.facts` sends `direction` and `tone`
   separately. Change strings use a real minus sign rather than a hyphen, since the same
   column shows "−Ks 1,175,057" beside "−5.6 points" and the two characters do not match.

3. **The products** (`Alert.table`), for an alert about a list rather than a number: the
   few with the least cover left, each with what is on the shelf, what sold in the last
   30 days, and how long that lasts, plus "78 more on the Inventory tab" when the list was
   capped (`AT_RISK_SHORTLIST_LIMIT`). A branch with eighty low products gets one true,
   unactionable sentence otherwise; nobody reorders eighty lines off a count.
4. **What to do** — tinted and holding the evidence button, since it is the thing the
   whole alert exists to produce.

**Values are formatted on the server, not the client.** Every fact arrives as a finished
string ("Ks 19,016,273", "-5.6 points"), built beside the sentences from the same figures.
Formatting them twice is how a panel ends up showing "32.8%" next to a sentence saying
"33%".

**A movement's colour is the rule's verdict, not its sign.** Cost of goods rising 14% is a
plus sign and bad news, so each fact carries a `tone` decided where the figure's meaning is
known; the panel only paints it. This was caught in review with "+14.1%" rendered green.

**`what_happened` is no longer shown here.** It states in a sentence exactly what the rows
above it now show, and the two together read as the panel saying everything twice. It stays
on the payload for the collapsed row, the branch cards, and the data-quality alerts, which
carry no figures of their own and fall back to it.

**The chip row is gone**, along with the revenue split and the stock alert's
demand/drawdown evidence block. The chips showed two or three of the same figures the fact
rows now carry in full, and keeping both would have been the duplication this engine avoids
everywhere else. The revenue split — the "Where the Ks 1,312,950 went" bars, `Alert.evidence`
with `kind: revenue_split` — went the same way: the money it split up is already in the fact
rows, so the bars were the panel's second telling of one movement. It had been dropped from
the customer alert earlier, for a different reason — that alert is about people, and a bar
chart of where the Kyat came from answers a question its reader is not asking.

The layout above was reviewed by the business as a text mock before any of it was built,
after two earlier attempts (a disclosure holding the arithmetic, then a numbered
step-by-step) were rejected for reading like a developer's working rather than a shop
owner's summary.

Percentages, money and counts inside those sentences are bolded, so a reader can take the
number off the row at a glance and read the sentence only if they want the rest.

Alert text is written to read as a sentence rather than a spreadsheet row: "1 product
has … at its recent selling rate", never "1 product(s) have … at their".

## Tuning

The dimension weights and every rule's firing point are business-wide settings, editable
by an admin on the Settings page under **Branch health weights** and **Early warning
thresholds**. This is what makes "are these weights right?" an answerable question
rather than an assertion: score the same branch and period under two weightings and
compare.

Both live in `app_settings` as a single nested JSON value each
(`branch_health_weights`, `early_warning_thresholds`) rather than as fourteen flat keys.
They are each edited as a _set_ — a weight only means anything relative to the other
four, and a half-saved threshold set would fire alerts nobody chose — and the value
column is already JSON, so nesting costs nothing and needs no migration. On read,
`settings._merged_over_default` lays the saved dict over the defaults, so a set saved
before a key existed still returns a complete shape rather than a hole for the rules to
trip over; there is a test for exactly that.

Two deliberate non-validations:

- **Weights need not sum to 100%.** The scorer already re-normalises over whichever
  dimensions were measurable, so a set summing to 90% still yields a sound 0-100 score.
  Rejecting it would block a legitimate half-finished edit in the form. The Settings
  card shows the running total instead of enforcing one.
- **Threshold bounds are sanity caps, not business rules.** The whole point of exposing
  them is that the business decides what counts as a problem — but a revenue-decline
  threshold above zero would fire on every growing branch, so the signs are pinned.

The set now carries a `normal` firing point for each rule that has one
(`revenue_decline_normal_pct`, `low_margin_normal_pct`, `margin_slip_normal_pp`,
`dead_stock_normal_share_pct`) alongside the
`warning` and `critical` ones. A threshold set saved before those keys existed still
returns a complete shape, since `_merged_over_default` lays the saved dict over the
defaults — the same property that made adding them need no migration.

In the form, the thresholds that are stored negative are entered positive: "revenue
falls by more than 10%" rather than asking anyone to type `-10`. Weights are stored as
fractions and shown as percentages, since nobody reasons about a weight of `0.25`.

## The response

```
branch_id, branch_name, period, date_from, date_to, previous_date_from, previous_date_to
overall_score        # 0-100, or null when nothing was measurable
status               # healthy | needs_attention | critical | null
scored_weight        # how much of the weight table was measurable, 0-1
dimensions[]         # key, label, description, weight, effective_weight, score,
                     # status, insufficient_data_reason, sub_metrics[]
sub_metrics[]        # key, label, unit, weight, value (raw), score
alerts[]             # id, severity, dimension, title, summary, what_happened,
                     # recommended_action, link
                     # `summary` is the few-word version for a collapsed row
metrics{}            # every raw number the scores and alerts were derived from
```

`metrics` travels with the scores on purpose: "Inventory 54" is only useful if the 323
dead-stock SKUs behind it are visible on the same page, and a score whose inputs can't
be inspected can't be argued with or corrected.

## Period

Overview defaults to **30d**, unlike every other tab's `today`. It is built on
vs-previous-period growth, and one day against the day before is mostly noise — a single
quiet Tuesday would read as a critical sales collapse. The other tabs keep their `today`
default because they report levels, not movement. `period` presets, the custom
`date_from`/`date_to` override, and the retail-only/admin-needs-`branch_id` branch rules
are all exactly the other tabs' (`resolve_period`, `_resolve_retail_branch`).

## Known limits

- **Inventory is always "now."** Current stock is a point-in-time fact with no period
  control on its own tab, so the Inventory dimension scores today's shelf even when the
  Overview is showing a custom range set months back. Sales velocity behind
  low/dead stock likewise uses its own fixed 30/90-day trailing windows.
- **Days of inventory on hand is understated when buying prices are missing**, because
  `estimated_stock_value` silently reads 0 for any product with no `buying_price` on its
  latest snapshot (a pre-existing property of the Inventory tab, not new here).
- **The score bands are a considered default, not a business-configured setting.** The
  dimension weights and the alert thresholds _are_ configurable (see **Tuning**); the
  piecewise bands that turn a raw value into a 0-100 sub-metric score are not, since
  they are a curve rather than a number and there is no sane form control for one.

## The tab

`OverviewTab.tsx`, the first tab in `DashboardPage.tsx` and the one the Dashboard lands
on. It is **two pages**:

**Page 1 — every retail branch at once.** Admin only, and where admin starts. One card
per branch: the overall score, all five dimension scores as labelled bars, the alert
count, and the single worst alert's `summary`. Two cards per row, so the card grows
wider rather than taller — the score sits left, the dimensions right. Clicking through
opens page 2.

**Page 2 — one branch.** A compact header (branch, score, status, date range, weakest
area) and then a grouped table: **each dimension as a full-width band, with every measure
that feeds it as the rows beneath** — the same shape the Business Alerts page uses for
branches. Columns are the measure, the value it actually had, the 0-100 that value
earned, a bar, and how much of the dimension it counts for. A branch-scoped account has
one branch, so it skips page 1 entirely and never sees a back link.

This page answers exactly one question: **why is this score what it is.** A reader can add
the rows up — Sales is 13 because two of its three measures scored zero; Inventory's 30 is
mostly dead stock rather than stockouts. Nothing is hidden and nothing is summarised.

**Every measure explains itself.** Opening a row shows three things:

- **What it measures** — one plain sentence (`SubMetric.definition`), in the words a shop
  manager would use rather than the ones the formula uses.
- **Where the number comes from** — the same value again as the figures behind it
  (`SubMetric.calculation`, evaluated against the snapshot): _"312 of 629 products with
  stock"_, _"Ks 77,000,000 of stock ÷ Ks 686,667 of goods sold per day"_.
- **How it scores** — the band table itself, rendered from `SubMetric.bands`, with this
  period's value marked on it.

**And the alert about that measure, if there is one** — the same `AlertExplanation` panel
the Business Alerts page uses, in full: its figures, the split behind them, what happened,
why, and what to do. Every alert names the
`SubMetric.key` it concerns (`Alert.measure`), so it appears inside the row holding the
very number it is talking about. A row with an alert waiting inside carries a small
severity dot next to its name; without it the row looks like every other one and nobody
opens it. `Alert.measure` can name a measure from a different dimension than the alert
scores under — `traffic_decline` is a Customer alert about the Sales dimension's
transaction count — because it belongs next to the figure it discusses. There is a test
asserting every alert's `measure` matches a real one, since a typo would look exactly
like a branch with no alerts.

That third point is the reason the band table is generated rather than written: the page
renders the very table the score was computed against, so the explanation on screen
cannot drift from the arithmetic behind the number. The old answer to "how is this measured" was the
"View Revenue" link, and it was the wrong one — that tab shows _related_ data, not the
calculation, so a reader still had to take the number on faith.

It deliberately does **not** list the branch's alerts, only a one-line count linking to
the Business Alerts page. Earlier versions did list them, from before that page existed;
once it did, showing them in both places made two pages that answered the same question
badly instead of two that answer different questions well — _what is wrong and what do I
do_ there, _why is this number what it is_ here.

Rows that could not be measured stay visible showing `—`, rather than disappearing: a
dimension whose weights suddenly did not add up to 100% would look broken. A dimension
that could not be scored at all shows its reason in place of its rows. The weight printed
on a band is the **effective** one, since an unscoreable dimension is dropped and the rest
re-normalised — the page must never explain a score with a weight that did not produce
it.

Both pages read the same `GET /api/dashboard/overview?branch_id=…`, one request per
branch, rather than a single all-branches endpoint. Each card owns its own request, so
the branches load in parallel (page 1 costs roughly what one branch costs, not the sum),
and opening a branch afterwards is instant because page 2 reads the cache entry the card
already filled. Admin's shared Branch selector is hidden on this tab, since Overview
picks its own branch.

Page 1 follows the rule that **a screen showing every branch can afford one line each**.
There is no "how this score works" panel on either page; that explanation lives here.

## The Business Alerts page

Its own nav item, directly under Dashboard: **every business warning, for every retail
branch, in one list** — "what needs my attention today", as opposed to Overview's "how is
this branch doing". `BusinessAlertsPage.tsx` — one file, since the page and its list were only ever used
together and splitting them forced the filters and the Refresh button onto opposite sides
of a prop boundary.

It sits beside Dashboard rather than beside Warning even though both are lists of things
that are wrong: this one is the _business_ going wrong, Warning is the _imported data_
being wrong, and they are read by different people for different reasons. A manager
should be able to open it directly rather than going through the Dashboard first, which
is why it is a nav section and not a sixth Dashboard tab.

It is a **table, grouped by branch** — the same `TableContainer`/`Thead`/`Tbody` markup
the Warning page uses, with a severity badge, a Details toggle in the last column, and an
expanded row spanning every column, so the app's two lists of "things that are wrong"
read the same way even though one is about the business and the other about the data. The
table's own look is deliberately left alone as the page around it changes: gridlines,
header tint and row colouring stay the app's standard, because the table is the part of
this page a reader already knows from every other list.

Each branch gets a full-width band naming it and its count, rather than a Branch column
that would repeat the same name down every row. Branches are ordered by their worst
alert, and within a branch: critical first, then by category so the same kind of problem
reads together. The order is stable, so nothing jumps around between refreshes.

Every control sits in one row under the header — period, custom range, branch — with the
category chips on the line below it and the Refresh button in the header's action slot,
the same furniture and the same places as the Sale, Inventory and Data Overview pages.
Each chip shows its count under the current branch filter, so a chip's number always
matches what clicking it produces.

**An alert carries its figures as data, not only inside its sentences.** `Alert.facts`
is the labelled rows the detail panel shows — a single value (`{label, value}`) or a
movement (`{label, before, after, change, tone}`) — and `Alert.table` is the products
behind a list-shaped alert. Both are filled by the rules from the same figures the sentences
are built from, so the UI renders one set of numbers rather than recomputing a second —
the "nothing is measured twice" rule applied across the wire, extended to formatting: the
values arrive as finished strings, because formatting them twice is how a row ends up
disagreeing with the sentence beside it. A figure that could not be measured leaves its
`before`/`change` empty rather than showing a zero.

**Every branch appears, including the healthy ones.** Above the table sits one tile per
retail branch — its overall score, its status band, and how many alerts it has here.
A page that lists only problems can never answer _who is fine?_, and a branch that is
simply absent from it reads as one that failed to load rather than one with nothing to
act on. The score and the band are Overview's own, read off the same payload rather than
recomputed: `STATUS_META` moved from `OverviewTab.tsx` to `dashboard/helpers.ts` so both
screens call the same band "Healthy" in the same word and the same green. Tiles are
ordered worst-first like the table beneath them (critical alerts, then alert count, then
score), an unscored branch sorting last rather than as a 0 — the same "unmeasured is not
zero" rule the score itself follows. A tile's count is the branch's whole alert count on
this page, not the count under the selected category chip: the tile describes the branch,
the chips describe the filter. Clicking a tile filters the table to that branch and
clicking it again clears it, sharing state with the Branch selector, so a healthy tile is
a control rather than decoration.

**A branch that raised nothing gets one row saying so** — a green _Normal_ badge and
"Everything normal this period" — rather than no rows at all, for the same reason it gets
a tile: absence is unreadable. It is shown only when no category chip is active, since
under a chip "everything normal" would be a claim about one category worded as a claim
about the branch. `normal` alerts themselves sort to the end of a branch's rows, so a
notice that asks for nothing can never push a decision off the top of the list.

**Data-quality alerts are excluded.** They are about the imported data being wrong
rather than the business going wrong, and the Warning page already lists them row by row
with the tools to fix them; a summary of them here would split one job across two
screens.

It issues **no requests of its own**: it reads the same per-branch overview payloads
through `useCachedFetchMany`, which shares the cache with the single-URL hook — so
opening it after the Dashboard is instant, and opening it first warms the Dashboard.

The nav item carries a **count badge**, like Warning's. `App.tsx` fills it from the same
hook and the same URLs (every retail branch at the default 30-day window), so the badge
and the page can never disagree, and the requests it makes are the ones both the Dashboard
and this page were going to need anyway — a dedicated count endpoint would have done the
same work and thrown the result away. The badge counts every alert the page lists (critical, warning and normal, data-quality ones included) — the page's headline count — so the two always show the same number. Both follow the left-nav branch switcher: with one branch chosen only that branch's alerts are counted, with "All branches" every branch's are. The badge re-asks every ten minutes, since some alerts depend on the clock (a missing-file
alert only appears after the daily cutoff) and the long page cache never notices that.

Following an alert's evidence link crosses sections, so `App.tsx` holds the target and
passes it to `DashboardPage` as `initialTab`/`initialBranchId`; the page reads them on
mount, which is exactly what a section switch causes. Both pages drive their period
control from the same `usePeriodRange` hook and `PeriodControls` component, so the two
behave identically without one owning the other's state.

**Drill-through** is the point of the whole layout: Sales → Revenue, Profit → Cost,
Inventory → Inventory, Customer → Customer, and Data Quality leaves the dashboard for
the Warning page. The branch travels with it, so drilling in from a branch card shows
_that_ branch rather than whatever the shared selector was on.

Two Settings cards sit alongside the tab (admin only, retail workspaces only): the
weights and the thresholds described under **Tuning**.

**Period**: the shared period control now starts at **30d** rather than `today`, since
Overview is the landing tab and growth against a single previous day is noise.
Switching to another tab keeps whatever period is selected, exactly as before — so
Revenue opens on 30 days unless the user changes it.

## Not yet built

- **Early Warning engine** (`app/retail/services/early_warning.py`) — declarative rules over
  the same `BranchSnapshot`, producing severity-ranked alerts. The data-integrity rules
  will delegate to `data_quality.py` rather than reimplement it.

## Tests

`backend/tests/test_early_warning.py` covers the engine (a healthy branch raising
nothing, criticals sorting ahead of warnings, injectable thresholds, and that _every_
alert from every rule carries an action and a valid evidence link — asserted once
across the whole rule set rather than rule by rule) and each rule's own behaviour:
escalation thresholds, the missing-import case, the mutually-exclusive margin and stock
alerts, share-based rather than count-based firing, that `traffic_decline` needs both
halves of its pattern, and that data-quality alerts reuse the Warning page's own titles
and severities. Plus endpoint-level tests that alerts arrive on the payload sorted and
complete, that a threshold saved through `PUT /api/settings` changes which alerts fire,
and that a threshold set saved before a rule existed falls back to that rule's default.

`backend/tests/test_branch_health.py` covers configured weights changing the overall
score while leaving each dimension's own score untouched, the payload reporting the
weight actually used, weights that don't sum to 1 still scoring, saved weights reaching
the endpoint, the weight table summing to 1 at both levels, band interpolation and clamping, the non-monotonic days-of-inventory band,
every "unmeasured is null not zero" path (no sales last year, low cost coverage, no
stock snapshot, no records at all), sub-metric-level drop-out without losing the whole
dimension, weight re-normalisation and the overall arithmetic, data quality scoring as a
rate, and — at the endpoint level — the default 30d window, custom ranges, retail-only
branch resolution, and that Overview's `metrics` match what the Revenue / Cost /
Inventory endpoints report for the same branch and period.
