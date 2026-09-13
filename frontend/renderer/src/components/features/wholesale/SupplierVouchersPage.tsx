import { useEffect, useMemo, useRef, useState } from "react";
import { type Session } from "@renderer/lib/auth";
import { useCachedFetch } from "@renderer/lib/useCachedFetch";
import { useToast } from "@renderer/lib/useToast";
import {
  CellInput,
  CountField,
  EDITABLE,
  GroupSelect,
  FigureCard,
  FloatingLayer,
  MenuItem,
  PAGE_SIZE,
  Panel,
  PaymentsTable,
  JourneyCard,
  JourneyRow,
  CopyButton,
  ProductCell,
  ReadOnlyField,
  Required,
  Reference,
  ReviewFact,
  SOFT_BLUE,
  SOFT_RED,
  SectionLabel,
  StepBar,
  SuggestInput,
} from "@renderer/components/features/wholesale/ui";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import { Select } from "@renderer/components/ui/Select";
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
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardIcon,
  CloseIcon,
  EyeIcon,
  MoreVerticalIcon,
  FactoryIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import { DeliveryJourney } from "@renderer/components/features/wholesale/journey";
import {
  CARGO_NAMES,
  paidPct,
  paymentStatus,
  receivedPct,
  receivingStatus,
  RECEIVING_STATUSES,
  remainingQty,
  paidAmount,
  voucherAmount,
  voucherBalance,
  type SupplierVoucher,
  type SupplierVoucherLine,
  type ReceivingStatus,
} from "@renderer/components/features/wholesale/supplierVouchers";
import {
  lineRemaining,
  remainingQty as orderRemaining,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/customerOrders";
import {
  SUPPLIER_NAMES,
  formatDate,
  colorQtyPairs,
  colorQtyProblem,
  duplicateStockCodeProblem,
  formatKyat,
  formatQty,
  nextReference,
  onlyDigits,
  todayIso,
  type PaymentStatus,
} from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  PAIRS_PER,
} from "@renderer/components/features/wholesale/units";
import {
  colorPairsForText,
  type ColorPairs,
} from "@renderer/components/features/wholesale/stock";
import {
  hydrateVouchers,
  hydrateOrders,
  saveVouchers,
  useWholesale,
} from "@renderer/components/features/wholesale/store";
import {
  CUSTOMER_ORDERS_URL,
  SUPPLIER_VOUCHERS_URL,
  WholesaleApiError,
  addSupplierVoucherPayment,
  createSupplierVoucher,
  deleteSupplierVoucher,
  removeSupplierVoucherPayment,
  ordersFromWire,
  updateSupplierVoucher,
  vouchersFromWire,
  type NewSupplierVoucherInput,
  type SupplierVoucherWire,
} from "@renderer/components/features/wholesale/api";
import {
  GROUP_LABELS,
  STOCK_CODES,
  productOf,
  type ProductGroup,
} from "@renderer/components/features/wholesale/products";

/** A quantity of goods, written in sets — the unit the business trades in. Pairs stay
 *  the figure underneath, so nothing is ever converted twice. */
const sets = (qty: number): string => formatIn(qty, "set");

function lineReceivedQty(line: SupplierVoucherLine): number {
  return line.received_qty ?? 0;
}

function lineRemainingQty(line: SupplierVoucherLine): number {
  return Math.max(0, line.voucher_qty - lineReceivedQty(line));
}

// The wholesale Supplier Vouchers screen — the supplier's (factory's) own document for
// one batch it is sending us. Built the same way as Customer Orders: the prototype's layout (figure cards,
// one panel holding header, filters, table and pagination; a read-only detail sheet; a
// three-step wizard), the ERD's fields, and this app's own tokens and primitives.
//
// No backend. Vouchers live in component state, so a new one survives moving between the
// three views but not a reload; every place a request will eventually go is a
// `saveVouchers` call in this file.

type View = "list" | "to_order" | "detail" | "new";
type VoucherDetailMode = "view" | "edit";
type ReceivingFilter = ReceivingStatus | "all";
type PayFilter = PaymentStatus | "all";

const RECEIVING_LABELS: Record<ReceivingStatus, string> = {
  waiting: "Waiting",
  partly_received: "Partly received",
  fully_received: "Fully received",
};

// Filled, not tinted — the same treatment the order and payment badges use.
const RECEIVING_STYLES: Record<ReceivingStatus, string> = {
  waiting: "bg-text-secondary text-bg-base",
  partly_received: "bg-warning text-white",
  fully_received: "bg-success text-white",
};

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
};

const PAYMENT_STYLES: Record<PaymentStatus, string> = {
  unpaid: "bg-error text-white",
  partial: "bg-warning text-white",
  paid: "bg-success text-white",
};

const PAYMENT_STATUSES: PaymentStatus[] = ["unpaid", "partial", "paid"];

function StatusPill({
  label,
  className,
}: {
  label: string;
  className: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap",
        className,
      )}
    >
      {label}
    </span>
  );
}

function ReceivingBadge({
  status,
}: {
  status: ReceivingStatus;
}): React.JSX.Element {
  return (
    <StatusPill
      label={RECEIVING_LABELS[status]}
      className={RECEIVING_STYLES[status]}
    />
  );
}

function PaymentBadge({
  status,
}: {
  status: PaymentStatus;
}): React.JSX.Element {
  return (
    <StatusPill
      label={PAYMENT_LABELS[status]}
      className={PAYMENT_STYLES[status]}
    />
  );
}

export default function SupplierVouchersPage({
  session,
  onOpenOrder,
}: {
  session: Session;
  onOpenOrder: (orderId: string) => void;
}): React.JSX.Element {
  const showToast = useToast();
  const {
    data: wire,
    isRefreshing,
    reload,
  } = useCachedFetch<SupplierVoucherWire[]>(
    SUPPLIER_VOUCHERS_URL,
    session,
    "supplier vouchers",
  );
  useEffect(() => { if (wire) hydrateVouchers(vouchersFromWire(wire)); }, [wire]);
  const { data: orderWire } = useCachedFetch<CustomerOrder[]>(
    CUSTOMER_ORDERS_URL,
    session,
    "customer orders for supplier planning",
  );
  useEffect(() => {
    if (orderWire) hydrateOrders(ordersFromWire(orderWire));
  }, [orderWire]);
  const { vouchers, orders } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openMode, setOpenMode] = useState<VoucherDetailMode>("view");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newOrderLines, setNewOrderLines] = useState<OpenOrderLine[] | undefined>();

  const selected =
    vouchers.find((voucher) => voucher.voucher_id === selectedId) ?? null;

  function openVoucher(
    voucherId: string,
    mode: VoucherDetailMode = "view",
  ): void {
    setSelectedId(voucherId);
    setOpenMode(mode);
    setView("detail");
  }

  function deleteVoucher(voucherId: string): void {
    deleteSupplierVoucher(session, voucherId).then(async () => {
      setSelectedId((current) => (current === voucherId ? null : current));
      setView("list"); await reload();
    }).catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not delete the voucher."));
  }

  async function persistVoucher(
    voucher: SupplierVoucher,
    originalVoucher: SupplierVoucher,
  ): Promise<void> {
    try {
      await updateSupplierVoucher(session, voucher.voucher_id, {
        supplier_name: voucher.supplier_name,
        voucher_date: voucher.voucher_date,
        cargo_name: voucher.cargo_name,
        total_packages: voucher.total_packages,
        lines: voucher.lines,
      });

      const originalPayments = originalVoucher.payment.payments;
      // A payment added but left at its default of 0 (the row exists but nobody has
      // typed an amount into it yet) is not a real payment — drop it rather than send
      // it to a server that rejects anything not greater than zero. Zeroing an existing
      // payment's amount is treated the same way: as taking that payment back.
      const currentPayments = voucher.payment.payments.filter(
        (payment) => payment.amount > 0,
      );
      const changed = (
        left: (typeof currentPayments)[number],
        right: (typeof currentPayments)[number],
      ): boolean =>
        left.date !== right.date ||
        left.amount !== right.amount ||
        left.note !== right.note;

      // There is no update endpoint for a payment, so an edit removes the old row and
      // adds the new one (removing first keeps the balance check, which sums every
      // existing payment, from double-counting the row being edited). If the add then
      // fails, put the original payment back rather than leaving it simply gone.
      for (const payment of originalPayments) {
        const next = currentPayments.find(
          (candidate) => candidate.payment_id === payment.payment_id,
        );
        if (!next) {
          await removeSupplierVoucherPayment(
            session,
            voucher.voucher_id,
            payment.payment_id,
          );
        } else if (changed(payment, next)) {
          await removeSupplierVoucherPayment(
            session,
            voucher.voucher_id,
            payment.payment_id,
          );
          try {
            await addSupplierVoucherPayment(session, voucher.voucher_id, next);
          } catch (error) {
            await addSupplierVoucherPayment(session, voucher.voucher_id, payment);
            throw error;
          }
        }
      }

      for (const payment of currentPayments) {
        const previous = originalPayments.find(
          (candidate) => candidate.payment_id === payment.payment_id,
        );
        if (!previous) {
          await addSupplierVoucherPayment(session, voucher.voucher_id, payment);
        }
      }

      await reload();
      showToast("success", "Voucher saved.");
    } catch (error) {
      showToast(
        "error",
        error instanceof WholesaleApiError
          ? error.message
          : "Could not save the voucher.",
      );
    }
  }

  function addVoucher(input: NewSupplierVoucherInput): void {
    createSupplierVoucher(session, input).then(async (voucher) => {
      saveVouchers((current) => [voucher, ...current]);
      setSelectedId(voucher.voucher_id);
      setOpenMode("edit");
      setView("detail");
      await reload();
    }).catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not create the voucher."));
  }

  function startNewVoucher(
    supplierName = "",
    orderLines?: OpenOrderLine[],
  ): void {
    setNewSupplierName(supplierName);
    setNewOrderLines(orderLines);
    setView("new");
  }

  if (view === "new") {
    return (
      <NewVoucherForm
        nextVoucherNo={nextVoucherNo(vouchers)}
        initialSupplierName={newSupplierName}
        initialOrderLines={newOrderLines}
        onCancel={() => {
          setNewSupplierName("");
          setNewOrderLines(undefined);
          setView("list");
        }}
        onCreate={addVoucher}
      />
    );
  }

  if (view === "to_order") {
    return (
      <ToOrderView
        orders={orders}
        vouchers={vouchers}
        onOpenVouchers={() => setView("list")}
        onRefresh={reload}
        refreshing={isRefreshing}
        onCreateVoucher={(supplierName, orderLines) =>
          startNewVoucher(supplierName, orderLines)
        }
        onOpenOrder={onOpenOrder}
      />
    );
  }

  if (view === "detail" && selected) {
    return (
      <VoucherDetail
        voucher={selected}
        initialMode={openMode}
        onSave={persistVoucher}
        onBack={() => setView("list")}
      />
    );
  }

  return (
    <VoucherList
      vouchers={vouchers}
      onOpen={openVoucher}
      onEdit={(voucherId) => openVoucher(voucherId, "edit")}
      onDelete={deleteVoucher}
      onNew={() => startNewVoucher()}
      onToOrder={() => setView("to_order")}
      onRefresh={reload}
      refreshing={isRefreshing}
    />
  );
}

function nextVoucherNo(vouchers: SupplierVoucher[]): string {
  return nextReference(
    "VCH",
    vouchers.map((voucher) => voucher.voucher_no),
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

function VoucherList({
  vouchers,
  onToOrder,
  onOpen,
  onEdit,
  onDelete,
  onNew,
  onRefresh,
  refreshing,
}: {
  vouchers: SupplierVoucher[];
  onToOrder: () => void;
  onOpen: (voucherId: string) => void;
  onEdit: (voucherId: string) => void;
  onDelete: (voucherId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [receiving, setReceiving] = useState<ReceivingFilter>("all");
  const [pay, setPay] = useState<PayFilter>("all");
  const [page, setPage] = useState(1);

  const totalQty = vouchers.reduce(
    (sum, voucher) => sum + voucher.total_qty,
    0,
  );
  const remainingAll = vouchers.reduce(
    (sum, voucher) => sum + remainingQty(voucher),
    0,
  );
  const waitingCount = vouchers.filter(
    (voucher) => receivingStatus(voucher) !== "fully_received",
  ).length;
  const unpaid = vouchers.reduce(
    (sum, voucher) => sum + voucherBalance(voucher),
    0,
  );
  const unpaidCount = vouchers.filter(
    (voucher) => voucherBalance(voucher) > 0,
  ).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vouchers.filter((voucher) => {
      const matchesQuery =
        query === "" ||
        voucher.voucher_no.toLowerCase().includes(query) ||
        voucher.supplier_name.toLowerCase().includes(query) ||
        voucher.cargo_name.toLowerCase().includes(query) ||
        voucher.lines.some(
          (line) =>
            line.stock_code.toLowerCase().includes(query) ||
            line.description.toLowerCase().includes(query),
        );
      const matchesReceiving =
        receiving === "all" || receivingStatus(voucher) === receiving;
      const matchesPay = pay === "all" || paymentStatus(voucher) === pay;
      return matchesQuery && matchesReceiving && matchesPay;
    });
  }, [vouchers, search, receiving, pay]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isFiltered =
    search.trim() !== "" || receiving !== "all" || pay !== "all";

  function resetFilters(): void {
    setSearch("");
    setReceiving("all");
    setPay("all");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
        <FigureCard
          label="Total vouchers"
          value={formatQty(vouchers.length)}
          sub="vouchers in the system"
        />
        <FigureCard
          label="Total quantity"
          value={sets(totalQty)}
          sub="across all vouchers"
          tone="neutral"
        />
        <FigureCard
          label="Still to arrive"
          value={sets(remainingAll)}
          sub={`of ${sets(totalQty)} not received yet`}
          tone={remainingAll > 0 ? "error" : "success"}
        />
        <FigureCard
          label="Vouchers not complete"
          value={formatQty(waitingCount)}
          sub={`of ${formatQty(vouchers.length)} still coming`}
          tone={waitingCount > 0 ? "warning" : "success"}
        />
        <FigureCard
          label="Unpaid amount"
          value={formatKyat(unpaid)}
          sub={`${unpaidCount} voucher${unpaidCount === 1 ? "" : "s"} not fully paid`}
          tone={unpaid > 0 ? "error" : "success"}
        />
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Supplier vouchers
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Manage all supplier vouchers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onToOrder}>
              <ClipboardIcon className="w-4 h-4" />
              To order
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              loading={refreshing}
            >
              Refresh
            </Button>
            <Button onClick={onNew}>
              <PlusIcon className="w-4 h-4" />
              New voucher
            </Button>
          </div>
        </div>

        <SupplierVoucherTabs
          active="vouchers"
          onVouchers={() => undefined}
          onToOrder={onToOrder}
        />

        <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
          <div className="w-full sm:w-80">
            <Input
              aria-label="Search vouchers"
              placeholder="Search voucher no., supplier, cargo or product"
              startIcon={<SearchIcon className="w-4 h-4" />}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="w-full sm:w-52">
            <Select
              aria-label="Filter by receiving status"
              value={receiving}
              onChange={(event) => {
                setReceiving(event.target.value as ReceivingFilter);
                setPage(1);
              }}
            >
              <option value="all">Any receiving status</option>
              {RECEIVING_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {RECEIVING_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Select
              aria-label="Filter by payment"
              value={pay}
              onChange={(event) => {
                setPay(event.target.value as PayFilter);
                setPage(1);
              }}
            >
              <option value="all">Any payment</option>
              {PAYMENT_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {PAYMENT_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <CloseIcon className="w-4 h-4" />
              Clear filters
            </Button>
          )}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<FactoryIcon />}
            title={isFiltered ? "No vouchers match" : "No vouchers yet"}
            description={
              isFiltered
                ? "Nothing here matches what you searched for. Try a different supplier or status."
                : "When a supplier sends its voucher for a batch, add it here so what is coming is written down."
            }
            action={
              isFiltered ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={onNew}>
                  <PlusIcon className="w-4 h-4" />
                  New voucher
                </Button>
              )
            }
          />
        ) : (
          <>
            <TableContainer className="border-0 rounded-none">
              <Thead>
                <Tr>
                  <Th className="whitespace-nowrap">Voucher no.</Th>
                  <Th className="whitespace-nowrap">Supplier / Factory</Th>
                  <Th className="whitespace-nowrap">Date</Th>
                  <Th className="text-right whitespace-nowrap">
                    Total packages
                  </Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right whitespace-nowrap">
                    Remaining qty
                  </Th>
                  <Th className="whitespace-nowrap">Receiving status</Th>
                  <Th className="whitespace-nowrap">Payment status</Th>
                  <Th className="w-12" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((voucher) => {
                  const remaining = remainingQty(voucher);
                  return (
                    <Tr key={voucher.voucher_id}>
                      <Td className="whitespace-nowrap">
                        <Reference
                          value={voucher.voucher_no}
                          what="voucher no."
                          onClick={() => onOpen(voucher.voucher_id)}
                        />
                      </Td>
                      <Td className="font-medium whitespace-nowrap">
                        {voucher.supplier_name}
                      </Td>
                      <Td className="text-text-muted whitespace-nowrap">
                        {formatDate(voucher.voucher_date)}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatQty(voucher.total_packages)}
                      </Td>
                      <Td className="text-right tabular-nums font-medium">
                        {sets(voucher.total_qty)}
                      </Td>
                      <Td className="text-right tabular-nums font-semibold text-error">
                        {sets(remaining)}
                      </Td>
                      <Td>
                        <ReceivingBadge status={receivingStatus(voucher)} />
                      </Td>
                      <Td>
                        <PaymentBadge status={paymentStatus(voucher)} />
                      </Td>
                      <Td className="text-center">
                        <RowMenu
                          onOpen={() => onOpen(voucher.voucher_id)}
                          onEdit={() => onEdit(voucher.voucher_id)}
                          onDelete={() => onDelete(voucher.voucher_id)}
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableContainer>
            <div className="px-6 py-3 border-t border-border">
              <Pagination
                page={safePage}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

const UNASSIGNED_SUPPLIER = "__unassigned_supplier__";

interface SupplierDemandGroup {
  supplierName: string;
  lines: OpenOrderLine[];
  total: number;
}

function supplierDemandGroups(
  orders: CustomerOrder[],
  vouchers: SupplierVoucher[],
): SupplierDemandGroup[] {
  const supplierNames = new Set<string>();
  let hasUnassigned = false;
  for (const order of orders) {
    if (order.order_status === "cancelled") continue;
    for (const line of order.lines) {
      const supplier = line.supplier_name.trim();
      if (supplier && supplier !== "—") supplierNames.add(supplier);
      else hasUnassigned = true;
    }
  }

  const names = [...supplierNames];
  if (hasUnassigned) names.push(UNASSIGNED_SUPPLIER);

  return names
    .map((supplierName) => {
      const lines = openOrderLines(orders, supplierName, vouchers);
      return {
        supplierName,
        lines,
        total: lines.reduce((sum, line) => sum + line.remaining, 0),
      };
    })
    .filter((group) => group.lines.length > 0)
    .sort((a, b) => {
      if (a.supplierName === UNASSIGNED_SUPPLIER) return -1;
      if (b.supplierName === UNASSIGNED_SUPPLIER) return 1;
      return b.total - a.total || a.supplierName.localeCompare(b.supplierName);
    });
}

function SupplierVoucherTabs({
  active,
  onVouchers,
  onToOrder,
}: {
  active: "vouchers" | "to_order";
  onVouchers: () => void;
  onToOrder: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 px-6 pt-3 border-b border-border">
      <button
        type="button"
        onClick={onVouchers}
        className={cn(
          "border-b-2 px-3 pb-3 text-sm font-semibold transition-colors duration-150",
          active === "vouchers"
            ? "border-brand text-brand"
            : "border-transparent text-text-muted hover:text-text-primary",
        )}
      >
        Supplier vouchers
      </button>
      <button
        type="button"
        onClick={onToOrder}
        className={cn(
          "border-b-2 px-3 pb-3 text-sm font-semibold transition-colors duration-150",
          active === "to_order"
            ? "border-brand text-brand"
            : "border-transparent text-text-muted hover:text-text-primary",
        )}
      >
        Create from customer orders
      </button>
    </div>
  );
}

function ToOrderView({
  orders,
  vouchers,
  onOpenVouchers,
  onRefresh,
  refreshing,
  onCreateVoucher,
  onOpenOrder,
}: {
  orders: CustomerOrder[];
  vouchers: SupplierVoucher[];
  onOpenVouchers: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onCreateVoucher: (supplierName: string, lines: OpenOrderLine[]) => void;
  onOpenOrder: (orderId: string) => void;
}): React.JSX.Element {
  const groups = useMemo(
    () => supplierDemandGroups(orders, vouchers),
    [orders, vouchers],
  );
  const totalQty = groups.reduce((sum, group) => sum + group.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <FigureCard
          label="Suppliers waiting"
          value={formatQty(groups.length)}
          sub="with customer demand"
          tone={groups.length > 0 ? "warning" : "success"}
        />
        <FigureCard
          label="Products waiting"
          value={formatQty(groups.reduce((sum, group) => sum + group.lines.length, 0))}
          sub="products to request"
        />
        <FigureCard
          label="Quantity to request"
          value={sets(totalQty)}
          sub="after existing vouchers"
          tone={totalQty > 0 ? "error" : "success"}
        />
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Create from customer orders
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Customer order quantities not yet included in a supplier voucher.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            loading={refreshing}
          >
            Refresh
          </Button>
        </div>

        <SupplierVoucherTabs
          active="to_order"
          onVouchers={onOpenVouchers}
          onToOrder={() => undefined}
        />

        {groups.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon />}
            title="Nothing to order"
            description="All open customer demand is already covered by supplier vouchers."
          />
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {groups.map((group) => {
              const isUnassigned =
                group.supplierName === UNASSIGNED_SUPPLIER;
              return (
                <section key={group.supplierName}>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-bg-subtle">
                  <div>
                    <h3
                      className={cn(
                        "font-semibold",
                        isUnassigned ? "text-warning" : "text-text-primary",
                      )}
                    >
                      {isUnassigned
                        ? "Supplier / Factory not chosen"
                        : group.supplierName}
                    </h3>
                    <p className="text-sm text-text-muted">
                      {isUnassigned
                        ? "Assign a factory before creating a supplier voucher."
                        : `${formatQty(group.lines.length)} product${group.lines.length === 1 ? "" : "s"} · ${sets(group.total)} to request`}
                    </p>
                  </div>
                  {!isUnassigned && (
                    <Button
                      size="sm"
                      onClick={() =>
                        onCreateVoucher(group.supplierName, group.lines)
                      }
                    >
                      <PlusIcon className="w-4 h-4" />
                      Create voucher
                    </Button>
                  )}
                  </div>
                  <TableContainer className="border-0 rounded-none">
                    <Thead>
                      <Tr>
                        <Th>Order</Th>
                        <Th>Customer</Th>
                        <Th>Product</Th>
                        <Th>Colors to request</Th>
                        <Th className="text-right whitespace-nowrap">
                          Qty to request
                        </Th>
                        {isUnassigned && <Th className="w-28">Action</Th>}
                      </Tr>
                    </Thead>
                    <Tbody>
                      {group.lines.map((line, index) => (
                        <Tr key={`${line.order_no}-${line.stock_code}-${index}`}>
                          <Td className="whitespace-nowrap">
                            <Reference value={line.order_no} what="order no." />
                          </Td>
                          <Td className="font-medium whitespace-nowrap">
                            {line.customer_name}
                        </Td>
                        <Td>
                          <div className="flex min-w-0 flex-col items-start gap-0.5">
                            <div className="flex min-w-0 items-center gap-1">
                              <span className="break-words font-semibold text-brand">
                                {line.stock_code || "No stock code"}
                              </span>
                              {line.stock_code && (
                                <CopyButton
                                  value={line.stock_code}
                                  what="stock code"
                                />
                              )}
                            </div>
                            <span className="break-words text-text-primary">
                              {line.description || "—"}
                            </span>
                            <span className="text-xs text-text-muted">
                              {GROUP_LABELS[line.group]}
                            </span>
                          </div>
                        </Td>
                          <Td className="font-mono text-xs text-text-secondary whitespace-normal break-words">
                            {line.color_qty || "—"}
                          </Td>
                          <Td className="text-right tabular-nums font-semibold text-error whitespace-nowrap">
                            {sets(line.remaining)}
                          </Td>
                          {isUnassigned && (
                            <Td>
                              <Button
                                size="sm"
                                variant="secondary"
                                className={SOFT_BLUE}
                                onClick={() => onOpenOrder(line.order_id)}
                              >
                                Open order
                              </Button>
                            </Td>
                          )}
                        </Tr>
                      ))}
                    </Tbody>
                  </TableContainer>
                </section>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

// Which customers are waiting for a stock code. This is **not** allocation: nothing is
// given to anyone until the boxes are opened and counted at the gate and the staff decide
// the split, which is the receiving screen's job (see diagram/wholesale/erd.mmd). This is
// only "who asked for this", so whoever is looking at a voucher can see who it is for.
interface WaitingCustomer {
  name: string;
  orderNo: string;
  qty: number;
}

function customersWaitingFor(
  stockCode: string,
  orders: CustomerOrder[],
): WaitingCustomer[] {
  const waiting: WaitingCustomer[] = [];
  for (const order of orders) {
    if (order.order_status === "cancelled") continue;
    if (orderRemaining(order) <= 0) continue;
    const qty = order.lines
      .filter((line) => line.stock_code === stockCode)
      .reduce((sum, line) => sum + line.wanted_qty, 0);
    if (qty > 0) {
      waiting.push({
        name: order.customer_name,
        orderNo: order.order_no,
        qty,
      });
    }
  }
  return waiting;
}

// What a new voucher can be built from, so a supplier order does not start from a blank
// row when the reason to place it is already sitting in Customer Orders. Purely a
// drafting shortcut — nothing here allocates anything; that still only happens once the
// goods are counted at the gate (see diagram/wholesale/erd.mmd).
interface OpenOrderLine {
  order_id: string;
  order_no: string;
  customer_name: string;
  supplier_name: string;
  stock_code: string;
  description: string;
  group: ProductGroup;
  color_qty: string;
  remaining: number;
}

/** Only lines a customer order itself says come from this factory — the voucher is with
 *  one supplier, so a line naming a different one (or naming none at all) is not "for"
 *  it and would only confuse what this voucher is actually buying. */
function openOrderLines(
  orders: CustomerOrder[],
  supplierName: string,
  vouchers: SupplierVoucher[] = [],
): OpenOrderLine[] {
  const wanted = supplierName.trim().toLowerCase();
  const requestedByCode = new Map<string, ColorPairs>();
  for (const voucher of vouchers) {
    if (voucher.supplier_name.trim().toLowerCase() !== wanted) continue;
    for (const line of voucher.lines) {
      const key = line.stock_code.trim().toLowerCase();
      const requested = requestedByCode.get(key) ?? {};
      for (const [color, pairs] of Object.entries(
        colorPairsForText(line.color_qty, line.unit),
      )) {
        requested[color] = (requested[color] ?? 0) + pairs;
      }
      requestedByCode.set(key, requested);
    }
  }
  const rows: OpenOrderLine[] = [];
  for (const order of orders) {
    if (order.order_status === "cancelled") continue;
    for (const line of order.lines) {
      const lineSupplier = line.supplier_name.trim();
      const isUnassigned = supplierName === UNASSIGNED_SUPPLIER;
      if (isUnassigned) {
        if (lineSupplier && lineSupplier !== "—") continue;
      } else if (lineSupplier.toLowerCase() !== wanted) {
        continue;
      }
      const requested = requestedByCode.get(line.stock_code.trim().toLowerCase()) ?? {};
      const demand = colorPairsForText(line.color_qty, line.unit);
      const remainingColors: ColorPairs = {};
      let openQty = lineRemaining(line);
      for (const [color, pairs] of Object.entries(demand)) {
        const alreadyRequested = Math.min(pairs, requested[color] ?? 0);
        requested[color] = Math.max(0, (requested[color] ?? 0) - alreadyRequested);
        const available = Math.max(0, pairs - alreadyRequested);
        const take = Math.min(available, openQty);
        if (take > 0) remainingColors[color] = take;
        openQty -= take;
      }
      const openPairs = lineRemaining(line) - openQty;
      if (openPairs <= 0) continue;
      rows.push({
        order_id: order.order_id,
        order_no: order.order_no,
        customer_name: order.customer_name,
        supplier_name: line.supplier_name,
        stock_code: line.stock_code,
        description: line.description,
        group: line.group,
        color_qty: colorQtyFromPairs(remainingColors),
        remaining: openPairs,
      });
    }
  }
  return rows.sort((a, b) => (a.order_no < b.order_no ? 1 : -1));
}

function colorQtyFromPairs(pairs: ColorPairs): string {
  return Object.entries(pairs)
    .filter(([, qty]) => qty > 0)
    .map(([color, qty]) =>
      qty % PAIRS_PER.set === 0
        ? `${color}${qty / PAIRS_PER.set}s`
        : `${color}${qty}p`,
    )
    .join(",");
}

/** Two color lines combined colour by colour, not just stuck end to end — "black10s" and
 *  a second line's "black5s,pink5s" becomes "black15s,pink5s", not "black10s,black5s,
 *  pink5s" with the same colour counted on two pieces of the line. */
function mergeColorQty(a: string, b: string): string {
  const merged: ColorPairs = { ...colorPairsForText(a, "set") };
  for (const [color, pairs] of Object.entries(colorPairsForText(b, "set"))) {
    merged[color] = (merged[color] ?? 0) + pairs;
  }
  return Object.entries(merged)
    .filter(([, pairs]) => pairs > 0)
    .map(([color, pairs]) =>
      pairs % PAIRS_PER.set === 0
        ? `${color}${pairs / PAIRS_PER.set}s`
        : `${color}${pairs}p`,
    )
    .join(",");
}

function draftLinesFromOpenOrderLines(rows: OpenOrderLine[]): DraftLine[] {
  const lines: DraftLine[] = [];
  for (const row of rows) {
    const code = row.stock_code.trim().toLowerCase();
    const existing = lines.findIndex(
      (line) => line.stock_code.trim().toLowerCase() === code,
    );
    if (existing >= 0) {
      lines[existing] = {
        ...lines[existing],
        color_qty: mergeColorQty(lines[existing].color_qty, row.color_qty),
      };
    } else {
      lines.push({
        stock_code: row.stock_code,
        description: row.description,
        group: row.group,
        color_qty: row.color_qty,
        buying_price: "",
      });
    }
  }
  return lines.length > 0 ? lines : [{ ...EMPTY_LINE }];
}

/** A row's own actions. Deleting asks a second time inside the menu, since there is no
 *  undo behind it. */
function RowMenu({
  onOpen,
  onEdit,
  onDelete,
}: {
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="Voucher actions"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setConfirming(false);
        }}
        className={cn(
          "p-1.5 rounded-md text-text-muted",
          "transition-colors duration-150",
          "hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <MoreVerticalIcon className="w-4 h-4" />
      </button>
      {open && (
        <FloatingLayer
          anchorRef={ref}
          align="right"
          className="min-w-48 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in"
        >
          {confirming ? (
            <>
              <p className="px-3.5 py-2 text-xs text-text-muted">
                Delete this voucher?
              </p>
              <MenuItem
                icon={<TrashIcon className="w-4 h-4" />}
                label="Delete for good"
                danger
                onClick={() => {
                  setOpen(false);
                  setConfirming(false);
                  onDelete();
                }}
              />
              <MenuItem label="Keep it" onClick={() => setConfirming(false)} />
            </>
          ) : (
            <>
              <MenuItem
                icon={<EyeIcon className="w-4 h-4" />}
                label="View details"
                onClick={() => {
                  setOpen(false);
                  onOpen();
                }}
              />
              <MenuItem
                icon={<PencilIcon className="w-4 h-4" />}
                label="Edit voucher"
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
              />
              <MenuItem
                icon={<TrashIcon className="w-4 h-4" />}
                label="Delete voucher"
                danger
                onClick={() => setConfirming(true)}
              />
            </>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function VoucherInfoView({
  voucher,
}: {
  voucher: SupplierVoucher;
}): React.JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          Supplier
        </h3>
        <dl>
          <ReadOnlyField
            label="Supplier / Factory"
            value={voucher.supplier_name}
          />
        </dl>
      </div>
      <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          Voucher
        </h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          <ReadOnlyField
            label="Voucher no."
            value={voucher.voucher_no}
            copyable
          />
          <ReadOnlyField
            label="Voucher date"
            value={formatDate(voucher.voucher_date)}
          />
          <ReadOnlyField label="Cargo" value={voucher.cargo_name} />
          <ReadOnlyField
            label="Packages"
            value={formatQty(voucher.total_packages)}
          />
        </dl>
      </div>
    </div>
  );
}

function VoucherProductsView({
  voucher,
}: {
  voucher: SupplierVoucher;
}): React.JSX.Element {
  return (
    <TableContainer>
      <Thead className="top-0">
        <Tr>
          <Th className="min-w-[18rem]">Product</Th>
          <Th className="min-w-[11rem]">Colors</Th>
          <Th className="text-right whitespace-nowrap">Ordered qty</Th>
          <Th className="text-right whitespace-nowrap">Received qty</Th>
          <Th className="text-right whitespace-nowrap">Remaining qty</Th>
          <Th className="text-right min-w-[7rem]">Buying price</Th>
          <Th className="text-right">Amount</Th>
          <Th>Customers</Th>
        </Tr>
      </Thead>
      <Tbody>
        {voucher.lines.map((line) => (
          <Tr key={line.voucher_line_id}>
            <Td>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1">
                  <span className="font-semibold text-brand break-words">
                    {line.stock_code || "No stock code"}
                  </span>
                  {line.stock_code && (
                    <CopyButton value={line.stock_code} what="stock code" />
                  )}
                </div>
                <span className="break-words text-text-primary">
                  {line.description || "—"}
                </span>
                <span className="text-xs text-text-muted">
                  {GROUP_LABELS[line.group]}
                </span>
              </div>
            </Td>
            <Td className="whitespace-normal break-words text-text-secondary">
              {line.color_qty || "—"}
            </Td>
            <Td className="text-right tabular-nums">
              {sets(line.voucher_qty)}
            </Td>
            <Td className="text-right tabular-nums">
              {sets(lineReceivedQty(line))}
            </Td>
            <Td className="text-right tabular-nums">
              {sets(lineRemainingQty(line))}
            </Td>
            <Td className="text-right tabular-nums">
              {formatKyat(line.buying_price)}
            </Td>
            <Td className="text-right tabular-nums font-medium whitespace-nowrap">
              {formatKyat(line.voucher_qty * line.buying_price)}
            </Td>
            <Td>
              <WaitingList
                stockCode={line.stock_code}
                voucherQty={line.voucher_qty}
              />
            </Td>
          </Tr>
        ))}
        <Tr className="bg-bg-subtle hover:bg-bg-subtle">
          <Td className="font-semibold" colSpan={2}>
            Total
          </Td>
          <Td className="text-right tabular-nums font-semibold">
            {sets(voucher.total_qty)}
          </Td>
          <Td className="text-right tabular-nums font-semibold text-success">
            {sets(voucher.received_qty)}
          </Td>
          <Td className="text-right tabular-nums font-semibold text-error">
            {sets(remainingQty(voucher))}
          </Td>
          <Td />
          <Td className="text-right tabular-nums font-semibold text-brand">
            {formatKyat(voucherAmount(voucher))}
          </Td>
          <Td />
        </Tr>
      </Tbody>
    </TableContainer>
  );
}

function VoucherDetail({
  voucher: initialVoucher,
  initialMode,
  onSave,
  onBack,
}: {
  voucher: SupplierVoucher;
  initialMode: VoucherDetailMode;
  onSave: (voucher: SupplierVoucher, originalVoucher: SupplierVoucher) => Promise<void>;
  onBack: () => void;
}): React.JSX.Element {
  const [voucher, setVoucher] = useState(initialVoucher);
  const [detailMode, setDetailMode] = useState<VoucherDetailMode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [addingLineId, setAddingLineId] = useState<string | null>(null);
  useEffect(() => {
    setVoucher(initialVoucher);
    setAddingLineId(null);
  }, [initialVoucher]);

  // total_qty/received_qty are the server's own running totals across voucher.lines
  // (see _out in the router) — recomputed here the same way whenever a line changes,
  // so the header figures never lag behind an edit still sitting unsaved on screen.
  function apply(patch: Partial<SupplierVoucher>): void {
    setVoucher((current) => {
      const next = { ...current, ...patch };
      if (!patch.lines) return next;
      return {
        ...next,
        total_qty: next.lines.reduce((sum, line) => sum + line.voucher_qty, 0),
        received_qty: next.lines.reduce(
          (sum, line) => sum + lineReceivedQty(line),
          0,
        ),
      };
    });
  }

  async function saveChanges(): Promise<void> {
    setSaving(true);
    try {
      await onSave(voucher, initialVoucher);
    } finally {
      setSaving(false);
    }
  }

  const remaining = remainingQty(voucher);
  const pct = receivedPct(voucher);
  const amount = voucherAmount(voucher);
  const balance = voucherBalance(voucher);
  const paid = paidAmount(voucher);
  const paidShare = paidPct(voucher);

  // A voucher is corrected the way it was written: change the colours and the quantity
  // follows, the same rule the wizard uses.
  function setLine(index: number, patch: Partial<SupplierVoucherLine>): void {
    apply({
      lines: voucher.lines.map((line, position) =>
        position === index ? { ...line, ...patch } : line,
      ),
    });
  }

  function setColors(index: number, colors: string): void {
    setLine(index, {
      color_qty: colors,
      voucher_qty: colorQtyPairs(colors, "set"),
    });
  }

  function setStockCode(index: number, code: string): void {
    const known = productOf(code);
    setLine(
      index,
      known
        ? {
            stock_code: code,
            description: known.description,
            group: known.group,
          }
        : { stock_code: code },
    );
  }

  function addLine(): void {
    if (addingLineId) return;
    const lineId = `fvl-${Date.now()}`;
    setAddingLineId(lineId);
    apply({
      lines: [
        ...voucher.lines,
        {
          voucher_line_id: lineId,
          stock_code: "",
          description: "",
          group: "man",
          color_qty: "",
          unit: "set",
          voucher_qty: 0,
          buying_price: 0,
        },
      ],
    });
  }

  function removeLine(index: number): void {
    if (voucher.lines[index]?.voucher_line_id === addingLineId) {
      setAddingLineId(null);
    }
    apply({
      lines: voucher.lines.filter((_, position) => position !== index),
    });
  }

  function cancelAddLine(): void {
    if (!addingLineId) return;
    apply({
      lines: voucher.lines.filter(
        (line) => line.voucher_line_id !== addingLineId,
      ),
    });
    setAddingLineId(null);
  }

  function setPayment(
    paymentId: string,
    patch: Partial<SupplierVoucher["payment"]["payments"][number]>,
  ): void {
    apply({
      payment: {
        ...voucher.payment,
        payments: voucher.payment.payments.map((payment) =>
          payment.payment_id === paymentId ? { ...payment, ...patch } : payment,
        ),
      },
    });
  }

  function addPayment(
    payment: SupplierVoucher["payment"]["payments"][number],
  ): void {
    apply({
      payment: {
        ...voucher.payment,
        payments: [...voucher.payment.payments, payment],
      },
    });
  }

  function removePayment(paymentId: string): void {
    apply({
      payment: {
        ...voucher.payment,
        payments: voucher.payment.payments.filter(
          (payment) => payment.payment_id !== paymentId,
        ),
      },
    });
  }

  const hasChanges = JSON.stringify(voucher) !== JSON.stringify(initialVoucher);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeftIcon className="w-4 h-4" />
          Back to vouchers
        </Button>
      </div>

      <Panel>
        <div className="grid items-center gap-3 px-6 py-4 border-b border-border lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                {voucher.voucher_no}
              </h2>
              <ReceivingBadge status={receivingStatus(voucher)} />
              <PaymentBadge status={paymentStatus(voucher)} />
            </div>
            <p className="mt-0.5 truncate text-sm text-text-muted">
              {voucher.supplier_name} · {formatDate(voucher.voucher_date)}
            </p>
          </div>
          <div
            role="tablist"
            aria-label="Voucher detail mode"
            className="order-2 flex w-full rounded-md bg-bg-subtle p-0.5 lg:order-none lg:w-auto lg:justify-self-center"
          >
            {(["view", "edit"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={detailMode === mode}
                onClick={() => setDetailMode(mode)}
                className={cn(
                  "flex-1 rounded-[5px] px-4 py-1.5 text-sm font-medium capitalize transition-colors duration-150 sm:flex-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  detailMode === mode
                    ? "bg-brand text-white shadow-sm"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="order-3 flex items-center gap-2 lg:order-none lg:justify-self-end">
            {(detailMode === "edit" || hasChanges) && (
              <Button
                size="sm"
                onClick={() => void saveChanges()}
                loading={saving}
                disabled={!hasChanges}
              >
                <CheckIcon className="w-4 h-4" />
                Save changes
              </Button>
            )}
          </div>
        </div>

        <div className="px-6 py-6 flex flex-col gap-8">
          <section>
            <SectionLabel>Voucher information</SectionLabel>
            {detailMode === "view" ? (
              <VoucherInfoView voucher={voucher} />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-text-primary">
                    Supplier
                  </h3>
                  <SuggestInput
                    label="Supplier / Factory"
                    placeholder="Goody Factory"
                    suggestions={SUPPLIER_NAMES}
                    value={voucher.supplier_name}
                    onChange={(next) => apply({ supplier_name: next })}
                  />
                </div>
                <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-text-primary">
                    Voucher
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
              <ReadOnlyField
                label="Voucher no."
                value={voucher.voucher_no}
                copyable
              />
              <Input
                label="Date"
                type="date"
                className={EDITABLE}
                value={voucher.voucher_date}
                onChange={(event) =>
                  apply({ voucher_date: event.target.value })
                }
              />
              <SuggestInput
                label="Cargo"
                placeholder="Shwe Moe Cargo"
                suggestions={CARGO_NAMES}
                value={voucher.cargo_name}
                onChange={(next) => apply({ cargo_name: next })}
              />
              <CountField
                label="Packages"
                value={voucher.total_packages}
                onChange={(next) => apply({ total_packages: next })}
              />
                  </div>
                </div>
              </div>
            )}
          </section>

          <section>
            <SectionLabel>Products</SectionLabel>
            {detailMode === "view" ? (
              <VoucherProductsView voucher={voucher} />
            ) : (
              <>
              <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="min-w-[18rem]">Product</Th>
                  <Th className="min-w-[11rem]">Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right whitespace-nowrap">Received qty</Th>
                  <Th className="text-right whitespace-nowrap">Remaining qty</Th>
                  <Th className="text-right min-w-[7rem]">Buying price</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Customers</Th>
                </Tr>
              </Thead>
              <Tbody>
                {voucher.lines.map((line, index) => (
                  <Tr key={line.voucher_line_id}>
                    <Td>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1">
                          <SuggestInput
                            bare
                            label={`Stock code for product ${index + 1}`}
                            placeholder="A1001"
                            suggestions={STOCK_CODES}
                            value={line.stock_code}
                            onChange={(next) => setStockCode(index, next)}
                            error={
                              duplicateStockCodeProblem(voucher.lines, index) ??
                              undefined
                            }
                          />
                          <CopyButton
                            value={line.stock_code}
                            what="stock code"
                          />
                        </div>
                        <CellInput
                          label={`Description for product ${index + 1}`}
                          placeholder="Men's leather sandal"
                          multiline
                          value={line.description}
                          onChange={(next) =>
                            setLine(index, { description: next })
                          }
                        />
                        <GroupSelect
                          label={`Group for product ${index + 1}`}
                          value={line.group}
                          onChange={(group) => setLine(index, { group })}
                        />
                      </div>
                    </Td>
                    <Td>
                      <CellInput
                        label={`Colors for product ${index + 1}`}
                        placeholder="black10s,pink2p"
                        multiline
                        value={line.color_qty}
                        onChange={(next) => setColors(index, next)}
                        error={colorQtyProblem(line.color_qty) ?? undefined}
                      />
                    </Td>
                    <Td className="text-right tabular-nums">
                      {sets(line.voucher_qty)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {sets(lineReceivedQty(line))}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {sets(lineRemainingQty(line))}
                    </Td>
                    <Td>
                      <CellInput
                        label={`Buying price for product ${index + 1}`}
                        placeholder="0"
                        numeric
                        className="text-right"
                        value={String(line.buying_price)}
                        onChange={(next) =>
                          setLine(index, { buying_price: Number(next) || 0 })
                        }
                      />
                    </Td>
                    <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                      {formatKyat(line.voucher_qty * line.buying_price)}
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        title="Remove this product"
                        aria-label={`Remove product ${index + 1}`}
                        className={cn(
                          "ml-2 p-1 rounded-md align-middle transition-colors duration-150",
                          SOFT_RED,
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error",
                        )}
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </Td>
                    <Td>
                      <WaitingList
                        stockCode={line.stock_code}
                        voucherQty={line.voucher_qty}
                      />
                    </Td>
                  </Tr>
                ))}
                <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                  <Td className="font-semibold" colSpan={2}>
                    Total
                  </Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {sets(voucher.total_qty)}
                  </Td>
                  <Td className="text-right tabular-nums font-semibold text-success">
                    {sets(voucher.received_qty)}
                  </Td>
                  <Td className="text-right tabular-nums font-semibold text-error">
                    {sets(remaining)}
                  </Td>
                  <Td />
                  <Td className="text-right tabular-nums font-semibold text-brand">
                    {formatKyat(amount)}
                  </Td>
                  <Td />
                </Tr>
              </Tbody>
            </TableContainer>
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={addLine}
              >
                  <PlusIcon className="w-4 h-4" />
                  Add product
                </Button>
                {addingLineId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelAddLine}
                    className={cn(SOFT_RED, "ml-2")}
                  >
                    Cancel
                  </Button>
                )}
              </div>
              </>
            )}
          </section>

          <section>
            <SectionLabel>Receiving</SectionLabel>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 mb-4">
              <BigFigure label="Ordered qty" value={sets(voucher.total_qty)} />
              <BigFigure
                label="Received qty"
                value={sets(voucher.received_qty)}
                tone="success"
              />
              <BigFigure
                label="Remaining qty"
                value={sets(remaining)}
                tone="error"
              />
            </div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium text-text-secondary">
                Receiving progress
              </span>
              <span className="tabular-nums font-semibold text-text-primary">
                {sets(voucher.received_qty)} / {sets(voucher.total_qty)} ({pct}
                %)
              </span>
            </div>
            <ThinBar pct={pct} label="Receiving progress" />
          </section>

          <section>
            <SectionLabel>Delivery journey</SectionLabel>
            <VoucherJourney voucher={voucher} />
          </section>

          <section>
            <SectionLabel>Payment</SectionLabel>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 mb-4">
              <MoneyFigure label="Voucher total" value={formatKyat(amount)} />
              <MoneyFigure
                label="Paid so far"
                value={formatKyat(paid)}
                tone="success"
              />
              <MoneyFigure
                label="Unpaid amount"
                value={formatKyat(balance)}
                tone={balance > 0 ? "error" : "success"}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm mb-2">
              <span className="font-medium text-text-secondary">
                Paid so far
              </span>
              <span className="tabular-nums font-semibold text-text-primary">
                {formatKyat(paid)} / {formatKyat(amount)} ({paidShare}%)
              </span>
            </div>
            <ThinBar pct={paidShare} label="Paid so far" warn />
            <div className="mt-5">
              {/* The same table the customer side uses, so money paid to a supplier is
                  written down exactly the way money from a customer is. */}
              <PaymentsTable
                payments={voucher.payment.payments}
                balance={balance}
                who="supplier"
                onAdd={addPayment}
                onUpdate={(payment) =>
                  setPayment(payment.payment_id, payment)
                }
                onRemove={removePayment}
                readOnly={detailMode === "view"}
              />
            </div>
          </section>
        </div>
      </Panel>
    </div>
  );
}

function WaitingList({
  stockCode,
  voucherQty,
}: {
  stockCode: string;
  voucherQty: number;
}): React.JSX.Element {
  const { orders } = useWholesale();
  const waiting = customersWaitingFor(stockCode, orders);
  const wanted = waiting.reduce((sum, entry) => sum + entry.qty, 0);
  const spare = voucherQty - wanted;

  if (waiting.length === 0) {
    return (
      <span className="text-xs text-text-muted">
        Nobody waiting — goes to stock
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {waiting.map((entry) => (
        <span
          key={`${entry.orderNo}-${entry.name}`}
          className="inline-flex max-w-full flex-col rounded-full bg-brand-subtle px-2 py-1 text-xs font-medium text-brand"
        >
          <span className="whitespace-nowrap">
            {entry.name} ({sets(entry.qty)})
          </span>
          <span className="inline-flex items-center gap-0.5 break-words text-[10px] font-normal text-brand/75">
            {entry.orderNo}
            <CopyButton value={entry.orderNo} what="order no." />
          </span>
        </span>
      ))}
      {spare > 0 && (
        <span className="inline-flex items-center rounded-full bg-bg-raised text-text-secondary text-xs font-medium px-2 py-0.5 whitespace-nowrap">
          {sets(spare)} unallocated
        </span>
      )}
    </div>
  );
}

// A voucher shows the very journey Delivery shows — the same cards, the same figures —
// with one card in front for the voucher itself. If no shipment has been raised for this
// voucher yet, that first card is all there is to show.
function VoucherJourney({
  voucher,
}: {
  voucher: SupplierVoucher;
}): React.JSX.Element {
  const { shipments, receivings } = useWholesale();
  const shipment = shipments.find(
    (entry) => entry.voucher_no === voucher.voucher_no,
  );

  const taken = (
    <JourneyCard
      key="voucher"
      stage="supplier"
      title="Voucher taken"
      subtitle={formatDate(voucher.voucher_date)}
    >
      <JourneyRow label="Ordered" value={sets(voucher.total_qty)} />
    </JourneyCard>
  );

  if (!shipment) {
    return (
      <div>
        <div className="flex items-stretch overflow-x-auto pb-2 mb-3">
          {taken}
        </div>
      </div>
    );
  }

  return (
    <DeliveryJourney
      shipment={shipment}
      receivings={receivings}
      before={[taken]}
    />
  );
}

function ThinBar({
  pct,
  label,
  warn = false,
}: {
  pct: number;
  label: string;
  warn?: boolean;
}): React.JSX.Element {
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2 rounded-full bg-bg-raised overflow-hidden"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
          pct === 100 ? "bg-success" : warn ? "bg-warning" : "bg-brand",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function BigFigure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "success" | "error";
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-center",
        tone === "success" && "bg-success-subtle border-success/30",
        tone === "warning" && "bg-warning-subtle border-warning/30",
        tone === "error" && "bg-error-subtle border-error/30",
        tone === "neutral" && "bg-bg-subtle border-border",
      )}
    >
      <div className="text-xs uppercase tracking-wide text-text-muted mb-1">
        {label}
      </div>
      <div
        className={cn(
          "text-xl font-bold tabular-nums leading-none",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "error" && "text-error",
          tone === "neutral" && "text-text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function MoneyFigure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "error";
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-center",
        tone === "success" && "bg-success-subtle border-success/30",
        tone === "error" && "bg-error-subtle border-error/30",
        tone === "neutral" && "bg-bg-subtle border-border",
      )}
    >
      <div className="text-xs uppercase tracking-wide text-text-muted mb-1">
        {label}
      </div>
      <div
        className={cn(
          "text-base font-bold tabular-nums leading-none",
          tone === "success" && "text-success",
          tone === "error" && "text-error",
          tone === "neutral" && "text-text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ── New voucher ──────────────────────────────────────────────────────────────

interface DraftLine {
  stock_code: string;
  description: string;
  group: ProductGroup;
  color_qty: string;
  buying_price: string;
}

/** The pairs one drafted row comes to: its colors read in its own unit. */
function draftPairs(line: DraftLine): number {
  // A colour with no letter of its own is counted in sets.
  return colorQtyPairs(line.color_qty, "set");
}

const EMPTY_LINE: DraftLine = {
  stock_code: "",
  description: "",
  group: "man",
  color_qty: "",
  buying_price: "",
};

const STEPS = ["Supplier", "Products", "Review"] as const;

function NewVoucherForm({
  nextVoucherNo: voucherNo,
  initialSupplierName = "",
  initialOrderLines,
  onCancel,
  onCreate,
}: {
  nextVoucherNo: string;
  initialSupplierName?: string;
  initialOrderLines?: OpenOrderLine[];
  onCancel: () => void;
  onCreate: (input: NewSupplierVoucherInput) => void;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [voucherDate, setVoucherDate] = useState(todayIso());
  const [supplierName, setSupplierName] = useState(initialSupplierName);
  const [cargoName, setCargoName] = useState("");
  const [packages, setPackages] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initialOrderLines ? draftLinesFromOpenOrderLines(initialOrderLines) : [{ ...EMPTY_LINE }],
  );
  const [showOrderPicker, setShowOrderPicker] = useState(false);

  const { orders, vouchers } = useWholesale();
  const orderLines = useMemo(
    () => openOrderLines(orders, supplierName, vouchers),
    [orders, supplierName, vouchers],
  );

  const filledLines = lines.filter((line) => line.stock_code.trim() !== "");
  const totalQty = filledLines.reduce((sum, line) => sum + draftPairs(line), 0);
  const totalAmount = filledLines.reduce(
    (sum, line) => sum + draftPairs(line) * (Number(line.buying_price) || 0),
    0,
  );
  const canLeaveSupplier = supplierName.trim() !== "";
  const colorProblem = lines
    .map((line) => colorQtyProblem(line.color_qty))
    .find((problem) => problem !== null);
  // Every row that names a product has to say how much of it: a stock code with no
  // colours counts nothing, and a line worth nothing on an order is a line nobody can
  // deliver against.
  const emptyColors = filledLines.some((line) => line.color_qty.trim() === "");
  const hasDuplicateStockCode = lines.some(
    (_, index) => duplicateStockCodeProblem(lines, index) !== null,
  );
  const canLeaveProducts =
    filledLines.length > 0 &&
    totalQty > 0 &&
    !emptyColors &&
    colorProblem === undefined &&
    !hasDuplicateStockCode;

  function updateLine(index: number, patch: Partial<DraftLine>): void {
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, ...patch } : line,
      ),
    );
  }

  // A code we already buy fills its own description and group in, so the same shoe is not
  // written two slightly different ways on two vouchers.
  function setStockCode(index: number, code: string): void {
    const known = productOf(code);
    updateLine(
      index,
      known
        ? {
            stock_code: code,
            description: known.description,
            group: known.group,
          }
        : { stock_code: code },
    );
  }

  function removeLine(index: number): void {
    setLines((current) =>
      current.length === 1
        ? [{ ...EMPTY_LINE }]
        : current.filter((_, position) => position !== index),
    );
  }

  // Customer demand is an optional shortcut. Adding a line here merges colours into an
  // existing stock-code row, while the manual product rows remain available below.
  function importOrderLine(source: OpenOrderLine): void {
    setLines((current) => {
      const code = source.stock_code.trim().toLowerCase();
      const matchIndex = current.findIndex(
        (line) => line.stock_code.trim().toLowerCase() === code,
      );
      if (matchIndex !== -1) {
        const existing = current[matchIndex];
        const combined = mergeColorQty(existing.color_qty, source.color_qty);
        return current.map((line, index) =>
          index === matchIndex ? { ...line, color_qty: combined } : line,
        );
      }
      const filled: DraftLine = {
        stock_code: source.stock_code,
        description: source.description,
        group: source.group,
        color_qty: source.color_qty,
        buying_price: "",
      };
      const emptyIndex = current.findIndex(
        (line) => line.stock_code.trim() === "",
      );
      return emptyIndex !== -1
        ? current.map((line, index) => (index === emptyIndex ? filled : line))
        : [...current, filled];
    });
  }

  function submit(): void {
    const voucherLines: SupplierVoucherLine[] = filledLines.map(
      (line, index) => ({
        voucher_line_id: `line-${index}`,
        stock_code: line.stock_code.trim(),
        description: line.description.trim(),
        group: line.group,
        color_qty: line.color_qty.trim(),
        unit: "set",
        voucher_qty: draftPairs(line),
        buying_price: Number(line.buying_price) || 0,
      }),
    );
    onCreate({
      supplier_name: supplierName.trim(),
      voucher_date: voucherDate,
      total_packages: Number(packages) || 0,
      cargo_name: cargoName.trim(),
      lines: voucherLines,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <ChevronLeftIcon className="w-4 h-4" />
          Back to vouchers
        </Button>
      </div>

      <Panel>
        <div className="px-6 py-5 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight mb-5">
            New supplier voucher
          </h2>
          <StepBar steps={STEPS} step={step} />
        </div>

        {step === 0 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <SectionLabel>Step 1 — supplier &amp; shipment</SectionLabel>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Input
                label="Date"
                type="date"
                className={EDITABLE}
                value={voucherDate}
                onChange={(event) => setVoucherDate(event.target.value)}
              />
              <Select
                label={<Required>Supplier / Factory</Required>}
                className={EDITABLE}
                value={supplierName}
                onChange={(event) => setSupplierName(event.target.value)}
              >
                <option value="">Choose…</option>
                {SUPPLIER_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
              <Select
                label="Cargo"
                className={EDITABLE}
                value={cargoName}
                onChange={(event) => setCargoName(event.target.value)}
              >
                <option value="">Choose…</option>
                {CARGO_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
              <Input
                label="Packages"
                type="text"
                inputMode="numeric"
                placeholder="0"
                className={cn(EDITABLE, "text-right")}
                value={packages}
                onChange={(event) =>
                  setPackages(onlyDigits(event.target.value))
                }
                hint="How many packages the supplier says it is sending."
              />
            </div>
            <div className="flex justify-end">
              <Button disabled={!canLeaveSupplier} onClick={() => setStep(1)}>
                Next: products
                <ChevronRightIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <div>
              <SectionLabel>Step 2 — products</SectionLabel>
              <p className="text-sm text-text-muted -mt-1">
                One row per stock code. Write the colors together with their
                counts and unit — black10s,pink2p — and the quantity works
                itself out.
              </p>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setShowOrderPicker((open) => !open)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-text-primary transition-colors duration-150 hover:bg-bg-subtle"
              >
                <span>Choose from customer orders for {supplierName}</span>
                <span className="text-xs text-text-muted">
                  {orderLines.length > 0
                    ? `${formatQty(orderLines.length)} product${orderLines.length === 1 ? "" : "s"} available`
                    : "No open products"}
                </span>
              </button>
              {showOrderPicker && (
                orderLines.length === 0 ? (
                  <p className="border-t border-border px-4 pb-4 pt-3 text-sm text-text-muted">
                    No open customer-order products are waiting for {supplierName}.
                    You can add a product manually below.
                  </p>
                ) : (
                  <TableContainer className="rounded-none border-0 border-t border-border">
                    <Thead>
                      <Tr>
                        <Th className="whitespace-nowrap">Order no.</Th>
                        <Th>Customer</Th>
                        <Th className="min-w-[12rem]">Product</Th>
                        <Th>Colors to request</Th>
                        <Th className="whitespace-nowrap text-right">
                          Qty to request
                        </Th>
                        <Th className="w-24" aria-label="Add product" />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {orderLines.map((row, index) => (
                        <Tr key={`${row.order_no}-${row.stock_code}-${index}`}>
                          <Td className="whitespace-nowrap">
                            <Reference value={row.order_no} what="order no." />
                          </Td>
                          <Td className="whitespace-nowrap font-medium">
                            {row.customer_name}
                          </Td>
                          <Td>
                            <div className="flex min-w-0 flex-col items-start gap-0.5">
                              <div className="flex min-w-0 items-center gap-1">
                                <span className="break-words font-semibold text-brand">
                                  {row.stock_code || "No stock code"}
                                </span>
                                {row.stock_code && (
                                  <CopyButton
                                    value={row.stock_code}
                                    what="stock code"
                                  />
                                )}
                              </div>
                              <span className="break-words text-text-primary">
                                {row.description || "—"}
                              </span>
                              <span className="text-xs text-text-muted">
                                {GROUP_LABELS[row.group]}
                              </span>
                            </div>
                          </Td>
                          <Td className="whitespace-normal break-words font-mono text-xs text-text-secondary">
                            {row.color_qty || "—"}
                          </Td>
                          <Td className="whitespace-nowrap text-right font-semibold tabular-nums text-error">
                            {sets(row.remaining)}
                          </Td>
                          <Td className="text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              className={SOFT_BLUE}
                              onClick={() => importOrderLine(row)}
                            >
                              <PlusIcon className="w-4 h-4" />
                              Add
                            </Button>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </TableContainer>
                )
              )}
            </div>

            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="min-w-[18rem]">Product</Th>
                  <Th className="min-w-[13rem]">Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right min-w-[8rem]">Buying price</Th>
                  <Th className="text-right min-w-[8rem]">Amount</Th>
                </Tr>
              </Thead>
              <Tbody>
                {lines.map((line, index) => {
                  const lineQty = draftPairs(line);
                  const lineAmount = lineQty * (Number(line.buying_price) || 0);
                  return (
                    <Tr key={index}>
                      <Td className="min-w-[18rem]">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <div className="flex min-w-0 items-start gap-1">
                            <SuggestInput
                              bare
                              label={`Stock code for product ${index + 1}`}
                              placeholder="A1001"
                              suggestions={STOCK_CODES}
                              value={line.stock_code}
                              onChange={(next) => setStockCode(index, next)}
                              error={
                                duplicateStockCodeProblem(lines, index) ??
                                undefined
                              }
                            />
                            <CopyButton
                              value={line.stock_code}
                              what="stock code"
                            />
                          </div>
                          <CellInput
                            label={`Description for product ${index + 1}`}
                            placeholder="Men's leather sandal"
                            multiline
                            value={line.description}
                            onChange={(next) =>
                              updateLine(index, { description: next })
                            }
                          />
                          <GroupSelect
                            label={`Group for product ${index + 1}`}
                            value={line.group}
                            onChange={(group) => updateLine(index, { group })}
                          />
                        </div>
                      </Td>
                      <Td>
                        <CellInput
                          label={`Colors for product ${index + 1}`}
                          placeholder="black10s,pink2p"
                          multiline
                          value={line.color_qty}
                          onChange={(next) =>
                            updateLine(index, { color_qty: next })
                          }
                          error={colorQtyProblem(line.color_qty) ?? undefined}
                        />
                        <span className="mt-1 block text-xs text-text-muted">
                          {lineQty > 0
                            ? sets(lineQty)
                            : "Every color needs a unit — s sets, p pairs, d dozens"}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                        {sets(lineQty)}
                      </Td>
                      <Td>
                        <CellInput
                          label={`Buying price for product ${index + 1}`}
                          placeholder="0"
                          numeric
                          className="text-right"
                          value={line.buying_price}
                          onChange={(next) =>
                            updateLine(index, {
                              buying_price: onlyDigits(next),
                            })
                          }
                        />
                      </Td>
                      <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                        {formatKyat(lineAmount)}
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn("ml-2 align-middle", SOFT_RED)}
                          aria-label={`Remove row ${index + 1}`}
                          onClick={() => removeLine(index)}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
                <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                  <Td className="font-semibold" colSpan={2}>
                    Total
                  </Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {sets(totalQty)}
                  </Td>
                  <Td />
                  <Td className="text-right tabular-nums font-semibold text-brand">
                    {formatKyat(totalAmount)}
                  </Td>
                </Tr>
              </Tbody>
            </TableContainer>

            <div>
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() =>
                  setLines((current) => [...current, { ...EMPTY_LINE }])
                }
              >
                <PlusIcon className="w-4 h-4" />
                Add another product
              </Button>
            </div>

            <div className="flex justify-between">
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() => setStep(0)}
              >
                <ChevronLeftIcon className="w-4 h-4" />
                Back
              </Button>
              <Button disabled={!canLeaveProducts} onClick={() => setStep(2)}>
                Next: review
                <ChevronRightIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <SectionLabel>Step 3 — review &amp; confirm</SectionLabel>
            <dl className="grid gap-4 grid-cols-1 sm:grid-cols-4 bg-bg-subtle border border-border rounded-lg p-4">
              <ReviewFact label="Voucher no." value={voucherNo} />
              <ReviewFact label="Date" value={formatDate(voucherDate)} />
              <ReviewFact
                label="Supplier / Factory"
                value={supplierName || "—"}
              />
              <ReviewFact label="Cargo" value={cargoName || "—"} />
              <ReviewFact label="Packages" value={packages || "—"} />
            </dl>
            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="min-w-[18rem]">Product</Th>
                  <Th className="min-w-[13rem]">Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right min-w-[8rem] whitespace-nowrap">
                    Buying price
                  </Th>
                  <Th className="text-right min-w-[8rem]">Amount</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filledLines.map((line, index) => {
                  const qty = draftPairs(line);
                  return (
                    <Tr key={index}>
                      <Td className="min-w-[18rem]">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <div className="flex items-center gap-1">
                            <span className="font-semibold text-brand break-words">
                              {line.stock_code}
                            </span>
                            {line.stock_code && (
                              <CopyButton
                                value={line.stock_code}
                                what="stock code"
                              />
                            )}
                          </div>
                          <ProductCell
                            description={line.description}
                            group={line.group}
                          />
                        </div>
                      </Td>
                      <Td className="font-mono text-xs text-text-secondary break-words">
                        {line.color_qty || "—"}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {sets(qty)}
                      </Td>
                      <Td className="text-right tabular-nums text-text-secondary">
                        {formatKyat(Number(line.buying_price) || 0)}
                      </Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatKyat(qty * (Number(line.buying_price) || 0))}
                      </Td>
                    </Tr>
                  );
                })}
                <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                  <Td className="font-semibold" colSpan={2}>
                    Total
                  </Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {sets(totalQty)}
                  </Td>
                  <Td />
                  <Td className="text-right tabular-nums font-semibold text-brand">
                    {formatKyat(totalAmount)}
                  </Td>
                </Tr>
              </Tbody>
            </TableContainer>
            <div className="flex justify-between">
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() => setStep(1)}
              >
                <ChevronLeftIcon className="w-4 h-4" />
                Back
              </Button>
              <Button onClick={submit}>
                <CheckIcon className="w-4 h-4" />
                Confirm voucher
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
