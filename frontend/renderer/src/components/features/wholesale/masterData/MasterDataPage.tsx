import React, { useMemo, useState } from "react";
import { useSearchShortcut } from "@renderer/lib/useSearchShortcut";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { ColumnHeaderFilter } from "@renderer/components/ui/ColumnHeaderFilter";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import { TabBar } from "@renderer/components/ui/Tabs";
import { Select } from "@renderer/components/ui/Select";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  CheckIcon,
  CloseIcon,
  MasterDataIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
} from "@renderer/components/ui/icons";
import {
  createWholesaleCustomer,
  createWholesaleNamedEntity,
  createWholesaleProduct,
  createWholesaleSupplier,
  updateWholesaleCustomer,
  updateWholesaleNamedEntity,
  updateWholesaleProduct,
  updateWholesaleSupplier,
  CARGO_COMPANIES_URL,
  CARRIERS_URL,
  CUSTOMERS_URL,
  DESTINATIONS_URL,
  RECEIVING_GATES_URL,
  SUPPLIERS_URL,
  WHOLESALE_PRODUCTS_URL,
  type NewWholesaleProductInput,
  type WholesaleCustomerWire,
  type WholesaleNamedEntityWire,
  type WholesaleProductWire,
} from "../shared/api";
import { GROUP_LABELS, PRODUCT_GROUPS, type ProductGroup } from "../shared/products";
import {
  CopyButton,
  DotPill,
  PAGE_SIZE,
  Panel,
} from "../shared/ui";
import { type Unit } from "../shared/units";

type MasterDataTab =
  | "products"
  | "suppliers"
  | "customers"
  | "cargo-companies"
  | "carriers"
  | "destinations"
  | "receiving-gates";

interface TabDefinition {
  id: MasterDataTab;
  label: string;
  description: string;
}

const TABS: TabDefinition[] = [
  { id: "products", label: "Products", description: "Stock codes and defaults" },
  { id: "suppliers", label: "Suppliers", description: "Factories and vendors" },
  { id: "customers", label: "Customers", description: "Customer contacts" },
  { id: "cargo-companies", label: "Cargo companies", description: "Transport providers" },
  { id: "carriers", label: "Carriers", description: "People handling cargo" },
  { id: "destinations", label: "Destinations", description: "Shipment stops" },
  { id: "receiving-gates", label: "Receiving gates", description: "Warehouse arrival points" },
];

const ENTITY_ID_KEYS: Record<MasterDataTab, string> = {
  products: "product_id",
  suppliers: "supplier_id",
  customers: "customer_id",
  "cargo-companies": "cargo_company_id",
  carriers: "carrier_id",
  destinations: "destination_id",
  "receiving-gates": "receiving_gate_id",
};

const ADD_LABELS: Record<MasterDataTab, string> = {
  products: "Add product",
  suppliers: "Add supplier",
  customers: "Add customer",
  "cargo-companies": "Add cargo company",
  carriers: "Add carrier",
  destinations: "Add destination",
  "receiving-gates": "Add receiving gate",
};

interface NamedRow {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  active: boolean;
}

interface ProductForm {
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  default_unit: Unit;
  set_pairs: string;
  dozen_pairs: string;
}

interface NamedForm {
  name: string;
  phone: string;
  address: string;
}

const EMPTY_PRODUCT_FORM: ProductForm = {
  stock_code: "",
  description: "",
  product_group: "man",
  default_unit: "set",
  set_pairs: "6",
  dozen_pairs: "12",
};

const EMPTY_NAMED_FORM: NamedForm = { name: "", phone: "", address: "" };

function namedRow(row: WholesaleNamedEntityWire, tab: MasterDataTab): NamedRow {
  const key = ENTITY_ID_KEYS[tab];
  return {
    id: String(row[key] ?? ""),
    name: row.name,
    phone: typeof row.phone === "string" ? row.phone : undefined,
    address: typeof row.address === "string" ? row.address : undefined,
    active: row.active,
  };
}

function productFormFromRow(row: WholesaleProductWire): ProductForm {
  return {
    stock_code: row.stock_code,
    description: row.description,
    product_group: row.product_group,
    default_unit: row.default_unit,
    set_pairs: String(row.default_unit_conversions.set ?? 6),
    dozen_pairs: String(row.default_unit_conversions.dozen ?? 12),
  };
}

export default function MasterDataPage({
  session,
}: {
  session: Session;
}): React.JSX.Element {
  const showToast = useToast();
  const [tab, setTab] = useState<MasterDataTab>("products");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const searchInputRef = useSearchShortcut();
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [groupFilter, setGroupFilter] = useState<"all" | ProductGroup>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [productForm, setProductForm] = useState<ProductForm>(EMPTY_PRODUCT_FORM);
  const [namedForm, setNamedForm] = useState<NamedForm>(EMPTY_NAMED_FORM);
  const [saving, setSaving] = useState(false);

  const products = useMasterDataQuery<WholesaleProductWire>(session, "products");
  const suppliers = useMasterDataQuery<WholesaleNamedEntityWire>(session, "suppliers");
  const customers = useMasterDataQuery<WholesaleCustomerWire>(session, "customers");
  const cargoCompanies = useMasterDataQuery<WholesaleNamedEntityWire>(session, "cargo-companies");
  const carriers = useMasterDataQuery<WholesaleNamedEntityWire>(session, "carriers");
  const destinations = useMasterDataQuery<WholesaleNamedEntityWire>(session, "destinations");
  const receivingGates = useMasterDataQuery<WholesaleNamedEntityWire>(session, "receiving-gates");

  const query = {
    products,
    suppliers,
    customers,
    "cargo-companies": cargoCompanies,
    carriers,
    destinations,
    "receiving-gates": receivingGates,
  }[tab];

  const counts: Record<MasterDataTab, number> = {
    products: products.data?.length ?? 0,
    suppliers: suppliers.data?.length ?? 0,
    customers: customers.data?.length ?? 0,
    "cargo-companies": cargoCompanies.data?.length ?? 0,
    carriers: carriers.data?.length ?? 0,
    destinations: destinations.data?.length ?? 0,
    "receiving-gates": receivingGates.data?.length ?? 0,
  };

  const rows = useMemo(() => {
    const allRows = query.data ?? [];
    const normalized =
      tab === "products"
        ? (allRows as WholesaleProductWire[]).map((row) => ({
            ...row,
            id: row.product_id,
          }))
        : (allRows as WholesaleNamedEntityWire[]).map((row) =>
            namedRow(row, tab),
          );
    const needle = search.trim().toLowerCase();
    return normalized.filter((row) => {
      const matchesSearch =
        !needle || JSON.stringify(row).toLowerCase().includes(needle);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? row.active : !row.active);
      const matchesGroup =
        tab !== "products" ||
        groupFilter === "all" ||
        ("product_group" in row && row.product_group === groupFilter);

      return matchesSearch && matchesStatus && matchesGroup;
    });
  }, [query.data, search, statusFilter, groupFilter, tab]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = rows.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const isFiltered =
    search.trim() !== "" ||
    statusFilter !== "all" ||
    (tab === "products" && groupFilter !== "all");

  const isLoading = query.isLoading && !query.data;
  const isError = query.isError;
  useLoadErrorToast(isError, "wholesale master data");

  function resetEditor(): void {
    setEditingId(null);
    setProductForm(EMPTY_PRODUCT_FORM);
    setNamedForm(EMPTY_NAMED_FORM);
  }

  function openCreate(): void {
    resetEditor();
    setEditorOpen(true);
  }

  function startEdit(row: WholesaleProductWire | NamedRow): void {
    setEditingId("product_id" in row ? row.product_id : row.id);
    if (tab === "products" && "product_id" in row)
      setProductForm(productFormFromRow(row));
    if (tab !== "products" && !("product_id" in row)) {
      setNamedForm({
        name: row.name,
        phone: row.phone ?? "",
        address: row.address ?? "",
      });
    }
    setEditorOpen(true);
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    try {
      if (tab === "products") {
        const setPairs = Number(productForm.set_pairs);
        const dozenPairs = Number(productForm.dozen_pairs);
        if (!productForm.stock_code.trim())
          throw new Error("Enter a stock code.");
        if (
          !Number.isInteger(setPairs) ||
          setPairs < 1 ||
          !Number.isInteger(dozenPairs) ||
          dozenPairs < 1
        ) {
          throw new Error("Conversion rates must be positive whole numbers.");
        }
        const input: NewWholesaleProductInput = {
          stock_code: productForm.stock_code.trim(),
          description: productForm.description.trim(),
          product_group: productForm.product_group,
          default_unit: productForm.default_unit,
          default_unit_conversions: {
            pair: 1,
            set: setPairs,
            dozen: dozenPairs,
          },
        };
        if (editingId) await updateWholesaleProduct(session, editingId, input);
        else await createWholesaleProduct(session, input);
      } else if (tab === "suppliers") {
        const input = {
          name: namedForm.name.trim(),
          phone: namedForm.phone.trim(),
          address: namedForm.address.trim(),
        };
        if (!input.name) throw new Error("Enter a name.");
        if (editingId) await updateWholesaleSupplier(session, editingId, input);
        else await createWholesaleSupplier(session, input);
      } else if (tab === "customers") {
        const input = {
          name: namedForm.name.trim(),
          phone: namedForm.phone.trim(),
          address: namedForm.address.trim(),
        };
        if (!input.name) throw new Error("Enter a name.");
        if (editingId) await updateWholesaleCustomer(session, editingId, input);
        else await createWholesaleCustomer(session, input);
      } else {
        const input = { name: namedForm.name.trim() };
        if (!input.name) throw new Error("Enter a name.");
        if (editingId)
          await updateWholesaleNamedEntity(session, tab, editingId, input);
        else await createWholesaleNamedEntity(session, tab, input);
      }
      showToast(
        "success",
        `${TABS.find((item) => item.id === tab)?.label ?? "Entry"} saved.`,
      );
      resetEditor();
      setEditorOpen(false);
      void query.refetch();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not save this entry.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(
    row: WholesaleProductWire | NamedRow,
  ): Promise<void> {
    const id = "product_id" in row ? row.product_id : row.id;
    try {
      if (tab === "products" && "product_id" in row)
        await updateWholesaleProduct(session, id, { active: !row.active });
      else if (tab === "suppliers" && !("product_id" in row))
        await updateWholesaleSupplier(session, id, { active: !row.active });
      else if (tab === "customers" && !("product_id" in row))
        await updateWholesaleCustomer(session, id, { active: !row.active });
      else if (!("product_id" in row))
        await updateWholesaleNamedEntity(session, tab, id, {
          active: !row.active,
        });
      showToast(
        "success",
        row.active ? "Entry deactivated." : "Entry activated.",
      );
      void query.refetch();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not change this entry.",
      );
    }
  }

  function resetFilters(): void {
    setSearch("");
    setStatusFilter("all");
    setGroupFilter("all");
    setPage(1);
  }

  function handleTabChange(nextTab: MasterDataTab): void {
    setTab(nextTab);
    resetEditor();
    setEditorOpen(false);
    setPage(1);
    setGroupFilter("all");
  }

  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0];
  const addLabel = ADD_LABELS[tab];
  const hasDetails =
    tab === "products" || tab === "suppliers" || tab === "customers";

  return (
    <div className="flex flex-col gap-4">

      <TabBar<MasterDataTab>
        tabs={TABS.map((item) => ({
          id: item.id,
          label: item.label,
          count: counts[item.id],
        }))}
        activeTab={tab}
        onSelect={handleTabChange}
      />

      <Panel className="shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-bg-base">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
              {activeTab.label}
            </h2>
            <span className="text-xs text-text-muted hidden sm:inline">
              {activeTab.description}
            </span>

            {isFiltered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="text-xs h-6 px-1.5 text-text-muted hover:text-error"
              >
                <CloseIcon className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="w-48 sm:w-64">
              <Input
                ref={searchInputRef}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={`Search ${activeTab.label.toLowerCase()}… (/)`}
                startIcon={<SearchIcon className="w-3.5 h-3.5" />}
                aria-label={`Search ${activeTab.label.toLowerCase()}`}
                className="h-8 text-xs"
              />
            </div>
            <RefreshButton
              onClick={() => void query.refetch()}
              refreshing={query.isFetching}
            />
            <Button
              size="sm"
              onClick={openCreate}
              aria-label={addLabel}
              title={addLabel}
              className="h-8 text-xs"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              {addLabel}
            </Button>
          </div>
        </div>

        {isError ? (
          <EmptyState
            icon={<MasterDataIcon />}
            title="Could not load master data"
            description="Check the connection and try again."
            action={
              <Button onClick={() => void query.refetch()} loading={query.isFetching}>
                Try again
              </Button>
            }
          />
        ) : isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner className="w-6 h-6 text-text-muted" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<MasterDataIcon />}
            title={isFiltered ? `No ${activeTab.label.toLowerCase()} match` : `No ${activeTab.label.toLowerCase()} yet`}
            description={
              isFiltered
                ? "Try adjusting your search or filter."
                : `Add the first entry using the ${addLabel} button.`
            }
            action={
              isFiltered ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={openCreate}>
                  <PlusIcon className="w-4 h-4" />
                  {addLabel}
                </Button>
              )
            }
          />
        ) : (
          <>
            <TableContainer className="rounded-none border-0">
              <Thead>
                <Tr>
                  <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">#</Th>
                  <Th className="whitespace-nowrap">{tab === "products" ? "Stock code" : "Name"}</Th>
                  {tab === "products" && (
                    <>
                      <Th className="whitespace-nowrap">Description</Th>
                      <Th className="whitespace-nowrap">
                        <ColumnHeaderFilter
                          label="Group"
                          isActive={groupFilter !== "all"}
                        >
                          {(close) => (
                            <div className="flex flex-col gap-1.5">
                              <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                                Filter Group
                              </div>
                              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGroupFilter("all");
                                    setPage(1);
                                    close();
                                  }}
                                  className={cn(
                                    "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                    groupFilter === "all"
                                      ? "bg-brand/10 font-bold text-brand"
                                      : "hover:bg-bg-subtle text-text-secondary",
                                  )}
                                >
                                  <span>All groups</span>
                                  {groupFilter === "all" && <CheckIcon className="w-3.5 h-3.5" />}
                                </button>
                                {PRODUCT_GROUPS.map((group) => (
                                  <button
                                    key={group}
                                    type="button"
                                    onClick={() => {
                                      setGroupFilter(group);
                                      setPage(1);
                                      close();
                                    }}
                                    className={cn(
                                      "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                      groupFilter === group
                                        ? "bg-brand/10 font-bold text-brand"
                                        : "hover:bg-bg-subtle text-text-secondary",
                                    )}
                                  >
                                    <span>{GROUP_LABELS[group]}</span>
                                    {groupFilter === group && <CheckIcon className="w-3.5 h-3.5" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </ColumnHeaderFilter>
                      </Th>
                    </>
                  )}
                  {hasDetails && tab !== "products" && (
                    <>
                      <Th className="whitespace-nowrap">Phone</Th>
                      <Th className="whitespace-nowrap">Address</Th>
                    </>
                  )}
                  <Th className="whitespace-nowrap">
                    <ColumnHeaderFilter
                      label="Status"
                      isActive={statusFilter !== "all"}
                    >
                      {(close) => (
                        <div className="flex flex-col gap-1.5">
                          <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                            Filter Status
                          </div>
                          <div className="space-y-0.5 max-h-48 overflow-y-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setStatusFilter("all");
                                setPage(1);
                                close();
                              }}
                              className={cn(
                                "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                statusFilter === "all"
                                  ? "bg-brand/10 font-bold text-brand"
                                  : "hover:bg-bg-subtle text-text-secondary",
                              )}
                            >
                              <span>All entries</span>
                              {statusFilter === "all" && <CheckIcon className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setStatusFilter("active");
                                setPage(1);
                                close();
                              }}
                              className={cn(
                                "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                statusFilter === "active"
                                  ? "bg-brand/10 font-bold text-brand"
                                  : "hover:bg-bg-subtle text-text-secondary",
                              )}
                            >
                              <span>Active only</span>
                              {statusFilter === "active" && <CheckIcon className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setStatusFilter("inactive");
                                setPage(1);
                                close();
                              }}
                              className={cn(
                                "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                statusFilter === "inactive"
                                  ? "bg-brand/10 font-bold text-brand"
                                  : "hover:bg-bg-subtle text-text-secondary",
                              )}
                            >
                              <span>Inactive only</span>
                              {statusFilter === "inactive" && <CheckIcon className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      )}
                    </ColumnHeaderFilter>
                  </Th>
                  <Th className="w-36 text-right whitespace-nowrap">Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {visibleRows.map((row, index) => {
                  const isProduct = tab === "products";
                  const product = isProduct
                    ? (row as WholesaleProductWire & { id: string })
                    : null;
                  const named = !isProduct ? (row as NamedRow) : null;
                  const rowNum = (safePage - 1) * PAGE_SIZE + index + 1;
                  return (
                    <Tr key={isProduct ? product?.product_id : named?.id}>
                      <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                        {rowNum}
                      </Td>
                      <Td className="font-medium whitespace-nowrap">
                        {isProduct && product?.stock_code ? (
                          <div className="flex items-center gap-1">
                            <span>{product.stock_code}</span>
                            <CopyButton value={product.stock_code} what="stock code" />
                          </div>
                        ) : (
                          named?.name
                        )}
                      </Td>
                      {isProduct && (
                        <>
                          <Td className="text-text-secondary">{product?.description || "—"}</Td>
                          <Td className="whitespace-nowrap">
                            {product
                              ? GROUP_LABELS[product.product_group]
                              : "—"}
                          </Td>
                        </>
                      )}
                      {hasDetails && !isProduct && (
                        <>
                          <Td className="whitespace-nowrap text-text-secondary">{named?.phone || "—"}</Td>
                          <Td className="max-w-[220px] truncate text-text-secondary">
                            {named?.address || "—"}
                          </Td>
                        </>
                      )}
                      <Td className="whitespace-nowrap">
                        <DotPill
                          label={row.active ? "Active" : "Inactive"}
                          className={
                            row.active
                              ? "bg-success-subtle text-success border border-success-pill"
                              : "bg-bg-raised text-text-secondary border border-border-strong"
                          }
                          dotClassName={
                            row.active ? "bg-success" : "bg-text-muted"
                          }
                        />
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              startEdit(row as WholesaleProductWire | NamedRow)
                            }
                            className="h-7 text-xs px-2"
                          >
                            <PencilIcon className="w-3.5 h-3.5" /> Edit
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              void toggleActive(
                                row as WholesaleProductWire | NamedRow,
                              )
                            }
                            className="h-7 text-xs px-2"
                          >
                            {row.active ? "Deactivate" : "Activate"}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableContainer>
            <div className="px-4 py-1.5 border-t border-border">
              <Pagination
                page={safePage}
                totalPages={totalPages}
                totalItems={rows.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Panel>

      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <section
            className="w-full max-w-md rounded-xl border border-border bg-bg-base p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="master-data-editor-title"
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id="master-data-editor-title"
                className="text-base font-semibold text-text-primary"
              >
                {editingId ? "Edit entry" : addLabel}
              </h2>
              <button
                type="button"
                onClick={() => {
                  resetEditor();
                  setEditorOpen(false);
                }}
                className="rounded-md p-1 text-text-muted hover:bg-bg-raised"
                aria-label="Close"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {activeTab.description}. Changes apply to future forms; existing
              transaction lines keep their saved values.
            </p>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(event) => void save(event)}
            >
              {tab === "products" ? (
                <>
                  <Input
                    label="Stock code"
                    value={productForm.stock_code}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        stock_code: event.target.value,
                      })
                    }
                    required
                  />
                  <Input
                    label="Description"
                    value={productForm.description}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        description: event.target.value,
                      })
                    }
                  />
                  <Select
                    label="Product group"
                    value={productForm.product_group}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        product_group: event.target.value as ProductGroup,
                      })
                    }
                  >
                    {PRODUCT_GROUPS.map((group) => (
                      <option key={group} value={group}>
                        {GROUP_LABELS[group]}
                      </option>
                    ))}
                  </Select>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Pairs per set"
                      type="number"
                      min="1"
                      step="1"
                      value={productForm.set_pairs}
                      onChange={(event) =>
                        setProductForm({
                          ...productForm,
                          set_pairs: event.target.value,
                        })
                      }
                    />
                    <Input
                      label="Pairs per dozen"
                      type="number"
                      min="1"
                      step="1"
                      value={productForm.dozen_pairs}
                      onChange={(event) =>
                        setProductForm({
                          ...productForm,
                          dozen_pairs: event.target.value,
                        })
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  <Input
                    label="Name"
                    value={namedForm.name}
                    onChange={(event) =>
                      setNamedForm({
                        ...namedForm,
                        name: event.target.value,
                      })
                    }
                    required
                  />
                  {(tab === "suppliers" || tab === "customers") && (
                    <>
                      <Input
                        label="Phone"
                        value={namedForm.phone}
                        onChange={(event) =>
                          setNamedForm({
                            ...namedForm,
                            phone: event.target.value,
                          })
                        }
                      />
                      <Input
                        label="Address"
                        value={namedForm.address}
                        onChange={(event) =>
                          setNamedForm({
                            ...namedForm,
                            address: event.target.value,
                          })
                        }
                      />
                    </>
                  )}
                </>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    resetEditor();
                    setEditorOpen(false);
                  }}
                  disabled={
                    !editingId && !productForm.stock_code && !namedForm.name
                  }
                >
                  Clear
                </Button>
                <Button type="submit" loading={saving}>
                  {editingId ? "Save changes" : addLabel}
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function useMasterDataQuery<
  T extends
    WholesaleProductWire | WholesaleNamedEntityWire | WholesaleCustomerWire,
>(
  session: Session,
  path: string,
): {
  data: T[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
} {
  return useQuery<T[]>({
    queryKey: ["wholesale", "master-data-admin", path],
    queryFn: () =>
      fetchJson<T[]>(
        `${getPathUrl(path)}?active_only=false&page_size=100`,
        session,
      ),
  });
}

function getPathUrl(path: string): string {
  const urls: Record<string, string> = {
    products: WHOLESALE_PRODUCTS_URL,
    suppliers: SUPPLIERS_URL,
    customers: CUSTOMERS_URL,
    "cargo-companies": CARGO_COMPANIES_URL,
    carriers: CARRIERS_URL,
    destinations: DESTINATIONS_URL,
    "receiving-gates": RECEIVING_GATES_URL,
  };
  return urls[path];
}

