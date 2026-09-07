# BranchWise — calculation diagrams

Diagrams for explaining **how BranchWise works out its numbers** — the dashboard, the
Branch Health Score, the alerts, and the Warning page. They are written for a business
audience (a teacher, a manager, an assessor): every box names a business idea, not a
piece of code.

Fifteen diagrams. The first eight tell the whole story, one topic each. Six more are
the alert **decision trees** — one per pillar, in full, for when someone asks "but how
does it decide?" and a summary slide is not enough. The last two are the one-slide
overview of Business Alerts, and one worked example to make it concrete.

## Turning these into images

```
npm run diagrams
```

That renders every `.mmd` file in this folder to a PNG (about 3,000 px wide, for slides)
and an SVG (for Word or a poster) in `diagram/out/`. The canvas is deliberately wide, so
a left-to-right tree keeps readable text instead of being squeezed. It uses `mermaid-cli`, installed by `npm install`
at the repo root, driving the copy of Google Chrome already on this machine
(`diagram/puppeteer-config.json` points at it — change that path if Chrome lives
somewhere else). Edit a `.mmd` file and run the command again to update its image.

Each `.mmd` starts with a shared styling line so all the diagrams look alike; red means
critical, amber means warning, grey-blue means a normal notice that asks for nothing,
green means fine or no alert, blue means data coming in, and purple diamonds are the
"why did this happen" question inside a tree.
`_style.txt` and `_classes.txt` hold that shared styling for when you add a new diagram —
they are not diagrams themselves.

## What each one shows

| # | File | Shows |
| --- | --- | --- |
| 01 | `01-big-picture` | The whole path from imported data to a decision. Use this one if you only have room for a single slide. |
| 02 | `02-health-score` | The five parts of the Health Score, what each is worth, and the healthy / needs-attention / critical bands. |
| 03 | `03-health-what-each-part-measures` | The measures inside each of those five parts, and their weights. |
| 04 | `04-value-to-score` | How one figure turns into a score out of 100 — and what happens when it cannot be measured at all. |
| 05 | `05-alerts-sales-and-profit` | The sales and profit alerts, as decision trees. |
| 06 | `06-alerts-stock-and-baskets` | The stock alerts (running out, not moving) and the shopping-behaviour alert. |
| 07 | `07-warning-checks` | The Warning page's checks, and how a warning gets fixed. |
| 08 | `08-dashboard` | How the four dashboard tabs are built from the same records, each compared with the period before. |
| 09 | `09-tree-sales-revenue` | **Sales pillar** — the revenue tree in full, including the empty-period case and the fewer-customers / smaller-basket split. |
| 10 | `10-tree-profit-margin` | **Profit pillar** — the margin tree: is it low, is it slipping, and why. |
| 11 | `11-tree-inventory-stock-running-out` | **Inventory pillar** — days of stock left, the three bands, and order-more versus order-sooner. |
| 12 | `12-tree-inventory-dead-stock` | **Inventory pillar** — stock that has not sold in 90 days, judged as a share. |
| 13 | `13-tree-customer-losing-customers` | **Customer pillar** — the hidden case: fewer shoppers behind a steady revenue line. |
| 14 | `14-tree-customer-single-item` | **Customer pillar** — sales that hold only one product, and whether that is new. |
| 15 | `15-business-alerts-overview` | Business Alerts on one slide: the four pillars, the limit check, and the three levels. |
| 16 | `16-example-revenue-alert` | One alert end to end with real figures: a branch's revenue fall, the level it earns, and the reason behind it. |

Suggested order for a short talk: **01 → 02 → 04 → 05 → 07**. If the audience wants the
detail of one pillar, follow with its tree from 09–14 rather than all six.

The written version of the same six trees, with a worked example for each, is
[`docs/business-alerts.md`](../docs/business-alerts.md).

The thresholds and weights shown here are the shipped defaults; several can be tuned on
the admin Settings page. The full written descriptions live in `docs/branch_health.md`
and `docs/retail_dashboard.md`.

## BranchWise — from imported data to a decision

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart LR
    A["Imported POS data<br/>Sales · Inventory · Purchases"]:::data
    A --> B["Dashboard<br/>the numbers"]
    A --> C["Warning page<br/>is the data trustworthy?"]
    B --> D["Health Score<br/>is this branch healthy?"]
    C --> D
    B --> E["Alerts<br/>what exactly is wrong?"]
    C --> E
    D --> F["Manager decides<br/>and acts"]:::good
    E --> F
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
```

## Health Score — five parts make one score

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart LR
    S["Sales<br/>25%"] --> T["Weighted average"]
    P["Profit<br/>25%"] --> T
    I["Inventory<br/>25%"] --> T
    C["Customer<br/>15%"] --> T
    Q["Data Quality<br/>10%"] --> T
    T --> R["Overall score<br/>0 - 100"]
    R --> G["80 and above<br/>Healthy"]:::good
    R --> A["60 to 79<br/>Needs attention"]:::warn
    R --> B["Below 60<br/>Critical"]:::crit
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
```

## Health Score — what each part measures

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart TD
    S["Sales — 25%"] --> S1["Revenue growth<br/>50%"]
    S --> S2["Transaction growth<br/>30%"]
    S --> S3["Average sale growth<br/>20%"]
    P["Profit — 25%"] --> P1["Gross margin<br/>60%"]
    P --> P2["Change in margin<br/>40%"]

    S1 ~~~ I["Inventory — 25%"]
    S1 ~~~ C["Customer — 15%"]
    I --> I1["Dead stock share<br/>40%"]
    I --> I2["Stockout risk share<br/>30%"]
    I --> I3["Days of stock on hand<br/>30%"]
    C --> C1["Items per basket<br/>55%"]
    C --> C2["One-item baskets<br/>45%"]

    I1 ~~~ Q["Data Quality — 10%"]
    Q --> Q1["Issues per 100 records<br/>70%"]
    Q --> Q2["Stock mismatches<br/>30%"]
```

## How one figure becomes a score out of 100

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart TD
    V["Revenue growth = -5%"]:::data --> K{"Can it be measured?"}
    K -- "No previous period<br/>or no cost data" --> N["Not scored.<br/>The other measures share its weight,<br/>and the reason is shown"]:::warn
    K -- Yes --> T["Its band table<br/>-20% = 0 · -10% = 40<br/>0% = 70 · +10% = 100"]
    T --> L["In between: straight line<br/>Past either end: capped"]
    L --> O["Score = 55"]:::good
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
```

## Alerts about sales and profit

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart TD
    A["Sales this period"]:::data --> Q1{"Any sales at all?"}
    Q1 -- "None, but last period had some" --> C1["CRITICAL<br/>Probably a file nobody imported"]:::crit
    Q1 -- Yes --> Q2{"Revenue against<br/>last period"}
    Q2 -- "Down 20% or more" --> C2["CRITICAL<br/>Revenue decline"]:::crit
    Q2 -- "Down 10% to 20%" --> W1["WARNING<br/>Revenue decline"]:::warn
    Q2 -- "Looks flat" --> Q3{"Fewer customers,<br/>but bigger baskets?"}
    Q3 -- Yes --> W2["WARNING<br/>Customers quietly stopped coming"]:::warn

    M["Gross margin"]:::data
    M --> Q4{"How high is it?"}
    Q4 -- "Below 5%" --> C3["CRITICAL<br/>Very low margin"]:::crit
    Q4 -- "5% to 10%" --> W3["WARNING<br/>Low margin"]:::warn
    Q4 -- "10% or above" --> Q5{"Fell 3 points<br/>or more?"}
    Q5 -- Yes --> W4["WARNING<br/>Margin slipping"]:::warn
    Q5 -- No --> OK["No profit alert"]:::good
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
```

## Alerts about stock and shopping behaviour

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart TD
    S["Stock on hand and<br/>recent selling speed"]:::data --> Q1{"Days of stock left"}
    Q1 -- "3 days or less" --> C1["CRITICAL<br/>About to run out"]:::crit
    Q1 -- "Under 7 days" --> W1["WARNING<br/>Low stock"]:::warn
    Q1 -- Comfortable --> Q2{"Share unsold<br/>for 90 days"}
    Q2 -- "25% or more" --> C2["CRITICAL<br/>Dead stock"]:::crit
    Q2 -- "10% to 25%" --> W2["WARNING<br/>Dead stock"]:::warn

    B["Baskets this period"]:::data
    B --> Q3{"Share holding<br/>just one item"}
    Q3 -- "60% or more" --> W3["WARNING<br/>Shoppers buy one thing and leave"]:::warn
    Q3 -- "Under 60%" --> OK["No basket alert"]:::good
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
```

## Warning page — checking the data can be trusted

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart TD
    D["Confirmed imports"]:::data --> N["Are the numbers sensible?<br/>no zero prices,<br/>no negative quantities"]
    D --> M["Is every item sold or bought<br/>also on the stock list?"]
    D --> R["Last count + purchases - sales<br/>= the stock counted now?"]
    N --> L["Warning list<br/>plain note · the field at fault ·<br/>link to the import that caused it"]:::warn
    M --> L
    R --> L
    L --> F["Undo that import,<br/>correct the file,<br/>import it again"]
    F --> G["Warning cleared,<br/>audit trail kept"]:::good
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
```

## Dashboard — one branch, one date range, four questions

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart TD
    R["Imported records for<br/>one branch and date range"]:::data --> A["Totals for this period<br/>and the period before it"]
    A --> T1["Revenue<br/>How much did we sell?"]
    A --> T2["Cost<br/>Did we make money on it?"]
    A --> T3["Inventory<br/>What is on the shelf?"]
    A --> T4["Customer<br/>How are people shopping?"]
    T1 --> U["Every figure carries its change<br/>green for up, red for down"]
    T2 --> U
    T3 --> U
    T4 --> U
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
```

## Decision tree — Sales pillar: revenue

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart LR
    A["Sales for this branch<br/>this period, against the same number of days before"]:::data
    A --> Q1{"Any sales at all<br/>this period?"}
    Q1 -- "None, but the period before had sales" --> C1["CRITICAL - No sales recorded<br/>Almost always a file nobody imported<br/>DO: open Import History for this branch"]:::crit
    Q1 -- "None before either" --> Z1["No alert<br/>First period for this branch,<br/>nothing to compare with"]:::good
    Q1 -- "Yes" --> Q2{"Revenue change<br/>against the period before"}
    Q2 -- "Better than 5% down" --> Z2["No alert"]:::good
    Q2 -- "Down 5% to 10%" --> N1["NORMAL - Revenue is drifting down<br/>Nothing to act on yet"]:::norm
    Q2 -- "Down 10% to 20%" --> W1["WARNING - Revenue is falling"]:::warn
    Q2 -- "Down 20% or more" --> C2["CRITICAL - Revenue has fallen sharply"]:::crit
    N1 --> WHY{"Why?<br/>Revenue = number of sales x average sale"}:::why
    W1 --> WHY
    C2 --> WHY
    WHY -- "Fewer sales cause 65% or more" --> D1["A footfall problem first<br/>DO: Revenue tab, daily trend -<br/>when did it start?"]
    WHY -- "Smaller average sale causes 65% or more" --> D2["People still come in,<br/>they buy less each time<br/>DO: compare top products with last period"]
    WHY -- "Neither reaches 65%" --> D3["Both, roughly equally -<br/>neither one explains it alone"]
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
    classDef norm fill:#f1f5f9,stroke:#94a3b8,color:#334155
    classDef why fill:#ede9fe,stroke:#a78bfa,color:#4c1d95
```

## Decision tree — Profit pillar: margin

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart LR
    A["Margin = sales minus the cost of the goods sold,<br/>divided by sales<br/>Cost comes from the purchase imports"]:::data
    A --> Q1{"Could we price at least half<br/>of this period's sales?"}
    Q1 -- "No" --> Z1["No alert<br/>A margin from a minority of the sales<br/>is not solid enough to act on"]:::good
    Q1 -- "Yes" --> Q2{"Is the margin below 15%?<br/>a LEVEL - is it low?"}
    Q2 -- "Below 5%" --> C1["CRITICAL - Margin below a healthy level"]:::crit
    Q2 -- "5% to 10%" --> W1["WARNING - Margin below a healthy level"]:::warn
    Q2 -- "10% to 15%" --> N1["NORMAL - Margin is on the low side"]:::norm
    Q2 -- "15% or above" --> Q3{"Did it fall against last period?<br/>a MOVEMENT - is it slipping?"}
    Q3 -- "Fell less than 1 point" --> Z2["No alert<br/>Drift on an estimate, not a fall"]:::good
    Q3 -- "Fell 1 to 3 points" --> N2["NORMAL - Margin has edged down"]:::norm
    Q3 -- "Fell 3 points or more" --> W2["WARNING - Margin is slipping"]:::warn
    C1 --> WHY1{"Why? Is this low margin new,<br/>or normal for this branch?"}:::why
    W1 --> WHY1
    N1 --> WHY1
    WHY1 -- "Same as last period" --> L1["A standing level:<br/>pricing and product mix"]
    WHY1 -- "Fell from a healthier level" --> L2["A recent move:<br/>find what changed this period"]
    WHY1 -- "Rose, but still low" --> L3["Improving, but not there yet"]
    L1 --> DO1["DO: Cost tab, profit ranking -<br/>the products holding it down<br/>sit at the bottom"]
    L2 --> DO1
    L3 --> DO1
    N2 --> WHY2{"Why? A race between two growth rates:<br/>what we sold for, and what we paid for it"}:::why
    W2 --> WHY2
    WHY2 -- "Costs up while sales went down" --> M1["Both sides moved against the margin"]
    WHY2 -- "Costs grew faster than sales" --> M2["Buying prices or product mix"]
    WHY2 -- "Costs fell, sales fell faster" --> M3["Selling prices or product mix"]
    M1 --> DO2["DO: Cost tab, revenue-versus-cost chart -<br/>the gap between the two lines is the margin"]
    M2 --> DO2
    M3 --> DO2
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
    classDef norm fill:#f1f5f9,stroke:#94a3b8,color:#334155
    classDef why fill:#ede9fe,stroke:#a78bfa,color:#4c1d95
```

## Decision tree — Inventory pillar: stock running out

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart LR
    A["Every product on the newest stock count"]:::data
    A --> Q1{"Did it sell at all<br/>in the last 30 days?"}
    Q1 -- "No" --> X["Not counted here - no selling rate,<br/>so no days left.<br/>It goes to the dead-stock check"]:::data
    Q1 -- "Yes" --> D["Days left = stock on hand<br/>divided by units sold per day"]
    D --> Q2{"The branch alert is the worst band<br/>that has anything in it"}
    Q2 -- "3 days or less" --> C1["CRITICAL - Products about to run out"]:::crit
    Q2 -- "4 to 7 days" --> W1["WARNING - Stock is running low"]:::warn
    Q2 -- "8 to 14 days" --> N1["NORMAL - Stock worth keeping an eye on"]:::norm
    Q2 -- "More than 14 days" --> Z1["No alert"]:::good
    C1 --> WHY{"Why are they running out?<br/>Each one's last 30 days against<br/>its own earlier rate"}:::why
    W1 --> WHY
    N1 --> WHY
    WHY -- "Most selling 1.3x faster or more" --> R1["Demand grew:<br/>ORDER MORE, not just sooner"]
    WHY -- "Most at their usual rate" --> R2["Stock was left to run down:<br/>ORDER SOONER"]
    WHY -- "A mix of both" --> R3["Check the quantities<br/>product by product"]
    R1 --> DO["DO: Inventory tab, low-stock table -<br/>sorted by days left, so what to<br/>reorder first is at the top"]
    R2 --> DO
    R3 --> DO
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
    classDef norm fill:#f1f5f9,stroke:#94a3b8,color:#334155
    classDef why fill:#ede9fe,stroke:#a78bfa,color:#4c1d95
```

## Decision tree — Inventory pillar: dead stock

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart LR
    A["Products that still have stock on the shelf"]:::data
    A --> Q1{"Sold at least once<br/>in the last 90 days?"}
    Q1 -- "Yes" --> Z0["Not dead stock"]:::good
    Q1 -- "No" --> S["Count them as a share of all<br/>products with stock on the shelf"]
    S --> Q2{"How big is the share?"}
    Q2 -- "Under 5%" --> Z1["No alert<br/>Every shop carries some"]:::good
    Q2 -- "5% to 10%" --> N1["NORMAL - Some stock is not moving"]:::norm
    Q2 -- "10% to 25%" --> W1["WARNING - Too much stock is not moving"]:::warn
    Q2 -- "25% or more" --> C1["CRITICAL - Too much stock is not moving"]:::crit
    N1 --> DO["DO: Inventory tab, dead-stock table -<br/>the clearance candidates, and the<br/>products not to reorder"]
    W1 --> DO
    C1 --> DO
    S --> NOTE["Judged as a share, never as a count:<br/>60 dead products mean something different<br/>in a 400-product shop and a 6,000-product shop"]:::data
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
    classDef norm fill:#f1f5f9,stroke:#94a3b8,color:#334155
    classDef why fill:#ede9fe,stroke:#a78bfa,color:#4c1d95
```

## Decision tree — Customer pillar: losing customers

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart LR
    A["The hidden case: the money looks fine,<br/>but fewer people are coming in"]:::data
    A --> Q1{"Is there a period before<br/>to compare with?"}
    Q1 -- "No" --> Z["No alert<br/>Nothing to act on for this check"]:::good
    Q1 -- "Yes" --> Q2{"Did revenue stay quiet?<br/>better than 5% down"}
    Q2 -- "No - revenue is already falling" --> R["The revenue alert already covers it<br/>and explains the same thing.<br/>No second card about one fall"]:::good
    Q2 -- "Yes" --> Q3{"Is the number of sales<br/>down 10% or more?"}
    Q3 -- "No" --> Z
    Q3 -- "Yes" --> Q4{"Did the average sale go UP?"}
    Q4 -- "No" --> Z
    Q4 -- "Yes" --> W1["WARNING - Losing customers behind<br/>a steady revenue line<br/>Bigger baskets are covering for<br/>the customers who stopped coming"]:::warn
    W1 --> DO["DO: Customer tab, busy-hours chart -<br/>which days and hours lost the footfall"]
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
    classDef norm fill:#f1f5f9,stroke:#94a3b8,color:#334155
    classDef why fill:#ede9fe,stroke:#a78bfa,color:#4c1d95
```

## Decision tree — Customer pillar: single-item sales

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart LR
    A["Sales slips this period"]:::data
    A --> Q1{"Were there any sales?"}
    Q1 -- "No" --> Z["No alert"]:::good
    Q1 -- "Yes" --> S["Share of slips that held<br/>only ONE product"]
    S --> Q2{"How big is the share?"}
    Q2 -- "Under 45%" --> Z
    Q2 -- "45% to 60%" --> N1["NORMAL - Many sales are a single item"]:::norm
    Q2 -- "60% or more" --> W1["WARNING - Most sales are a single item"]:::warn
    N1 --> WHY{"Why? Is this new, or is it how<br/>the branch always sells?<br/>Needs a 5-point move to count as changed"}:::why
    W1 --> WHY
    WHY -- "About the same as before" --> B1["How the branch normally sells:<br/>layout, bundling, what is offered<br/>at the counter"]
    WHY -- "Jumped up" --> B2["Something changed: a companion product<br/>out of stock, or a display that moved"]
    WHY -- "Down, but still high" --> B3["Going the right way,<br/>the level is still worth building on"]
    B1 --> DO["DO: Customer tab,<br/>items-per-sale chart"]
    B2 --> DO
    B3 --> DO
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
    classDef norm fill:#f1f5f9,stroke:#94a3b8,color:#334155
    classDef why fill:#ede9fe,stroke:#a78bfa,color:#4c1d95
```

## Business Alerts — the whole thing on one slide

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart LR
    D["Imported data"]:::data --> P["This period against<br/>the period before"]
    P --> S["Sales"]
    P --> F["Profit"]
    P --> I["Inventory"]
    P --> C["Customer"]
    S --> Q{"Which condition does it meet?"}
    F --> Q
    I --> Q
    C --> Q
    Q -- "None" --> OK["No alert"]:::good
    Q -- "Critical condition" --> CR["CRITICAL"]:::crit
    Q -- "Warning condition" --> WA["WARNING"]:::warn
    Q -- "Normal condition" --> NO["NORMAL"]:::norm
    CR --> PG["Business Alerts page"]
    WA --> PG
    NO --> PG
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
    classDef norm fill:#f1f5f9,stroke:#94a3b8,color:#334155
    classDef why fill:#ede9fe,stroke:#a78bfa,color:#4c1d95
```

## One alert, end to end — a worked example

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#eef2ff","primaryTextColor":"#1e293b","primaryBorderColor":"#a5b4fc","lineColor":"#94a3b8","clusterBkg":"#f8fafc","clusterBorder":"#cbd5e1"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42,"padding":8,"useMaxWidth":true}}%%
flowchart LR
    N1["This period<br/>7,920,000 Ks from 800 sales"]:::data --> CH["Revenue change<br/>down 20.8%"]
    N2["The 30 days before<br/>10,000,000 Ks from 1,000 sales"]:::data --> CH
    CH --> Q{"Which condition<br/>does it meet?"}
    Q -- "Down 20% or more" --> CR["CRITICAL<br/>Revenue has fallen sharply"]:::crit
    CR --> WHY{"Why?<br/>Revenue = sales x average sale"}:::why
    WHY --> P1["200 fewer sales<br/>2,000,000 Ks less"]
    WHY --> P2["Average sale 100 Ks smaller<br/>100,000 Ks less"]
    WHY --> P3["Both at once<br/>20,000 Ks back"]
    P1 --> R["Fewer sales explain 95% of the fall<br/>A footfall problem, not a pricing one"]
    P2 --> R
    P3 --> R
    R --> DO["DO: Revenue tab, daily trend -<br/>when did it start?"]
    classDef crit fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f
    classDef good fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef data fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e
    classDef norm fill:#f1f5f9,stroke:#94a3b8,color:#334155
    classDef why fill:#ede9fe,stroke:#a78bfa,color:#4c1d95
```
