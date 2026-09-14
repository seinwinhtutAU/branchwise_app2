import { Fragment } from "react";
import {
  JourneyArrow,
  JourneyCard,
  JourneyRow,
} from "@renderer/components/features/wholesale/ui";
import {
  cargoRemaining,
  finalRemaining,
  legRemaining,
  maxForLeg,
  shipmentPairs,
  type Shipment,
} from "@renderer/components/features/wholesale/shipments";
import {
  countedPairs,
  openedCount,
  type Receiving,
} from "@renderer/components/features/wholesale/receivings";
import { formatQty } from "@renderer/components/features/wholesale/shared";
import { formatIn, type Unit } from "@renderer/components/features/wholesale/units";

// One journey, drawn once. A customer order, a supplier voucher and a shipment are three
// views of the same goods moving, so they show the same cards with the same figures — not
// three drawings of the same idea that drift apart. A voucher adds a card in front of it
// ("Voucher taken"), an order adds one at each end ("Order created", "Delivered to
// customer"), and Delivery shows it plain.

export function DeliveryJourney({
  shipment,
  receivings = [],
  before = [],
  after = [],
  includeGateCount = true,
  expectedPackages,
  expectedQtyPairs,
  expectedUnit,
}: {
  shipment: Shipment;
  /** So "Final received" can show what has actually been opened and counted, not just
   *  how many boxes reached the gate. Omit where that detail isn't available; the card
   *  falls back to packages arrived, as before. */
  receivings?: Receiving[];
  /** Cards to show before the goods leave the supplier. */
  before?: React.ReactNode[];
  /** Cards to show after they reach the gate. */
  after?: React.ReactNode[];
  /** Whether to show the receiving gate's package-count card. */
  includeGateCount?: boolean;
  /** Supplier voucher package target, when the journey is shown from a voucher. */
  expectedPackages?: number;
  /** Supplier voucher quantity target in pairs, when it is the source of truth. */
  expectedQtyPairs?: number;
  /** Unit used to present the expected quantity. */
  expectedUnit?: Unit;
}): React.JSX.Element {
  // A package the gate has logged is not the same as one anyone has opened and checked
  // against the voucher — see final_received_packages in ./store. This is the number
  // that actually says "we have counted what's in these boxes."
  const ours = receivings.filter(
    (receiving) => receiving.shipment_no === shipment.shipment_no,
  );
  const openedPackages = ours.reduce(
    (sum, receiving) => sum + openedCount(receiving),
    0,
  );
  const countedQty = ours.reduce(
    (sum, receiving) => sum + countedPairs(receiving),
    0,
  );
  const packagesToReceive = expectedPackages ?? shipment.total_packages;
  const quantityToReceive = expectedQtyPairs ?? shipmentPairs(shipment);
  const quantityUnit = expectedUnit ?? shipment.total_unit;
  const packagesComplete =
    packagesToReceive > 0 && openedPackages === packagesToReceive;
  const quantityMatches = countedQty === quantityToReceive;

  const cards: React.ReactNode[] = [
    ...before,
    <JourneyCard
      key="supplier"
      stage="supplier"
      title="Supplier"
      subtitle={shipment.supplier_name}
    >
      <JourneyRow label="Packages" value={formatQty(shipment.total_packages)} />
      <JourneyRow
        label="Quantity"
        value={formatIn(shipmentPairs(shipment), "set")}
      />
    </JourneyCard>,
    <JourneyCard
      key="cargo"
      stage="cargo"
      title="Cargo"
      subtitle={shipment.carrier_name}
      done={
        shipment.packages_sent_by_cargo > 0 && cargoRemaining(shipment) === 0
      }
      doneLabel="Everything sent on"
    >
      <JourneyRow
        label="Sent"
        value={formatQty(shipment.packages_sent_by_cargo)}
      />
      <JourneyRow
        label="Remaining"
        value={formatQty(cargoRemaining(shipment))}
        good={
          shipment.packages_sent_by_cargo > 0
            ? cargoRemaining(shipment) === 0
            : undefined
        }
      />
    </JourneyCard>,
    ...shipment.legs.map((leg, index) => {
      // A stop is only finished once everything sent to it has arrived and gone on
      // again — receiving and sending the same number says nothing about the packages
      // still on their way to it.
      const due = maxForLeg(shipment, index);
      const remaining = legRemaining(shipment, index);
      return (
        <JourneyCard
          key={leg.leg_id}
          stage="stop"
          title={leg.stop_name}
          subtitle={leg.carrier_name}
          done={due > 0 && remaining === 0}
          doneLabel="Everything sent on"
        >
          <JourneyRow
            label="Received"
            value={formatQty(leg.packages_received)}
          />
          <JourneyRow label="Sent" value={formatQty(leg.packages_sent)} />
          <JourneyRow
            label="Remaining"
            value={formatQty(remaining)}
            good={due > 0 ? remaining === 0 : undefined}
          />
        </JourneyCard>
      );
    }),
    <JourneyCard
      key="final"
      stage="final"
      title="Final received"
      subtitle={shipment.final_destination}
      done={
        shipment.final_received_packages > 0 && finalRemaining(shipment) === 0
      }
      doneLabel="Everything delivered"
    >
      <JourneyRow
        label="Received"
        value={formatQty(shipment.final_received_packages)}
      />
      <JourneyRow
        label="Remaining"
        value={formatQty(finalRemaining(shipment))}
        good={
          shipment.final_received_packages > 0
            ? finalRemaining(shipment) === 0
            : undefined
        }
      />
    </JourneyCard>,
    ...(includeGateCount
      ? [
          <JourneyCard
            key="counted"
            stage="final"
            title="Counted at the gate"
            subtitle={shipment.final_destination}
            done={packagesComplete && quantityMatches}
            doneLabel="Everything counted"
          >
            <JourneyRow
              label="Packages opened"
              value={`${formatQty(openedPackages)} / ${formatQty(packagesToReceive)}`}
              good={packagesComplete && quantityMatches}
            />
            <JourneyRow
              label="Quantity"
              value={`${formatIn(countedQty, quantityUnit)} / ${formatIn(quantityToReceive, quantityUnit)}`}
              good={quantityMatches}
            />
          </JourneyCard>,
        ]
      : []),
    ...after,
  ];

  return (
    <div className="flex items-stretch min-w-0 overflow-x-auto pb-2">
      {cards.map((card, index) => (
        <Fragment key={index}>
          {index > 0 && <JourneyArrow />}
          {card}
        </Fragment>
      ))}
    </div>
  );
}
