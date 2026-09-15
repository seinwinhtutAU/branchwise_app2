import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import {
  CellInput,
  CountField,
  CurrencySelect,
  EDITABLE,
  GroupSelect,
  FigureCard,
  FloatingLayer,
  MenuItem,
  MismatchIconButton,
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
import type { AppSettings } from "@renderer/lib/appSettings";
import {
  DEFAULT_CURRENCY,
  formatOriginalAmount,
  formatRate,
  isForeignCurrency,
  previewKyatAmount,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/currency";
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
  WarehouseIcon,
} from "@renderer/components/ui/icons";
import { DeliveryJourney } from "@renderer/components/features/wholesale/journey";
import {
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
  formatDate,
  colorQtyPairs,
  colorQtyProblem,
  duplicateStockCodeProblem,
  formatKyat,
  formatQty,
  mismatchDescription,
  nextReference,
  onlyDigits,
  todayIso,
  type PaymentStatus,
} from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  PAIRS_PER,
  pricedAmount,
  UNIT_LABELS,
  UNITS,
} from "@renderer/components/features/wholesale/units";
import {
  colorPairsForText,
  type ColorPairs,
} from "@renderer/components/features/wholesale/stock";
import {
  hydrateVouchers,
  hydrateOrders,
  saveOrders,
  saveVouchers,
  useWholesale,
} from "@renderer/components/features/wholesale/store";
import {
  CUSTOMER_ORDERS_URL,
  SUPPLIER_VOUCHERS_URL,
  WHOLESALE_WRITE_OFFS_URL,
  WholesaleApiError,
  addSupplierVoucherPayment,
  createSupplierVoucher,
  deleteSupplierVoucher,
  removeSupplierVoucherPayment,
  ordersFromWire,
  updateCustomerOrder,
  updateSupplierVoucher,
  writeOffSupplierVoucherLine,
  type WriteOffReason,
  type WriteOffWire,
  vouchersFromWire,
  type NewSupplierVoucherInput,
  type SupplierVoucherWire,
} from "@renderer/components/features/wholesale/api";
import {
  GROUP_LABELS,
  type ProductGroup,
} from "@renderer/components/features/wholesale/products";
import {
  CARGO_NAMES,
  STOCK_CODES,
  SUPPLIER_NAMES,
  productOf,
  useHydrateMasterData,
} from "@renderer/components/features/wholesale/masterData";
import { WriteOffModal } from "@renderer/components/features/wholesale/WriteOffModal";

/** An aggregate may combine products with different units, so pairs are its only
 * unambiguous display unit. Individual lines use their own unit below. */
const sets = (qty: number): string => formatIn(qty, "pair");

function lineReceivedQty(line: SupplierVoucherLine): number {
  return line.received_quantity_pairs ?? 0;
}
function lineRemainingQty(line: SupplierVoucherLine): number {
  return Math.max(
    0,
    line.quantity_pairs -
      lineReceivedQty(line) -
      (line.lost_quantity_pairs ?? 0),
  );
}

// The wholesale Supplier Vouchers screen — the supplier's (factory's) own document for
// one batch it is sending us. Built the same way as Customer Orders: the prototype's layout (figure cards,
// one panel holding header, filters, table and pagination; a read-only detail sheet; a
// three-step wizard), the ERD's fields, and this app's own tokens and primitives.
//
// Reads and writes the backend through React Query rather than the hand-rolled
// useCachedFetch — see @renderer/lib/queryClient.ts. The shared store is still hydrated
// with each query's own answer, since other screens still read vouchers/orders from
// there; nothing here recomputes what the query already got right.

const VOUCHERS_QUERY_KEY = ["wholesale", "supplier-vouchers"] as const;
const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;

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
  settings,
  initialVoucherId,
  onInitialVoucherOpened,
}: {
  session: Session;
  settings: AppSettings | null;
  initialVoucherId?: string | null;
  onInitialVoucherOpened?: () => void;
}): React.JSX.Element {
  const showToast = useToast();
  useHydrateMasterData(session);
  const queryClient = useQueryClient();
  const {
    data: wire,
    isFetching: isRefreshing,
    isError,
  } = useQuery({
    queryKey: VOUCHERS_QUERY_KEY,
    queryFn: () =>
      fetchJson<SupplierVoucherWire[]>(SUPPLIER_VOUCHERS_URL, session),
  });
  useLoadErrorToast(isError, "supplier vouchers");
  const { data: writeOffs = [], isError: writeOffsFailed } = useQuery({
    queryKey: ["wholesale", "write-offs"],
    queryFn: () => fetchJson<WriteOffWire[]>(WHOLESALE_WRITE_OFFS_URL, session),
  });
  useLoadErrorToast(writeOffsFailed, "mismatch explanations");
  useEffect(() => {
    if (wire) hydrateVouchers(vouchersFromWire(wire));
  }, [wire]);

  async function reload(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: VOUCHERS_QUERY_KEY });
    await queryClient.invalidateQueries({
      queryKey: ["wholesale", "write-offs"],
    });
  }

  const { data: orderWire, isError: ordersFailed } = useQuery({
    queryKey: ORDERS_QUERY_KEY,
    queryFn: () => fetchJson<CustomerOrder[]>(CUSTOMER_ORDERS_URL, session),
  });
  useLoadErrorToast(ordersFailed, "customer orders for supplier planning");

  async function reloadOrders(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
  }

  useEffect(() => {
    if (orderWire) hydrateOrders(ordersFromWire(orderWire));
  }, [orderWire]);
  const { vouchers, orders } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openMode, setOpenMode] = useState<VoucherDetailMode>("view");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newOrderLines, setNewOrderLines] = useState<
    OpenOrderLine[] | undefined
  >();

  useEffect(() => {
    if (!initialVoucherId) return;
    const target = vouchers.find(
      (voucher) => voucher.voucher_id === initialVoucherId,
    );
    if (!target) return;
    setSelectedId(target.voucher_id);
    setOpenMode("view");
    setView("detail");
    onInitialVoucherOpened?.();
  }, [initialVoucherId, onInitialVoucherOpened, vouchers]);

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
    deleteSupplierVoucher(session, voucherId)
      .then(async () => {
        setSelectedId((current) => (current === voucherId ? null : current));
        setView("list");
        await reload();
      })
      .catch((error) =>
        showToast(
          "error",
          error instanceof WholesaleApiError
            ? error.message
            : "Could not delete the voucher.",
        ),
      );
  }

  async function persistVoucher(
    voucher: SupplierVoucher,
    originalVoucher: SupplierVoucher,
  ): Promise<void> {
    try {
      await updateSupplierVoucher(session, voucher.voucher_id, {
        supplier_name: voucher.supplier_name,
        voucher_date: voucher.voucher_date,
        carrier_name: voucher.carrier_name,
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
        left.paid_on !== right.paid_on ||
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
            await addSupplierVoucherPayment(
              session,
              voucher.voucher_id,
              payment,
            );
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

  async function writeOffVoucherLine(
    lineId: string,
    quantity: number,
    reason: WriteOffReason,
    note: string,
  ): Promise<void> {
    await writeOffSupplierVoucherLine(session, lineId, {
      quantity,
      reason,
      note,
    });
    await reload();
    showToast("success", "Write-off recorded.");
  }

  function addVoucher(input: NewSupplierVoucherInput): void {
    createSupplierVoucher(session, input)
      .then(async (voucher) => {
        saveVouchers((current) => [voucher, ...current]);
        setSelectedId(voucher.voucher_id);
        setOpenMode("edit");
        setView("detail");
        await reload();
      })
      .catch((error) =>
        showToast(
          "error",
          error instanceof WholesaleApiError
            ? error.message
            : "Could not create the voucher.",
        ),
      );
  }

  function startNewVoucher(
    supplierName = "",
    orderLines?: OpenOrderLine[],
  ): void {
    setNewSupplierName(supplierName);
    setNewOrderLines(orderLines);
    setView("new");
  }

  async function assignOrderLineSupplier(
    orderId: string,
    orderLineId: string,
    supplierName: string,
  ): Promise<void> {
    const order = orders.find((candidate) => candidate.order_id === orderId);
    const trimmedSupplier = supplierName.trim();
    if (!order || !trimmedSupplier) return;

    try {
      const updatedOrder = await updateCustomerOrder(session, orderId, {
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        customer_address: order.customer_address,
        order_date: order.order_date,
        lines: order.lines.map((line) =>
          line.order_line_id === orderLineId
            ? { ...line, supplier_name: trimmedSupplier }
            : line,
        ),
      });
      saveOrders((current) =>
        current.map((candidate) =>
          candidate.order_id === updatedOrder.order_id
            ? updatedOrder
            : candidate,
        ),
      );
      reloadOrders();
      showToast("success", "Factory assigned to product.");
    } catch (error) {
      showToast(
        "error",
        error instanceof WholesaleApiError
          ? error.message
          : "Could not assign the factory.",
      );
    }
  }

  if (view === "new") {
    return (
      <NewVoucherForm
        nextVoucherNo={nextVoucherNo(vouchers)}
        initialSupplierName={newSupplierName}
        initialOrderLines={newOrderLines}
        lockedSupplier={Boolean(newSupplierName)}
        settings={settings}
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
        onAssignSupplier={assignOrderLineSupplier}
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
        onWriteOff={writeOffVoucherLine}
        writeOffs={writeOffs}
        settings={settings}
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
    (sum, voucher) => sum + voucher.total_quantity_pairs,
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
        voucher.carrier_name.toLowerCase().includes(query) ||
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
          <div className="w-full sm:w-[28rem] lg:w-[32rem]">
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
                  <Th className="text-right whitespace-nowrap">
                    Ordered quantity
                  </Th>
                  <Th className="text-right whitespace-nowrap">
                    Remaining quantity
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
                        {sets(voucher.total_quantity_pairs)}
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
    .filter((product_group) => product_group.lines.length > 0)
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
  onAssignSupplier,
}: {
  orders: CustomerOrder[];
  vouchers: SupplierVoucher[];
  onOpenVouchers: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onCreateVoucher: (supplierName: string, orderLines: OpenOrderLine[]) => void;
  onAssignSupplier: (
    orderId: string,
    orderLineId: string,
    supplierName: string,
  ) => Promise<void>;
}): React.JSX.Element {
  const [supplierDrafts, setSupplierDrafts] = useState<Record<string, string>>(
    {},
  );
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const groups = useMemo(
    () => supplierDemandGroups(orders, vouchers),
    [orders, vouchers],
  );
  const totalQty = groups.reduce(
    (sum, product_group) => sum + product_group.total,
    0,
  );
  const selectedGroup = groups.find(
    (product_group) => product_group.supplierName === selectedSupplier,
  );
  const selectedLines =
    selectedGroup?.lines.filter((line) =>
      selectedLineIds.includes(line.order_line_id),
    ) ?? [];
  const selectedTotal = selectedLines.reduce(
    (sum, line) => sum + line.remaining,
    0,
  );
  const allProductsSelected =
    !!selectedGroup &&
    selectedGroup.lines.length > 0 &&
    selectedGroup.lines.every((line) =>
      selectedLineIds.includes(line.order_line_id),
    );

  async function saveSupplier(line: OpenOrderLine): Promise<void> {
    const supplierName = supplierDrafts[line.order_line_id]?.trim() ?? "";
    if (!supplierName || savingLineId) return;

    setSavingLineId(line.order_line_id);
    try {
      await onAssignSupplier(line.order_id, line.order_line_id, supplierName);
      setSupplierDrafts((current) => {
        const next = { ...current };
        delete next[line.order_line_id];
        return next;
      });
    } finally {
      setSavingLineId(null);
    }
  }

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
          value={formatQty(
            groups.reduce(
              (sum, product_group) => sum + product_group.lines.length,
              0,
            ),
          )}
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
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-text-primary tracking-tight">
                Create from customer orders
              </h2>
              <p className="text-sm text-text-muted mt-0.5">
                Customer order products still waiting for a supplier voucher.
              </p>
            </div>
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
        ) : !selectedGroup ? (
          <div className="p-6">
            <div className="mb-5">
              <h3 className="font-semibold text-text-primary">
                Choose a factory
              </h3>
              <p className="mt-1 text-sm text-text-muted">
                Select a factory to see only the customer-order products it
                needs to supply.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {groups.map((product_group) => {
                const isUnassigned =
                  product_group.supplierName === UNASSIGNED_SUPPLIER;
                return (
                  <section
                    key={product_group.supplierName}
                    className="product_group flex flex-col overflow-hidden rounded-xl border border-border bg-bg-base transition-all duration-150 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-subtle/40 px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                            isUnassigned
                              ? "bg-warning-subtle text-warning"
                              : "bg-brand-subtle text-brand",
                          )}
                        >
                          <WarehouseIcon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                            Factory
                          </p>
                          <h4
                            className={cn(
                              "mt-0.5 break-words text-base font-semibold",
                              isUnassigned
                                ? "text-warning"
                                : "text-text-primary",
                            )}
                          >
                            {isUnassigned
                              ? "Factory not chosen"
                              : product_group.supplierName}
                          </h4>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-border">
                      <div className="px-5 py-4">
                        <p className="text-xs font-medium text-text-muted">
                          Products
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                          {formatQty(product_group.lines.length)}
                        </p>
                      </div>
                      <div className="px-5 py-4">
                        <p className="text-xs font-medium text-text-muted">
                          To request
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                          {sets(product_group.total)}
                        </p>
                      </div>
                    </div>
                    <div className="px-5 pb-5">
                      <Button
                        className="w-full justify-center"
                        size="sm"
                        variant={isUnassigned ? "secondary" : "primary"}
                        onClick={() => {
                          setSelectedSupplier(product_group.supplierName);
                          setSelectedLineIds(
                            product_group.lines.map(
                              (line) => line.order_line_id,
                            ),
                          );
                        }}
                      >
                        {isUnassigned ? "Assign factory" : "Choose products"}
                        <ChevronRightIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-bg-subtle px-6 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Back to factories"
                    title="Back to factories"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition-colors duration-150 hover:border-brand/50 hover:bg-brand-subtle hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                    onClick={() => {
                      setSelectedSupplier(null);
                      setSelectedLineIds([]);
                    }}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <h3
                    className={cn(
                      "font-semibold",
                      selectedGroup.supplierName === UNASSIGNED_SUPPLIER
                        ? "text-warning"
                        : "text-text-primary",
                    )}
                  >
                    {selectedGroup.supplierName === UNASSIGNED_SUPPLIER
                      ? "Factory not chosen"
                      : selectedGroup.supplierName}
                  </h3>
                </div>
                <p className="text-sm text-text-muted">
                  {selectedGroup.supplierName === UNASSIGNED_SUPPLIER
                    ? "Assign a factory to each product before creating a supplier voucher."
                    : `${formatQty(selectedGroup.lines.length)} product${selectedGroup.lines.length === 1 ? "" : "s"} · ${sets(selectedGroup.total)} to request`}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <span className="text-sm text-text-muted">
                  {formatQty(selectedLines.length)} selected ·{" "}
                  {sets(selectedTotal)}
                </span>
                {selectedGroup.supplierName !== UNASSIGNED_SUPPLIER && (
                  <Button
                    size="sm"
                    disabled={selectedLines.length === 0}
                    onClick={() =>
                      onCreateVoucher(selectedGroup.supplierName, selectedLines)
                    }
                  >
                    <PlusIcon className="w-4 h-4" />
                    Create voucher
                  </Button>
                )}
              </div>
            </div>
            <TableContainer className="rounded-none border-0">
              <Thead>
                <Tr>
                  <Th>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand"
                        aria-label="Select all products"
                        checked={allProductsSelected}
                        ref={(element) => {
                          if (element) {
                            element.indeterminate =
                              selectedLines.length > 0 && !allProductsSelected;
                          }
                        }}
                        onChange={(event) =>
                          setSelectedLineIds(
                            event.target.checked
                              ? selectedGroup.lines.map(
                                  (line) => line.order_line_id,
                                )
                              : [],
                          )
                        }
                      />
                      <span>Order</span>
                    </label>
                  </Th>
                  <Th>Customer</Th>
                  <Th>Product</Th>
                  <Th>Colors</Th>
                  <Th className="text-right whitespace-nowrap">
                    Qty to request
                  </Th>
                  {selectedGroup.supplierName === UNASSIGNED_SUPPLIER && (
                    <Th className="min-w-[17rem]">Factory</Th>
                  )}
                </Tr>
              </Thead>
              <Tbody>
                {selectedGroup.lines.map((line, index) => (
                  <Tr key={`${line.order_no}-${line.stock_code}-${index}`}>
                    <Td>
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand"
                          aria-label={`Select ${line.stock_code || "product"} from ${line.order_no}`}
                          checked={selectedLineIds.includes(line.order_line_id)}
                          onChange={(event) =>
                            setSelectedLineIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, line.order_line_id])]
                                : current.filter(
                                    (id) => id !== line.order_line_id,
                                  ),
                            )
                          }
                        />
                        <Reference value={line.order_no} what="order no." />
                      </div>
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
                          {GROUP_LABELS[line.product_group]}
                        </span>
                      </div>
                    </Td>
                    <Td className="font-mono text-xs text-text-secondary whitespace-normal break-words">
                      {line.color_breakdown || "—"}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold text-error whitespace-nowrap">
                      {sets(line.remaining)}
                    </Td>
                    {selectedGroup.supplierName === UNASSIGNED_SUPPLIER && (
                      <Td>
                        <div className="flex min-w-[16rem] items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <SuggestInput
                              bare
                              label={`Factory for ${line.stock_code || "product"} in ${line.order_no}`}
                              placeholder="Choose or type factory"
                              suggestions={SUPPLIER_NAMES}
                              value={supplierDrafts[line.order_line_id] ?? ""}
                              onChange={(value) =>
                                setSupplierDrafts((current) => ({
                                  ...current,
                                  [line.order_line_id]: value,
                                }))
                              }
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={() => void saveSupplier(line)}
                            loading={savingLineId === line.order_line_id}
                            disabled={
                              !supplierDrafts[line.order_line_id]?.trim() ||
                              savingLineId !== null
                            }
                          >
                            Save
                          </Button>
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))}
              </Tbody>
            </TableContainer>
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
      .reduce((sum, line) => sum + line.quantity_pairs, 0);
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
  order_line_id: string;
  order_no: string;
  customer_name: string;
  supplier_name: string;
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  color_breakdown: string;
  unit: "pair" | "set" | "dozen";
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
        colorPairsForText(line.color_breakdown, line.unit),
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
      const requested =
        requestedByCode.get(line.stock_code.trim().toLowerCase()) ?? {};
      const demand = colorPairsForText(line.color_breakdown, line.unit);
      const remainingColors: ColorPairs = {};
      let openQty = lineRemaining(line);
      for (const [color, pairs] of Object.entries(demand)) {
        const alreadyRequested = Math.min(pairs, requested[color] ?? 0);
        requested[color] = Math.max(
          0,
          (requested[color] ?? 0) - alreadyRequested,
        );
        const available = Math.max(0, pairs - alreadyRequested);
        const take = Math.min(available, openQty);
        if (take > 0) remainingColors[color] = take;
        openQty -= take;
      }
      const openPairs = lineRemaining(line) - openQty;
      if (openPairs <= 0) continue;
      rows.push({
        order_id: order.order_id,
        order_line_id: line.order_line_id,
        order_no: order.order_no,
        customer_name: order.customer_name,
        supplier_name: line.supplier_name,
        stock_code: line.stock_code,
        description: line.description,
        product_group: line.product_group,
        color_breakdown: colorQtyFromPairs(remainingColors),
        unit: line.unit,
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
        color_breakdown: mergeColorQty(
          lines[existing].color_breakdown,
          row.color_breakdown,
        ),
      };
    } else {
      lines.push({
        stock_code: row.stock_code,
        description: row.description,
        product_group: row.product_group,
        color_breakdown: row.color_breakdown,
        unit: row.unit,
        unit_conversions: PAIRS_PER,
        currency_code: DEFAULT_CURRENCY,
        buying_price: "",
        original_buying_price: "",
        exchange_rate: "",
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
          <ReadOnlyField label="Cargo" value={voucher.carrier_name} />
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
  onWriteOff,
  writeOffs,
}: {
  voucher: SupplierVoucher;
  onWriteOff: (line: SupplierVoucherLine) => void;
  writeOffs: WriteOffWire[];
}): React.JSX.Element {
  return (
    <TableContainer>
      <Thead className="top-0">
        <Tr>
          <Th className="min-w-[18rem]">Product</Th>
          <Th className="min-w-[11rem]">Colors</Th>
          <Th className="text-right whitespace-nowrap">Ordered quantity</Th>
          <Th className="text-right whitespace-nowrap">Received quantity</Th>
          <Th className="text-right whitespace-nowrap">Qty to receive</Th>
          <Th className="text-right min-w-[7rem]">Buying price</Th>
          <Th className="text-right">Amount</Th>
          <Th>Customers</Th>
          <Th className="text-center">Mismatch</Th>
        </Tr>
      </Thead>
      <Tbody>
        {voucher.lines.map((line) => {
          const explanation = writeOffs.find(
            (entry) => entry.subject_id === line.voucher_line_id,
          );
          return (
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
                    {GROUP_LABELS[line.product_group]}
                  </span>
                </div>
              </Td>
              <Td className="whitespace-normal break-words text-text-secondary">
                {line.color_breakdown || "—"}
              </Td>
              <Td className="text-right tabular-nums">
                {formatIn(line.quantity_pairs, line.unit, line.unit_conversions)}
              </Td>
              <Td className="text-right tabular-nums">
                {formatIn(lineReceivedQty(line), line.unit, line.unit_conversions)}
              </Td>
              <Td className="text-right tabular-nums">
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={
                      line.lost_quantity_pairs ? "text-warning" : undefined
                    }
                  >
                    {formatIn(lineRemainingQty(line), line.unit, line.unit_conversions)}
                    {(line.lost_quantity_pairs ?? 0) > 0 && !explanation && (
                      <span className="ml-1 text-xs font-medium text-warning">
                        ({formatIn(line.lost_quantity_pairs ?? 0, line.unit, line.unit_conversions)}{" "}
                        written off)
                      </span>
                    )}
                  </span>
                  {explanation && (
                    <span
                      className="text-[10px] font-medium text-warning"
                      title={
                        explanation
                          ? mismatchDescription(explanation)
                          : undefined
                      }
                    >
                      {mismatchDescription(explanation)}
                    </span>
                  )}
                </div>
              </Td>
              <Td className="text-right tabular-nums">
                {formatKyat(line.buying_price)}
                {isForeignCurrency(line.currency_code ?? DEFAULT_CURRENCY) &&
                  line.original_buying_price != null &&
                  line.exchange_rate != null && (
                    <div className="text-xs text-text-muted font-normal whitespace-nowrap">
                      {formatOriginalAmount(line.currency_code ?? DEFAULT_CURRENCY, line.original_buying_price)}{" "}
                      × {formatRate(line.exchange_rate)}
                    </div>
                  )}
              </Td>
              <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                {formatKyat(pricedAmount(line.quantity_pairs, line.unit, line.buying_price, line.unit_conversions))}
              </Td>
              <Td>
                <WaitingList
                  stockCode={line.stock_code}
                  voucherQty={line.quantity_pairs}
                />
              </Td>
              <Td className="text-center">
                <MismatchIconButton
                  explained={Boolean(explanation)}
                  disabled={lineRemainingQty(line) <= 0}
                  onClick={() => onWriteOff(line)}
                />
              </Td>
            </Tr>
          );
        })}
        <Tr className="bg-bg-subtle hover:bg-bg-subtle">
          <Td className="font-semibold" colSpan={2}>
            Total
          </Td>
          <Td className="text-right tabular-nums font-semibold">
            {sets(voucher.total_quantity_pairs)}
          </Td>
          <Td className="text-right tabular-nums font-semibold text-success">
            {sets(voucher.received_quantity_pairs)}
          </Td>
          <Td className="text-right tabular-nums font-semibold text-error">
            {sets(remainingQty(voucher))}
          </Td>
          <Td />
          <Td className="text-right tabular-nums font-semibold text-brand">
            {formatKyat(voucherAmount(voucher))}
          </Td>
          <Td />
          <Td />
        </Tr>
      </Tbody>
    </TableContainer>
  );
}

function InlineProgress({
  label,
  value,
  pct,
  warn = false,
}: {
  label: string;
  value: string;
  pct: number;
  warn?: boolean;
}): React.JSX.Element {
  return (
    <div className="w-full min-w-0 sm:w-72">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-text-secondary">{label}</span>
        <span className="shrink-0 tabular-nums font-semibold text-text-primary">
          {value}
        </span>
      </div>
      <ThinBar pct={pct} label={label} warn={warn} />
    </div>
  );
}

const supplierVoucherDetailLineSchema = z.object({
  voucher_line_id: z.string(),
  stock_code: z.string(),
  description: z.string(),
  product_group: z.enum(["man", "lady", "child"]),
  color_breakdown: z.string(),
  unit: z.enum(["pair", "set", "dozen"]),
  quantity_pairs: z.number().finite().min(0),
  received_quantity_pairs: z.number().finite().min(0).optional(),
  buying_price: z.number().finite().min(0),
  currency_code: z.string().optional(),
  original_buying_price: z.number().finite().min(0).nullable().optional(),
  exchange_rate: z.number().finite().gt(0).nullable().optional(),
});

const supplierVoucherDetailSchema = z.object({
  voucher: z.object({
    voucher_id: z.string(),
    voucher_no: z.string(),
    supplier_name: z.string().trim().min(1, "Enter a supplier name."),
    voucher_date: z.string().trim().min(1, "Choose a voucher date."),
    total_packages: z.number().finite().min(0),
    carrier_name: z.string(),
    total_quantity_pairs: z.number().finite().min(0),
    received_quantity_pairs: z.number().finite().min(0),
    payment: z.object({
      account_id: z.string(),
      payments: z.array(
        z.object({
          payment_id: z.string(),
          paid_on: z.string(),
          amount: z.number().finite().min(0),
          note: z.string(),
        }),
      ),
    }),
    lines: z.array(supplierVoucherDetailLineSchema),
  }),
});

interface SupplierVoucherDetailFormValues {
  voucher: SupplierVoucher;
}

function VoucherDetail({
  voucher: initialVoucher,
  initialMode,
  onSave,
  onBack,
  onWriteOff,
  writeOffs,
  settings,
}: {
  voucher: SupplierVoucher;
  initialMode: VoucherDetailMode;
  onSave: (
    voucher: SupplierVoucher,
    originalVoucher: SupplierVoucher,
  ) => Promise<void>;
  onBack: () => void;
  onWriteOff: (
    lineId: string,
    quantity: number,
    reason: WriteOffReason,
    note: string,
  ) => Promise<void>;
  writeOffs: WriteOffWire[];
  settings: AppSettings | null;
}): React.JSX.Element {
  const [detailMode, setDetailMode] = useState<VoucherDetailMode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [addingLineId, setAddingLineId] = useState<string | null>(null);
  const [writeOffLine, setWriteOffLine] = useState<SupplierVoucherLine | null>(
    null,
  );
  const {
    control,
    getValues,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<SupplierVoucherDetailFormValues>({
    resolver: zodResolver(supplierVoucherDetailSchema),
    defaultValues: { voucher: initialVoucher },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const {
    fields: lineFields,
    append,
    remove,
    replace,
  } = useFieldArray({
    control,
    name: "voucher.lines",
  });
  const voucher = useWatch({ control, name: "voucher" }) as SupplierVoucher;

  useEffect(() => {
    reset({ voucher: initialVoucher });
    setAddingLineId(null);
  }, [initialVoucher, reset]);

  // total_quantity_pairs/received_quantity_pairs are the server's own running totals across voucher.lines
  // (see _out in the router) — recomputed here the same way whenever a line changes,
  // so the header figures never lag behind an edit still sitting unsaved on screen.
  function apply(patch: Partial<SupplierVoucher>): void {
    if (patch.lines) {
      replace(patch.lines);
      setValue(
        "voucher.total_quantity_pairs",
        patch.lines.reduce((sum, line) => sum + line.quantity_pairs, 0),
        { shouldDirty: true, shouldValidate: true },
      );
      setValue(
        "voucher.received_quantity_pairs",
        patch.lines.reduce((sum, line) => sum + lineReceivedQty(line), 0),
        { shouldDirty: true, shouldValidate: true },
      );
    }
    if (patch.payment) {
      setValue("voucher.payment", patch.payment, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    for (const [key, value] of Object.entries(patch)) {
      if (key === "lines" || key === "payment") continue;
      setValue(`voucher.${key}` as "voucher.supplier_name", value as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  async function saveChanges(
    values: SupplierVoucherDetailFormValues,
  ): Promise<void> {
    setSaving(true);
    try {
      await onSave(values.voucher, initialVoucher);
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
    const lines = getValues("voucher.lines").map((line, position) =>
      position === index ? { ...line, ...patch } : line,
    );
    apply({ lines });
  }

  function setColors(index: number, colors: string): void {
    setLine(index, {
      color_breakdown: colors,
      quantity_pairs: colorQtyPairs(colors, "set"),
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
            product_group: known.product_group,
            unit: known.default_unit,
            unit_conversions: known.default_unit_conversions ?? PAIRS_PER,
          }
        : { stock_code: code },
    );
  }

  function addLine(): void {
    const lineId = `fvl-${Date.now()}`;
    setAddingLineId(lineId);
    append({
      voucher_line_id: lineId,
      stock_code: "",
      description: "",
      product_group: "man",
      color_breakdown: "",
      unit: "set",
      quantity_pairs: 0,
      buying_price: 0,
    });
  }

  function removeLine(index: number): void {
    if (voucher.lines[index]?.voucher_line_id === addingLineId) {
      setAddingLineId(null);
    }
    const lines = voucher.lines.filter((_, position) => position !== index);
    remove(index);
    setValue(
      "voucher.total_quantity_pairs",
      lines.reduce((sum, line) => sum + line.quantity_pairs, 0),
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "voucher.received_quantity_pairs",
      lines.reduce((sum, line) => sum + lineReceivedQty(line), 0),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function cancelAddLine(): void {
    if (!addingLineId) return;
    const index = voucher.lines.findIndex(
      (line) => line.voucher_line_id === addingLineId,
    );
    if (index >= 0) removeLine(index);
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

  const hasChanges = isDirty;

  return (
    <>
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
                  onClick={() => void handleSubmit(saveChanges)()}
                  loading={saving}
                  disabled={!hasChanges}
                >
                  <CheckIcon className="w-4 h-4" />
                  Save changes
                </Button>
              )}
            </div>
          </div>

          <div className="px-6 py-6 flex flex-col gap-10">
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
                    <Controller
                      control={control}
                      name="voucher.supplier_name"
                      render={({ field }) => (
                        <SuggestInput
                          label="Supplier / Factory"
                          placeholder="Goody Factory"
                          suggestions={SUPPLIER_NAMES}
                          value={field.value}
                          onChange={field.onChange}
                          error={errors.voucher?.supplier_name?.message}
                        />
                      )}
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
                      <Controller
                        control={control}
                        name="voucher.voucher_date"
                        render={({ field }) => (
                          <Input
                            label="Date"
                            type="date"
                            className={EDITABLE}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            error={errors.voucher?.voucher_date?.message}
                          />
                        )}
                      />
                      <Controller
                        control={control}
                        name="voucher.carrier_name"
                        render={({ field }) => (
                          <SuggestInput
                            label="Cargo"
                            placeholder="Shwe Moe Cargo"
                            suggestions={CARGO_NAMES}
                            value={field.value}
                            onChange={field.onChange}
                          />
                        )}
                      />
                      <Controller
                        control={control}
                        name="voucher.total_packages"
                        render={({ field }) => (
                          <CountField
                            label="Packages"
                            value={field.value}
                            onChange={field.onChange}
                          />
                        )}
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Products
                </h3>
                <InlineProgress
                  label="Receiving"
                  value={`${sets(voucher.received_quantity_pairs)} / ${sets(voucher.total_quantity_pairs)} (${pct}%)`}
                  pct={pct}
                />
              </div>
              {detailMode === "view" ? (
                <VoucherProductsView
                  voucher={voucher}
                  onWriteOff={setWriteOffLine}
                  writeOffs={writeOffs}
                />
              ) : (
                <>
                  <TableContainer>
                    <Thead className="top-0">
                      <Tr>
                        <Th className="min-w-[18rem]">Product</Th>
                        <Th className="min-w-[11rem]">Colors</Th>
                        <Th className="text-right whitespace-nowrap">
                          Ordered quantity
                        </Th>
                        <Th className="text-right whitespace-nowrap">
                          Received quantity
                        </Th>
                        <Th className="text-right whitespace-nowrap">
                          Qty to receive
                        </Th>
                        <Th className="text-right min-w-[7rem]">
                          Buying price
                        </Th>
                        <Th className="text-right">Amount</Th>
                        <Th>Customers</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {lineFields.map((field, index) => {
                        const line = voucher.lines[index];
                        if (!line) return null;
                        return (
                          <Tr key={field.id}>
                            <Td>
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-1">
                                  <Controller
                                    control={control}
                                    name={`voucher.lines.${index}.stock_code`}
                                    render={({ field: stockField }) => (
                                      <SuggestInput
                                        bare
                                        label={`Stock code for product ${index + 1}`}
                                        placeholder="A1001"
                                        suggestions={STOCK_CODES}
                                        value={stockField.value}
                                        onChange={(next) => {
                                          stockField.onChange(next);
                                          setStockCode(index, next);
                                        }}
                                        error={
                                          duplicateStockCodeProblem(
                                            voucher.lines,
                                            index,
                                          ) ?? undefined
                                        }
                                      />
                                    )}
                                  />
                                  <CopyButton
                                    value={line.stock_code}
                                    what="stock code"
                                  />
                                </div>
                                <Controller
                                  control={control}
                                  name={`voucher.lines.${index}.description`}
                                  render={({ field: descriptionField }) => (
                                    <CellInput
                                      label={`Description for product ${index + 1}`}
                                      placeholder="Men's leather sandal"
                                      multiline
                                      value={descriptionField.value}
                                      onChange={descriptionField.onChange}
                                    />
                                  )}
                                />
                                <Controller
                                  control={control}
                                  name={`voucher.lines.${index}.product_group`}
                                  render={({ field: groupField }) => (
                                    <GroupSelect
                                      label={`Group for product ${index + 1}`}
                                      value={groupField.value}
                                      onChange={groupField.onChange}
                                    />
                                  )}
                                />
                              </div>
                            </Td>
                            <Td>
                              <Controller
                                control={control}
                                name={`voucher.lines.${index}.color_breakdown`}
                                render={({ field: colorField }) => (
                                  <CellInput
                                    label={`Colors for product ${index + 1}`}
                                    placeholder="black10s,pink2p"
                                    multiline
                                    value={colorField.value}
                                    onChange={(next) => {
                                      colorField.onChange(next);
                                      setColors(index, next);
                                    }}
                                    error={
                                      colorQtyProblem(line.color_breakdown) ??
                                      undefined
                                    }
                                  />
                                )}
                              />
                            </Td>
                            <Td className="text-right tabular-nums">
                              {sets(line.quantity_pairs)}
                            </Td>
                            <Td className="text-right tabular-nums">
                              {sets(lineReceivedQty(line))}
                            </Td>
                            <Td className="text-right tabular-nums">
                              {sets(lineRemainingQty(line))}
                            </Td>
                            <Td>
                              <div className="flex flex-col gap-1.5 min-w-[9rem]">
                                <CurrencySelect
                                  label={`Currency for product ${index + 1}`}
                                  value={(line.currency_code as CurrencyCode) ?? DEFAULT_CURRENCY}
                                  onChange={(code) => {
                                    if (code === DEFAULT_CURRENCY) {
                                      setLine(index, {
                                        currency_code: DEFAULT_CURRENCY,
                                        original_buying_price: null,
                                        exchange_rate: null,
                                      });
                                      return;
                                    }
                                    const todayRate = settings?.today_exchange_rates?.[code];
                                    const rate =
                                      line.exchange_rate ?? (todayRate ? Number(todayRate) : null);
                                    const original = line.original_buying_price ?? 0;
                                    setLine(index, {
                                      currency_code: code,
                                      original_buying_price: original,
                                      exchange_rate: rate,
                                      buying_price: rate ? previewKyatAmount(original, rate) : 0,
                                    });
                                  }}
                                />
                                {isForeignCurrency(line.currency_code ?? DEFAULT_CURRENCY) ? (
                                  <>
                                    <CellInput
                                      label={`Original price for product ${index + 1}`}
                                      placeholder="0"
                                      className="text-right"
                                      value={String(line.original_buying_price ?? "")}
                                      onChange={(next) => {
                                        const cleaned = next.replace(/[^0-9.]/g, "");
                                        const original = Number(cleaned) || 0;
                                        const rate = line.exchange_rate ?? 0;
                                        setLine(index, {
                                          original_buying_price: original,
                                          buying_price: previewKyatAmount(original, rate),
                                        });
                                      }}
                                    />
                                    <CellInput
                                      label={`Exchange rate for product ${index + 1}`}
                                      placeholder="0"
                                      className="text-right"
                                      value={String(line.exchange_rate ?? "")}
                                      onChange={(next) => {
                                        const cleaned = next.replace(/[^0-9.]/g, "");
                                        const rate = Number(cleaned) || 0;
                                        const original = line.original_buying_price ?? 0;
                                        setLine(index, {
                                          exchange_rate: rate,
                                          buying_price: previewKyatAmount(original, rate),
                                        });
                                      }}
                                    />
                                    <p className="text-xs text-text-muted text-right tabular-nums">
                                      {formatKyat(line.buying_price)}
                                    </p>
                                  </>
                                ) : (
                                  <Controller
                                    control={control}
                                    name={`voucher.lines.${index}.buying_price`}
                                    render={({ field: priceField }) => (
                                      <CellInput
                                        label={`Buying price for product ${index + 1}`}
                                        placeholder="0"
                                        numeric
                                        className="text-right"
                                        value={String(priceField.value)}
                                        onChange={(next) => {
                                          const buyingPrice = Number(next) || 0;
                                          priceField.onChange(buyingPrice);
                                          setLine(index, {
                                            buying_price: buyingPrice,
                                          });
                                        }}
                                        error={
                                          errors.voucher?.lines?.[index]
                                            ?.buying_price?.message
                                        }
                                      />
                                    )}
                                  />
                                )}
                              </div>
                            </Td>
                            <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                              {formatKyat(
                                pricedAmount(line.quantity_pairs, line.unit, line.buying_price, line.unit_conversions),
                              )}
                              {isForeignCurrency(line.currency_code ?? DEFAULT_CURRENCY) &&
                                line.original_buying_price != null &&
                                line.exchange_rate != null && (
                                  <div className="text-xs text-text-muted font-normal whitespace-nowrap">
                                    {formatOriginalAmount(line.currency_code ?? DEFAULT_CURRENCY, line.original_buying_price)}{" "}
                                    × {formatRate(line.exchange_rate)}
                                  </div>
                                )}
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
                                voucherQty={line.quantity_pairs}
                              />
                            </Td>
                          </Tr>
                        );
                      })}
                      <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                        <Td className="font-semibold" colSpan={2}>
                          Total
                        </Td>
                        <Td className="text-right tabular-nums font-semibold">
                          {sets(voucher.total_quantity_pairs)}
                        </Td>
                        <Td className="text-right tabular-nums font-semibold text-success">
                          {sets(voucher.received_quantity_pairs)}
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
                    <Button size="sm" onClick={addLine}>
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
              <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Payment
                </h3>
                <InlineProgress
                  label="Paid so far"
                  value={`${formatKyat(paid)} / ${formatKyat(amount)} (${paidShare}%)`}
                  pct={paidShare}
                  warn
                />
              </div>
              {/* The same table the customer side uses, so money paid to a supplier is
                written down exactly the way money from a customer is. */}
              <PaymentsTable
                payments={voucher.payment.payments}
                balance={balance}
                who="supplier"
                onAdd={addPayment}
                onUpdate={(payment) => setPayment(payment.payment_id, payment)}
                onRemove={removePayment}
                readOnly={detailMode === "view"}
              />
            </section>

            <section>
              <SectionLabel>Shipment journey</SectionLabel>
              <VoucherJourney voucher={voucher} />
            </section>
          </div>
        </Panel>
      </div>
      <WriteOffModal
        open={writeOffLine !== null}
        subject={
          writeOffLine
            ? `${voucher.voucher_no} · ${writeOffLine.stock_code}`
            : "this voucher line"
        }
        remaining={writeOffLine ? lineRemainingQty(writeOffLine) : 0}
        unit={writeOffLine?.unit ?? "pair"}
        onClose={() => setWriteOffLine(null)}
        onSubmit={(quantity, reason, note) =>
          onWriteOff(writeOffLine!.voucher_line_id, quantity, reason, note)
        }
      />
    </>
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
    <div className="min-w-[12rem]">
      {waiting.map((entry) => (
        <div
          key={`${entry.orderNo}-${entry.name}`}
          className="border-b border-border/60 py-2 first:pt-0 last:border-0 last:pb-0"
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-text-primary">
              {entry.name}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-brand">
              {sets(entry.qty)}
            </span>
          </div>
          <div className="mt-0.5 inline-flex max-w-full items-center gap-0.5 text-xs text-text-muted">
            <span className="break-words">{entry.orderNo}</span>
            <CopyButton value={entry.orderNo} what="order no." />
          </div>
        </div>
      ))}
      {spare > 0 && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-bg-raised px-2 py-1.5 text-xs text-text-secondary">
          <span>Unallocated</span>
          <span className="font-semibold tabular-nums">{sets(spare)}</span>
        </div>
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
      <JourneyRow label="Ordered" value={sets(voucher.total_quantity_pairs)} />
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
      expectedPackages={voucher.total_packages}
      expectedQtyPairs={voucher.total_quantity_pairs}
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

// ── New voucher ──────────────────────────────────────────────────────────────

interface DraftLine {
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  color_breakdown: string;
  unit: "pair" | "set" | "dozen";
  unit_conversions: { pair: number; set: number; dozen: number };
  currency_code: CurrencyCode;
  buying_price: string;
  original_buying_price: string;
  exchange_rate: string;
}

const voucherDraftLineSchema = z
  .object({
    stock_code: z.string(),
    description: z.string(),
    product_group: z.enum(["man", "lady", "child"]),
    color_breakdown: z.string(),
    unit: z.enum(["pair", "set", "dozen"]),
    unit_conversions: z.object({
      pair: z.number().int().positive(),
      set: z.number().int().positive(),
      dozen: z.number().int().positive(),
    }),
    currency_code: z.enum(["MMK", "THB", "USD"]),
    buying_price: z
      .string()
      .regex(/^\d*$/, "Buying price can only contain numbers."),
    original_buying_price: z
      .string()
      .regex(/^\d*\.?\d*$/, "Original price can only contain numbers."),
    exchange_rate: z
      .string()
      .regex(/^\d*\.?\d*$/, "Exchange rate can only contain numbers."),
  })
  .superRefine((line, context) => {
    if (line.currency_code !== "MMK" && line.stock_code.trim() !== "") {
      if (line.original_buying_price.trim() === "") {
        context.addIssue({
          code: "custom",
          path: ["original_buying_price"],
          message: "Enter the original price.",
        });
      }
      if (line.exchange_rate.trim() === "" || Number(line.exchange_rate) <= 0) {
        context.addIssue({
          code: "custom",
          path: ["exchange_rate"],
          message: "Enter an exchange rate greater than zero.",
        });
      }
    }
    const hasProductDetails =
      line.stock_code.trim() !== "" ||
      line.description.trim() !== "" ||
      line.color_breakdown.trim() !== "" ||
      line.buying_price.trim() !== "";

    // A blank draft row is harmless until staff begin entering it. Detailed color
    // syntax and server-backed checks deliberately remain outside this local schema.
    if (!hasProductDetails) return;

    if (line.stock_code.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["stock_code"],
        message: "Enter a stock code.",
      });
    }
    if (line.description.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "Enter a description.",
      });
    }
    if (line.color_breakdown.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["color_breakdown"],
        message: "Enter colors and quantities.",
      });
    }
  });

const supplierVoucherFormSchema = z
  .object({
    voucher_date: z.string().trim().min(1, "Choose a voucher date."),
    supplier_name: z.string().trim().min(1, "Choose a supplier or factory."),
    carrier_name: z.string(),
    packages: z.string().regex(/^\d*$/, "Packages can only contain numbers."),
    lines: z.array(voucherDraftLineSchema),
  })
  .superRefine((values, context) => {
    if (!values.lines.some((line) => line.stock_code.trim() !== "")) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Add at least one product.",
      });
    }
  });

interface SupplierVoucherFormValues {
  voucher_date: string;
  supplier_name: string;
  carrier_name: string;
  packages: string;
  lines: DraftLine[];
}

/** The pairs one drafted row comes to: its colors read in its own unit. */
function draftPairs(line: DraftLine): number {
  return colorQtyPairs(line.color_breakdown, line.unit, line.unit_conversions);
}

const EMPTY_LINE: DraftLine = {
  stock_code: "",
  description: "",
  product_group: "man",
  color_breakdown: "",
  unit: "set",
  unit_conversions: PAIRS_PER,
  currency_code: DEFAULT_CURRENCY,
  buying_price: "",
  original_buying_price: "",
  exchange_rate: "",
};

const STEPS = ["Supplier", "Products", "Review"] as const;

function NewVoucherForm({
  nextVoucherNo: voucherNo,
  initialSupplierName = "",
  initialOrderLines,
  lockedSupplier = false,
  title = "New supplier voucher",
  backLabel = "Back to vouchers",
  settings,
  onCancel,
  onCreate,
}: {
  nextVoucherNo: string;
  initialSupplierName?: string;
  initialOrderLines?: OpenOrderLine[];
  /** The factory was selected in Create from customer orders and must not change here. */
  lockedSupplier?: boolean;
  title?: string;
  backLabel?: string;
  settings: AppSettings | null;
  onCancel: () => void;
  onCreate: (input: NewSupplierVoucherInput) => void;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const {
    control,
    register,
    handleSubmit,
    clearErrors,
    setError,
    setValue,
    trigger,
    getValues,
    formState: { errors, isDirty },
  } = useForm<SupplierVoucherFormValues>({
    resolver: zodResolver(supplierVoucherFormSchema),
    defaultValues: {
      voucher_date: todayIso(),
      supplier_name: initialSupplierName,
      carrier_name: "",
      packages: "",
      lines: initialOrderLines
        ? draftLinesFromOpenOrderLines(initialOrderLines)
        : [{ ...EMPTY_LINE }],
    },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "lines",
  });
  const values = useWatch({ control }) as SupplierVoucherFormValues;
  const {
    voucher_date: voucherDate,
    supplier_name: supplierName,
    carrier_name: cargoName,
    packages,
  } = values;
  const lines = values.lines;
  const [showOrderPicker, setShowOrderPicker] = useState(false);

  const { orders, vouchers } = useWholesale();
  const orderLines = useMemo(
    () => openOrderLines(orders, supplierName, vouchers),
    [orders, supplierName, vouchers],
  );

  const filledLines = lines.filter((line) => line.stock_code.trim() !== "");
  const totalQty = filledLines.reduce((sum, line) => sum + draftPairs(line), 0);
  const totalAmount = filledLines.reduce(
    (sum, line) => sum + pricedAmount(draftPairs(line), line.unit, Number(line.buying_price) || 0, line.unit_conversions),
    0,
  );
  // A code we already buy fills its own description and product_group in, so the same shoe is not
  // written two slightly different ways on two vouchers.
  function setStockCode(index: number, code: string): void {
    const known = productOf(code);
    setValue(`lines.${index}.stock_code`, code, {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (known) {
      setValue(`lines.${index}.description`, known.description, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setValue(`lines.${index}.product_group`, known.product_group, {
        shouldDirty: true,
      });
      setValue(`lines.${index}.unit`, known.default_unit, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setValue(`lines.${index}.unit_conversions`, known.default_unit_conversions ?? PAIRS_PER, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  // Switching a draft line's currency clears (MMK) or seeds (foreign, from today's
  // Settings rate) the original-amount/exchange-rate pair, and recomputes the Kyat
  // buying_price shown/submitted for the line — the same preview-then-server-verifies
  // split every other foreign-currency field in this app follows.
  function setLineCurrency(index: number, code: CurrencyCode): void {
    setValue(`lines.${index}.currency_code`, code, { shouldDirty: true });
    if (code === DEFAULT_CURRENCY) {
      setValue(`lines.${index}.original_buying_price`, "", { shouldDirty: true });
      setValue(`lines.${index}.exchange_rate`, "", { shouldDirty: true });
      return;
    }
    const line = lines[index] ?? EMPTY_LINE;
    const rate = line.exchange_rate || settings?.today_exchange_rates?.[code] || "";
    setValue(`lines.${index}.exchange_rate`, rate, { shouldDirty: true });
    setValue(
      `lines.${index}.buying_price`,
      String(previewKyatAmount(Number(line.original_buying_price) || 0, Number(rate) || 0)),
      { shouldDirty: true },
    );
  }

  function setForeignPrice(
    index: number,
    patch: { original_buying_price?: string; exchange_rate?: string },
  ): void {
    const line = lines[index] ?? EMPTY_LINE;
    const original = Number(patch.original_buying_price ?? line.original_buying_price) || 0;
    const rate = Number(patch.exchange_rate ?? line.exchange_rate) || 0;
    if (patch.original_buying_price !== undefined)
      setValue(`lines.${index}.original_buying_price`, patch.original_buying_price, { shouldDirty: true });
    if (patch.exchange_rate !== undefined)
      setValue(`lines.${index}.exchange_rate`, patch.exchange_rate, { shouldDirty: true });
    setValue(`lines.${index}.buying_price`, String(previewKyatAmount(original, rate)), {
      shouldDirty: true,
    });
  }

  function removeLine(index: number): void {
    if (fields.length === 1) {
      replace([{ ...EMPTY_LINE }]);
      return;
    }
    remove(index);
  }

  // Customer demand is an optional shortcut. Adding a line here merges colours into an
  // existing stock-code row, while the manual product rows remain available below.
  function importOrderLine(source: OpenOrderLine): void {
    const current = getValues("lines");
    const code = source.stock_code.trim().toLowerCase();
    const matchIndex = current.findIndex(
      (line) => line.stock_code.trim().toLowerCase() === code,
    );
    if (matchIndex !== -1) {
      const existing = current[matchIndex];
      const combined = mergeColorQty(
        existing.color_breakdown,
        source.color_breakdown,
      );
      setValue(`lines.${matchIndex}.color_breakdown`, combined, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }
    const filled: DraftLine = {
      stock_code: source.stock_code,
      description: source.description,
      product_group: source.product_group,
      color_breakdown: source.color_breakdown,
      unit: source.unit,
      unit_conversions: PAIRS_PER,
      currency_code: DEFAULT_CURRENCY,
      buying_price: "",
      original_buying_price: "",
      exchange_rate: "",
    };
    const emptyIndex = current.findIndex(
      (line) => line.stock_code.trim() === "",
    );
    if (emptyIndex !== -1) {
      setValue(`lines.${emptyIndex}`, filled, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }
    append(filled);
  }

  async function moveToProducts(): Promise<void> {
    const valid = await trigger([
      "voucher_date",
      "supplier_name",
      "carrier_name",
      "packages",
    ]);
    if (valid) setStep(1);
  }

  async function moveToReview(): Promise<void> {
    clearErrors("lines");
    const valid = await trigger("lines");
    const colorProblem = lines.findIndex(
      (line) => colorQtyProblem(line.color_breakdown) !== null,
    );
    if (colorProblem >= 0) {
      setError(`lines.${colorProblem}.color_breakdown`, {
        type: "validate",
        message:
          colorQtyProblem(lines[colorProblem].color_breakdown) ?? undefined,
      });
    }
    const duplicateStockCode = lines.findIndex(
      (_, index) => duplicateStockCodeProblem(lines, index) !== null,
    );
    if (duplicateStockCode >= 0) {
      setError(`lines.${duplicateStockCode}.stock_code`, {
        type: "validate",
        message:
          duplicateStockCodeProblem(lines, duplicateStockCode) ?? undefined,
      });
    }
    const hasProductQuantity = filledLines.some((line) => draftPairs(line) > 0);
    if (!hasProductQuantity) {
      setError("lines", {
        type: "validate",
        message: "Add a product with at least one color quantity.",
      });
    }
    if (
      valid &&
      colorProblem < 0 &&
      duplicateStockCode < 0 &&
      hasProductQuantity
    ) {
      setStep(2);
    }
  }

  function submit(values: SupplierVoucherFormValues): void {
    const voucherLines: SupplierVoucherLine[] = values.lines
      .filter((line) => line.stock_code.trim() !== "")
      .map((line, index) => ({
        voucher_line_id: `line-${index}`,
        stock_code: line.stock_code.trim(),
        description: line.description.trim(),
        product_group: line.product_group,
        color_breakdown: line.color_breakdown.trim(),
        unit: line.unit,
        unit_conversions: line.unit_conversions,
        quantity_pairs: draftPairs(line),
        currency_code: line.currency_code,
        buying_price: Number(line.buying_price) || 0,
        original_buying_price: isForeignCurrency(line.currency_code)
          ? Number(line.original_buying_price) || 0
          : null,
        exchange_rate: isForeignCurrency(line.currency_code)
          ? Number(line.exchange_rate) || 0
          : null,
      }));
    onCreate({
      supplier_name: values.supplier_name.trim(),
      voucher_date: values.voucher_date,
      total_packages: Number(values.packages) || 0,
      carrier_name: values.carrier_name.trim(),
      lines: voucherLines,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button
          variant="ghost"
          size="sm"
          title={isDirty ? "This new voucher has unsaved changes." : undefined}
          onClick={onCancel}
        >
          <ChevronLeftIcon className="w-4 h-4" />
          {backLabel}
        </Button>
      </div>

      <Panel>
        <div className="px-6 py-5 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight mb-5">
            {title}
          </h2>
          <StepBar
            steps={
              lockedSupplier ? ["Voucher details", "Products", "Review"] : STEPS
            }
            step={step}
          />
        </div>

        {step === 0 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <SectionLabel>
              Step 1 —{" "}
              {lockedSupplier ? "voucher details" : "supplier & shipment"}
            </SectionLabel>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Input
                label="Date"
                type="date"
                className={EDITABLE}
                error={errors.voucher_date?.message}
                {...register("voucher_date")}
              />
              {lockedSupplier ? (
                <ReadOnlyField
                  label="Supplier / Factory"
                  value={supplierName}
                />
              ) : (
                <Select
                  label={<Required>Supplier / Factory</Required>}
                  className={EDITABLE}
                  error={errors.supplier_name?.message}
                  {...register("supplier_name")}
                >
                  <option value="">Choose…</option>
                  {SUPPLIER_NAMES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
              <Select
                label="Cargo"
                className={EDITABLE}
                error={errors.carrier_name?.message}
                {...register("carrier_name")}
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
                error={errors.packages?.message}
                value={packages}
                onChange={(event) =>
                  setValue("packages", onlyDigits(event.target.value), {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                hint="How many packages the supplier says it is sending."
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void moveToProducts()}>
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
              {showOrderPicker &&
                (orderLines.length === 0 ? (
                  <p className="border-t border-border px-4 pb-4 pt-3 text-sm text-text-muted">
                    No open customer-order products are waiting for{" "}
                    {supplierName}. You can add a product manually below.
                  </p>
                ) : (
                  <TableContainer className="rounded-none border-0 border-t border-border">
                    <Thead>
                      <Tr>
                        <Th className="whitespace-nowrap">Order no.</Th>
                        <Th>Customer</Th>
                        <Th className="min-w-[12rem]">Product</Th>
                        <Th>Colors</Th>
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
                                {GROUP_LABELS[row.product_group]}
                              </span>
                            </div>
                          </Td>
                          <Td className="whitespace-normal break-words font-mono text-xs text-text-secondary">
                            {row.color_breakdown || "—"}
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
                ))}
            </div>

            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="min-w-[18rem]">Product</Th>
                  <Th className="min-w-[13rem]">Colors</Th>
                  <Th className="text-right whitespace-nowrap">
                    Ordered quantity
                  </Th>
                  <Th className="text-right min-w-[8rem]">Buying price</Th>
                  <Th className="text-right min-w-[8rem]">Amount</Th>
                </Tr>
              </Thead>
              <Tbody>
                {fields.map((field, index) => {
                  const line = lines[index] ?? EMPTY_LINE;
                  const lineQty = draftPairs(line);
                  const lineAmount = pricedAmount(
                    lineQty,
                    line.unit,
                    Number(line.buying_price) || 0,
                    line.unit_conversions,
                  );
                  return (
                    <Tr key={field.id}>
                      <Td className="min-w-[18rem]">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <div className="flex min-w-0 items-start gap-1">
                            <Controller
                              control={control}
                              name={`lines.${index}.stock_code`}
                              render={() => (
                                <SuggestInput
                                  bare
                                  label={`Stock code for product ${index + 1}`}
                                  placeholder="A1001"
                                  suggestions={STOCK_CODES}
                                  value={line.stock_code}
                                  onChange={(next) => setStockCode(index, next)}
                                  error={
                                    errors.lines?.[index]?.stock_code
                                      ?.message ??
                                    duplicateStockCodeProblem(lines, index) ??
                                    undefined
                                  }
                                />
                              )}
                            />
                            <CopyButton
                              value={line.stock_code}
                              what="stock code"
                            />
                          </div>
                          <Controller
                            control={control}
                            name={`lines.${index}.description`}
                            render={({ field: descriptionField }) => (
                              <CellInput
                                label={`Description for product ${index + 1}`}
                                placeholder="Men's leather sandal"
                                multiline
                                value={descriptionField.value}
                                onChange={descriptionField.onChange}
                                error={
                                  errors.lines?.[index]?.description?.message
                                }
                              />
                            )}
                          />
                          <Controller
                            control={control}
                            name={`lines.${index}.product_group`}
                            render={({ field: groupField }) => (
                              <GroupSelect
                                label={`Group for product ${index + 1}`}
                                value={groupField.value}
                                onChange={groupField.onChange}
                              />
                            )}
                          />
                        </div>
                      </Td>
                      <Td>
                        <Controller
                          control={control}
                          name={`lines.${index}.unit`}
                          render={({ field: unitField }) => (
                            <Select
                              aria-label={`Default unit for product ${index + 1}`}
                              className={EDITABLE}
                              {...unitField}
                            >
                              {UNITS.map((unit) => (
                                <option key={unit} value={unit}>
                                  {UNIT_LABELS[unit]}
                                </option>
                              ))}
                            </Select>
                          )}
                        />
                        <Controller
                          control={control}
                          name={`lines.${index}.color_breakdown`}
                          render={({ field: colorField }) => (
                            <CellInput
                              label={`Colors for product ${index + 1}`}
                              placeholder="black10s,pink2p"
                              multiline
                              value={colorField.value}
                              onChange={colorField.onChange}
                              error={
                                errors.lines?.[index]?.color_breakdown
                                  ?.message ??
                                colorQtyProblem(line.color_breakdown) ??
                                undefined
                              }
                            />
                          )}
                        />
                        <span className="mt-1 block text-xs text-text-muted">
                          {lineQty > 0
                            ? formatIn(lineQty, line.unit, line.unit_conversions)
                            : "Every color needs a unit — s sets, p pairs, d dozens"}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                        {formatIn(lineQty, line.unit, line.unit_conversions)}
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-1.5 min-w-[9rem]">
                          <Controller
                            control={control}
                            name={`lines.${index}.currency_code`}
                            render={({ field: currencyField }) => (
                              <CurrencySelect
                                label={`Currency for product ${index + 1}`}
                                value={currencyField.value}
                                onChange={(code) => setLineCurrency(index, code)}
                              />
                            )}
                          />
                          {isForeignCurrency(line.currency_code) ? (
                            <>
                              <CellInput
                                label={`Original price for product ${index + 1}`}
                                placeholder="0"
                                className="text-right"
                                value={line.original_buying_price}
                                onChange={(next) =>
                                  setForeignPrice(index, {
                                    original_buying_price: next.replace(/[^0-9.]/g, ""),
                                  })
                                }
                                error={
                                  errors.lines?.[index]?.original_buying_price
                                    ?.message
                                }
                              />
                              <CellInput
                                label={`Exchange rate for product ${index + 1}`}
                                placeholder="0"
                                className="text-right"
                                value={line.exchange_rate}
                                onChange={(next) =>
                                  setForeignPrice(index, {
                                    exchange_rate: next.replace(/[^0-9.]/g, ""),
                                  })
                                }
                                error={
                                  errors.lines?.[index]?.exchange_rate?.message
                                }
                              />
                              <p className="text-xs text-text-muted text-right tabular-nums">
                                {formatKyat(Number(line.buying_price) || 0)}
                              </p>
                            </>
                          ) : (
                            <Controller
                              control={control}
                              name={`lines.${index}.buying_price`}
                              render={({ field: priceField }) => (
                                <CellInput
                                  label={`Buying price for product ${index + 1}`}
                                  placeholder="0"
                                  numeric
                                  className="text-right"
                                  value={priceField.value}
                                  onChange={priceField.onChange}
                                  error={
                                    errors.lines?.[index]?.buying_price
                                      ?.message
                                  }
                                />
                              )}
                            />
                          )}
                        </div>
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

            {errors.lines?.message && (
              <p className="text-sm text-error">{errors.lines.message}</p>
            )}

            <div>
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() => append({ ...EMPTY_LINE })}
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
              <Button onClick={() => void moveToReview()}>
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
                  <Th className="text-right whitespace-nowrap">
                    Ordered quantity
                  </Th>
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
                            product_group={line.product_group}
                          />
                        </div>
                      </Td>
                      <Td className="font-mono text-xs text-text-secondary break-words">
                        {line.color_breakdown || "—"}
                      </Td>
                      <Td className="text-right tabular-nums">{sets(qty)}</Td>
                      <Td className="text-right tabular-nums text-text-secondary">
                        {formatKyat(Number(line.buying_price) || 0)}
                        {isForeignCurrency(line.currency_code) &&
                          line.original_buying_price.trim() !== "" &&
                          line.exchange_rate.trim() !== "" && (
                            <div className="text-xs text-text-muted whitespace-nowrap">
                              {formatOriginalAmount(line.currency_code, Number(line.original_buying_price))}{" "}
                              × {formatRate(Number(line.exchange_rate))}
                            </div>
                          )}
                      </Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatKyat(pricedAmount(qty, line.unit, Number(line.buying_price) || 0, line.unit_conversions))}
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
              <Button onClick={handleSubmit(submit)}>
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
