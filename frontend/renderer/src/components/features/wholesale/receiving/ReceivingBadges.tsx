import React from "react";
import { cn } from "@renderer/lib/utils";
import { FloatingLayer, MenuItem, StatusPill } from "@renderer/components/features/wholesale/ui";
import { useDismissableMenu } from "@renderer/components/features/wholesale/useDismissableMenu";
import { Switch } from "@renderer/components/ui/Switch";
import {
  CheckIcon,
  DollarIcon,
  EyeIcon,
  MoreVerticalIcon,
  TrashIcon,
  TruckIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import { type ReceivingStatus } from "@renderer/components/features/wholesale/receivings";
import { formatIn, type Unit } from "@renderer/components/features/wholesale/units";
import { formatQty } from "@renderer/components/features/wholesale/shared";
import { STATUS_LABELS, STATUS_STYLES } from "./types";

export function StatusBadge({
  status,
}: {
  status: ReceivingStatus;
}): React.JSX.Element {
  return <StatusPill label={STATUS_LABELS[status]} className={STATUS_STYLES[status]} />;
}

export function OpenedToggle({
  opened,
  onToggle,
  disabled = false,
}: {
  opened: boolean;
  onToggle: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <Switch
      checked={opened}
      onChange={onToggle}
      disabled={disabled}
      label={opened ? "Opened" : "Not opened"}
      size="sm"
    />
  );
}

export function CountCheck({
  counted,
  expected,
  opened,
  total,
  expectedPackages,
  unit,
}: {
  counted: number;
  expected: number;
  opened: number;
  /** Packages added so far. */
  total: number;
  /** Packages on the shipment, when known. */
  expectedPackages: number | undefined;
  unit: Unit;
}): React.JSX.Element {
  const difference = counted - expected;
  // Packages the shipment says went out that this receiving has no record of at all.
  // Every package added so far being open still doesn't make the count final while
  // some of them have not turned up yet.
  const packagesMissing =
    expectedPackages === undefined ? 0 : Math.max(0, expectedPackages - total);
  const allOpened = opened === total && total > 0 && packagesMissing === 0;

  if (allOpened) {
    if (difference === 0) {
      return (
        <div className="flex items-center gap-2 bg-success-subtle px-5 py-2.5 text-sm text-success">
          <CheckIcon className="w-4 h-4 shrink-0" />
          <span>
            All {formatQty(total)} packages received, and the{" "}
            {formatIn(counted, unit)} match the voucher.
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-start gap-2 bg-error-subtle px-5 py-2.5 text-sm text-error">
        <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          <strong className="font-semibold">
            {difference < 0
              ? `${formatIn(-difference, unit)} short.`
              : `${formatIn(difference, unit)} too many.`}
          </strong>{" "}
          The voucher says {formatIn(expected, unit)} are coming and{" "}
          {formatIn(counted, unit)} were received. Open the packages again
          before this goes into stock.
        </span>
      </div>
    );
  }

  // Packages still to come is said in every state, but how loudly depends on what it
  // means. One shipment's packages do not always travel together, so most of the time
  // this is simply a delivery still in progress and gets a plain, quiet note.
  if (packagesMissing > 0) {
    const one = packagesMissing === 1;
    const headline = `${formatQty(packagesMissing)} of the ${formatQty(
      expectedPackages ?? 0,
    )} packages sent ${one ? "is" : "are"} still to come.`;

    // The exception worth an amber warning: the voucher's entire quantity has already
    // been counted out of fewer packages than were sent. Goods cannot all be here
    // while a package is still on the road, so something was almost certainly
    // recorded twice.
    if (difference >= 0) {
      return (
        <div className="flex items-start gap-2 bg-warning-subtle px-5 py-2.5 text-sm text-warning">
          <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong className="font-semibold">{headline}</strong> Even so,
            everything the voucher lists has already been counted out of the{" "}
            {formatQty(total)} that did arrive. Check whether the same products
            were counted twice before completing receiving.
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-start gap-2 bg-bg-subtle px-5 py-2.5 text-sm text-text-secondary">
        <TruckIcon className="w-4 h-4 shrink-0 mt-0.5 text-text-muted" />
        <span>
          <strong className="font-semibold text-text-primary">
            {headline}
          </strong>{" "}
          Packages from one shipment do not always arrive together. Add{" "}
          {one ? "it" : "them"} when {one ? "it turns up" : "they turn up"}.
        </span>
      </div>
    );
  }

  // Every package sent is here, but some are still shut. Falling short on quantity now
  // is just the normal in-progress state — more could still be inside one nobody has
  // opened, so it says nothing. Already matching or exceeding the voucher's total this
  // early is not normal: it means everything the voucher named has been counted out of
  // too few packages, usually because the same products got logged twice.
  if (opened > 0 && difference >= 0) {
    const unopenedAdded = total - opened;
    const headline =
      difference > 0
        ? `Received ${formatIn(difference, unit)} more than the voucher.`
        : "Received quantity matches the voucher.";
    return (
      <div className="flex items-start gap-2 bg-warning-subtle px-5 py-2.5 text-sm text-warning">
        <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          <strong className="font-semibold">{headline}</strong>{" "}
          {formatQty(unopenedAdded)} of the packages{" "}
          {unopenedAdded === 1 ? "is" : "are"} still unopened. Check{" "}
          {unopenedAdded === 1 ? "it" : "them"} before completing receiving.
        </span>
      </div>
    );
  }

  return <></>;
}

export function ReceivingRowMenu({
  onOpen,
  onRecordCost,
  onCheckCount,
  onDelete,
  canDelete = true,
}: {
  onOpen: () => void;
  onRecordCost?: () => void;
  onCheckCount?: () => void;
  onDelete: () => void;
  canDelete?: boolean;
}): React.JSX.Element {
  const { open, setOpen, confirming, setConfirming, ref, toggle } = useDismissableMenu();

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="Receiving actions"
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
                Delete this receiving?
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
              {onCheckCount && (
                <MenuItem
                  icon={<CheckIcon className="w-4 h-4" />}
                  label="Check count"
                  onClick={() => {
                    setOpen(false);
                    onCheckCount();
                  }}
                />
              )}
              <MenuItem
                icon={<EyeIcon className="w-4 h-4" />}
                label="Open receiving"
                onClick={() => {
                  setOpen(false);
                  onOpen();
                }}
              />
              {onRecordCost && (
                <MenuItem
                  icon={<DollarIcon className="w-4 h-4" />}
                  label="Record cost"
                  onClick={() => {
                    setOpen(false);
                    onRecordCost();
                  }}
                />
              )}
              {canDelete && (
                <MenuItem
                  icon={<TrashIcon className="w-4 h-4" />}
                  label="Delete receiving"
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
