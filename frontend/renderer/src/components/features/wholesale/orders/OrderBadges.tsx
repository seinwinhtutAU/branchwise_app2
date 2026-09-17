import { cn } from "@renderer/lib/utils";
import { DotPill, FloatingLayer, MenuItem } from "@renderer/components/features/wholesale/ui";
import { useDismissableMenu } from "@renderer/components/features/wholesale/useDismissableMenu";
import {
  ClipboardIcon,
  CloseIcon,
  DollarIcon,
  MoreIcon,
  PencilIcon,
} from "@renderer/components/ui/icons";
import { type OrderStatus } from "@renderer/components/features/wholesale/customerOrders";
import { type PaymentStatus } from "@renderer/components/features/wholesale/shared";
import {
  formatOriginalAmount,
  formatRate,
  isForeignCurrency,
} from "@renderer/components/features/wholesale/currency";
import {
  PAYMENT_LABELS,
  PAYMENT_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
} from "./types";

/** A status the app does not recognise still has to say something. The server is the one
 *  that names these, so a version of it older or newer than this screen would otherwise
 *  paint a pill with a dot and no word in it — which tells the reader nothing at all and
 *  looks like a rendering fault rather than a mismatch. */
export function statusLabel(status: OrderStatus): string {
  const known = STATUS_LABELS[status];
  if (known) return known;
  const words = String(status).replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}

export function StatusBadge({ status }: { status: OrderStatus }): React.JSX.Element {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.waiting_for_stock;
  return <DotPill label={statusLabel(status)} className={style.bg} dotClassName={style.dot} />;
}

/** The original amount and exchange rate a line was priced at, shown under its Kyat
 *  figure only when the line was actually saved in a foreign currency — an MMK line
 *  (the default) shows nothing extra. */
export function CurrencyNote({
  currency_code,
  original_amount,
  exchange_rate,
}: {
  currency_code?: string;
  original_amount?: number | null;
  exchange_rate?: number | null;
}): React.JSX.Element | null {
  if (
    !currency_code ||
    !isForeignCurrency(currency_code) ||
    original_amount == null ||
    exchange_rate == null
  )
    return null;
  return (
    <span className="block text-[10px] font-normal text-text-muted whitespace-nowrap">
      {formatOriginalAmount(currency_code, original_amount)} ×{" "}
      {formatRate(exchange_rate)}
    </span>
  );
}

export function PaymentBadge({
  status,
}: {
  status: PaymentStatus;
}): React.JSX.Element {
  const style = PAYMENT_STYLES[status] ?? PAYMENT_STYLES.unpaid;
  return <DotPill label={PAYMENT_LABELS[status]} className={style.bg} dotClassName={style.dot} />;
}

/** The prototype's per-row three-dot menu, carrying only the actions that actually do
 *  something with no backend behind them. */
export function RowMenu({
  onOpen,
  onPay,
  onAllocate,
  onCancel,
}: {
  onOpen: () => void;
  onPay?: () => void;
  /** Reaching the allocation screen. It lives in the menu rather than beside Deliver
   *  because stock allocates itself on arrival now — coming here is the exception, and a
   *  second button next to the daily one would say otherwise. */
  onAllocate?: () => void;
  onCancel?: () => void;
}): React.JSX.Element {
  // Two presses, matching the delete menus on the other wholesale screens: cancelling
  // releases the order's stock and there is no undo behind it.
  const { open, setOpen, confirming: confirmingCancel, setConfirming: setConfirmingCancel, ref, toggle } =
    useDismissableMenu();

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="Order actions"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          "p-1.5 rounded-md text-text-muted",
          "transition-colors duration-150",
          "hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <MoreIcon className="w-4 h-4" />
      </button>
      {open && (
        <FloatingLayer
          anchorRef={ref}
          align="right"
          className="min-w-44 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in"
        >
          {/* A question with other choices still sitting above it is not really a
              question. While the cancel confirmation is up, it is the only thing in the
              menu — answer it or back out. */}
          {!confirmingCancel && (
            <>
              <MenuItem
                icon={<PencilIcon className="w-4 h-4" />}
                label="Open order"
                onClick={() => {
                  setOpen(false);
                  onOpen();
                }}
              />
              {onPay && (
                <MenuItem
                  icon={<DollarIcon className="w-4 h-4" />}
                  label="Pay order"
                  onClick={() => {
                    setOpen(false);
                    onPay();
                  }}
                />
              )}
              {onAllocate && (
                <MenuItem
                  icon={<ClipboardIcon className="w-4 h-4" />}
                  label="Allocate & deliver"
                  onClick={() => {
                    setOpen(false);
                    onAllocate();
                  }}
                />
              )}
            </>
          )}
          {onCancel &&
            (confirmingCancel ? (
              <>
                <p className="px-3.5 py-2 text-xs text-text-muted">
                  Cancel this order?
                </p>
                <MenuItem
                  icon={<CloseIcon className="w-4 h-4" />}
                  label="Cancel it"
                  danger
                  onClick={() => {
                    setOpen(false);
                    setConfirmingCancel(false);
                    onCancel();
                  }}
                />
                <MenuItem
                  label="Keep it"
                  onClick={() => setConfirmingCancel(false)}
                />
              </>
            ) : (
              <MenuItem
                icon={<CloseIcon className="w-4 h-4" />}
                label="Cancel order"
                danger
                onClick={() => setConfirmingCancel(true)}
              />
            ))}
        </FloatingLayer>
      )}
    </div>
  );
}
