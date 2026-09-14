import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
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
  CloseIcon,
  SearchIcon,
  WarehouseIcon,
} from "@renderer/components/ui/icons";
import {
  addCustomerOrderPayment,
  addSupplierVoucherPayment,
  RECEIVINGS_URL,
  receivingsFromWire,
  SUPPLIER_VOUCHERS_URL,
  WHOLESALE_FINANCE_CUSTOMERS_URL,
  type ReceivingWire,
} from "@renderer/components/features/wholesale/api";
import {
  formatKyat,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import {
  paidAmount as paidVoucherAmount,
  paymentStatus as voucherPaymentStatus,
  voucherBalance,
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/supplierVouchers";

interface FinanceCustomerRow {
  order_id: string;
  customer_name: string;
  order_no: string;
  total_amount: number;
  paid_amount: number;
  balance: number;
  payment_status: "unpaid" | "partial" | "paid";
}

type Tab = "customers" | "suppliers" | "shipment-costs";
type StatusFilter = "all" | "unpaid" | "partial" | "paid";
type PaymentStatus = Exclude<StatusFilter, "all">;

const STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
};
const STATUS_STYLES: Record<PaymentStatus, string> = {
  unpaid: "bg-error text-white",
  partial: "bg-warning text-white",
  paid: "bg-success text-white",
};

interface SupplierFinanceRow {
  voucher: SupplierVoucher;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  status: PaymentStatus;
}

interface PaymentTarget {
  id: string;
  name: string;
  reference: string;
  kind: "customer" | "supplier";
}

interface ShipmentCostRow {
  id: string;
  receivingNo: string;
  shipmentNo: string;
  supplierName: string;
  stage: string;
  carrier: string;
  kind: string;
  amount: number;
  note: string;
}

export default function FinancePage({
  session,
  onOpenOrder,
  onOpenVoucher,
}: {
  session: Session;
  onOpenOrder: (orderId: string) => void;
  onOpenVoucher: (voucherId: string) => void;
}): React.JSX.Element {
  const showToast = useToast();
  const [tab, setTab] = useState<Tab>("customers");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [paymentTarget, setPaymentTarget] = useState<PaymentTarget | null>(
    null,
  );

  const customerQuery = useQuery({
    queryKey: ["wholesale", "finance", "customers"],
    queryFn: () =>
      fetchJson<FinanceCustomerRow[]>(WHOLESALE_FINANCE_CUSTOMERS_URL, session),
  });
  const supplierQuery = useQuery({
    queryKey: ["wholesale", "finance", "suppliers"],
    queryFn: () => fetchJson<SupplierVoucher[]>(SUPPLIER_VOUCHERS_URL, session),
  });
  const receivingQuery = useQuery({
    queryKey: ["wholesale", "finance", "shipment-costs"],
    queryFn: async () =>
      receivingsFromWire(
        await fetchJson<ReceivingWire[]>(RECEIVINGS_URL, session),
      ),
  });

  useLoadErrorToast(customerQuery.isError, "customer finance");
  useLoadErrorToast(supplierQuery.isError, "supplier payables");
  useLoadErrorToast(receivingQuery.isError, "shipment costs");

  const isRefreshing =
    customerQuery.isFetching ||
    supplierQuery.isFetching ||
    receivingQuery.isFetching;

  function refreshFinance(): void {
    void Promise.all([
      customerQuery.refetch(),
      supplierQuery.refetch(),
      receivingQuery.refetch(),
    ]);
  }

  const customers = useMemo(
    () => customerQuery.data ?? [],
    [customerQuery.data],
  );
  const suppliers = useMemo<SupplierFinanceRow[]>(
    () =>
      (supplierQuery.data ?? []).map((voucher) => {
        const totalAmount = voucher.lines.reduce(
          (sum, line) => sum + line.quantity_pairs * line.buying_price,
          0,
        );
        return {
          voucher,
          totalAmount,
          paidAmount: paidVoucherAmount(voucher),
          balance: voucherBalance(voucher),
          status: voucherPaymentStatus(voucher),
        };
      }),
    [supplierQuery.data],
  );
  const shipmentCosts = useMemo<ShipmentCostRow[]>(
    () =>
      (receivingQuery.data ?? []).flatMap((receiving) =>
        receiving.costs.map((cost) => ({
          id: `${receiving.receiving_id}-${cost.cost_id}`,
          receivingNo: receiving.receiving_no,
          shipmentNo: receiving.shipment_no,
          supplierName: receiving.supplier_name,
          stage: cost.stage || "—",
          carrier: cost.carrier || "—",
          kind: cost.kind || "—",
          amount: cost.amount,
          note: cost.note,
        })),
      ),
    [receivingQuery.data],
  );
  const totalCustomerReceivable = customers.reduce(
    (sum, row) => sum + row.balance,
    0,
  );
  const totalSupplierPayable = suppliers.reduce(
    (sum, row) => sum + row.balance,
    0,
  );
  const queryText = search.trim().toLowerCase();

  const visibleCustomers = useMemo(
    () =>
      customers.filter((row) => {
        const matchesSearch =
          !queryText ||
          row.customer_name.toLowerCase().includes(queryText) ||
          row.order_no.toLowerCase().includes(queryText);
        return (
          matchesSearch &&
          (statusFilter === "all" || row.payment_status === statusFilter)
        );
      }),
    [customers, queryText, statusFilter],
  );
  const visibleSuppliers = useMemo(
    () =>
      suppliers.filter(({ voucher, status }) => {
        const matchesSearch =
          !queryText ||
          voucher.supplier_name.toLowerCase().includes(queryText) ||
          voucher.voucher_no.toLowerCase().includes(queryText);
        return (
          matchesSearch && (statusFilter === "all" || status === statusFilter)
        );
      }),
    [queryText, statusFilter, suppliers],
  );
  const visibleShipmentCosts = useMemo(
    () =>
      shipmentCosts.filter((row) => {
        if (!queryText) return true;
        return [
          row.receivingNo,
          row.shipmentNo,
          row.supplierName,
          row.stage,
          row.carrier,
          row.kind,
          row.note,
        ].some((value) => value.toLowerCase().includes(queryText));
      }),
    [queryText, shipmentCosts],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-text-primary">
            Finance
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            See who owes what, and whether it is paid.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={refreshFinance}
          loading={isRefreshing}
        >
          Refresh
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <MoneyCard
          label="Total Customer Receivable"
          value={formatKyat(totalCustomerReceivable)}
        />
        <MoneyCard
          label="Total Supplier Payable"
          value={formatKyat(totalSupplierPayable)}
        />
      </div>
      <div className="flex border-b border-border">
        <TabButton
          active={tab === "customers"}
          onClick={() => setTab("customers")}
        >
          Customer Receivables
        </TabButton>
        <TabButton
          active={tab === "suppliers"}
          onClick={() => setTab("suppliers")}
        >
          Supplier Payables
        </TabButton>
        <TabButton
          active={tab === "shipment-costs"}
          onClick={() => setTab("shipment-costs")}
        >
          Shipment Costs
        </TabButton>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full md:w-72">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or reference"
            startIcon={<SearchIcon className="h-4 w-4" />}
            aria-label="Search name or reference"
          />
        </div>
        {tab !== "shipment-costs" && (
          <div className="w-full md:w-48">
            <Select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
            >
              <option value="all">Any status</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Part paid</option>
              <option value="paid">Paid</option>
            </Select>
          </div>
        )}
      </div>
      {tab === "customers" ? (
        <FinanceTable
          loading={customerQuery.isLoading}
          emptyTitle="No customer receivables"
          emptyDescription="Orders matching these filters will appear here."
          rows={visibleCustomers}
          onRecordPayment={(row) =>
            setPaymentTarget({
              id: row.order_id,
              name: row.customer_name,
              reference: row.order_no,
              kind: "customer",
            })
          }
          onOpenReference={onOpenOrder}
        />
      ) : tab === "suppliers" ? (
        <SupplierTable
          loading={supplierQuery.isLoading}
          rows={visibleSuppliers}
          onRecordPayment={(row) =>
            setPaymentTarget({
              id: row.voucher.voucher_id,
              name: row.voucher.supplier_name,
              reference: row.voucher.voucher_no,
              kind: "supplier",
            })
          }
          onOpenReference={onOpenVoucher}
        />
      ) : (
        <ShipmentCostTable
          loading={receivingQuery.isLoading}
          rows={visibleShipmentCosts}
        />
      )}
      {paymentTarget && (
        <RecordPaymentModal
          session={session}
          target={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={() => {
            setPaymentTarget(null);
            showToast("success", "Payment recorded");
          }}
        />
      )}
    </div>
  );
}

function MoneyCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-bg-base p-5">
      <span className="block text-xs font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <span className="mt-2 block text-2xl font-bold tabular-nums text-brand">
        {value}
      </span>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-4 py-3 text-left text-sm font-semibold leading-tight ${active ? "border-brand text-brand" : "border-transparent text-text-muted hover:text-text-primary"}`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: PaymentStatus }): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-bg-base">
      <div className="border-b border-border px-5 py-4">
        <h3 className="font-semibold text-text-primary">{title}</h3>
        {description && (
          <p className="mt-1 text-sm text-text-muted">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function FinanceTable({
  loading,
  emptyTitle,
  emptyDescription,
  rows,
  onRecordPayment,
  onOpenReference,
}: {
  loading: boolean;
  emptyTitle: string;
  emptyDescription: string;
  rows: FinanceCustomerRow[];
  onRecordPayment: (row: FinanceCustomerRow) => void;
  onOpenReference: (referenceId: string) => void;
}): React.JSX.Element {
  const totals = rows.reduce(
    (summary, row) => ({
      total: summary.total + row.total_amount,
      paid: summary.paid + row.paid_amount,
      balance: summary.balance + row.balance,
    }),
    { total: 0, paid: 0, balance: 0 },
  );
  return (
    <Panel
      title="Customer Receivables"
      description="Unpaid balances from customer orders."
    >
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<WarehouseIcon />}
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <TableContainer className="rounded-none border-0">
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Reference</Th>
              <Th className="text-right">Total Amount</Th>
              <Th className="text-right">Paid Amount</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.order_id}>
                <Td className="font-medium">{row.customer_name}</Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => onOpenReference(row.order_id)}
                    className="font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {row.order_no}
                  </button>
                </Td>
                <Td className="text-right tabular-nums whitespace-nowrap">
                  {formatKyat(row.total_amount)}
                </Td>
                <Td className="text-right tabular-nums whitespace-nowrap">
                  {formatKyat(row.paid_amount)}
                </Td>
                <Td
                  className={`text-right tabular-nums whitespace-nowrap ${row.balance > 0 ? "text-warning font-semibold" : "text-success"}`}
                >
                  {formatKyat(row.balance)}
                </Td>
                <Td>
                  <StatusPill status={row.payment_status} />
                </Td>
                <Td>
                  <Button size="sm" onClick={() => onRecordPayment(row)}>
                    Record Payment
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
          <tfoot>
            <Tr className="bg-bg-subtle">
              <Td colSpan={2} className="text-right font-semibold">
                Total
              </Td>
              <Td className="text-right font-bold tabular-nums whitespace-nowrap">
                {formatKyat(totals.total)}
              </Td>
              <Td className="text-right font-bold tabular-nums whitespace-nowrap">
                {formatKyat(totals.paid)}
              </Td>
              <Td className="text-right font-bold tabular-nums whitespace-nowrap">
                {formatKyat(totals.balance)}
              </Td>
              <Td />
              <Td />
            </Tr>
          </tfoot>
        </TableContainer>
      )}
    </Panel>
  );
}

function SupplierTable({
  loading,
  rows,
  onRecordPayment,
  onOpenReference,
}: {
  loading: boolean;
  rows: SupplierFinanceRow[];
  onRecordPayment: (row: SupplierFinanceRow) => void;
  onOpenReference: (referenceId: string) => void;
}): React.JSX.Element {
  const totals = rows.reduce(
    (summary, row) => ({
      total: summary.total + row.totalAmount,
      paid: summary.paid + row.paidAmount,
      balance: summary.balance + row.balance,
    }),
    { total: 0, paid: 0, balance: 0 },
  );
  return (
    <Panel
      title="Supplier Payables"
      description="Outstanding balances owed to suppliers."
    >
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<WarehouseIcon />}
          title="No supplier payables"
          description="Supplier vouchers matching these filters will appear here."
        />
      ) : (
        <TableContainer className="rounded-none border-0">
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Reference</Th>
              <Th className="text-right">Total Amount</Th>
              <Th className="text-right">Paid Amount</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.voucher.voucher_id}>
                <Td className="font-medium">{row.voucher.supplier_name}</Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => onOpenReference(row.voucher.voucher_id)}
                    className="font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {row.voucher.voucher_no}
                  </button>
                </Td>
                <Td className="text-right tabular-nums whitespace-nowrap">
                  {formatKyat(row.totalAmount)}
                </Td>
                <Td className="text-right tabular-nums whitespace-nowrap">
                  {formatKyat(row.paidAmount)}
                </Td>
                <Td
                  className={`text-right tabular-nums whitespace-nowrap ${row.balance > 0 ? "text-warning font-semibold" : "text-success"}`}
                >
                  {formatKyat(row.balance)}
                </Td>
                <Td>
                  <StatusPill status={row.status} />
                </Td>
                <Td>
                  <Button size="sm" onClick={() => onRecordPayment(row)}>
                    Record Payment
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
          <tfoot>
            <Tr className="bg-bg-subtle">
              <Td colSpan={2} className="text-right font-semibold">
                Total
              </Td>
              <Td className="text-right font-bold tabular-nums whitespace-nowrap">
                {formatKyat(totals.total)}
              </Td>
              <Td className="text-right font-bold tabular-nums whitespace-nowrap">
                {formatKyat(totals.paid)}
              </Td>
              <Td className="text-right font-bold tabular-nums whitespace-nowrap">
                {formatKyat(totals.balance)}
              </Td>
              <Td />
              <Td />
            </Tr>
          </tfoot>
        </TableContainer>
      )}
    </Panel>
  );
}

function ShipmentCostTable({
  loading,
  rows,
}: {
  loading: boolean;
  rows: ShipmentCostRow[];
}): React.JSX.Element {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return (
    <Panel
      title="Shipment Costs"
      description="Cargo and receiving costs recorded for shipments."
    >
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<WarehouseIcon />}
          title="No shipment costs"
          description="Recorded receiving and transport costs will appear here."
        />
      ) : (
        <TableContainer className="rounded-none border-0">
          <Thead>
            <Tr>
              <Th>Receiving</Th>
              <Th>Shipment</Th>
              <Th>Supplier</Th>
              <Th>Stage</Th>
              <Th>Carrier</Th>
              <Th>Type</Th>
              <Th className="text-right">Amount</Th>
              <Th>Note</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td className="font-semibold text-brand">{row.receivingNo}</Td>
                <Td>{row.shipmentNo}</Td>
                <Td className="font-medium">{row.supplierName}</Td>
                <Td>{row.stage}</Td>
                <Td>{row.carrier}</Td>
                <Td>{row.kind}</Td>
                <Td className="text-right font-semibold tabular-nums whitespace-nowrap">
                  {formatKyat(row.amount)}
                </Td>
                <Td className="max-w-xs">{row.note || "—"}</Td>
              </Tr>
            ))}
          </Tbody>
          <tfoot>
            <Tr className="bg-bg-subtle">
              <Td colSpan={6} className="text-right font-semibold">
                Total
              </Td>
              <Td className="text-right font-bold tabular-nums whitespace-nowrap">
                {formatKyat(total)}
              </Td>
              <Td />
            </Tr>
          </tfoot>
        </TableContainer>
      )}
    </Panel>
  );
}

function Loading(): React.JSX.Element {
  return (
    <div className="flex justify-center py-14">
      <Spinner className="h-6 w-6 text-text-muted" />
    </div>
  );
}

function RecordPaymentModal({
  session,
  target,
  onClose,
  onSaved,
}: {
  session: Session;
  target: PaymentTarget;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError("Enter a payment amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payment = {
        payment_id: "",
        paid_on: paidOn,
        amount: amountValue,
        note: note.trim(),
      };
      if (target.kind === "customer")
        await addCustomerOrderPayment(session, target.id, payment);
      else await addSupplierVoucherPayment(session, target.id, payment);
      onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not record payment.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-payment-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-border bg-bg-base p-5 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 id="record-payment-title" className="text-lg font-semibold">
              Record Payment
            </h3>
            <p className="mt-1 text-sm text-text-muted">
              {target.name} · {target.reference}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted hover:bg-bg-raised"
            aria-label="Close"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <Input
            label="Amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0"
            required
          />
          <Input
            label="Date"
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            required
          />
          <Input
            label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note"
          />
        </div>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save payment
          </Button>
        </div>
      </form>
    </div>
  );
}
