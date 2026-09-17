// The one place every wholesale screen talks to the real backend from — split by domain
// into the files below, and re-exported here so existing imports of "./api" (or "../api")
// keep working unchanged. Add new wholesale API calls to the matching domain file, not to
// this one.

export * from "./apiClient";
export * from "./shipmentsApi";
export * from "./monitoringApi";
export * from "./masterDataApi";
export * from "./receivingsApi";
export * from "./supplierVouchersApi";
export * from "./customerOrdersApi";
export * from "./inventoryApi";
export * from "./reportsApi";
