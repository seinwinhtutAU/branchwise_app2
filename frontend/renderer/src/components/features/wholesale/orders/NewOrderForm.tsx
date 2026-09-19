import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { cn } from "@renderer/lib/utils";
import { type AppSettings } from "@renderer/lib/appSettings";
import {
  CellInput,
  CurrencySelect,
  EDITABLE,
  GroupSelect,
  FloatingLayer,
  CopyButton,
  Panel,
  Required,
  ReviewFact,
  SOFT_BLUE,
  SOFT_RED,
  SectionLabel,
  StepBar,
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
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  type CustomerOrder,
  type CustomerOrderLine,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import {
  KNOWN_CUSTOMERS,
  STOCK_CODES,
  productOf,
} from "@renderer/components/features/wholesale/masterData/masterData";
import {
  DEFAULT_CURRENCY,
  isForeignCurrency,
  previewKyatAmount,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/shared/currency";
import {
  PAIRS_PER,
  formatIn,
  pricedAmount,
  unitName,
} from "@renderer/components/features/wholesale/shared/units";
import {
  colorQtyProblem,
  duplicateStockCodeProblem,
  formatDate,
  formatKyat,
  todayIso,
} from "@renderer/components/features/wholesale/shared/shared";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/shared/products";
import {
  EMPTY_LINE,
  STEPS,
  customerOrderFormSchema,
  draftPairs,
  sets,
  type CustomerOrderFormValues,
} from "./types";
import { CurrencyNote } from "./OrderBadges";

// A name field with our own suggestion list under it. The obvious choice — a native
// `<datalist>` — is drawn by the operating system, not the page, so it ignored the app's
// theme entirely and came up as a black OS menu. This is plain markup, so it follows the
// same tokens as every other dropdown, and it can show a name that is not on the list as
// a new customer rather than silently offering nothing.
export function CustomerPicker({
  value,
  onChange,
  onBlur,
  error,
}: {
  value: string;
  onChange: (name: string) => void;
  onBlur?: () => void;
  error?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const query = value.trim().toLowerCase();
  const matches = KNOWN_CUSTOMERS.filter((customer) =>
    query === "" ? true : customer.name.toLowerCase().includes(query),
  );

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  function choose(name: string): void {
    onChange(name);
    setOpen(false);
  }

  function handleKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => {
        if (matches.length === 0) return 0;
        return (current + step + matches.length) % matches.length;
      });
      return;
    }
    if (event.key === "Enter" && open && matches[highlight]) {
      event.preventDefault();
      choose(matches[highlight].name);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative" ref={ref}>
        <Input
          label={<Required>Customer name</Required>}
          className={EDITABLE}
          placeholder="Type a name, or pick one already known"
          value={value}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          error={error}
          onChange={(event) => {
            onChange(event.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={handleKey}
        />
        {open && (
          <FloatingLayer
            anchorRef={ref}
            matchAnchorWidth
            className="bg-bg-base border border-border rounded-md shadow-lg animate-fade-in"
          >
            <ul role="listbox" className="max-h-52 overflow-y-auto py-1">
              {matches.map((customer, index) => (
                <li key={customer.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(customer.name)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm transition-colors duration-150",
                      index === highlight
                        ? "bg-brand-subtle text-brand"
                        : "text-text-secondary hover:bg-bg-subtle hover:text-text-primary",
                    )}
                  >
                    {customer.name}
                  </button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="px-3 py-2 text-sm text-text-muted">
                  No customer by that name yet — carry on and a new one is
                  created.
                </li>
              )}
            </ul>
          </FloatingLayer>
        )}
      </div>
    </div>
  );
}

export function NewOrderForm({
  nextOrderNo: orderNo,
  settings,
  onCancel,
  onCreate,
}: {
  nextOrderNo: string;
  settings: AppSettings | null;
  onCancel: () => void;
  onCreate: (order: CustomerOrder) => void;
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
    formState: { errors, isDirty },
  } = useForm<CustomerOrderFormValues>({
    resolver: zodResolver(customerOrderFormSchema),
    defaultValues: {
      order_date: todayIso(),
      customer_name: "",
      customer_phone: "",
      customer_address: "",
      lines: [{ ...EMPTY_LINE }],
    },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "lines",
  });
  const values = useWatch({ control }) as CustomerOrderFormValues;
  const lines = values.lines;
  const { order_date: orderDate, customer_name: customerName } = values;
  const customerPhone = values.customer_phone;
  const customerAddress = values.customer_address;

  const filledLines = lines.filter((line) => line.stock_code.trim() !== "");
  const totalQty = filledLines.reduce((sum, line) => sum + draftPairs(line), 0);
  const totalAmount = filledLines.reduce(
    (sum, line) =>
      sum +
      pricedAmount(
        draftPairs(line),
        line.unit,
        Number(line.selling_price) || 0,
        line.unit_conversions,
      ),
    0,
  );
  // Picking a customer already known fills in their phone and address rather than making
  // staff retype them; a name nobody has used before simply creates a new customer.
  function pickCustomer(name: string): void {
    setValue("customer_name", name, {
      shouldDirty: true,
      shouldValidate: true,
    });
    const known = KNOWN_CUSTOMERS.find((entry) => entry.name === name);
    if (known) {
      setValue("customer_phone", known.phone, { shouldDirty: true });
      setValue("customer_address", known.address, { shouldDirty: true });
    }
  }

  // Typing a code we already sell fills the rest of the product in. Staff should not be
  // retyping "Men's leather sandal" every time A1001 is ordered, and a product written two
  // slightly different ways is a product that cannot be counted as one.
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

  function removeLine(index: number): void {
    if (fields.length === 1) {
      replace([{ ...EMPTY_LINE }]);
      return;
    }
    remove(index);
  }

  // Picking a currency for a draft line: MMK clears the foreign-currency fields back
  // to nothing; any other currency prefills the exchange rate from Settings' current
  // rate (only ever a prefill — the field stays editable) and, once both an original
  // price and a rate exist, keeps selling_price (the Kyat figure everything else on
  // this form reads) in step with their product.
  function setLineCurrency(index: number, code: CurrencyCode): void {
    setValue(`lines.${index}.currency_code`, code, {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (code === "MMK") {
      setValue(`lines.${index}.original_selling_price`, "", {
        shouldDirty: true,
      });
      setValue(`lines.${index}.exchange_rate`, "", { shouldDirty: true });
      return;
    }
    const current = lines[index];
    const rate =
      current?.exchange_rate || settings?.today_exchange_rates[code] || "";
    setValue(`lines.${index}.exchange_rate`, rate, { shouldDirty: true });
    recomputeForeignPrice(index, current?.original_selling_price ?? "", rate);
  }

  function recomputeForeignPrice(
    index: number,
    original: string,
    rate: string,
  ): void {
    const preview = previewKyatAmount(Number(original) || 0, Number(rate) || 0);
    setValue(`lines.${index}.selling_price`, String(preview), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  async function moveToProducts(): Promise<void> {
    const valid = await trigger([
      "order_date",
      "customer_name",
      "customer_phone",
      "customer_address",
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
        message: "Add a product with at least one color qty.",
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

  function submit(values: CustomerOrderFormValues): void {
    const now = Date.now();
    const orderLines: CustomerOrderLine[] = values.lines
      .filter((line) => line.stock_code.trim() !== "")
      .map((line, index) => ({
        order_line_id: `col-${now}-${index}`,
        stock_code: line.stock_code.trim(),
        description: line.description.trim(),
        product_group: line.product_group,
        supplier_name: line.supplier_name.trim() || "—",
        color_breakdown: line.color_breakdown.trim(),
        unit: line.unit,
        unit_conversions: line.unit_conversions,
        quantity_pairs: draftPairs(line),
        // Nothing has been given to the customer at the moment an order is written down.
        delivered_quantity_pairs: 0,
        selling_price: Number(line.selling_price) || 0,
        currency_code: line.currency_code,
        original_selling_price: isForeignCurrency(line.currency_code)
          ? Number(line.original_selling_price) || 0
          : null,
        exchange_rate: isForeignCurrency(line.currency_code)
          ? Number(line.exchange_rate) || 0
          : null,
      }));
    onCreate({
      order_id: `co-${now}`,
      order_no: orderNo,
      customer_name: values.customer_name.trim(),
      customer_phone: values.customer_phone.trim(),
      customer_address: values.customer_address.trim(),
      order_date: values.order_date,
      total_quantity_pairs: orderLines.reduce(
        (sum, line) => sum + line.quantity_pairs,
        0,
      ),
      delivered_quantity_pairs: 0,
      order_status: "waiting_for_stock",
      // Nothing has been paid at the moment an order is written down, so the account
      // starts unpaid.
      payment: { account_id: `pa-${now}`, payments: [] },
      lines: orderLines,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          title={isDirty ? "This new order has unsaved changes." : undefined}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary rounded-md hover:bg-bg-subtle transition-colors border border-transparent hover:border-border"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
          <span>Back to orders</span>
        </button>
      </div>

      <Panel className="border-border shadow-sm">
        <div className="px-6 py-4 border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                  New customer order
                </h2>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-brand-subtle text-brand border border-brand/20 font-semibold">
                  {orderNo}
                </span>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                Draft a new wholesale sales order and specify color breakdowns.
              </p>
            </div>
          </div>
          <StepBar steps={STEPS} step={step} />
        </div>

        {step === 0 && (
          <div className="px-6 py-5 flex flex-col gap-4">
            <div>
              <SectionLabel>Step 1 — Customer Information</SectionLabel>
              <p className="text-xs text-text-muted -mt-0.5">
                Select or type a customer name. Contact details are
                automatically populated for recognized customers.
              </p>
            </div>
            <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-2">
              <Input
                label="Order date"
                type="date"
                className={EDITABLE}
                error={errors.order_date?.message}
                {...register("order_date")}
              />
              <Controller
                control={control}
                name="customer_name"
                render={({ field }) => (
                  <CustomerPicker
                    value={field.value}
                    onChange={pickCustomer}
                    onBlur={field.onBlur}
                    error={errors.customer_name?.message}
                  />
                )}
              />
              <Input
                label="Phone"
                className={EDITABLE}
                placeholder="09-…"
                error={errors.customer_phone?.message}
                {...register("customer_phone")}
              />
              <Input
                label="Address"
                className={EDITABLE}
                placeholder="Street, town"
                error={errors.customer_address?.message}
                {...register("customer_address")}
              />
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
                  One row per stock code. Specify colors with units (e.g.
                  black10s, pink2p) and prices.
                </p>
              </div>

              {/* Real-time Summary Badge Strip */}
              <div className="flex items-center gap-2.5 px-3 py-1.5 bg-bg-subtle rounded-lg border border-border text-xs">
                <span className="text-text-muted">
                  Items:{" "}
                  <strong className="font-mono text-text-primary">
                    {filledLines.length}
                  </strong>
                </span>
                <span className="text-border">|</span>
                <span className="text-text-muted">
                  Total Qty:{" "}
                  <strong className="font-mono text-brand font-semibold">
                    {sets(totalQty)}
                  </strong>
                </span>
                <span className="text-border">|</span>
                <span className="text-text-muted">
                  Total Amount:{" "}
                  <strong className="font-mono text-brand font-semibold">
                    {formatKyat(totalAmount)}
                  </strong>
                </span>
              </div>
            </div>

            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">#</Th>
                  <Th className="min-w-[18rem]">Product</Th>
                  <Th className="min-w-[13rem]">Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right min-w-[8rem]">
                    Selling price
                  </Th>
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
                    Number(line.selling_price) || 0,
                    line.unit_conversions,
                  );
                  return (
                    <Tr key={field.id}>
                      <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                        {index + 1}
                      </Td>
                      <Td className="min-w-[18rem]">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 flex-1 min-w-0">
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
                            <div className="w-28 shrink-0">
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
                        </div>
                      </Td>
                      <Td>
                        <Controller
                          control={control}
                          name={`lines.${index}.color_breakdown`}
                          render={({ field: colorField }) => (
                            <CellInput
                              label={`Colors for product ${index + 1}`}
                              placeholder="Enter color qty"
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
                            ? formatIn(
                                lineQty,
                                line.unit,
                                line.unit_conversions,
                              )
                            : "Every color needs a unit — s sets, p pairs, d dozens"}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                        {formatIn(lineQty, line.unit, line.unit_conversions)}
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-1">
                          <CurrencySelect
                            label={`Currency for product ${index + 1}`}
                            value={line.currency_code || DEFAULT_CURRENCY}
                            onChange={(code) => setLineCurrency(index, code)}
                            className="w-full"
                          />
                          {isForeignCurrency(line.currency_code) ? (
                            <>
                              <Controller
                                control={control}
                                name={`lines.${index}.original_selling_price`}
                                render={({ field: originalField }) => (
                                  <CellInput
                                    label={`Original price for product ${index + 1}`}
                                    placeholder="Original price"
                                    className="text-right"
                                    value={originalField.value}
                                    onChange={(next) => {
                                      const filtered = next.replace(
                                        /[^0-9.]/g,
                                        "",
                                      );
                                      originalField.onChange(filtered);
                                      recomputeForeignPrice(
                                        index,
                                        filtered,
                                        line.exchange_rate,
                                      );
                                    }}
                                    error={
                                      errors.lines?.[index]
                                        ?.original_selling_price?.message
                                    }
                                  />
                                )}
                              />
                              <Controller
                                control={control}
                                name={`lines.${index}.exchange_rate`}
                                render={({ field: rateField }) => (
                                  <CellInput
                                    label={`Exchange rate for product ${index + 1}`}
                                    placeholder="Exchange rate"
                                    className="text-right"
                                    value={rateField.value}
                                    onChange={(next) => {
                                      const filtered = next.replace(
                                        /[^0-9.]/g,
                                        "",
                                      );
                                      rateField.onChange(filtered);
                                      recomputeForeignPrice(
                                        index,
                                        line.original_selling_price,
                                        filtered,
                                      );
                                    }}
                                    error={
                                      errors.lines?.[index]?.exchange_rate
                                        ?.message
                                    }
                                  />
                                )}
                              />
                              <span className="text-right text-[10px] text-text-muted tabular-nums">
                                = {formatKyat(Number(line.selling_price) || 0)} per {unitName(line.unit, 1)}
                              </span>
                            </>
                          ) : (
                            <>
                              <Controller
                                control={control}
                                name={`lines.${index}.selling_price`}
                                render={({ field: priceField }) => (
                                  <CellInput
                                    label={`Selling price for product ${index + 1}`}
                                    placeholder="0"
                                    numeric
                                    className="text-right"
                                    value={priceField.value}
                                    onChange={priceField.onChange}
                                    error={
                                      errors.lines?.[index]?.selling_price
                                        ?.message
                                    }
                                  />
                                )}
                              />
                              <span className="text-right text-[10px] text-text-muted">
                                per {unitName(line.unit, 1)}
                              </span>
                            </>
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
              <Button variant="secondary" size="sm" onClick={() => setStep(0)}>
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                Back to customer
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
                Verify customer details and ordered quantities before generating
                the order record.
              </p>
            </div>
            <dl className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-bg-subtle border border-border rounded-lg p-3.5 text-xs">
              <ReviewFact label="Order no." value={orderNo} />
              <ReviewFact label="Order date" value={formatDate(orderDate)} />
              <ReviewFact label="Customer" value={customerName || "—"} />
              <ReviewFact label="Phone" value={customerPhone || "—"} />
              <ReviewFact
                label="Address"
                value={customerAddress || "—"}
                className="sm:col-span-2 lg:col-span-4"
              />
            </dl>
            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">#</Th>
                  <Th className="whitespace-nowrap">Supplier / Factory</Th>
                  <Th className="min-w-[18rem]">Product</Th>
                  <Th className="min-w-[13rem]">Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right min-w-[8rem]">
                    Selling price
                  </Th>
                  <Th className="text-right min-w-[8rem]">Amount</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filledLines.map((line, index) => {
                  const qty = draftPairs(line);
                  return (
                    <Tr key={index}>
                      <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                        {index + 1}
                      </Td>
                      <Td className="text-text-secondary">
                        {line.supplier_name || "—"}
                      </Td>
                      <Td className="min-w-[18rem]">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-brand break-words">
                              {line.stock_code || "—"}
                            </span>
                            {line.stock_code && (
                              <CopyButton
                                value={line.stock_code}
                                what="stock code"
                              />
                            )}
                            <span className="text-xs text-text-muted">
                              · {GROUP_LABELS[line.product_group]}
                            </span>
                          </div>
                          <span className="break-words text-text-primary text-sm">
                            {line.description || "—"}
                          </span>
                        </div>
                      </Td>
                      <Td className="font-mono text-xs text-text-secondary break-words">
                        {line.color_breakdown || "—"}
                      </Td>
                      <Td className="text-right tabular-nums">{sets(qty)}</Td>
                      <Td className="text-right tabular-nums">
                        <div>{formatKyat(Number(line.selling_price) || 0)}</div>
                        <div className="text-[10px] text-text-muted">
                          per {unitName(line.unit, 1)}
                        </div>
                        <CurrencyNote
                          currency_code={line.currency_code}
                          original_amount={
                            Number(line.original_selling_price) || 0
                          }
                          exchange_rate={Number(line.exchange_rate) || 0}
                        />
                      </Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatKyat(
                          pricedAmount(
                            qty,
                            line.unit,
                            Number(line.selling_price) || 0,
                            line.unit_conversions,
                          ),
                        )}
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
            <div className="flex items-center justify-between border-t border-border pt-4">
              <Button variant="secondary" size="sm" onClick={() => setStep(1)}>
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                Back to products
              </Button>
              <Button size="sm" onClick={handleSubmit(submit)}>
                <CheckIcon className="w-3.5 h-3.5 mr-1" />
                Confirm &amp; Create order
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
