import React from "react";
import { cn } from "@renderer/lib/utils";
import { DotPill, FloatingLayer, MenuItem } from "@renderer/components/features/wholesale/shared/ui";
import { useDismissableMenu } from "@renderer/components/features/wholesale/shared/useDismissableMenu";
import {
  DollarIcon,
  MoreVerticalIcon,
  PencilIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  type ReceivingStatus,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { type PaymentStatus } from "@renderer/components/features/wholesale/shared/shared";
import {
  RECEIVING_LABELS,
  RECEIVING_STYLES,
  PAYMENT_LABELS,
  PAYMENT_STYLES,
} from "./types";

export function ReceivingBadge({
  status,
}: {
  status: ReceivingStatus;
}): React.JSX.Element {
  const style = RECEIVING_STYLES[status] ?? RECEIVING_STYLES.waiting;
  return <DotPill label={RECEIVING_LABELS[status]} className={style.bg} dotClassName={style.dot} />;
}

export function PaymentBadge({
  status,
}: {
  status: PaymentStatus;
}): React.JSX.Element {
  const style = PAYMENT_STYLES[status] ?? PAYMENT_STYLES.unpaid;
  return <DotPill label={PAYMENT_LABELS[status]} className={style.bg} dotClassName={style.dot} />;
}

export function ThinBar({
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

export function InlineProgress({
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
    <div className="w-full min-w-0 sm:w-80 md:w-96">
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

export function RowMenu({
  onOpen,
  onPay,
  onDelete,
  canDelete = true,
}: {
  onOpen: () => void;
  onPay?: () => void;
  onDelete: () => void;
  canDelete?: boolean;
}): React.JSX.Element {
  const { open, setOpen, confirming, setConfirming, ref, toggle } = useDismissableMenu();

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="Voucher actions"
        aria-expanded={open}
        onClick={toggle}
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
                icon={<PencilIcon className="w-4 h-4" />}
                label="Open voucher"
                onClick={() => {
                  setOpen(false);
                  onOpen();
                }}
              />
              {onPay && (
                <MenuItem
                  icon={<DollarIcon className="w-4 h-4" />}
                  label="Pay voucher"
                  onClick={() => {
                    setOpen(false);
                    onPay();
                  }}
                />
              )}
              {canDelete && (
                <MenuItem
                  icon={<TrashIcon className="w-4 h-4" />}
                  label="Delete voucher"
                  danger
                  onClick={() => setConfirming(true)}
                />
              )}
            </>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}
