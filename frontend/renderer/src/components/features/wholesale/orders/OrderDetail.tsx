import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { cn } from "@renderer/lib/utils";
import { useToast } from "@renderer/lib/useToast";
import { type AppSettings } from "@renderer/lib/appSettings";
import {
  CellInput,
  CurrencySelect,
  EDITABLE,
  GroupSelect,
  MismatchIconButton,
  PaymentsTable,
  CopyButton,
  ReadOnlyField,
  SOFT_RED,
  SectionLabel,
  SuggestInput,
} from "@renderer/components/features/wholesale/shared/ui";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
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
  PlusIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  lineRemaining,
  orderAmount,
  orderBalance,
  paidAmount,
  paidPct,
  paymentStatus,
  receivedPct,
  remainingQty,
  type CustomerOrder,
  type CustomerOrderLine,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import {
  STOCK_CODES,
  SUPPLIER_NAMES,
  productOf,
} from "@renderer/components/features/wholesale/masterData/masterData";
import {
  PAIRS_PER,
  pricedAmount,
} from "@renderer/components/features/wholesale/shared/units";
import {
  colorQtyPairs,
  colorQtyProblem,
  duplicateStockCodeProblem,
  formatKyat,
  mismatchDescription,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  DEFAULT_CURRENCY,
  isForeignCurrency,
  previewKyatAmount,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/shared/currency";
import { type StockLine } from "@renderer/components/features/wholesale/inventory/stock";
import {
  type CustomerDeliveryBatchInput,
  type WriteOffReason,
  type WriteOffWire,
} from "@renderer/components/features/wholesale/shared/api";
import { WriteOffModal } from "@renderer/components/features/wholesale/shared/WriteOffModal";
import {
  customerOrderDetailSchema,
  sets,
  type CustomerOrderDetailFormValues,
  type DetailTab,
} from "./types";
import { formatColorBreakdown } from "./orderColorUtils";
import { PaymentBadge, StatusBadge } from "./OrderBadges";
import { FulfillmentBody } from "./OrderFulfillmentBody";

export function OrderDetail({
  order: initialOrder,
  orders,
  settings,
  initialTab = "products",
  initialFulfillSubTab = "allocate",
  inventoryLines,
  inventoryLoading,
  onSave,
  onBack,
  onSaveAllocation,
  onSaveAllocationsComplete,
  onSaveDelivery,
  onWriteOff,
  writeOffs,
}: {
  order: CustomerOrder;
  orders: CustomerOrder[];
  settings: AppSettings | null;
  initialTab?: DetailTab;
  initialFulfillSubTab?: "allocate" | "deliver";
  inventoryLines: StockLine[];
  inventoryLoading: boolean;
  onSave: (order: CustomerOrder, originalOrder: CustomerOrder) => Promise<void>;
  onBack: () => void;
  onSaveAllocation: (lineId: string, colorBreakdown: string) => Promise<void>;
  onSaveAllocationsComplete: () => Promise<void>;
  onSaveDelivery: (input: CustomerDeliveryBatchInput) => Promise<void>;
  onWriteOff: (
    lineId: string,
    quantity: number,
    reason: WriteOffReason,
    note: string,
  ) => Promise<void>;
  writeOffs: WriteOffWire[];
}): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  const [addingLineId, setAddingLineId] = useState<string | null>(null);
  /** The line whose removal is waiting for a second click. */
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(
    null,
  );
  const [writeOffLine, setWriteOffLine] = useState<CustomerOrderLine | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const {
    control,
    getValues,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<CustomerOrderDetailFormValues>({
    resolver: zodResolver(customerOrderDetailSchema),
    defaultValues: { order: initialOrder },
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
    name: "order.lines",
  });
  const order = useWatch({ control, name: "order" }) as CustomerOrder;

  useEffect(() => {
    reset({ order: initialOrder });
    setAddingLineId(null);
  }, [initialOrder, reset]);

  async function saveChanges(
    values: CustomerOrderDetailFormValues,
  ): Promise<void> {
    setSaving(true);
    try {
      await onSave(values.order, initialOrder);
    } finally {
      setSaving(false);
    }
  }

  // Save is the one keyboard shortcut this page keeps — same rule as Receiving.
  // Everything else (switching tabs, adding a line) stays a visible button.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        if (isDirty && !saving) {
          void handleSubmit(saveChanges)();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, saving, handleSubmit]);

  const pct = receivedPct(order);

  // total_quantity_pairs/delivered_quantity_pairs are the server's own running totals across order.lines (see
  // _out in the router) — recomputed here the same way whenever a line changes, so the
  // header figures never lag behind an edit still sitting unsaved on screen.
  function apply(patch: Partial<CustomerOrder>): void {
    if (patch.lines) {
      replace(patch.lines);
      setValue(
        "order.total_quantity_pairs",
        patch.lines.reduce((sum, line) => sum + line.quantity_pairs, 0),
        { shouldDirty: true, shouldValidate: true },
      );
      setValue(
        "order.delivered_quantity_pairs",
        patch.lines.reduce(
          (sum, line) => sum + line.delivered_quantity_pairs,
          0,
        ),
        { shouldDirty: true, shouldValidate: true },
      );
    }
    if (patch.payment) {
      setValue("order.payment", patch.payment, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    for (const [key, value] of Object.entries(patch)) {
      if (key === "lines" || key === "payment") continue;
      setValue(`order.${key}` as "order.customer_name", value as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  // Editing a line is editing the order: the quantity is re-read from the colours, the
  // same rule the wizard follows, so the two can never be written down differently.
  function setLine(index: number, patch: Partial<CustomerOrderLine>): void {
    const lines = getValues("order.lines").map((line, position) =>
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
            unit: "set",
            unit_conversions: known.default_unit_conversions ?? PAIRS_PER,
          }
        : { stock_code: code },
    );
  }

  function addLine(): void {
    const lineId = `col-${Date.now()}`;
    setAddingLineId(lineId);
    append({
      order_line_id: lineId,
      stock_code: "",
      description: "",
      product_group: "man",
      supplier_name: "",
      color_breakdown: "",
      unit: "set",
      quantity_pairs: 0,
      delivered_quantity_pairs: 0,
      selling_price: 0,
      currency_code: DEFAULT_CURRENCY,
      original_selling_price: null,
      exchange_rate: null,
    });
  }

  /** A line that has had goods go out against it, or has stock set aside for it, is not
   *  the kind of thing to take off an order with one click: the delivery records would
   *  then point at a product the order no longer lists, and the reservation would be
   *  holding stock for nobody. Take the delivery back, or release the allocation, first. */
  function lineLockedReason(line: CustomerOrderLine): string | null {
    if (line.delivered_quantity_pairs > 0) {
      return "Already given to the customer — take that delivery back first.";
    }
    if ((line.allocated_quantity_pairs ?? 0) > 0) {
      return "Stock is set aside for this — release the allocation first.";
    }
    return null;
  }

  function removeLine(index: number): void {
    setConfirmingRemoval(null);
    if (order.lines[index]?.order_line_id === addingLineId) {
      setAddingLineId(null);
    }
    const lines = order.lines.filter((_, position) => position !== index);
    remove(index);
    setValue(
      "order.total_quantity_pairs",
      lines.reduce((sum, line) => sum + line.quantity_pairs, 0),
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "order.delivered_quantity_pairs",
      lines.reduce((sum, line) => sum + line.delivered_quantity_pairs, 0),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function cancelAddLine(): void {
    if (!addingLineId) return;
    apply({
      lines: order.lines.filter((line) => line.order_line_id !== addingLineId),
    });
    setAddingLineId(null);
  }

  function setPayment(
    paymentId: string,
    patch: Partial<CustomerOrder["payment"]["payments"][number]>,
  ): void {
    apply({
      payment: {
        ...order.payment,
        payments: order.payment.payments.map((payment) =>
          payment.payment_id === paymentId ? { ...payment, ...patch } : payment,
        ),
      },
    });
  }

  function addPayment(
    payment: CustomerOrder["payment"]["payments"][number],
  ): void {
    apply({
      payment: {
        ...order.payment,
        payments: [...order.payment.payments, payment],
      },
    });
  }

  function removePayment(paymentId: string): void {
    apply({
      payment: {
        ...order.payment,
        payments: order.payment.payments.filter(
          (payment) => payment.payment_id !== paymentId,
        ),
      },
    });
  }

  const amount = orderAmount(order);
  const balance = orderBalance(order);
  const paid = paidAmount(order);
  const paidShare = paidPct(order);
  const hasChanges = isDirty;
  const allocatedPairs = order.lines.reduce(
    (sum, line) => sum + (line.allocated_quantity_pairs ?? 0),
    0,
  );
  const allocatedPct =
    order.total_quantity_pairs > 0
      ? Math.round((allocatedPairs / order.total_quantity_pairs) * 100)
      : 0;

  function handleBack(): void {
    if (hasChanges) {
      const confirmed = window.confirm(
        "You have unsaved changes. Discard them?",
      );
      if (!confirmed) return;
    }
    onBack();
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {/* One panel, header + tabs + whichever tab's content is active — the same
            command-bar shape Receiving uses, so both screens work the same way. */}
        <div className="rounded-xl border border-border bg-bg-base overflow-hidden divide-y divide-border">
          <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="text-text-muted hover:text-text-primary gap-1.5"
                title="Back to orders"
              >
                <ChevronLeftIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </Button>

              <div className="h-5 w-px bg-border" />

              <div className="min-w-0 flex items-center gap-2.5">
                <div className="flex items-center gap-1">
                  <h2 className="text-base font-bold text-text-primary tracking-tight truncate">
                    {order.order_no}
                  </h2>
                  <CopyButton value={order.order_no} what="order no." />
                </div>
                <StatusBadge status={order.order_status} />
                <PaymentBadge status={paymentStatus(order)} />
                <span className="hidden md:inline text-xs text-text-muted truncate">
                  {order.customer_name}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {hasChanges && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-warning"
                  title="Unsaved changes"
                />
              )}
              <Button
                size="sm"
                onClick={() => void handleSubmit(saveChanges)()}
                loading={saving}
                disabled={!hasChanges}
                className="font-medium gap-1.5 shadow-xs"
                title="Save changes (Ctrl+S)"
              >
                <CheckIcon className="w-4 h-4" />
                <span>Save</span>
              </Button>
            </div>
          </header>

          {/* Underline tabs on their own row, the same shape Supplier Vouchers
              already uses for its two-tab switch — a pill-tablist felt cramped
              here sharing a row with the order identity and Save button. */}
          <div
            role="tablist"
            aria-label="Order sections"
            className="flex items-center gap-1 px-5 pt-2.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "products"}
              onClick={() => setActiveTab("products")}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-semibold transition-colors duration-150",
                activeTab === "products"
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:text-text-primary",
              )}
            >
              <span>Products</span>
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
                  activeTab === "products"
                    ? "bg-brand text-white"
                    : "bg-brand-subtle text-brand border border-brand-pill",
                )}
              >
                {pct}%
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "payments"}
              onClick={() => setActiveTab("payments")}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-semibold transition-colors duration-150",
                activeTab === "payments"
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:text-text-primary",
              )}
            >
              <span>Payments</span>
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
                  activeTab === "payments"
                    ? "bg-brand text-white"
                    : "bg-brand-subtle text-brand border border-brand-pill",
                )}
              >
                {paidShare}%
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "allocate"}
              onClick={() => setActiveTab("allocate")}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-semibold transition-colors duration-150",
                activeTab === "allocate"
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:text-text-primary",
              )}
            >
              <span>Allocate &amp; Deliver</span>
            </button>
          </div>

          <div className="px-6 py-6 flex flex-col gap-8">
            {activeTab === "products" && (
              <section>
                <SectionLabel>Order information</SectionLabel>
                <div className="grid gap-4 lg:grid-cols-2 mt-2">
                  <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Customer details
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Controller
                        control={control}
                        name="order.customer_name"
                        render={({ field }) => (
                          <Input
                            label="Customer name"
                            className={EDITABLE}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            error={errors.order?.customer_name?.message}
                          />
                        )}
                      />
                      <Controller
                        control={control}
                        name="order.customer_phone"
                        render={({ field }) => (
                          <Input
                            label="Phone"
                            className={EDITABLE}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                          />
                        )}
                      />
                      <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                          Address
                        </label>
                        <Controller
                          control={control}
                          name="order.customer_address"
                          render={({ field }) => (
                            <CellInput
                              label="Address"
                              placeholder="Customer address"
                              multiline
                              value={field.value}
                              onChange={field.onChange}
                            />
                          )}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Order parameters
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ReadOnlyField
                        label="Order no."
                        value={order.order_no}
                        copyable
                      />
                      <Controller
                        control={control}
                        name="order.order_date"
                        render={({ field }) => (
                          <Input
                            label="Order date"
                            type="date"
                            className={EDITABLE}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            error={errors.order?.order_date?.message}
                          />
                        )}
                      />
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeTab === "products" && (
              <section>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <SectionLabel>Products</SectionLabel>
                    <p className="text-xs text-text-muted -mt-0.5">
                      Ordered items, allocated stock, pricing, and fulfillment
                      progress per line.
                    </p>
                  </div>
                  <div className="w-full sm:w-80 md:w-96">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-text-secondary font-medium">
                        Fulfillment progress
                      </span>
                      <span className="tabular-nums font-mono text-[11px] text-text-muted">
                        {sets(order.delivered_quantity_pairs)} /{" "}
                        {sets(order.total_quantity_pairs)}
                        <span className="ml-1.5 text-text-secondary font-semibold">
                          ({pct}%)
                        </span>
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Fulfillment progress"
                      className="h-2 rounded-full bg-bg-subtle border border-border overflow-hidden relative"
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-brand/35 transition-[width] duration-300 motion-reduce:transition-none"
                        style={{ width: String(allocatedPct) + "%" }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 bg-success transition-[width] duration-300 motion-reduce:transition-none"
                        style={{ width: String(pct) + "%" }}
                      />
                    </div>
                  </div>
                </div>
                <TableContainer>
                  <Thead className="top-0">
                    <Tr>
                      <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
                        #
                      </Th>
                      <Th className="min-w-[10rem] whitespace-nowrap">
                        Supplier / Factory
                      </Th>
                      <Th className="min-w-[18rem]">Product</Th>
                      <Th className="min-w-[11rem]">Colors</Th>
                      <Th className="text-right whitespace-nowrap min-w-[12.5rem]">
                        Delivered / Ordered
                      </Th>
                      <Th className="text-right min-w-[10rem]">
                        Selling price
                        <span className="block text-[10px] font-normal text-text-muted">
                          per set
                        </span>
                      </Th>
                      <Th className="text-right">Amount</Th>
                      <Th className="text-center">Mismatch</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {lineFields.map((field, index) => {
                      const line = order.lines[index];
                      if (!line) return null;
                      const explanation = writeOffs.find(
                        (entry) => entry.subject_id === line.order_line_id,
                      );
                      return (
                        <Tr key={field.id}>
                          <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                            {index + 1}
                          </Td>
                          <Td>
                            <Controller
                              control={control}
                              name={`order.lines.${index}.supplier_name`}
                              render={({ field: supplierField }) => (
                                <SuggestInput
                                  bare
                                  label={`Supplier for product ${index + 1}`}
                                  placeholder="Choose…"
                                  suggestions={SUPPLIER_NAMES}
                                  value={supplierField.value}
                                  onChange={supplierField.onChange}
                                />
                              )}
                            />
                          </Td>
                          <Td className="min-w-[18rem]">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                  <Controller
                                    control={control}
                                    name={`order.lines.${index}.stock_code`}
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
                                            order.lines,
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
                                <div className="w-28 shrink-0">
                                  <Controller
                                    control={control}
                                    name={`order.lines.${index}.product_group`}
                                    render={({ field: groupField }) => (
                                      <GroupSelect
                                        label={`Group for product ${index + 1}`}
                                        value={groupField.value}
                                        onChange={groupField.onChange}
                                      />
                                    )}
                                  />
                                </div>
                              </div>
                              <Controller
                                control={control}
                                name={`order.lines.${index}.description`}
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
                            </div>
                          </Td>
                          <Td>
                            <Controller
                              control={control}
                              name={`order.lines.${index}.color_breakdown`}
                              render={({ field: colorField }) => (
                                <CellInput
                                  label={`Colors for product ${index + 1}`}
                                  placeholder="Enter color qty"
                                  multiline
                                  value={colorField.value}
                                  onChange={(next) => {
                                    colorField.onChange(next);
                                    setColors(index, next);
                                  }}
                                  error={
                                    colorQtyProblem(line.color_breakdown) ??
                                    (line.quantity_pairs <
                                    line.delivered_quantity_pairs
                                      ? `${sets(line.delivered_quantity_pairs)} have already gone to the customer.`
                                      : undefined)
                                  }
                                />
                              )}
                            />
                          </Td>
                          <Td className="text-right tabular-nums whitespace-nowrap">
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="flex items-center gap-1.5 font-mono">
                                <span
                                  className={cn(
                                    "font-semibold",
                                    lineRemaining(line) === 0 &&
                                      line.quantity_pairs > 0
                                      ? "text-success"
                                      : line.delivered_quantity_pairs > 0
                                        ? "text-text-primary"
                                        : "text-text-muted",
                                  )}
                                >
                                  {sets(line.delivered_quantity_pairs)}
                                </span>
                                <span className="text-text-muted/50 font-normal">
                                  /
                                </span>
                                <span className="text-text-secondary font-medium">
                                  {sets(line.quantity_pairs)}
                                </span>
                              </div>
                              <div className="text-[11px]">
                                {lineRemaining(line) > 0 ? (
                                  <span className="text-error font-medium">
                                    {sets(lineRemaining(line))} left
                                  </span>
                                ) : (
                                  <span className="text-success text-[10px] font-medium">
                                    Done
                                  </span>
                                )}
                                {(line.lost_quantity_pairs ?? 0) > 0 &&
                                  !explanation && (
                                    <span className="text-warning text-[10px] ml-1">
                                      ({sets(line.lost_quantity_pairs ?? 0)}{" "}
                                      lost)
                                    </span>
                                  )}
                              </div>
                              {(line.allocated_quantity_pairs ?? 0) > 0 && (
                                <div
                                  className="text-[11px] text-brand font-medium"
                                  title={
                                    line.allocated_color_breakdown
                                      ? `Allocated: ${formatColorBreakdown(line.allocated_color_breakdown, line.unit, line.unit_conversions)}`
                                      : undefined
                                  }
                                >
                                  {sets(line.allocated_quantity_pairs ?? 0)}{" "}
                                  allocated
                                </div>
                              )}
                              {explanation && (
                                <span
                                  className="text-[10px] font-medium text-warning mt-0.5"
                                  title={mismatchDescription(explanation)}
                                >
                                  {mismatchDescription(explanation)}
                                </span>
                              )}
                            </div>
                          </Td>
                          <Td>
                            <div className="flex flex-col gap-1">
                              <CurrencySelect
                                label={`Currency for product ${index + 1}`}
                                value={
                                  (line.currency_code as CurrencyCode) ||
                                  DEFAULT_CURRENCY
                                }
                                onChange={(code) => {
                                  if (code === DEFAULT_CURRENCY) {
                                    setLine(index, {
                                      currency_code: DEFAULT_CURRENCY,
                                      original_selling_price: null,
                                      exchange_rate: null,
                                    });
                                    return;
                                  }
                                  const original =
                                    line.original_selling_price ?? 0;
                                  const prefillRate =
                                    line.exchange_rate ??
                                    (settings?.today_exchange_rates[code]
                                      ? Number(
                                          settings.today_exchange_rates[code],
                                        )
                                      : null);
                                  setLine(index, {
                                    currency_code: code,
                                    original_selling_price: original,
                                    exchange_rate: prefillRate,
                                    selling_price:
                                      prefillRate != null
                                        ? previewKyatAmount(
                                            original,
                                            prefillRate,
                                          )
                                        : line.selling_price,
                                  });
                                }}
                                className="w-full"
                              />
                              {line.currency_code &&
                              isForeignCurrency(line.currency_code) ? (
                                <>
                                  <CellInput
                                    label={`Original price for product ${index + 1}`}
                                    placeholder="Original price"
                                    className="text-right"
                                    value={String(
                                      line.original_selling_price ?? "",
                                    )}
                                    onChange={(next) => {
                                      const original = Number(next) || 0;
                                      const rate = line.exchange_rate ?? 0;
                                      setLine(index, {
                                        original_selling_price: original,
                                        selling_price: previewKyatAmount(
                                          original,
                                          rate,
                                        ),
                                      });
                                    }}
                                  />
                                  <CellInput
                                    label={`Exchange rate for product ${index + 1}`}
                                    placeholder="Exchange rate"
                                    className="text-right"
                                    value={String(line.exchange_rate ?? "")}
                                    onChange={(next) => {
                                      const rate = Number(next) || 0;
                                      const original =
                                        line.original_selling_price ?? 0;
                                      setLine(index, {
                                        exchange_rate: rate,
                                        selling_price: previewKyatAmount(
                                          original,
                                          rate,
                                        ),
                                      });
                                    }}
                                  />
                                  <span className="text-right text-[10px] text-text-muted tabular-nums">
                                    = {formatKyat(line.selling_price)}
                                  </span>
                                </>
                              ) : (
                                <Controller
                                  control={control}
                                  name={`order.lines.${index}.selling_price`}
                                  render={({ field: priceField }) => (
                                    <CellInput
                                      label={`Selling price for product ${index + 1}`}
                                      placeholder="0"
                                      numeric
                                      className="text-right"
                                      value={String(priceField.value)}
                                      onChange={(next) => {
                                        priceField.onChange(Number(next) || 0);
                                        setLine(index, {
                                          selling_price: Number(next) || 0,
                                        });
                                      }}
                                      error={
                                        errors.order?.lines?.[index]
                                          ?.selling_price?.message
                                      }
                                    />
                                  )}
                                />
                              )}
                            </div>
                          </Td>
                          <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                            {formatKyat(
                              pricedAmount(
                                line.quantity_pairs,
                                line.unit,
                                line.selling_price,
                                line.unit_conversions,
                              ),
                            )}
                          </Td>
                          {/* The row's two icon actions sit together rather than one of them
                            leaning on the money: a figure column reads as a figure. */}
                          <Td className="text-center">
                            <div className="flex flex-col items-center gap-1">
                              <MismatchIconButton
                                explained={Boolean(explanation)}
                                disabled={lineRemaining(line) <= 0}
                                onClick={() => setWriteOffLine(line)}
                              />
                              {(() => {
                                const locked = lineLockedReason(line);
                                if (locked) {
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => showToast("info", locked)}
                                      title={locked}
                                      aria-label={`Cannot remove product ${index + 1}. ${locked}`}
                                      className="p-1 rounded-md text-text-disabled transition-colors hover:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                    >
                                      <TrashIcon className="w-4 h-4" />
                                    </button>
                                  );
                                }
                                if (confirmingRemoval === line.order_line_id) {
                                  return (
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => removeLine(index)}
                                        className="rounded-md bg-error px-1.5 py-0.5 text-[10px] font-semibold text-white"
                                      >
                                        Remove
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmingRemoval(null)
                                        }
                                        className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
                                      >
                                        Keep
                                      </button>
                                    </div>
                                  );
                                }
                                return (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmingRemoval(line.order_line_id)
                                    }
                                    title="Remove this product"
                                    aria-label={`Remove product ${index + 1}`}
                                    className={cn(
                                      "p-1 rounded-md transition-colors duration-150",
                                      SOFT_RED,
                                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error",
                                    )}
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                  </button>
                                );
                              })()}
                            </div>
                          </Td>
                        </Tr>
                      );
                    })}
                    <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                      <Td className="font-semibold" colSpan={3}>
                        Total
                      </Td>
                      <Td className="text-right tabular-nums whitespace-nowrap">
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center gap-1.5 font-mono font-semibold">
                            <span
                              className={
                                order.delivered_quantity_pairs ===
                                  order.total_quantity_pairs &&
                                order.total_quantity_pairs > 0
                                  ? "text-success"
                                  : "text-text-primary"
                              }
                            >
                              {sets(order.delivered_quantity_pairs)}
                            </span>
                            <span className="text-text-muted/50 font-normal">
                              /
                            </span>
                            <span>{sets(order.total_quantity_pairs)}</span>
                          </div>
                          <div className="text-[11px] font-sans font-normal">
                            {remainingQty(order) > 0 ? (
                              <span className="text-error font-medium">
                                {sets(remainingQty(order))} left
                              </span>
                            ) : (
                              <span className="text-success font-medium">
                                Done
                              </span>
                            )}
                          </div>
                          {allocatedPairs > 0 && (
                            <div className="text-[11px] font-sans text-brand font-medium">
                              {sets(allocatedPairs)} allocated
                            </div>
                          )}
                        </div>
                      </Td>
                      <Td />
                      <Td className="text-right tabular-nums font-semibold text-brand">
                        {formatKyat(orderAmount(order))}
                      </Td>
                      <Td />
                    </Tr>
                  </Tbody>
                </TableContainer>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={addLine}>
                    <PlusIcon className="w-4 h-4 mr-1" />
                    Add product
                  </Button>
                  {addingLineId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={cancelAddLine}
                      className={cn(SOFT_RED)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </section>
            )}

            {activeTab === "payments" && (
              <section>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <SectionLabel>Payment Records</SectionLabel>
                    <p className="text-xs text-text-muted -mt-0.5">
                      Customer receipts, installments, and outstanding balance.
                    </p>
                  </div>
                  <div className="w-full sm:w-80 md:w-96">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-medium text-text-secondary">
                        Paid progress
                      </span>
                      <span className="tabular-nums font-mono font-semibold text-text-primary">
                        {formatKyat(paid)} / {formatKyat(amount)} ({paidShare}%)
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuenow={paidShare}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Paid so far"
                      className="h-2 rounded-full bg-bg-subtle border border-border overflow-hidden"
                    >
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                          paidShare === 100 ? "bg-success" : "bg-warning",
                        )}
                        style={{ width: String(paidShare) + "%" }}
                      />
                    </div>
                  </div>
                </div>
                <PaymentsTable
                  payments={order.payment.payments}
                  balance={balance}
                  who="customer"
                  onAdd={addPayment}
                  onUpdate={(payment) =>
                    setPayment(payment.payment_id, payment)
                  }
                  onRemove={removePayment}
                  readOnly={false}
                />
              </section>
            )}

            {activeTab === "allocate" && (
              <FulfillmentBody
                order={order}
                orders={orders}
                inventoryLines={inventoryLines}
                inventoryLoading={inventoryLoading}
                initialTab={initialFulfillSubTab}
                onSaveAllocation={onSaveAllocation}
                onSaveAllocationsComplete={onSaveAllocationsComplete}
                onSaveDelivery={onSaveDelivery}
              />
            )}
          </div>
        </div>
      </div>
      <WriteOffModal
        open={writeOffLine !== null}
        subject={
          writeOffLine
            ? `${order.order_no} · ${writeOffLine.stock_code}`
            : "this order line"
        }
        remaining={writeOffLine ? lineRemaining(writeOffLine) : 0}
        unit={writeOffLine?.unit ?? "pair"}
        onClose={() => setWriteOffLine(null)}
        onSubmit={(quantity, reason, note) =>
          onWriteOff(writeOffLine!.order_line_id, quantity, reason, note)
        }
      />
    </>
  );
}
