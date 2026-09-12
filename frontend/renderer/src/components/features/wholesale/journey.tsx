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
import { formatQty } from "@renderer/components/features/wholesale/shared";
import { formatIn } from "@renderer/components/features/wholesale/units";

// One journey, drawn once. A customer order, a supplier voucher and a shipment are three
// views of the same goods moving, so they show the same cards with the same figures — not
// three drawings of the same idea that drift apart. A voucher adds a card in front of it
// ("Voucher taken"), an order adds one at each end ("Order created", "Delivered to
// customer"), and Delivery shows it plain.

export function DeliveryJourney({
  shipment,
  before = [],
  after = [],
}: {
  shipment: Shipment;
  /** Cards to show before the goods leave the supplier. */
  before?: React.ReactNode[];
  /** Cards to show after they reach the gate. */
  after?: React.ReactNode[];
}): React.JSX.Element {
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
      subtitle={shipment.cargo_name}
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
      subtitle={shipment.final_location}
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
    ...after,
  ];

  return (
    <div className="flex items-stretch overflow-x-auto pb-2">
      {cards.map((card, index) => (
        <div key={index} className="flex items-stretch">
          {index > 0 && <JourneyArrow />}
          {card}
        </div>
      ))}
    </div>
  );
}
