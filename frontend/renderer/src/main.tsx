import React from "react";
import ReactDOM from "react-dom/client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import App from "./App";
import { queryClient } from "@renderer/lib/queryClient";
import { ToastProvider } from "@renderer/lib/toast";
import { applyTheme, getCachedTheme } from "@renderer/lib/theme";
import "./styles/globals.css";

// Applied before the first render, from the last theme fetched from the backend, so the
// app doesn't flash the system-default theme while it boots and re-fetches the
// business-wide setting (see lib/appSettings.ts).
applyTheme(getCachedTheme());

// The cache also survives closing the app — a launch shows yesterday's numbers
// immediately and revalidates behind them, the same bargain the in-memory cache in
// lib/queryClient.ts already makes, extended across restarts. Bump the buster whenever a
// cached page's API shape changes — a page reading a field that didn't exist in a
// version cached before the change is exactly how this kind of cache breaks.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "branchwise:react-query-cache:v1",
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        // v2: several wholesale API response shapes changed (monitoring, master data,
        // write-offs, reports, multi-currency order/voucher/receiving lines) since v1 was
        // cached — a stale v1 cache was missing fields the current code reads
        // unconditionally (e.g. MonitoringDashboardPage's statusLabel crashing on
        // undefined). Bump this again the next time a cached page's API shape changes.
        // v3: the Customer dashboard's KPIs changed (total_transactions and
        // conversion_rate replaced avg_items_per_basket and single_item_basket_share_pct),
        // so a cached v2 response crashed the tab reading `.value` of the new fields.
        // v4: the Inventory dashboard gained potential_sale_value, which a cached v3
        // response does not have.
        buster: "v4",
      }}
    >
      <ToastProvider>
        <App />
      </ToastProvider>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
