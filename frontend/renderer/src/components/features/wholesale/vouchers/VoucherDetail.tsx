import React, { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@renderer/lib/utils";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import {
  CheckIcon,
  ChevronLeftIcon,
  PlusIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  CellInput,
  CountField,
  CurrencySelect,
  EDITABLE,
  GroupSelect,
  MismatchIconButton,
  PaymentsTable,
  ReadOnlyField,
  SectionLabel,
  SOFT_RED,
  SuggestInput,
  CopyButton,
} from "@renderer/components/features/wholesale/shared/ui";
import type { AppSettings } from "@renderer/lib/appSettings";
import {
  DEFAULT_CURRENCY,
  formatOriginalAmount,
  formatRate,
  isForeignCurrency,
  previewKyatAmount,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/shared/currency";
import {
  formatKyat,
  colorQtyPairs,
  colorQtyProblem,
  duplicateStockCodeProblem,
  mismatchDescription,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  formatIn,
  PAIRS_PER,
  pricedAmount,
} from "@renderer/components/features/wholesale/shared/units";
import {
  paidPct,
  paymentStatus,
  receivedPct,
  receivingStatus,
  remainingQty,
  paidAmount,
  voucherAmount,
  voucherBalance,
  type SupplierVoucher,
  type SupplierVoucherLine,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import {
  CARGO_NAMES,
  STOCK_CODES,
  SUPPLIER_NAMES,
  productOf,
} from "@renderer/components/features/wholesale/masterData/masterData";
import { WriteOffModal } from "@renderer/components/features/wholesale/shared/WriteOffModal";
import { type WriteOffReason, type WriteOffWire } from "@renderer/components/features/wholesale/shared/api";
import {
  sets,
  lineReceivedQty,
  lineRemainingQty,
  supplierVoucherDetailSchema,
  type SupplierVoucherDetailFormValues,
} from "./types";
import { ReceivingBadge, PaymentBadge, InlineProgress } from "./VoucherBadges";
import { VoucherJourney, WaitingList } from "./VoucherJourneyView";

export function VoucherDetail({
  voucher: initialVoucher,
  focus,
  onSave,
  onBack,
  onWriteOff,
  writeOffs,
  settings,
}: {
  voucher: SupplierVoucher;
  focus?: "payment";
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
  const paymentSectionRef = useRef<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingLineId, setAddingLineId] = useState<string | null>(null);
  const [writeOffLine, setWriteOffLine] = useState<SupplierVoucherLine | null>(
    null,
  );
  const showToast = useToast();
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);

  function lineLockedReason(line: SupplierVoucherLine): string | null {
    if (lineReceivedQty(line) > 0) {
      return "Some of this has already arrived — sort the receiving out first.";
    }
    if ((line.lost_quantity_pairs ?? 0) > 0) {
      return "This line has a write-off against it.";
    }
    return null;
  }

  const [activeTab, setActiveTab] = useState<"voucher" | "payments">(
    focus === "payment" ? "payments" : "voucher",
  );

  useEffect(() => {
    if (focus === "payment") {
      setActiveTab("payments");
    }
  }, [focus]);

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
      reset({ voucher: values.voucher });
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
            unit: "set",
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
    setConfirmingRemoval(null);
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
        <div className="rounded-xl border border-border bg-bg-base overflow-hidden divide-y divide-border">
          <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="text-text-muted hover:text-text-primary gap-1.5"
                title="Back to vouchers"
              >
                <ChevronLeftIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </Button>

              <div className="h-5 w-px bg-border" />

              <div className="min-w-0 flex items-center gap-2.5">
                <div className="flex items-center gap-1">
                  <h2 className="text-base font-bold text-text-primary tracking-tight truncate font-mono">
                    {voucher.voucher_no}
                  </h2>
                  <CopyButton value={voucher.voucher_no} what="voucher no." />
                </div>
                <ReceivingBadge status={receivingStatus(voucher)} />
                <PaymentBadge status={paymentStatus(voucher)} />
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

          <div
            role="tablist"
            aria-label="Voucher sections"
            className="flex items-center gap-1 px-5 pt-2.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "voucher"}
              onClick={() => setActiveTab("voucher")}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-semibold transition-colors duration-150",
                activeTab === "voucher"
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:text-text-primary",
              )}
            >
              <span>Voucher</span>
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
                  activeTab === "voucher"
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
          </div>

          <div className="px-6 py-6 flex flex-col gap-8">
            {activeTab === "voucher" && (
              <>
                <section>
                  <SectionLabel>Voucher information</SectionLabel>
                  <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                </section>

                <section>
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <SectionLabel>Products</SectionLabel>
                    </div>
                    <div className="w-full sm:w-80 md:w-96">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-text-secondary font-medium">
                          Receiving progress
                        </span>
                        <span className="tabular-nums font-mono text-[11px] text-text-muted">
                          {sets(voucher.received_quantity_pairs)} / {sets(voucher.total_quantity_pairs)}
                          <span className="ml-1.5 text-text-secondary font-semibold">({pct}%)</span>
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Receiving progress"
                        className="h-2 rounded-full bg-bg-subtle border border-border overflow-hidden relative"
                      >
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
                        <Th className="min-w-[18rem]">Product</Th>
                        <Th className="min-w-[11rem]">Colors</Th>
                        <Th className="text-right whitespace-nowrap min-w-[12.5rem]">
                          Received / Ordered
                        </Th>
                        <Th className="text-right min-w-[7rem]">
                          Buying price
                          <span className="block text-[10px] font-normal text-text-muted">
                            per set
                          </span>
                        </Th>
                        <Th className="text-right">Amount</Th>
                        <Th>Customers</Th>
                        <Th className="text-center">Mismatch</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {lineFields.map((field, index) => {
                        const line = voucher.lines[index];
                        if (!line) return null;
                        const remainingLine = lineRemainingQty(line);
                        const explanation = writeOffs.find(
                          (entry) => entry.subject_id === line.voucher_line_id,
                        );
                        return (
                          <Tr key={field.id}>
                            <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                              {index + 1}
                            </Td>
                            <Td>
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-2">
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
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
                                  <div className="w-28 shrink-0">
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
                              <Td className="whitespace-nowrap text-right tabular-nums">
                                <div className="flex flex-col items-end gap-0.5">
                                  <div className="flex items-center gap-1.5 font-mono">
                                    <span
                                      className={cn(
                                        "font-semibold",
                                        remainingLine === 0 && line.quantity_pairs > 0
                                          ? "text-success"
                                          : lineReceivedQty(line) > 0
                                            ? "text-text-primary"
                                            : "text-text-muted",
                                      )}
                                    >
                                      {formatIn(
                                        lineReceivedQty(line),
                                        line.unit,
                                        line.unit_conversions,
                                      )}
                                    </span>
                                    <span className="text-text-muted/50 font-normal">/</span>
                                    <span className="text-text-secondary font-medium">
                                      {formatIn(
                                        line.quantity_pairs,
                                        line.unit,
                                        line.unit_conversions,
                                      )}
                                    </span>
                                  </div>
                                  <div className="text-[11px]">
                                    {remainingLine > 0 ? (
                                      <span className="text-error font-medium">
                                        {formatIn(
                                          remainingLine,
                                          line.unit,
                                          line.unit_conversions,
                                        )}{" "}
                                        left
                                      </span>
                                    ) : (
                                      <span className="text-success text-[10px] font-medium">
                                        Done
                                      </span>
                                    )}
                                    {(line.lost_quantity_pairs ?? 0) > 0 && !explanation && (
                                      <span className="text-warning text-[10px] ml-1">
                                        ({sets(line.lost_quantity_pairs ?? 0)} lost)
                                      </span>
                                    )}
                                    {explanation && (
                                      <span
                                        className="text-[10px] font-medium text-warning ml-1"
                                        title={mismatchDescription(explanation)}
                                      >
                                        ({mismatchDescription(explanation)})
                                      </span>
                                    )}
                                  </div>
                                </div>
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
                              </Td>
                              <Td>
                                <WaitingList
                                  stockCode={line.stock_code}
                                  voucherQty={line.quantity_pairs}
                                />
                              </Td>
                              <Td className="text-center">
                                <div className="flex flex-col items-center gap-1">
                                  <MismatchIconButton
                                    explained={Boolean(explanation)}
                                    disabled={remainingLine <= 0}
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
                                    if (confirmingRemoval === line.voucher_line_id) {
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
                                            onClick={() => setConfirmingRemoval(null)}
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
                                        onClick={() => setConfirmingRemoval(line.voucher_line_id)}
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
                          <Td className="font-semibold" colSpan={2}>
                            Total
                          </Td>
                          <Td className="text-right tabular-nums font-semibold whitespace-nowrap">
                            <div>
                              {sets(voucher.received_quantity_pairs)}
                              <span className="text-text-muted font-normal"> / </span>
                              <span className="text-text-secondary font-normal">
                                {sets(voucher.total_quantity_pairs)}
                              </span>
                            </div>
                            {remaining > 0 && (
                              <div className="text-[11px] font-medium text-error">
                                {sets(remaining)} to come
                              </div>
                            )}
                          </Td>
                          <Td />
                          <Td className="text-right tabular-nums font-semibold text-brand">
                            {formatKyat(amount)}
                          </Td>
                          <Td />
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
                  </section>

                  <section>
                    <SectionLabel>Shipment journey</SectionLabel>
                    <VoucherJourney voucher={voucher} />
                  </section>
                </>
              )}

              {activeTab === "payments" && (
                <section ref={paymentSectionRef}>
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
                  <PaymentsTable
                    payments={voucher.payment.payments}
                    balance={balance}
                    who="supplier"
                    onAdd={addPayment}
                    onUpdate={(payment) => setPayment(payment.payment_id, payment)}
                    onRemove={removePayment}
                    readOnly={false}
                  />
                </section>
              )}
            </div>
          </div>
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
