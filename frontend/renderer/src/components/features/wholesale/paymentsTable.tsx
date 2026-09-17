import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { cn } from "@renderer/lib/utils";
import { PlusIcon, TrashIcon } from "@renderer/components/ui/icons";
import { Button } from "@renderer/components/ui/Button";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  formatDate,
  formatKyat,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import { type Payment } from "@renderer/components/features/wholesale/customerOrders";
import { CellInput } from "./formFields";
import { SOFT_RED } from "./ui";

/** Editing an existing payment's amount. Keeps its own draft text so clearing the box to
 *  retype a number does not immediately snap back to the old amount — a plain input bound
 *  straight to `payment.amount` rejects (and un-shows) every keystroke that briefly leaves
 *  it empty or invalid, which made an existing payment feel impossible to edit in place. The
 *  committed amount (and so "Paid so far") only updates once the typed value is valid. */
function PaymentAmountCell({
  paid_on,
  value,
  balance,
  onChange,
  error,
}: {
  paid_on: string;
  value: number;
  balance: number;
  onChange: (amount: number) => void;
  error?: string;
}): React.JSX.Element {
  const [text, setText] = useState(String(value));
  const room = balance + value;

  // The committed amount can change from outside this box — another edit reverted, the
  // voucher/order reloaded after Save — so the draft still has to follow it.
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const typed = Number(text) || 0;
  const tooMuch = text.trim() !== "" && typed > room;

  function handleChange(next: string): void {
    setText(next);
    const amount = Number(next) || 0;
    if (amount > 0 && amount <= room) {
      onChange(amount);
    }
  }

  return (
    <CellInput
      label={`Amount for payment on ${formatDate(paid_on)}`}
      placeholder="0"
      numeric
      className="text-right"
      value={text}
      onChange={handleChange}
      error={tooMuch ? `Only ${formatKyat(room)} is available.` : error}
    />
  );
}

const paymentFormSchema = z.object({
  payments: z.array(
    z.object({
      payment_id: z.string(),
      paid_on: z.string().trim().min(1, "Choose a payment date."),
      amount: z
        .number()
        .finite("Enter a valid amount.")
        .min(0, "Amount cannot be negative."),
      note: z.string(),
    }),
  ),
});

interface PaymentsFormValues {
  payments: Payment[];
}

/** The money taken against one order or one voucher, and the box for writing down the
 *  next payment.
 *
 *  Payments are kept one by one rather than as a single "paid" figure, because that is how
 *  they happen: a deposit, then something on delivery, then the rest. A single figure
 *  somebody edits cannot answer "when did that money come in?", and two people adjusting
 *  it cannot both be right. Everything above it — paid so far, unpaid amount, the status
 *  pill — is the sum of this table.
 *
 *  Both screens use it, so a payment to a supplier is recorded exactly the way a payment
 *  from a customer is. */
export function PaymentsTable({
  payments,
  balance,
  /** "customer" or "supplier" — only used to say who the money is to or from. */
  who,
  onAdd,
  onUpdate,
  onRemove,
  readOnly = false,
}: {
  payments: Payment[];
  balance: number;
  who: string;
  onAdd: (payment: Payment) => void;
  onUpdate?: (payment: Payment) => void;
  onRemove: (paymentId: string) => void;
  readOnly?: boolean;
}): React.JSX.Element {
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<PaymentsFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: { payments },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "payments",
  });
  const formPayments = useWatch({ control, name: "payments" }) as Payment[];
  // A new row joins the table the moment "Add payment" is pressed — the same way a new
  // product line does — rather than living in a separate draft form the amount has to
  // clear a "save" gate to leave. addingId just remembers which row that was, so a
  // "Cancel" can take back an add nobody meant to make.
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (readOnly) setAddingId(null);
  }, [readOnly]);

  // Detail pages own the staged order/voucher draft. Reflect their updates here, while
  // RHF owns the inputs between edits and supplies field-level validation.
  useEffect(() => {
    reset({ payments });
  }, [payments, reset]);

  function addPayment(): void {
    const id = `pay-${Date.now()}`;
    setAddingId(id);
    const payment = {
      payment_id: id,
      paid_on: todayIso(),
      amount: 0,
      note: "",
    };
    append(payment);
    onAdd(payment);
  }

  function cancelAdd(): void {
    if (!addingId) return;
    const index = formPayments.findIndex(
      (payment) => payment.payment_id === addingId,
    );
    if (index >= 0) remove(index);
    onRemove(addingId);
    setAddingId(null);
  }

  function removePayment(index: number, paymentId: string): void {
    remove(index);
    onRemove(paymentId);
    if (paymentId === addingId) setAddingId(null);
  }

  function commitPayment(index: number, payment: Payment): void {
    setValue(`payments.${index}`, payment, {
      shouldDirty: true,
      shouldValidate: true,
    });
    void handleSubmit(() => onUpdate?.(payment))();
  }

  return (
    <div className="flex flex-col gap-3">
      <TableContainer>
        <Thead className="top-0">
          <Tr>
            <Th className="w-40">Date</Th>
            <Th className="text-right w-44">Amount</Th>
            <Th>Note</Th>
            {!readOnly && <Th className="w-10" aria-label="Remove payment" />}
          </Tr>
        </Thead>
        <Tbody>
          {formPayments.length === 0 && (
            <Tr>
              <Td
                colSpan={readOnly ? 3 : 4}
                className="text-text-muted text-sm"
              >
                Nothing paid yet.
              </Td>
            </Tr>
          )}
          {fields.map((field, index) => {
            const payment = formPayments[index];
            if (!payment) return null;
            return (
              <Tr key={field.id}>
                {onUpdate && !readOnly ? (
                  <Td>
                    <Controller
                      control={control}
                      name={`payments.${index}.paid_on`}
                      render={({ field: dateField }) => (
                        <CellInput
                          label={`Payment date for ${formatKyat(payment.amount)}`}
                          placeholder=""
                          type="date"
                          value={dateField.value}
                          onChange={(date) => {
                            dateField.onChange(date);
                            commitPayment(index, { ...payment, paid_on: date });
                          }}
                          error={errors.payments?.[index]?.paid_on?.message}
                        />
                      )}
                    />
                  </Td>
                ) : (
                  <Td className="whitespace-nowrap">
                    {formatDate(payment.paid_on)}
                  </Td>
                )}
                {onUpdate && !readOnly ? (
                  <Td>
                    <Controller
                      control={control}
                      name={`payments.${index}.amount`}
                      render={({ field: amountField }) => (
                        <PaymentAmountCell
                          paid_on={payment.paid_on}
                          value={amountField.value}
                          balance={balance}
                          onChange={(amount) => {
                            amountField.onChange(amount);
                            commitPayment(index, { ...payment, amount });
                          }}
                          error={errors.payments?.[index]?.amount?.message}
                        />
                      )}
                    />
                  </Td>
                ) : (
                  <Td className="text-right tabular-nums font-medium">
                    {formatKyat(payment.amount)}
                  </Td>
                )}
                {onUpdate && !readOnly ? (
                  <Td>
                    <Controller
                      control={control}
                      name={`payments.${index}.note`}
                      render={({ field: noteField }) => (
                        <CellInput
                          label={`Note for payment on ${formatDate(payment.paid_on)}`}
                          placeholder="Deposit, transfer, cash…"
                          value={noteField.value}
                          onChange={(note) => {
                            noteField.onChange(note);
                            commitPayment(index, { ...payment, note });
                          }}
                        />
                      )}
                    />
                  </Td>
                ) : (
                  <Td className="text-text-muted">{payment.note || "—"}</Td>
                )}
                {!readOnly && (
                  <Td className="text-center">
                    <button
                      type="button"
                      onClick={() => removePayment(index, payment.payment_id)}
                      title="Remove this payment"
                      aria-label={`Remove the payment of ${formatKyat(payment.amount)}`}
                      className={cn(
                        "p-1.5 rounded-md transition-colors duration-150",
                        SOFT_RED,
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error",
                      )}
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </Td>
                )}
              </Tr>
            );
          })}
          <Tr className="bg-bg-subtle hover:bg-bg-subtle">
            <Td className="font-semibold">Paid so far</Td>
            <Td className="text-right tabular-nums font-semibold text-success">
              {formatKyat(
                formPayments.reduce((sum, payment) => sum + payment.amount, 0),
              )}
            </Td>
            <Td colSpan={readOnly ? 1 : 2} className="text-text-muted">
              {balance > 0
                ? `${formatKyat(balance)} still unpaid`
                : balance < 0
                  ? `${formatKyat(-balance)} overpaid — reconcile this payment`
                  : "Nothing left to pay"}
            </Td>
          </Tr>
        </Tbody>
      </TableContainer>

      <div className="flex flex-wrap items-center gap-2">
        {!readOnly ? (
          <>
            <Button
              size="sm"
              title={
                isDirty
                  ? "Payment changes are pending Save changes."
                  : undefined
              }
              onClick={addPayment}
            >
              <PlusIcon className="w-4 h-4" />
              Add payment
            </Button>
            {addingId && (
              <Button
                variant="ghost"
                size="sm"
                className={SOFT_RED}
                onClick={cancelAdd}
              >
                Cancel
              </Button>
            )}
          </>
        ) : null}
        {balance <= 0 && formPayments.length > 0 && (
          <span className="text-xs text-text-muted">
            {balance < 0
              ? `This ${who} is overpaid by ${formatKyat(-balance)}.`
              : `This ${who} has paid in full.`}
          </span>
        )}
      </div>
    </div>
  );
}

