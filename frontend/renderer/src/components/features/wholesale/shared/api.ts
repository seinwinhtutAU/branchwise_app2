// The one place every wholesale screen talks to the real backend from — split by domain
// into the files below, and re-exported here so existing imports of "./api" (or "../api")
// keep working unchanged. Add new wholesale API calls to the matching domain file, not to
// this one.

export * from "./apiClient";
export * from "../delivery/shipmentsApi";
export * from "../monitoring/monitoringApi";
export * from "../masterData/masterDataApi";
export * from "../receiving/receivingsApi";
export * from "../vouchers/supplierVouchersApi";
export * from "../orders/customerOrdersApi";
export * from "../inventory/inventoryApi";
export * from "../reports/reportsApi";
