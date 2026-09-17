import { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { FloatingLayer, MenuItem, EDITABLE } from "@renderer/components/features/wholesale/shared/ui";
import {
  ArrowRightIcon,
  CheckIcon,
  EyeIcon,
  MoreVerticalIcon,
  PlusIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  formatQty,
  onlyDigits,
  mismatchDescription,
} from "@renderer/components/features/wholesale/shared/shared";
import { formatIn, type Unit } from "@renderer/components/features/wholesale/shared/units";
import { type WriteOffWire } from "@renderer/components/features/wholesale/shared/api";
import {
  type Shipment,
  type ShipmentStatus,
} from "@renderer/components/features/wholesale/delivery/shipments";
import { STATUS_LABELS, STATUS_STYLES } from "./types";

export function StatusBadge({
  status,
}: {
  status: ShipmentStatus;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap",
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** A row's own actions. Deleting asks a second time inside the menu, with FSM guards. */
export function RowMenu({
  shipment,
  onOpen,
  onDelete,
}: {
  shipment?: Shipment;
  onOpen: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const canDelete = shipment?.allowed_actions
    ? shipment.allowed_actions.includes("delete")
    : true;

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
        aria-label="Shipment actions"
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
        <FloatingLayer
          anchorRef={ref}
          align="right"
          className="min-w-48 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in"
        >
          {confirming ? (
            <>
              <p className="px-3.5 py-2 text-xs text-text-muted">
                Delete this shipment?
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
                label="View & edit"
                onClick={() => {
                  setOpen(false);
                  onOpen();
                }}
              />
              {canDelete ? (
                <MenuItem
                  icon={<TrashIcon className="w-4 h-4" />}
                  label="Delete shipment"
                  danger
                  onClick={() => setConfirming(true)}
                />
              ) : (
                <div
                  className="px-3.5 py-2 text-xs text-text-muted flex items-center gap-2 cursor-not-allowed opacity-60"
                  title="Cannot delete shipment with recorded arrival or when completed"
                >
                  <TrashIcon className="w-4 h-4 text-text-muted" />
                  <span>Cannot delete (locked)</span>
                </div>
              )}
            </>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}

export function ArrowHead({
  insertLabel,
  onInsert,
}: {
  insertLabel?: string;
  onInsert?: () => void;
} = {}): React.JSX.Element {
  if (!onInsert)
    return <th className="w-12 p-0 bg-bg-base border-0" aria-hidden />;
  return (
    <th className="w-12 p-0 bg-bg-base border-0 align-middle">
      <button
        type="button"
        aria-label={insertLabel}
        title={insertLabel}
        onClick={onInsert}
        className={cn(
          "mx-auto flex items-center justify-center w-7 h-7 rounded-full",
          "bg-brand-subtle border border-brand/40 text-brand",
          "transition-colors duration-150",
          "hover:bg-brand hover:border-brand hover:text-white",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        )}
      >
        <PlusIcon className="w-4 h-4" />
      </button>
    </th>
  );
}

export function ArrowCell({ body = false }: { body?: boolean }): React.JSX.Element {
  const inner = (
    <div className="flex items-center justify-center text-text-muted">
      <ArrowRightIcon className="w-4 h-4" />
    </div>
  );
  return body ? (
    <td className="w-12 p-0 bg-bg-base border-0">{inner}</td>
  ) : (
    <th className="w-12 p-0 bg-bg-base border-0" aria-hidden>
      {inner}
    </th>
  );
}

export function BigCount({
  value,
  unit,
}: {
  value: number;
  unit?: Unit;
}): React.JSX.Element {
  return (
    <span className="text-sm font-bold tabular-nums text-text-primary">
      {unit ? formatIn(value, unit) : formatQty(value)}
    </span>
  );
}

export function LeftOver({
  value,
  started,
  writtenOff = 0,
  explanation,
}: {
  value: number;
  started: boolean;
  writtenOff?: number;
  explanation?: WriteOffWire;
}): React.JSX.Element {
  const settled = started && value === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1 min-w-[3rem] rounded-md px-2 py-1.5 text-sm font-bold tabular-nums",
        !started
          ? "bg-bg-raised text-text-muted"
          : settled
            ? "bg-success-subtle text-success"
            : "bg-error-subtle text-error",
      )}
    >
      {formatQty(value)}
      {settled && <CheckIcon className="w-3.5 h-3.5" />}
      {writtenOff > 0 && !explanation && (
        <span
          className="text-[10px] font-medium text-warning"
          title={`${formatQty(writtenOff)} written off`}
        >
          · {formatQty(writtenOff)} written off
        </span>
      )}
      {explanation && (
        <span
          className="block max-w-[10rem] text-[10px] font-medium text-warning"
          title={mismatchDescription(explanation)}
        >
          · {mismatchDescription(explanation)}
        </span>
      )}
    </span>
  );
}

export function PackageInput({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={draft}
      onChange={(event) => {
        const digits = onlyDigits(event.target.value);
        setDraft(digits);
        if (digits === "") return;
        onChange(Math.min(Number(digits), max));
      }}
      onBlur={() => setDraft(String(value))}
      className={cn(
        "w-20 h-10 rounded-md border border-border text-center px-2 text-sm font-bold tabular-nums",
        "text-text-primary",
        EDITABLE,
        "transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent",
        "hover:border-border-strong",
      )}
    />
  );
}
