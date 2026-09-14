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
        buster: "v1",
      }}
    >
      <ToastProvider>
        <App />
      </ToastProvider>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
