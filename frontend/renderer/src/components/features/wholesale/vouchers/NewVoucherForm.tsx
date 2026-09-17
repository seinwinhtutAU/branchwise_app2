import React, { useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
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
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  CellInput,
  CurrencySelect,
  EDITABLE,
  GroupSelect,
  Panel,
  ProductCell,
  ReadOnlyField,
  Required,
  ReviewFact,
  SectionLabel,
  SOFT_BLUE,
  SOFT_RED,
  StepBar,
  SuggestInput,
  CopyButton,
  Reference,
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
import {
  colorQtyProblem,
  duplicateStockCodeProblem,
  formatDate,
  formatKyat,
  formatQty,
  onlyDigits,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  PAIRS_PER,
  pricedAmount,
} from "@renderer/components/features/wholesale/units";
import {
  CARGO_NAMES,
  STOCK_CODES,
  SUPPLIER_NAMES,
  productOf,
} from "@renderer/components/features/wholesale/masterData";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/products";
import { useWholesale } from "@renderer/components/features/wholesale/store";
import { type NewSupplierVoucherInput } from "@renderer/components/features/wholesale/api";
import {
  type SupplierVoucherLine,
} from "@renderer/components/features/wholesale/supplierVouchers";
import {
  sets,
  EMPTY_LINE,
  STEPS,
  supplierVoucherFormSchema,
  type DraftLine,
  type OpenOrderLine,
  type SupplierVoucherFormValues,
} from "./types";
import {
  draftPairs,
  openOrderLines,
  mergeColorQty,
  draftLinesFromOpenOrderLines,
} from "./voucherOrderUtils";

export function NewVoucherForm({
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
  lockedSupplier?: boolean;
  title?: string;
  backLabel?: string;
  settings: AppSettings | null;
  onCancel: () => void;
  onCreate: (input: NewSupplierVoucherInput) => void;
}): React.JSX.Element {
  const [step, setStep] = useState(() =>
    initialSupplierName && (initialOrderLines?.length ?? 0) > 0 ? 1 : 0,
  );
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
    (sum, line) =>
      sum +
      pricedAmount(
        draftPairs(line),
        line.unit,
        Number(line.buying_price) || 0,
        line.unit_conversions,
      ),
    0,
  );

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
      setValue(`lines.${index}.unit`, "set", {
        shouldDirty: true,
        shouldValidate: true,
      });
      setValue(
        `lines.${index}.unit_conversions`,
        known.default_unit_conversions ?? PAIRS_PER,
        {
          shouldDirty: true,
          shouldValidate: true,
        },
      );
    }
  }

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
          <div className="px-6 py-6 flex flex-col gap-6">
            <div>
              <SectionLabel>
                Step 1 —{" "}
                {lockedSupplier ? "voucher details" : "supplier & shipment"}
              </SectionLabel>
            </div>

            <div className="flex flex-col gap-5">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                  Now
                </h3>
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
                </div>
              </div>

              <div className="rounded-lg border border-border/80 bg-bg-subtle/50 p-4">
                <div className="mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    When it ships
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Leave blank if you don&apos;t know yet.
                  </p>
                </div>
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
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
              </div>
            </div>

            <div className="flex justify-end border-t border-border pt-4">
              <Button size="sm" onClick={() => void moveToProducts()}>
                Next: Products
                <ChevronRightIcon className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="px-6 py-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <SectionLabel>Step 2 — Products</SectionLabel>
                <p className="text-xs text-text-muted -mt-0.5">
                  One row per stock code. Specify colors with units (e.g. black10s, pink2p) and buying prices.
                </p>
              </div>

              <div className="flex items-center gap-2.5 px-3 py-1.5 bg-bg-subtle rounded-lg border border-border text-xs">
                <span className="text-text-muted">
                  Items: <strong className="font-mono text-text-primary">{filledLines.length}</strong>
                </span>
                <span className="text-border">|</span>
                <span className="text-text-muted">
                  Total Qty: <strong className="font-mono text-brand font-semibold">{sets(totalQty)}</strong>
                </span>
                <span className="text-border">|</span>
                <span className="text-text-muted">
                  Total Amount: <strong className="font-mono text-brand font-semibold">{formatKyat(totalAmount)}</strong>
                </span>
              </div>
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
                  <Th className="text-right min-w-[8rem]">Buying price<span className="block text-xs font-normal text-text-muted">per set</span></Th>
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
                size="sm"
                className={SOFT_BLUE}
                onClick={() => append({ ...EMPTY_LINE })}
              >
                <PlusIcon className="w-4 h-4 mr-1" />
                Add another product
              </Button>
            </div>

            <div className="flex items-center justify-between border-t border-border pt-4">
              <Button
                variant="secondary"
                size="sm"
                className={SOFT_BLUE}
                onClick={() => setStep(0)}
              >
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                Back to details
              </Button>
              <Button size="sm" onClick={() => void moveToReview()}>
                Next: Review
                <ChevronRightIcon className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="px-6 py-5 flex flex-col gap-4">
            <div>
              <SectionLabel>Step 3 — Review &amp; Confirm</SectionLabel>
              <p className="text-xs text-text-muted -mt-0.5">
                Verify voucher details and product quantities before generating the voucher record.
              </p>
            </div>
            <dl className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-bg-subtle border border-border rounded-lg p-3.5 text-xs">
              <ReviewFact label="Voucher no." value={voucherNo} />
              <ReviewFact label="Date" value={formatDate(voucherDate)} />
              <ReviewFact
                label="Supplier / Factory"
                value={supplierName || "—"}
              />
              <ReviewFact label="Cargo" value={cargoName || "—"} />
              <ReviewFact
                label="Packages"
                value={
                  packages
                    ? `${packages} ${Number(packages) === 1 ? "package" : "packages"}`
                    : "—"
                }
              />
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
                    <span className="block text-[10px] font-normal text-text-muted">
                      per set
                    </span>
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
            <div className="flex items-center justify-between border-t border-border pt-4">
              <Button
                variant="secondary"
                size="sm"
                className={SOFT_BLUE}
                onClick={() => setStep(1)}
              >
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                Back to products
              </Button>
              <Button size="sm" onClick={handleSubmit(submit)}>
                <CheckIcon className="w-3.5 h-3.5 mr-1" />
                Confirm &amp; Create voucher
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
