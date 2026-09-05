# Branch Health Score

The "Overview" tab of the retail dashboard, and the first half of turning BranchWise
from a set of charts into a decision support system. Where the Revenue / Cost /
Inventory / Customer tabs each answer "what are the numbers," Overview answers **"is
this branch healthy, and if not, which part of it isn't"** — one 0-100 score per
dimension plus one overall score, so a manager reads `Inventory 54 — critical` and
clicks straight through to the Inventory tab for the evidence, instead of opening four
tabs and interpreting them by hand.

Backed by `GET /api/dashboard/overview` (`app/routers/dashboard.py`), computed in
`app/services/branch_health.py` (the score), `app/services/early_warning.py` (the
alerts) and `app/services/explanation.py` (why each alert happened), rendered by
`frontend/renderer/src/components/features/dashboard/OverviewTab.tsx`.

## Two rules the whole design rests on

**1. Nothing is measured twice.** Every raw number comes from the helper that the
matching dashboard tab itself uses — `_revenue_totals`, `_cost_totals_and_products`,
`_stock_summary`, `_basket_stats` in `app/services/dashboard.py`, and
`build_warning_sections` in `app/services/data_quality.py`. Overview is a second
*reading* of the pillars' figures, never a second *computation* of them. If a red
Inventory score sent a manager to an Inventory tab that reported a different dead-stock
count, neither number would ever be trusted again. `test_overview_reports_the_same_figures_as_the_tabs_it_links_to`
exists specifically to keep that true.

Two small refactors in `dashboard.py` were made to serve this rather than duplicate it:
`_cost_totals_and_products` now also returns `priced_net_revenue` (the cost-coverage
denominator), and `_stock_summary` was split out of `build_inventory_dashboard` so the
score can read the same stock figures without paying for a second warnings pass.

**2. A number that can't be known is `null`, never `0`.** A branch with no
previous-period sales has no computable growth. A branch whose products have no buying
price has no computable margin. Scoring either as 0 would tell a manager their branch is
failing when the truth is that it hasn't been measured — the single most damaging thing
a health score can do. Instead the sub-metric drops out, the remaining weights within
its dimension are re-normalised, the dimension's `insufficient_data_reason` says in
plain English what's missing (usually: import the missing records), and if a whole
dimension drops out, the remaining dimensions re-normalise to share 100% of the overall
score between them. `scored_weight` reports how much of the weight table was actually
measurable, and each dimension's `effective_weight` reports what it really contributed.

## The scoring table

Five dimensions, weighted:

| Dimension | Weight | Question it answers |
| --- | ---: | --- |
| Sales | 25% | Is the branch selling more or less than the previous period of the same length? |
| Profit | 25% | Is what it sells actually making money, and is that improving? |
| Inventory | 25% | Is stock moving, and is it about to run out of anything that sells? |
| Customer | 15% | Are shoppers buying more per visit, or making smaller, single-item trips? |
| Data Quality | 10% | Can the four scores above be trusted? |

Each dimension is a weighted average of its sub-metrics:

| Dimension | Sub-metric | Weight | Score bands (value → score) |
| --- | --- | ---: | --- |
| Sales | Revenue growth % | 50% | -20→0, -10→40, 0→70, +10→100 |
| Sales | Transaction growth % | 30% | same as above |
| Sales | Average sale growth % | 20% | -15→0, -5→50, 0→75, +5→100 |
| Profit | Gross margin % | 60% | 0→0, 10→40, 20→80, 30→100 |
| Profit | Margin change (pp) | 40% | -10→0, -3→50, 0→75, +3→100 |
| Inventory | Dead stock share % | 40% | 0→100, 5→80, 15→40, 30→0 |
| Inventory | Stockout risk share % | 30% | 0→100, 2→85, 5→60, 10→20, 20→0 |
| Inventory | Days of inventory on hand | 30% | 0→50, 15→90, 30→100, 45→85, 60→60, 90→30, 120→0 |
| Customer | Items per basket growth % | 55% | -15→0, -5→50, 0→75, +5→100 |
| Customer | Single-item basket share % | 45% | 30→100, 50→75, 70→40, 85→0 |
| Data Quality | Issues per 100 records | 70% | 0→100, 1→80, 3→50, 10→10, 20→0 |
| Data Quality | Stock mismatches (count) | 30% | 0→100, 1→70, 5→30, 20→0 |

Each sub-metric also carries a `unit` telling the frontend how to render its raw
value. `pct_change` and `pct_points` are movements and get a green/red ▲/▼ arrow and a signed
number — the same arrows and colours the stat tiles use, so "this went up" looks the same
across the app — while `pct` is a plain level (`30.0%`); the rest are `days`, `count` and
`rate`. The colour follows the direction rather than whether the movement was good: on
single-item basket share a rise is a problem, so green means "went up", and the score
beside it is what judges. `pct_points` is written out as "points" rather than `pp`, which
is correct, standard, and unread by anyone outside finance.

A value between two breakpoints is linearly interpolated; a value past either end is
clamped. Because the score is stated *per breakpoint* rather than derived from the
value's direction, one mechanism covers "higher is better" (revenue growth), "lower is
better" (dead stock), and "there is a healthy middle" — days of inventory on hand peaks
at 30 days and falls off on *both* sides, since under two weeks of cover is a stockout
waiting to happen and over two months is cash sitting on a shelf.

Status bands, used identically by the gauge, the dimension bars and (later) the alerts:
**≥ 80 healthy**, **≥ 60 needs attention**, **below 60 critical**.

### Choices worth defending

- **0% growth scores 70, not 100.** Flat is acceptable, not excellent.
- **Transactions appear in Sales but deliberately not in Customer**, even though
  footfall is a customer-side idea. It is already 30% of the Sales dimension, and
  counting the same movement twice would let one bad week hit the overall score through
  two doors at once.
- **Data quality is a rate, not a count.** 40 warnings across 40,000 rows is a clean
  import; 40 across 200 is a broken one. The denominator (`records_checked`) is the
  period's sale lines + purchase lines + the branch's current SKU count.
- **Profit is gated on cost coverage.** Costs are *estimates* from
  `app/services/pricing.py`'s point-in-time buying price, and a product with no cost
  estimate is simply not costed. Below `MIN_COST_COVERAGE_PCT` (50%) of period revenue
  having any cost estimate at all, the margin figure describes a minority of the
  business and is not worth a quarter of the score, so the dimension is dropped with a
  reason naming the actual coverage. `cost_coverage_pct` is always reported in
  `metrics` regardless.

## The Early Warning engine

The score says *which part* of a branch is unhealthy. `app/services/early_warning.py`
answers the next question — **what specifically is wrong, and what should I do about
it** — as a severity-ranked list of named problems on the same payload.

Each rule is a pure `(BranchSnapshot, Thresholds) -> list[Alert]` registered in one
`RULES` tuple, so adding a check means appending a function and nothing else in the file
changes. Every alert carries `title`, `what_happened`, `recommended_action`, a
`severity`, the `dimension` it belongs to, and the `link` naming the tab holding its
evidence.

**There are three severities, and only two of them ask for anything.** `critical` is act
today, `warning` is act soon, and `normal` is a movement drifting the wrong way that is
not worth doing anything about yet — a margin down a point, a product with a fortnight of
cover left. A third level is normally how an alert list turns into noise, and the reason
it does not here is that **nothing counts it**: the nav badge, the Business Alerts branch
tiles and the Overview branch cards all count criticals and warnings only, so the number
a manager reacts to still means "things to act on", while the list itself can show the
drift that used to produce no row at all. A `normal` alert's `recommended_action` says as
much in its first words ("Nothing to act on yet…"), and there is a test asserting it.

| Rule | Fires when | Severity |
| --- | --- | --- |
| `no_sales_recorded` | No sales at all this period, after a period that had them | critical |
| `revenue_decline` | Revenue growth ≤ -5% (≤ -10% and ≤ -20% escalate) | normal / warning / critical |
| `low_margin` | Gross margin < 15% (< 10% and < 5% escalate) | normal / warning / critical |
| `margin_slipping` | Margin fell ≥ 1 percentage point (≥ 3 escalates) | normal / warning |
| `stockout_risk` | Any product with ≤ 3 days of stock left | critical |
| `low_stock` | Any product with < 7 days of stock left | warning |
| `watch_stock` | Any product with 7–14 days of stock left | normal |
| `dead_stock` | ≥ 5% of SKUs on the shelf with no sale in 90 days (≥ 10% and ≥ 25% escalate) | normal / warning / critical |
| `traffic_decline` | Transactions down ≥ 10% while the average sale rose **and** revenue itself stayed quiet | warning |
| `single_item_baskets` | ≥ 45% of transactions were one line item (≥ 60% escalates) | normal / warning |
| `data_quality_*` | Any Warning-page check found rows this period | that check's own severity |

Two rules deliberately have no `normal` tier. `no_sales_recorded` is never mild — an
empty period is either a missing import or a shut shop. `traffic_decline` is already the
narrow hidden case (see below), and a milder version of "the headline looks fine" is
indistinguishable from an ordinary week. `watch_stock` is the opposite: the one rule that
exists *only* at `normal`, reusing the Inventory tab's own third band
(`WATCH_DAYS_OF_STOCK` = 14), so the three stock levels on that page and the three
severities here are the same three bands rather than two sets that can drift apart.

Three design rules behind that table:

- **One rule owns one subject.** A margin below the floor and a margin that is slipping
  are the same conversation, so one rule reports whichever is worse rather than two
  firing about one number and burying everything else. Same for stockout vs. low stock,
  and for revenue decline vs. an empty period. `traffic_decline` extends this across
  rules: it fires only when revenue itself stayed quiet — quiet enough that
  `revenue_decline` said nothing at all, including at its `normal` tier — because a
  visible revenue fall is already decomposed by `revenue_decline` into exactly this
  explanation, and a second card repeating it word for word is the duplication everything
  else here avoids. What
  is left is the genuinely hidden case — the headline looks fine because bigger baskets
  covered for the customers who stopped coming.
- **An empty period is reported as a missing import, not a 100% collapse.** A period
  with no sales at all, after one that had them, is nearly always a file nobody
  imported; sending a manager to investigate the shop floor over it would be the most
  annoying thing this engine could do.
- **Data-integrity alerts delegate to `data_quality.py` entirely**, down to that
  check's own title and severity (carried on the snapshot as `data_issue_sections`).
  The engine holds no second opinion about what counts as a data problem or how bad one
  is — it surfaces what the Warning page already found, scoped to this branch and
  period, and links back to it.

Thresholds live in a frozen `Thresholds` dataclass that every rule takes as an
argument, built from `app_settings` on each request (see **Tuning** below).
`dead_stock` and `single_item_baskets` fire on *shares*, not raw counts: twelve dead
SKUs is nothing in a 1,000-product shop and serious in a 40-product one.

Alerts are computed, never generated — every sentence is a template filled with figures
from the snapshot. Nothing in this engine asks a model what it thinks.

## Why it happened

`app/services/explanation.py`. An alert saying "revenue is down 11.3%" tells a manager
something they could read off a chart. The next sentence is the one that changes what
they do: *fewer people came in, and the ones who did spent more* calls for marketing,
opening hours or staffing; *the same people bought less each* calls for pricing,
placement or stock. Two different decisions behind one identical headline.

Every explanation here is **arithmetic**, never a model's opinion. Revenue decomposes
exactly:

```
revenue = transactions × average basket

Δrevenue = (ΔT × B₀)   +   (ΔB × T₀)   +   (ΔT × ΔB)
           transactions     basket          interaction
           effect           effect
```

The three terms sum to the actual change with **no residual** — there is a test
asserting exactly that across four different shapes of movement — so whichever of the
first two is larger *is* the driver. It is measured, not inferred. That is the whole
reason this is a module rather than a prompt: a decomposition can be checked by hand,
and it cannot be confidently wrong.

A term is called "the" driver only above `DOMINANCE_SHARE` (65%) of the combined
movement; between 35% and 65% the honest answer is that both are contributing, and the
text says so rather than picking a winner by a nose. The interpretation also branches on
the **signs** of the two effects, not only on which is larger: when they pull in
opposite directions, naming the bigger one as "the cause" while ignoring that the other
partly cancelled it would misdescribe what happened, and a branch whose revenue held up
purely because bigger baskets covered for lost footfall is in a genuinely different
position from one whose revenue fell.

Margin gets its own treatment, because a ratio's movement is really a race between two
growth rates — what the branch sold for, against what it paid for what it sold. Three
named causes come out of that comparison: `costs_outpaced_sales` (selling more without
keeping more of it — buying prices or mix), `sales_fell_faster_than_costs` (selling
prices or mix, not suppliers), and `costs_rose_while_sales_fell` (both sides moved
against the margin). A low margin *level* is a different question again, and
`describe_margin_level` answers the one that changes the decision: whether it is new. A
margin thin for months is a pricing decision to revisit; one that was healthy last
period is an event to investigate.

**Stock risk decomposes the same way**, because days left = on hand ÷ recent selling
rate. A product hits the threshold either because its stock fell or because its sales
rose, and those call for different responses — reorder sooner, versus reorder *more*.
`classify_stock_risk` compares each at-risk product's recent daily rate against its own
rate over the 60 days before that (backed out of the 30- and 90-day velocity figures
`_stock_summary` already computes, so it costs no extra query), and calls the risk
`demand`, `drawdown` or `mixed` by the same 65% dominance rule. A product that sold
nothing at all in the earlier window counts as new demand rather than getting a ratio —
dividing by zero aside, "new" is the stronger signal of the two.

**A high single-item basket share** gets the `low_margin` treatment, since it is also a
level rather than a movement: the question that changes the decision is whether it is
new. A branch that has always sold this way has a layout and bundling question; one that
jumped from 45% to 78% has an event to find — a companion product out of stock, or a
display that moved. Its drift threshold is 5 percentage points rather than margin's 1,
because basket composition moves with the weather and the day of the week.

In the UI (`AlertExplanation` in `dashboard/shared.tsx`) an opened alert reads as four
labelled parts, in the order a reader asks for them: **What happened**, **Possible
driver**, **Interpretation**, **What to do**.

Driver and interpretation are separate sections rather than one paragraph because they
are different kinds of claim — the driver is measured ("transactions −17.8%, average sale
+7.9%"), the interpretation is the reading of it ("this is a footfall problem, not an
average-sale one"). Running them together lets the second borrow the authority of the
first. The action sits apart, tinted and holding the evidence button, since it is the
thing the whole alert exists to produce.

A redesign of this panel — one sentence, the figures as chips, and the arithmetic behind a
"How this was worked out" disclosure — was built and then reverted at the business's
request; the four-part layout is what ships. `Alert.chips` and `Alert.evidence` (below)
remain on the payload, so it can be picked up again without touching the engine.

Percentages, money and counts inside those sentences are bolded, so a reader can take the
number off the row at a glance and read the sentence only if they want the rest.

Explanations are attached by the rules that raise the alert, and a rule with nothing to
decompose leaves `driver`/`interpretation` empty rather than inventing a cause — a
dead-stock count has no two components to split it into, and the "why" behind a
data-quality alert is the individual flagged rows, which already exist on the Warning
page and would be worse as a generated summary. `no_sales_recorded` also stays empty:
everything is down 100%, so decomposing it yields only noise, and its recommended
action already carries the real explanation.

Alert text is written to read as a sentence rather than a spreadsheet row: "1 product
has … at its recent selling rate", never "1 product(s) have … at their"; and with a
single product at risk the driver names it directly instead of reporting "0 of the 1
at-risk products", which is the right count and the wrong sentence.

Money figures never appear in these sentences, only percentages and directions. The
effects are computed in Kyat internally to decide which term dominates, but a manager
reading "transactions are down 18.0%" does not need the Ks figure behind it, and
printing one would invite comparing it against a revenue total it is not directly
comparable to.

## Tuning

The dimension weights and every rule's firing point are business-wide settings, editable
by an admin on the Settings page under **Branch health weights** and **Early warning
thresholds**. This is what makes "are these weights right?" an answerable question
rather than an assertion: score the same branch and period under two weightings and
compare.

Both live in `app_settings` as a single nested JSON value each
(`branch_health_weights`, `early_warning_thresholds`) rather than as fourteen flat keys.
They are each edited as a *set* — a weight only means anything relative to the other
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
`dead_stock_normal_share_pct`, `single_item_basket_normal_share_pct`) alongside the
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
                     # recommended_action, link, driver, interpretation
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
  dimension weights and the alert thresholds *are* configurable (see **Tuning**); the
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
  (`SubMetric.calculation`, evaluated against the snapshot): *"312 of 629 products with
  stock"*, *"Ks 77,000,000 of stock ÷ Ks 686,667 of goods sold per day"*.
- **How it scores** — the band table itself, rendered from `SubMetric.bands`, with this
  period's value marked on it.

**And the alert about that measure, if there is one** — its severity, what happened,
the driver, the interpretation and what to do, in full. Every alert names the
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
"View Revenue" link, and it was the wrong one — that tab shows *related* data, not the
calculation, so a reader still had to take the number on faith.

It deliberately does **not** list the branch's alerts, only a one-line count linking to
the Business Alerts page. Earlier versions did list them, from before that page existed;
once it did, showing them in both places made two pages that answered the same question
badly instead of two that answer different questions well — *what is wrong and what do I
do* there, *why is this number what it is* here.

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
that are wrong: this one is the *business* going wrong, Warning is the *imported data*
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

**An alert carries its figures as data, not only inside its sentences.** `Alert.chips`
is the two or three numbers that make it legible at a glance (`{label, value, unit}` —
`pct_change`/`pct_points` are movements, `pct`/`count`/`days` are levels), and
`Alert.evidence` is the decomposition behind it (`kind: "revenue_split"`, the before and
after totals, and the three parts that sum to the change). Both are filled by the rules
from the same `explanation.py` results the sentences were built from, so the UI renders
one set of numbers rather than recomputing a second — the "nothing is measured twice"
rule applied across the wire. Nothing renders them today — the panel that used them was
reverted (above) — but they cost one dataclass field each and mean a future panel reads
figures rather than re-deriving them. A figure that could not be measured produces no chip at all
rather than a zero, and a rule with nothing to decompose leaves `evidence` null, exactly
as it already leaves `driver` empty.

**Every branch appears, including the healthy ones.** Above the table sits one tile per
retail branch — its overall score, its status band, and how many alerts it has here.
A page that lists only problems can never answer *who is fine?*, and a branch that is
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

**A branch that raised nothing gets one row saying so** — a green *Normal* badge and
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
same work and thrown the result away. Data-quality alerts are left out of the count for
the same reason they are left out of the page: the Warning badge beside it already counts
those.

Following an alert's evidence link crosses sections, so `App.tsx` holds the target and
passes it to `DashboardPage` as `initialTab`/`initialBranchId`; the page reads them on
mount, which is exactly what a section switch causes. Both pages drive their period
control from the same `usePeriodRange` hook and `PeriodControls` component, so the two
behave identically without one owning the other's state.

**Drill-through** is the point of the whole layout: Sales → Revenue, Profit → Cost,
Inventory → Inventory, Customer → Customer, and Data Quality leaves the dashboard for
the Warning page. The branch travels with it, so drilling in from a branch card shows
*that* branch rather than whatever the shared selector was on.

Two Settings cards sit alongside the tab (admin only, retail workspaces only): the
weights and the thresholds described under **Tuning**.

**Period**: the shared period control now starts at **30d** rather than `today`, since
Overview is the landing tab and growth against a single previous day is noise.
Switching to another tab keeps whatever period is selected, exactly as before — so
Revenue opens on 30 days unless the user changes it.

## Not yet built

- **Early Warning engine** (`app/services/early_warning.py`) — declarative rules over
  the same `BranchSnapshot`, producing severity-ranked alerts. The data-integrity rules
  will delegate to `data_quality.py` rather than reimplement it.

## Tests

`backend/tests/test_explanation.py` covers the decomposition's defining property — the
three effects summing exactly to the actual change, across four shapes of movement —
plus attribution to visits, to baskets, and to "both" when neither dominates; the
sign-aware wording when revenue held up despite lost footfall; the three margin causes;
whether a low margin level is reported as new or standing; the stock-risk split between
demand speeding up and stock running down (including the no-earlier-sales case and the
single-product wording); whether a high single-item share is reported as new or
standing; and that alerts with nothing to decompose leave the fields empty. It also asserts that no two alerts on one branch
carry identical explanation text.

`backend/tests/test_early_warning.py` covers the engine (a healthy branch raising
nothing, criticals sorting ahead of warnings, injectable thresholds, and that *every*
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
every "unmeasured is null not zero" path (no previous period, low cost coverage, no
stock snapshot, no records at all), sub-metric-level drop-out without losing the whole
dimension, weight re-normalisation and the overall arithmetic, data quality scoring as a
rate, and — at the endpoint level — the default 30d window, custom ranges, retail-only
branch resolution, and that Overview's `metrics` match what the Revenue / Cost /
Inventory endpoints report for the same branch and period.
