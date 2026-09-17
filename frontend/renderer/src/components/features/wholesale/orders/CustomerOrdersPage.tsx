import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { type AppSettings } from "@renderer/lib/appSettings";
import { type CustomerOrder } from "@renderer/components/features/wholesale/customerOrders";
import {
  hydrateOrders,
  saveOrders,
  useWholesale,
} from "@renderer/components/features/wholesale/store";
import {
  CUSTOMER_ORDERS_URL,
  WHOLESALE_INVENTORY_URL,
  WHOLESALE_WRITE_OFFS_URL,
  WholesaleApiError,
  addCustomerOrderPayment,
  cancelCustomerOrder,
  createCustomerDeliveryBatch,
  createCustomerOrder,
  inventoryMovementsFromWire,
  ordersFromWire,
  removeCustomerOrderPayment,
  updateCustomerOrder,
  updateCustomerOrderLineAllocation,
  writeOffCustomerOrderLine,
  type CustomerDeliveryBatchInput,
  type InventoryMovementWire,
  type NewCustomerOrderInput,
  type WriteOffReason,
  type WriteOffWire,
} from "@renderer/components/features/wholesale/api";
import {
  stockLines,
  type StockLine,
} from "@renderer/components/features/wholesale/stock";
import { useHydrateMasterData } from "@renderer/components/features/wholesale/masterData";
import {
  ORDERS_QUERY_KEY,
  STOCK_QUERY_KEY,
  nextOrderNo,
  type DetailTab,
  type View,
} from "./types";
import { OrderList } from "./OrderList";
import { OrderDetail } from "./OrderDetail";
import { NewOrderForm } from "./NewOrderForm";

export default function CustomerOrdersPage({
  session,
  settings,
  initialOrderId,
  onInitialOrderOpened,
}: {
  session: Session;
  settings: AppSettings | null;
  initialOrderId?: string | null;
  onInitialOrderOpened?: () => void;
}): React.JSX.Element {
  const showToast = useToast();
  useHydrateMasterData(session);
  const queryClient = useQueryClient();
  const {
    data: wire,
    isFetching: isRefreshing,
    isError,
  } = useQuery({
    queryKey: ORDERS_QUERY_KEY,
    queryFn: () => fetchJson<CustomerOrder[]>(CUSTOMER_ORDERS_URL, session),
  });
  useLoadErrorToast(isError, "customer orders");
  const { data: writeOffs = [], isError: writeOffsFailed } = useQuery({
    queryKey: ["wholesale", "write-offs"],
    queryFn: () => fetchJson<WriteOffWire[]>(WHOLESALE_WRITE_OFFS_URL, session),
  });
  useLoadErrorToast(writeOffsFailed, "mismatch explanations");
  const {
    data: inventoryWire,
    isFetching: isInventoryFetching,
    isError: inventoryFailed,
  } = useQuery({
    queryKey: ["wholesale", "inventory"],
    queryFn: () =>
      fetchJson<InventoryMovementWire[]>(WHOLESALE_INVENTORY_URL, session),
  });
  useLoadErrorToast(inventoryFailed, "wholesale inventory for allocations");
  const inventoryLines = useMemo<StockLine[]>(
    () =>
      inventoryWire
        ? stockLines(inventoryMovementsFromWire(inventoryWire))
        : [],
    [inventoryWire],
  );
  // The shared store still holds orders — other screens (Supplier Vouchers' waiting
  // list, Inventory) read them from there — so this query's answer, which React Query
  // already keeps correct on its own, is pushed in as-is rather than recomputed.
  useEffect(() => {
    if (wire) hydrateOrders(ordersFromWire(wire));
  }, [wire]);
  const { orders } = useWholesale();

  async function reload(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
    await queryClient.invalidateQueries({
      queryKey: ["wholesale", "write-offs"],
    });
    await queryClient.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
    await queryClient.invalidateQueries({
      queryKey: ["wholesale", "inventory"],
    });
  }

  async function saveAllocation(
    lineId: string,
    colorBreakdown: string,
  ): Promise<void> {
    await updateCustomerOrderLineAllocation(session, lineId, colorBreakdown);
  }

  async function finishAllocationSave(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: STOCK_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["wholesale", "inventory"] }),
    ]);
    showToast("success", "Customer allocation saved.");
  }

  async function saveDelivery(
    input: CustomerDeliveryBatchInput,
  ): Promise<void> {
    try {
      await createCustomerDeliveryBatch(session, input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STOCK_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["wholesale", "inventory"] }),
      ]);
      showToast("success", "Customer delivery recorded.");
    } catch (error) {
      showToast(
        "error",
        error instanceof WholesaleApiError
          ? error.message
          : "Could not record this customer delivery.",
      );
      throw error;
    }
  }

  async function writeOffOrderLine(
    lineId: string,
    quantity: number,
    reason: WriteOffReason,
    note: string,
  ): Promise<void> {
    await writeOffCustomerOrderLine(session, lineId, {
      quantity,
      reason,
      note,
    });
    await reload();
    showToast("success", "Write-off recorded.");
  }

  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("products");
  const [fulfillSubTab, setFulfillSubTab] = useState<"allocate" | "deliver">(
    "allocate",
  );

  const selected =
    orders.find((order) => order.order_id === selectedId) ?? null;

  useEffect(() => {
    if (!initialOrderId) return;
    const target = orders.find((order) => order.order_id === initialOrderId);
    if (!target) return;
    setSelectedId(target.order_id);
    setDetailTab("products");
    setView("detail");
    onInitialOrderOpened?.();
  }, [initialOrderId, onInitialOrderOpened, orders]);

  function openOrder(orderId: string, focus?: "payment"): void {
    setSelectedId(orderId);
    setDetailTab(focus === "payment" ? "payments" : "products");
    setView("detail");
  }

  function openOrderWithPay(orderId: string): void {
    openOrder(orderId, "payment");
  }

  function openAllocation(
    orderId: string,
    tab: "allocate" | "deliver" = "allocate",
  ): void {
    setSelectedId(orderId);
    setDetailTab("allocate");
    setFulfillSubTab(tab);
    setView("detail");
  }

  function cancelOrder(orderId: string): void {
    cancelCustomerOrder(session, orderId)
      .then(reload)
      .catch((error) =>
        showToast(
          "error",
          error instanceof WholesaleApiError
            ? error.message
            : "Could not cancel the order.",
        ),
      );
  }

  async function persistOrder(
    order: CustomerOrder,
    originalOrder: CustomerOrder,
  ): Promise<void> {
    try {
      await updateCustomerOrder(session, order.order_id, {
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        customer_address: order.customer_address,
        order_date: order.order_date,
        lines: order.lines,
      });

      const originalPayments = originalOrder.payment.payments;
      // A payment added but left at its default of 0 (the row exists but nobody has
      // typed an amount into it yet) is not a real payment — drop it rather than send
      // it to a server that rejects anything not greater than zero. Zeroing an existing
      // payment's amount is treated the same way: as taking that payment back.
      const currentPayments = order.payment.payments.filter(
        (payment) => payment.amount > 0,
      );
      const changed = (
        left: (typeof currentPayments)[number],
        right: (typeof currentPayments)[number],
      ): boolean =>
        left.paid_on !== right.paid_on ||
        left.amount !== right.amount ||
        left.note !== right.note;

      // There is no update endpoint for a payment, so an edit removes the old row and
      // adds the new one (removing first keeps the balance check, which sums every
      // existing payment, from double-counting the row being edited). If the add then
      // fails, put the original payment back rather than leaving it simply gone.
      for (const payment of originalPayments) {
        const next = currentPayments.find(
          (candidate) => candidate.payment_id === payment.payment_id,
        );
        if (!next) {
          await removeCustomerOrderPayment(
            session,
            order.order_id,
            payment.payment_id,
          );
        } else if (changed(payment, next)) {
          await removeCustomerOrderPayment(
            session,
            order.order_id,
            payment.payment_id,
          );
          try {
            await addCustomerOrderPayment(session, order.order_id, next);
          } catch (error) {
            await addCustomerOrderPayment(session, order.order_id, payment);
            throw error;
          }
        }
      }

      for (const payment of currentPayments) {
        const previous = originalPayments.find(
          (candidate) => candidate.payment_id === payment.payment_id,
        );
        if (!previous) {
          await addCustomerOrderPayment(session, order.order_id, payment);
        }
      }

      await reload();
      showToast("success", "Order saved.");
    } catch (error) {
      showToast(
        "error",
        error instanceof WholesaleApiError
          ? error.message
          : "Could not save the order.",
      );
    }
  }

  function addOrder(order: CustomerOrder): void {
    const input: NewCustomerOrderInput = {
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      customer_address: order.customer_address,
      order_date: order.order_date,
      lines: order.lines,
    };
    createCustomerOrder(session, input)
      .then(async (created) => {
        saveOrders((current) => [created, ...current]);
        setSelectedId(created.order_id);
        setView("detail");
        await reload();
      })
      .catch((error) =>
        showToast(
          "error",
          error instanceof WholesaleApiError
            ? error.message
            : "Could not create the order.",
        ),
      );
  }

  if (view === "new") {
    return (
      <NewOrderForm
        nextOrderNo={nextOrderNo(orders)}
        settings={settings}
        onCancel={() => setView("list")}
        onCreate={addOrder}
      />
    );
  }

  if (view === "detail" && selected) {
    return (
      <OrderDetail
        order={selected}
        orders={orders}
        settings={settings}
        initialTab={detailTab}
        initialFulfillSubTab={fulfillSubTab}
        inventoryLines={inventoryLines}
        inventoryLoading={isInventoryFetching}
        onSave={persistOrder}
        onBack={() => setView("list")}
        onSaveAllocation={saveAllocation}
        onSaveAllocationsComplete={finishAllocationSave}
        onSaveDelivery={saveDelivery}
        onWriteOff={writeOffOrderLine}
        writeOffs={writeOffs}
      />
    );
  }

  return (
    <OrderList
      orders={orders}
      inventoryLines={inventoryLines}
      onOpen={openOrder}
      onPay={openOrderWithPay}
      onAllocate={openAllocation}
      onCancel={cancelOrder}
      onNew={() => setView("new")}
      onRefresh={reload}
      refreshing={isRefreshing}
    />
  );
}
