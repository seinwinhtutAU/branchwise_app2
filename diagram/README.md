# BranchWise — calculation diagrams

Diagrams for explaining **how BranchWise works out its numbers** — the dashboard, the
Branch Health Score, the alerts, and the Warning page. They are written for a business
audience (a teacher, a manager, an assessor): every box names a business idea, not a
piece of code.

Eight diagrams, one topic each — enough to follow the whole story without a slide for
every rule.

## Turning these into images

```
npm run diagrams
```

That renders every `.mmd` file in this folder to a PNG (3x, for slides) and an SVG (for
Word or a poster) in `diagram/out/`. It uses `mermaid-cli`, installed by `npm install`
at the repo root, driving the copy of Google Chrome already on this machine
(`diagram/puppeteer-config.json` points at it — change that path if Chrome lives
somewhere else). Edit a `.mmd` file and run the command again to update its image.

Each `.mmd` starts with a shared styling line so all the diagrams look alike; red means
critical, amber means warning, green means fine, blue means data coming in.
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

Suggested order for a short talk: **01 → 02 → 04 → 05 → 07**.

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

