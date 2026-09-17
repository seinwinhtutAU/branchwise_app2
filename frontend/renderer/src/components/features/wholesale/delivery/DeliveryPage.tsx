import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { TruckIcon } from "@renderer/components/ui/icons";
import { type Shipment } from "@renderer/components/features/wholesale/delivery/shipments";
import { useHydrateMasterData } from "@renderer/components/features/wholesale/masterData/masterData";
import { hydrateShipments } from "@renderer/components/features/wholesale/shared/store";
import {
  SHIPMENTS_URL,
  WHOLESALE_WRITE_OFFS_URL,
  WholesaleApiError,
  createShipment as apiCreateShipment,
  deleteShipment as apiDeleteShipment,
  shipmentsFromWire,
  splitShipment as apiSplitShipment,
  updateShipment as apiUpdateShipment,
  writeOffShipment as apiWriteOffShipment,
  type WriteOffReason,
  type NewShipmentInput,
  type ShipmentWire,
  type WriteOffWire,
} from "@renderer/components/features/wholesale/shared/api";
import { SHIPMENTS_QUERY_KEY, type View } from "./types";
import { ShipmentList } from "./ShipmentList";
import { ShipmentDetail } from "./ShipmentDetail";
import { NewShipmentForm } from "./NewShipmentForm";

export default function DeliveryPage({
  session,
  initialShipmentId,
  onInitialShipmentOpened,
}: {
  session: Session;
  initialShipmentId?: string | null;
  onInitialShipmentOpened?: () => void;
}): React.JSX.Element {
  const showToast = useToast();
  useHydrateMasterData(session);
  const queryClient = useQueryClient();
  const {
    data: wire,
    isFetching: isRefreshing,
    isError: failed,
  } = useQuery({
    queryKey: SHIPMENTS_QUERY_KEY,
    queryFn: () => fetchJson<ShipmentWire[]>(SHIPMENTS_URL, session),
  });
  useLoadErrorToast(failed, "shipments");
  const { data: writeOffs = [], isError: writeOffsFailed } = useQuery({
    queryKey: ["wholesale", "write-offs"],
    queryFn: () => fetchJson<WriteOffWire[]>(WHOLESALE_WRITE_OFFS_URL, session),
  });
  useLoadErrorToast(writeOffsFailed, "mismatch explanations");

  async function reload(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: SHIPMENTS_QUERY_KEY });
    await queryClient.invalidateQueries({
      queryKey: ["wholesale", "write-offs"],
    });
  }

  const shipments = useMemo(
    () => (wire ? shipmentsFromWire(wire) : []),
    [wire],
  );

  useEffect(() => {
    if (wire) hydrateShipments(shipmentsFromWire(wire));
  }, [wire]);

  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusSection, setFocusSection] = useState<"tracking" | undefined>(undefined);

  useEffect(() => {
    if (!initialShipmentId) return;
    const target = shipments.find(
      (shipment) => shipment.shipment_id === initialShipmentId,
    );
    if (!target) return;
    setSelectedId(target.shipment_id);
    setView("detail");
    onInitialShipmentOpened?.();
  }, [initialShipmentId, onInitialShipmentOpened, shipments]);

  function reportSaveFailure(error: unknown, fallback: string): void {
    showToast(
      "error",
      error instanceof WholesaleApiError ? error.message : fallback,
    );
  }

  async function persistShipment(shipment: Shipment): Promise<void> {
    try {
      await apiUpdateShipment(session, shipment.shipment_id, shipment);
      await reload();
      showToast("success", "Shipment saved.");
    } catch (error) {
      reportSaveFailure(error, "Could not save the shipment.");
    }
  }

  async function writeOffShipment(
    shipmentId: string,
    legId: string | undefined,
    quantity: number,
    reason: WriteOffReason,
    note: string,
  ): Promise<void> {
    await apiWriteOffShipment(session, shipmentId, {
      quantity,
      reason,
      note,
      ...(legId ? { leg_id: legId } : {}),
    });
    await reload();
    showToast("success", "Write-off recorded.");
  }

  function deleteShipment(shipmentId: string): void {
    apiDeleteShipment(session, shipmentId)
      .then(async () => {
        setSelectedId((current) => (current === shipmentId ? null : current));
        setView("list");
        await reload();
      })
      .catch((error) =>
        reportSaveFailure(error, "Could not delete the shipment."),
      );
  }

  async function splitShipment(
    shipmentId: string,
    packages: number,
    quantityPairs: number | undefined,
    finalDestination: string,
    carrierName: string,
    splitLegOrder: number | undefined,
  ): Promise<void> {
    const { newShipment } = await apiSplitShipment(session, shipmentId, {
      packages,
      quantity_pairs: quantityPairs,
      final_destination: finalDestination,
      carrier_name: carrierName,
      split_leg_order: splitLegOrder,
    });
    await reload();
    showToast("success", `Split into ${newShipment.shipment_no}.`);
  }

  function addShipment(input: NewShipmentInput): void {
    apiCreateShipment(session, input)
      .then(async (created) => {
        setSelectedId(created.shipment_id);
        setView("detail");
        await reload();
      })
      .catch((error) =>
        reportSaveFailure(error, "Could not create the shipment."),
      );
  }

  const selected =
    shipments.find((shipment) => shipment.shipment_id === selectedId) ?? null;

  if (failed && shipments.length === 0) {
    return (
      <EmptyState
        icon={<TruckIcon />}
        title="Could not load shipments"
        description="Check the connection and try again."
        action={
          <Button onClick={reload} loading={isRefreshing}>
            Try again
          </Button>
        }
      />
    );
  }

  if (view === "new") {
    return (
      <NewShipmentForm
        onCancel={() => setView("list")}
        onCreate={addShipment}
      />
    );
  }

  if (view === "detail" && selected) {
    return (
      <ShipmentDetail
        key={selected.shipment_id}
        shipment={selected}
        allShipments={shipments}
        onOpenShipment={(shipmentId) => {
          setSelectedId(shipmentId);
          setView("detail");
        }}
        focus={focusSection}
        onBack={() => {
          setFocusSection(undefined);
          setView("list");
        }}
        onSave={persistShipment}
        onDelete={() => deleteShipment(selected.shipment_id)}
        onWriteOff={writeOffShipment}
        onSplit={(packages, quantity, finalDestination, carrierName, splitLegOrder) =>
          splitShipment(
            selected.shipment_id,
            packages,
            quantity,
            finalDestination,
            carrierName,
            splitLegOrder,
          )
        }
        writeOffs={writeOffs}
      />
    );
  }

  return (
    <ShipmentList
      shipments={shipments}
      onOpen={(shipmentId, focus) => {
        setSelectedId(shipmentId);
        setFocusSection(focus);
        setView("detail");
      }}
      onDelete={deleteShipment}
      onNew={() => setView("new")}
      onRefresh={reload}
      refreshing={isRefreshing}
    />
  );
}
