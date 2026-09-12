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
  CloseIcon,
  EyeIcon,
  MoreVerticalIcon,
  FactoryIcon,
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
  remainingQty as orderRemaining,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/customerOrders";
import {
  SUPPLIER_NAMES,
  formatDate,
  colorQtyPairs,
  colorQtyProblem,
  formatKyat,
  formatQty,
  nextReference,
  onlyDigits,
  todayIso,
  type PaymentStatus,
} from "@renderer/components/features/wholesale/shared";
import { formatIn } from "@renderer/components/features/wholesale/units";
import {
  hydrateVouchers,
  saveVouchers,
  useWholesale,
} from "@renderer/components/features/wholesale/store";
import {
  SUPPLIER_VOUCHERS_URL,
  WholesaleApiError,
  addSupplierVoucherPayment,
  createSupplierVoucher,
  deleteSupplierVoucher,
  removeSupplierVoucherPayment,
  updateSupplierVoucher,
  vouchersFromWire,
  type NewSupplierVoucherInput,
  type SupplierVoucherWire,
} from "@renderer/components/features/wholesale/api";
import {
  GROUP_LABELS,
  PRODUCT_GROUPS,
  STOCK_CODES,
  productOf,
  type ProductGroup,
} from "@renderer/components/features/wholesale/products";

/** A quantity of goods, written in sets — the unit the business trades in. Pairs stay
 *  the figure underneath, so nothing is ever converted twice. */
const sets = (qty: number): string => formatIn(qty, "set");

// The wholesale Supplier Vouchers screen — the supplier's (factory's) own document for
// one batch it is sending us. Built the same way as Customer Orders: the prototype's layout (figure cards,
// one panel holding header, filters, table and pagination; a read-only detail sheet; a
// three-step wizard), the ERD's fields, and this app's own tokens and primitives.
//
// No backend. Vouchers live in component state, so a new one survives moving between the
// three views but not a reload; every place a request will eventually go is a
// `saveVouchers` call in this file.

type View = "list" | "detail" | "new";
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

export default function SupplierVouchersPage({ session }: { session: Session }): React.JSX.Element {
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
  const { vouchers } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    vouchers.find((voucher) => voucher.voucher_id === selectedId) ?? null;

  function openVoucher(voucherId: string): void {
    setSelectedId(voucherId);
    setView("detail");
  }

  function deleteVoucher(voucherId: string): void {
    deleteSupplierVoucher(session, voucherId).then(async () => {
      setSelectedId((current) => (current === voucherId ? null : current));
      setView("list"); await reload();
    }).catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not delete the voucher."));
  }

  async function persistVoucher(voucher: SupplierVoucher): Promise<void> {
    try {
      await updateSupplierVoucher(session, voucher.voucher_id, {
        supplier_name: voucher.supplier_name,
        voucher_date: voucher.voucher_date,
        cargo_name: voucher.cargo_name,
        total_packages: voucher.total_packages,
        lines: voucher.lines,
      });
      reload();
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
      setSelectedId(voucher.voucher_id); setView("detail"); await reload();
    }).catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not create the voucher."));
  }

  if (view === "new") {
    return (
      <NewVoucherForm
        nextVoucherNo={nextVoucherNo(vouchers)}
        onCancel={() => setView("list")}
        onCreate={addVoucher}
      />
    );
  }

  if (view === "detail" && selected) {
    return (
      <VoucherDetail
        voucher={selected}
        onSave={persistVoucher}
        onAddPayment={(payment) => addSupplierVoucherPayment(session, selected.voucher_id, payment).then(reload).catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not add the payment."))}
        onRemovePayment={(paymentId) => removeSupplierVoucherPayment(session, selected.voucher_id, paymentId).then(reload).catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not remove the payment."))}
        onBack={() => setView("list")}
      />
    );
  }

  return (
    <VoucherList
      vouchers={vouchers}
      onOpen={openVoucher}
      onDelete={deleteVoucher}
      onNew={() => setView("new")}
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
  onOpen,
  onDelete,
  onNew,
  onRefresh,
  refreshing,
}: {
  vouchers: SupplierVoucher[];
  onOpen: (voucherId: string) => void;
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

// Which customers are waiting for a stock code. This is **not** allocation: nothing is
// given to anyone until the boxes are opened and counted at the gate and the staff decide
// the split, which is the receiving screen's job (see diagram/wholesale/erd.mmd). This is
// only "who asked for this", so whoever is looking at a voucher can see who it is for.
interface WaitingCustomer {
  name: string;
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
    if (qty > 0) waiting.push({ name: order.customer_name, qty });
  }
  return waiting;
}

/** A row's own actions. Deleting asks a second time inside the menu, since there is no
 *  undo behind it. */
function RowMenu({
  onOpen,
  onDelete,
}: {
  onOpen: () => void;
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
        <div className="absolute right-0 top-9 z-30 min-w-48 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in">
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
                icon={<TrashIcon className="w-4 h-4" />}
                label="Delete voucher"
                danger
                onClick={() => setConfirming(true)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function VoucherDetail({
  voucher: initialVoucher,
  onSave,
  onAddPayment,
  onRemovePayment,
  onBack,
}: {
  voucher: SupplierVoucher;
  onSave: (voucher: SupplierVoucher) => Promise<void>;
  onAddPayment: (payment: SupplierVoucher["payment"]["payments"][number]) => void;
  onRemovePayment: (paymentId: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  const [voucher, setVoucher] = useState(initialVoucher);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setVoucher(initialVoucher);
  }, [initialVoucher]);

  function apply(patch: Partial<SupplierVoucher>): void {
    setVoucher((current) => ({ ...current, ...patch }));
  }

  async function saveChanges(): Promise<void> {
    setSaving(true);
    try {
      await onSave(voucher);
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
    apply({
      lines: [
        ...voucher.lines,
        {
          voucher_line_id: `fvl-${Date.now()}`,
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
    apply({
      lines: voucher.lines.filter((_, position) => position !== index),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeftIcon className="w-4 h-4" />
          Back to vouchers
        </Button>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight">
            Voucher details
          </h2>
          <div className="flex items-center gap-2">
            <ReceivingBadge status={receivingStatus(voucher)} />
            <PaymentBadge status={paymentStatus(voucher)} />
            <Button
              size="sm"
              onClick={() => void saveChanges()}
              loading={saving}
            >
              <CheckIcon className="w-4 h-4" />
              Save changes
            </Button>
          </div>
        </div>

        <div className="px-6 py-6 flex flex-col gap-8">
          <section>
            <SectionLabel>Voucher information</SectionLabel>
            {/* The voucher number stays as it is — it is how this voucher is referred
                to on Delivery and at the gate. Everything else can be corrected. */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
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
                label="Supplier / Factory"
                placeholder="Goody Factory"
                suggestions={SUPPLIER_NAMES}
                value={voucher.supplier_name}
                onChange={(next) => apply({ supplier_name: next })}
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
          </section>

          <section>
            <SectionLabel>Products</SectionLabel>
            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="min-w-[9rem]">Stock code</Th>
                  <Th className="min-w-[12rem]">Product</Th>
                  <Th className="min-w-[11rem]">Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right min-w-[7rem]">Buying price</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Customers</Th>
                </Tr>
              </Thead>
              <Tbody>
                {voucher.lines.map((line, index) => (
                  <Tr key={line.voucher_line_id}>
                    <Td>
                      <div className="flex items-center gap-1">
                        <SuggestInput
                          bare
                          label={`Stock code for line ${index + 1}`}
                          placeholder="A1001"
                          suggestions={STOCK_CODES}
                          value={line.stock_code}
                          onChange={(next) => setStockCode(index, next)}
                        />
                        <CopyButton value={line.stock_code} what="stock code" />
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-1.5">
                        <CellInput
                          label={`Description for line ${index + 1}`}
                          placeholder="Men's leather sandal"
                          value={line.description}
                          onChange={(next) =>
                            setLine(index, { description: next })
                          }
                        />
                        <GroupSelect
                          label={`Group for line ${index + 1}`}
                          value={line.group}
                          onChange={(group) => setLine(index, { group })}
                        />
                      </div>
                    </Td>
                    <Td>
                      <CellInput
                        label={`Colors for line ${index + 1}`}
                        placeholder="black10s,pink2p"
                        value={line.color_qty}
                        onChange={(next) => setColors(index, next)}
                        error={colorQtyProblem(line.color_qty) ?? undefined}
                      />
                    </Td>
                    <Td className="text-right tabular-nums">
                      {sets(line.voucher_qty)}
                    </Td>
                    <Td>
                      <CellInput
                        label={`Buying price for line ${index + 1}`}
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
                        aria-label={`Remove product on line ${index + 1}`}
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
                  <Td className="font-semibold" colSpan={3}>
                    Total
                  </Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {sets(voucher.total_qty)}
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
                variant="ghost"
                size="sm"
                className={SOFT_BLUE}
                onClick={addLine}
              >
                <PlusIcon className="w-4 h-4" />
                Add product
              </Button>
            </div>
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
                onAdd={(payment) =>
                  onAddPayment(payment)
                }
                onRemove={(paymentId) =>
                  onRemovePayment(paymentId)
                }
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
          key={entry.name}
          className="inline-flex items-center rounded-full bg-brand-subtle text-brand text-xs font-medium px-2 py-0.5 whitespace-nowrap"
        >
          {entry.name} ({sets(entry.qty)})
        </span>
      ))}
      {spare > 0 && (
        <span className="inline-flex items-center rounded-full bg-bg-raised text-text-secondary text-xs font-medium px-2 py-0.5 whitespace-nowrap">
          {sets(spare)} spare
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
  const { shipments } = useWholesale();
  const shipment = shipments.find(
    (entry) => entry.voucher_no === voucher.voucher_no,
  );

  const taken = (
    <JourneyCard
      key="voucher"
      stage="supplier"
      title="Voucher taken"
      subtitle={formatDate(voucher.voucher_date)}
      done={voucher.received_qty >= voucher.total_qty && voucher.total_qty > 0}
      doneLabel="Everything received"
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
        <p className="text-sm text-text-muted">
          Nothing has been shipped against this voucher yet. Once a shipment is
          raised on the Delivery screen, its journey appears here.
        </p>
      </div>
    );
  }

  return <DeliveryJourney shipment={shipment} before={[taken]} />;
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
  onCancel,
  onCreate,
}: {
  nextVoucherNo: string;
  onCancel: () => void;
  onCreate: (input: NewSupplierVoucherInput) => void;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [voucherDate, setVoucherDate] = useState(todayIso());
  const [supplierName, setSupplierName] = useState("");
  const [cargoName, setCargoName] = useState("");
  const [packages, setPackages] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

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
  const canLeaveProducts =
    filledLines.length > 0 &&
    totalQty > 0 &&
    !emptyColors &&
    colorProblem === undefined;

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

            <div className="border border-border rounded-lg divide-y divide-border">
              {lines.map((line, index) => {
                const lineQty = draftPairs(line);
                const lineAmount = lineQty * (Number(line.buying_price) || 0);
                return (
                  <div
                    key={index}
                    className="grid gap-3 grid-cols-1 md:grid-cols-12 items-start p-3"
                  >
                    <div className="md:col-span-3">
                      <SuggestInput
                        label={<Required>Stock code</Required>}
                        placeholder="A1001"
                        suggestions={STOCK_CODES}
                        value={line.stock_code}
                        onChange={(next) => setStockCode(index, next)}
                      />
                    </div>
                    <div className="md:col-span-5">
                      <Input
                        label="Description"
                        className={EDITABLE}
                        placeholder="Men's leather sandal"
                        value={line.description}
                        onChange={(event) =>
                          updateLine(index, { description: event.target.value })
                        }
                      />
                    </div>
                    <div className="md:col-span-4">
                      <Select
                        label="Group"
                        className={EDITABLE}
                        value={line.group}
                        onChange={(event) =>
                          updateLine(index, {
                            group: event.target.value as ProductGroup,
                          })
                        }
                      >
                        {PRODUCT_GROUPS.map((group) => (
                          <option key={group} value={group}>
                            {GROUP_LABELS[group]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="md:col-span-4">
                      <Input
                        label={<Required>Colors</Required>}
                        className={EDITABLE}
                        placeholder="black10s,pink2p"
                        value={line.color_qty}
                        onChange={(event) =>
                          updateLine(index, { color_qty: event.target.value })
                        }
                        error={colorQtyProblem(line.color_qty) ?? undefined}
                        hint={
                          lineQty > 0
                            ? sets(lineQty)
                            : "Every color needs a unit — s sets, p pairs, d dozens"
                        }
                      />
                    </div>
                    <div className="md:col-span-3">
                      <Input
                        label="Buying price"
                        type="text"
                        inputMode="numeric"
                        placeholder="0"
                        className={cn(EDITABLE, "text-right")}
                        value={line.buying_price}
                        onChange={(event) =>
                          updateLine(index, {
                            buying_price: onlyDigits(event.target.value),
                          })
                        }
                        hint={lineAmount > 0 ? formatKyat(lineAmount) : " "}
                      />
                    </div>
                    <div className="md:col-span-2 flex md:justify-end md:pt-7">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={SOFT_RED}
                        aria-label={`Remove row ${index + 1}`}
                        onClick={() => removeLine(index)}
                      >
                        <TrashIcon className="w-4 h-4" />
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}

              <div className="grid gap-3 grid-cols-1 md:grid-cols-12 items-center p-3 bg-bg-subtle">
                <span className="md:col-span-3 text-sm font-semibold text-text-primary">
                  Total
                </span>
                <span className="md:col-span-4 text-sm font-semibold tabular-nums text-text-primary">
                  {sets(totalQty)}
                </span>
                <span className="md:col-span-3 text-sm font-semibold tabular-nums text-brand md:text-right">
                  {formatKyat(totalAmount)}
                </span>
                <span className="hidden md:block md:col-span-2" />
              </div>
            </div>

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
                  <Th>Stock code</Th>
                  <Th className="w-48">Product</Th>
                  <Th>Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right whitespace-nowrap">Buying price</Th>
                  <Th className="text-right">Amount</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filledLines.map((line, index) => {
                  const qty = draftPairs(line);
                  return (
                    <Tr key={index}>
                      <Td className="font-semibold text-brand">
                        {line.stock_code}
                      </Td>
                      <Td>
                        <ProductCell
                          description={line.description}
                          group={line.group}
                        />
                      </Td>
                      <Td className="font-mono text-xs text-text-secondary">
                        {line.color_qty || "—"}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatQty(qty)}
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
                  <Td className="font-semibold" colSpan={3}>
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
