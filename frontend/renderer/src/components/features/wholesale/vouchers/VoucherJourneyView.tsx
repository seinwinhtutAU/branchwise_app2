import React, { useState } from "react";
import { CopyButton, JourneyCard, JourneyRow } from "@renderer/components/features/wholesale/ui";
import { DeliveryJourney } from "@renderer/components/features/wholesale/journey";
import { formatDate } from "@renderer/components/features/wholesale/shared";
import { useWholesale } from "@renderer/components/features/wholesale/store";
import { type SupplierVoucher } from "@renderer/components/features/wholesale/supplierVouchers";
import { sets } from "./types";
import { customersWaitingFor } from "./voucherOrderUtils";

export function WaitingList({
  stockCode,
  voucherQty,
}: {
  stockCode: string;
  voucherQty: number;
}): React.JSX.Element {
  const { orders } = useWholesale();
  const waiting = customersWaitingFor(stockCode, orders);
  const wanted = waiting.reduce((sum, entry) => sum + entry.qty, 0);
  const spare = voucherQty - wanted;

  if (waiting.length === 0) {
    return (
      <span className="text-xs text-text-muted">
        Nobody waiting — goes to stock
      </span>
    );
  }

  return (
    <div className="min-w-[12rem]">
      {waiting.map((entry) => (
        <div
          key={`${entry.orderNo}-${entry.customerName}`}
          className="border-b border-border/60 py-2 first:pt-0 last:border-0 last:pb-0"
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-text-primary">
              {entry.customerName}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-brand">
              {sets(entry.qty)}
            </span>
          </div>
          <div className="mt-0.5 inline-flex max-w-full items-center gap-0.5 text-xs text-text-muted">
            <span className="break-words">{entry.orderNo}</span>
            <CopyButton value={entry.orderNo} what="order no." />
          </div>
        </div>
      ))}
      {spare > 0 && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-bg-raised px-2 py-1.5 text-xs text-text-secondary">
          <span>Unallocated</span>
          <span className="font-semibold tabular-nums">{sets(spare)}</span>
        </div>
      )}
    </div>
  );
}

export function VoucherJourney({
  voucher,
}: {
  voucher: SupplierVoucher;
}): React.JSX.Element {
  const { shipments, receivings } = useWholesale();
  const [showJourney, setShowJourney] = useState(false);
  const shipment = shipments.find(
    (entry) => entry.voucher_no === voucher.voucher_no,
  );

  const taken = (
    <JourneyCard
      key="voucher"
      stage="supplier"
      title="Voucher taken"
      subtitle={formatDate(voucher.voucher_date)}
    >
      <JourneyRow label="Ordered" value={sets(voucher.total_quantity_pairs)} />
    </JourneyCard>
  );

  if (!shipment) {
    return (
      <div className="py-2 text-sm text-text-muted">
        Not shipped yet.
      </div>
    );
  }

  const arrived = shipment.final_received_packages;
  const total = shipment.total_packages;
  const destination = shipment.final_destination || "destination";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-text-primary">
          Shipment <span className="font-semibold">{shipment.shipment_no}</span> —{" "}
          <span className="tabular-nums font-medium">{arrived}</span> of{" "}
          <span className="tabular-nums font-medium">{total}</span> packages received at{" "}
          <span className="font-medium">{destination}</span>.
        </p>
        <button
          type="button"
          onClick={() => setShowJourney((v) => !v)}
          className="text-xs font-semibold text-brand hover:underline focus-visible:outline-none"
        >
          {showJourney ? "Hide journey" : "Show journey"}
        </button>
      </div>

      {showJourney && (
        <div className="pt-2">
          <DeliveryJourney
            shipment={shipment}
            receivings={receivings}
            before={[taken]}
            expectedPackages={voucher.total_packages}
            expectedQtyPairs={voucher.total_quantity_pairs}
          />
        </div>
      )}
    </div>
  );
}
