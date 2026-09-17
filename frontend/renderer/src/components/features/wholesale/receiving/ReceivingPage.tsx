import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import type { AppSettings } from "@renderer/lib/appSettings";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { ReceivingIcon } from "@renderer/components/ui/icons";
import { type Receiving } from "@renderer/components/features/wholesale/receivings";
import {
  hydrateReceivings,
  hydrateShipments,
  saveReceivings,
  useWholesale,
} from "@renderer/components/features/wholesale/store";
import {
  RECEIVINGS_URL,
  SHIPMENTS_URL,
  WHOLESALE_STOCK_URL,
  WholesaleApiError,
  createReceiving as apiCreateReceiving,
  deleteReceiving as apiDeleteReceiving,
  receivingsFromWire,
  replaceReceivingCosts,
  shipmentsFromWire,
  updateReceiving as apiUpdateReceiving,
  updateReceivingPackage,
  type NewReceivingInput,
  stockRecordsFromWire,
  type ReceivingWire,
  type ShipmentWire,
  type StockRecordWire,
} from "@renderer/components/features/wholesale/api";
import { useHydrateMasterData } from "@renderer/components/features/wholesale/masterData";
import {
  RECEIVINGS_QUERY_KEY,
  SHIPMENTS_QUERY_KEY,
  STOCK_QUERY_KEY,
  nextReceivingNo,
  type View,
} from "./types";
import { ReceivingList } from "./ReceivingList";
import { ReceivingDetail } from "./ReceivingDetail";
import { NewReceivingForm } from "./NewReceivingForm";

export default function ReceivingGatePage({
  session,
  settings,
  initialReceivingNo,
  onInitialReceivingOpened,
  onOpenOrders,
}: {
  session: Session;
  settings: AppSettings | null;
  initialReceivingNo?: string | null;
  onInitialReceivingOpened?: () => void;
  /** Sends the user on to Customer Orders — receiving goods is only half the job; the
   *  stock still has to be shared out, and nothing else on this screen says so. */
  onOpenOrders?: () => void;
}): React.JSX.Element {
  const showToast = useToast();
  useHydrateMasterData(session);
  const queryClient = useQueryClient();
  const {
    data: wire,
    isFetching: isRefreshing,
    isError: failed,
  } = useQuery({
    queryKey: RECEIVINGS_QUERY_KEY,
    queryFn: () => fetchJson<ReceivingWire[]>(RECEIVINGS_URL, session),
  });
  useLoadErrorToast(failed, "receivings");
  const {
    data: shipmentWire,
    isFetching: shipmentsRefreshing,
    isError: shipmentsFailed,
  } = useQuery({
    queryKey: SHIPMENTS_QUERY_KEY,
    queryFn: () => fetchJson<ShipmentWire[]>(SHIPMENTS_URL, session),
  });
  useLoadErrorToast(shipmentsFailed, "shipments for receivings");
  // What the gate has already put on the shelf. Read here only to answer the question
  // this screen leaves hanging: the packages are counted, so what happens next?
  const { data: stockWire } = useQuery({
    queryKey: STOCK_QUERY_KEY,
    queryFn: () => fetchJson<StockRecordWire[]>(WHOLESALE_STOCK_URL, session),
  });
  const stockRecords = useMemo(
    () => (stockWire ? stockRecordsFromWire(stockWire) : []),
    [stockWire],
  );
  const readyToAllocatePairs = stockRecords.reduce(
    (sum, record) => sum + Math.max(0, record.available_pairs),
    0,
  );
  const owedToCustomersPairs = stockRecords.reduce(
    (sum, record) => sum + Math.max(0, record.owed_to_customers_pairs),
    0,
  );
  useEffect(() => {
    if (wire) hydrateReceivings(receivingsFromWire(wire));
  }, [wire]);
  useEffect(() => {
    if (shipmentWire) hydrateShipments(shipmentsFromWire(shipmentWire));
  }, [shipmentWire]);

  async function reload(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: RECEIVINGS_QUERY_KEY });
  }

  async function reloadShipments(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: SHIPMENTS_QUERY_KEY });
  }

  function refreshPage(): void {
    void reload();
    void reloadShipments();
  }

  const { receivings } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusSection, setFocusSection] = useState<
    "packages" | "costs" | undefined
  >(undefined);

  const selected =
    receivings.find((receiving) => receiving.receiving_id === selectedId) ??
    null;

  useEffect(() => {
    if (!initialReceivingNo) return;
    const target = receivings.find(
      (receiving) => receiving.receiving_no === initialReceivingNo,
    );
    if (!target) return;
    setSelectedId(target.receiving_id);
    setFocusSection(undefined);
    setView("detail");
    onInitialReceivingOpened?.();
  }, [initialReceivingNo, onInitialReceivingOpened, receivings]);

  function reportSaveFailure(error: unknown, fallback: string): void {
    showToast(
      "error",
      error instanceof WholesaleApiError ? error.message : fallback,
    );
  }

  async function persistReceiving(receiving: Receiving): Promise<void> {
    try {
      // Resize first because the server allocates new package IDs. Reattach the
      // locally staged contents by package number before saving each package.
      const header = await apiUpdateReceiving(session, receiving.receiving_id, {
        gate: receiving.gate,
        received_on: receiving.received_on,
        total_packages: receiving.total_packages,
        total_quantity_pairs: receiving.total_quantity_pairs,
        total_unit: receiving.total_unit,
      });
      const stagedByNumber = new Map(
        receiving.packages.map((entry) => [entry.package_no, entry]),
      );
      for (const serverPackage of header.packages) {
        const staged = stagedByNumber.get(serverPackage.package_no);
        if (staged) {
          await updateReceivingPackage(session, receiving.receiving_id, {
            ...staged,
            package_id: serverPackage.package_id,
          });
        }
      }
      await replaceReceivingCosts(
        session,
        receiving.receiving_id,
        receiving.costs,
      );
      await reload();
      showToast("success", "Receiving saved.");
    } catch (error) {
      reportSaveFailure(error, "Could not save the receiving.");
    }
  }

  function deleteReceiving(receivingId: string): void {
    apiDeleteReceiving(session, receivingId)
      .then(async () => {
        setSelectedId((current) => (current === receivingId ? null : current));
        setView("list");
        await reload();
      })
      .catch((error) =>
        reportSaveFailure(error, "Could not delete the receiving."),
      );
  }

  function addReceiving(input: NewReceivingInput): void {
    apiCreateReceiving(session, input)
      .then(async (created) => {
        saveReceivings((current) => [created, ...current]);
        setSelectedId(created.receiving_id);
        setFocusSection(undefined);
        setView("detail");
        await reload();
      })
      .catch((error) =>
        reportSaveFailure(error, "Could not create the receiving."),
      );
  }

  if (view === "new") {
    return (
      <NewReceivingForm
        nextReceivingNo={nextReceivingNo(receivings)}
        onCancel={() => setView("list")}
        onCreate={addReceiving}
      />
    );
  }

  if (view === "detail" && selected) {
    return (
      <ReceivingDetail
        receiving={selected}
        focus={focusSection}
        settings={settings}
        onBack={() => {
          setFocusSection(undefined);
          setView("list");
        }}
        onSave={persistReceiving}
        onDelete={() => deleteReceiving(selected.receiving_id)}
      />
    );
  }

  if (failed && receivings.length === 0) {
    return (
      <EmptyState
        icon={<ReceivingIcon />}
        title="Could not load receivings"
        description="Check the connection and try again."
        action={
          <Button onClick={reload} loading={isRefreshing}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <ReceivingList
      receivings={receivings}
      onOpen={(receivingId, focus) => {
        setSelectedId(receivingId);
        setFocusSection(focus);
        setView("detail");
      }}
      onDelete={deleteReceiving}
      onNew={() => setView("new")}
      onRefresh={refreshPage}
      refreshing={isRefreshing || shipmentsRefreshing}
      readyToAllocatePairs={readyToAllocatePairs}
      owedToCustomersPairs={owedToCustomersPairs}
      onOpenOrders={onOpenOrders}
    />
  );
}
