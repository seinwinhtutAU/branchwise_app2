import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import type { AppSettings } from "@renderer/lib/appSettings";
import {
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import {
  type CustomerOrder,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import {
  hydrateVouchers,
  hydrateOrders,
  saveOrders,
  saveVouchers,
  useWholesale,
} from "@renderer/components/features/wholesale/shared/store";
import {
  CUSTOMER_ORDERS_URL,
  SUPPLIER_VOUCHERS_URL,
  WHOLESALE_WRITE_OFFS_URL,
  WholesaleApiError,
  addSupplierVoucherPayment,
  createSupplierVoucher,
  deleteSupplierVoucher,
  removeSupplierVoucherPayment,
  ordersFromWire,
  updateCustomerOrder,
  updateSupplierVoucher,
  writeOffSupplierVoucherLine,
  type WriteOffReason,
  type WriteOffWire,
  vouchersFromWire,
  type NewSupplierVoucherInput,
  type SupplierVoucherWire,
} from "@renderer/components/features/wholesale/shared/api";
import { useHydrateMasterData } from "@renderer/components/features/wholesale/masterData/masterData";
import {
  VOUCHERS_QUERY_KEY,
  ORDERS_QUERY_KEY,
  WRITE_OFFS_QUERY_KEY,
  nextVoucherNo,
  type View,
  type OpenOrderLine,
} from "./types";
import { supplierDemandGroups } from "./voucherOrderUtils";
import { VoucherList } from "./VoucherList";
import { ToOrderView } from "./ToOrderView";
import { VoucherDetail } from "./VoucherDetail";
import { NewVoucherForm } from "./NewVoucherForm";

export default function SupplierVouchersPage({
  session,
  settings,
  initialVoucherId,
  onInitialVoucherOpened,
}: {
  session: Session;
  settings: AppSettings | null;
  initialVoucherId?: string | null;
  onInitialVoucherOpened?: () => void;
}): React.JSX.Element {
  const showToast = useToast();
  useHydrateMasterData(session);
  const queryClient = useQueryClient();

  const {
    data: wire,
    isFetching: isRefreshing,
    isError,
  } = useQuery({
    queryKey: VOUCHERS_QUERY_KEY,
    queryFn: () =>
      fetchJson<SupplierVoucherWire[]>(SUPPLIER_VOUCHERS_URL, session),
  });
  useLoadErrorToast(isError, "supplier vouchers");

  const { data: writeOffs = [], isError: writeOffsFailed } = useQuery({
    queryKey: WRITE_OFFS_QUERY_KEY,
    queryFn: () => fetchJson<WriteOffWire[]>(WHOLESALE_WRITE_OFFS_URL, session),
  });
  useLoadErrorToast(writeOffsFailed, "mismatch explanations");

  useEffect(() => {
    if (wire) hydrateVouchers(vouchersFromWire(wire));
  }, [wire]);

  async function reload(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: VOUCHERS_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: WRITE_OFFS_QUERY_KEY });
  }

  const { data: orderWire, isError: ordersFailed } = useQuery({
    queryKey: ORDERS_QUERY_KEY,
    queryFn: () => fetchJson<CustomerOrder[]>(CUSTOMER_ORDERS_URL, session),
  });
  useLoadErrorToast(ordersFailed, "customer orders for supplier planning");

  async function reloadOrders(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
  }

  useEffect(() => {
    if (orderWire) hydrateOrders(ordersFromWire(orderWire));
  }, [orderWire]);

  const { vouchers, orders } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailFocus, setDetailFocus] = useState<"payment" | undefined>();
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newOrderLines, setNewOrderLines] = useState<
    OpenOrderLine[] | undefined
  >();

  const toOrderCount = useMemo(() => {
    return supplierDemandGroups(orders, vouchers).reduce(
      (sum, g) => sum + g.lines.length,
      0,
    );
  }, [orders, vouchers]);

  useEffect(() => {
    if (!initialVoucherId) return;
    const target = vouchers.find(
      (voucher) => voucher.voucher_id === initialVoucherId,
    );
    if (!target) return;
    setSelectedId(target.voucher_id);
    setDetailFocus(undefined);
    setView("detail");
    onInitialVoucherOpened?.();
  }, [initialVoucherId, onInitialVoucherOpened, vouchers]);

  const selected =
    vouchers.find((voucher) => voucher.voucher_id === selectedId) ?? null;

  function openVoucher(voucherId: string, focus?: "payment"): void {
    setSelectedId(voucherId);
    setDetailFocus(focus);
    setView("detail");
  }

  function openVoucherWithPay(voucherId: string): void {
    openVoucher(voucherId, "payment");
  }

  function deleteVoucher(voucherId: string): void {
    deleteSupplierVoucher(session, voucherId)
      .then(async () => {
        setSelectedId((current) => (current === voucherId ? null : current));
        setView("list");
        await reload();
      })
      .catch((error) =>
        showToast(
          "error",
          error instanceof WholesaleApiError
            ? error.message
            : "Could not delete the voucher.",
        ),
      );
  }

  async function persistVoucher(
    voucher: SupplierVoucher,
    originalVoucher: SupplierVoucher,
  ): Promise<void> {
    try {
      await updateSupplierVoucher(session, voucher.voucher_id, {
        supplier_name: voucher.supplier_name,
        voucher_date: voucher.voucher_date,
        carrier_name: voucher.carrier_name,
        total_packages: voucher.total_packages,
        lines: voucher.lines,
      });

      const originalPayments = originalVoucher.payment.payments;
      const currentPayments = voucher.payment.payments.filter(
        (payment) => payment.amount > 0,
      );
      const changed = (
        left: (typeof currentPayments)[number],
        right: (typeof currentPayments)[number],
      ): boolean =>
        left.paid_on !== right.paid_on ||
        left.amount !== right.amount ||
        left.note !== right.note;

      for (const payment of originalPayments) {
        const next = currentPayments.find(
          (candidate) => candidate.payment_id === payment.payment_id,
        );
        if (!next) {
          await removeSupplierVoucherPayment(
            session,
            voucher.voucher_id,
            payment.payment_id,
          );
        } else if (changed(payment, next)) {
          await removeSupplierVoucherPayment(
            session,
            voucher.voucher_id,
            payment.payment_id,
          );
          try {
            await addSupplierVoucherPayment(session, voucher.voucher_id, next);
          } catch (error) {
            await addSupplierVoucherPayment(
              session,
              voucher.voucher_id,
              payment,
            );
            throw error;
          }
        }
      }

      for (const payment of currentPayments) {
        const previous = originalPayments.find(
          (candidate) => candidate.payment_id === payment.payment_id,
        );
        if (!previous) {
          await addSupplierVoucherPayment(session, voucher.voucher_id, payment);
        }
      }

      await reload();
      showToast("success", "Voucher saved.");
    } catch (error) {
      showToast(
        "error",
        error instanceof WholesaleApiError
          ? error.message
          : "Could not save the voucher.",
      );
    }
  }

  async function writeOffVoucherLine(
    lineId: string,
    quantity: number,
    reason: WriteOffReason,
    note: string,
  ): Promise<void> {
    await writeOffSupplierVoucherLine(session, lineId, {
      quantity,
      reason,
      note,
    });
    await reload();
    showToast("success", "Write-off recorded.");
  }

  function addVoucher(input: NewSupplierVoucherInput): void {
    createSupplierVoucher(session, input)
      .then(async (voucher) => {
        saveVouchers((current) => [voucher, ...current]);
        setSelectedId(voucher.voucher_id);
        setDetailFocus(undefined);
        setView("detail");
        await reload();
      })
      .catch((error) =>
        showToast(
          "error",
          error instanceof WholesaleApiError
            ? error.message
            : "Could not create the voucher.",
        ),
      );
  }

  function startNewVoucher(
    supplierName = "",
    orderLines?: OpenOrderLine[],
  ): void {
    setNewSupplierName(supplierName);
    setNewOrderLines(orderLines);
    setView("new");
  }

  async function assignOrderLineSupplier(
    orderId: string,
    orderLineId: string,
    supplierName: string,
  ): Promise<void> {
    const order = orders.find((candidate) => candidate.order_id === orderId);
    const trimmedSupplier = supplierName.trim();
    if (!order || !trimmedSupplier) return;

    try {
      const updatedOrder = await updateCustomerOrder(session, orderId, {
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        customer_address: order.customer_address,
        order_date: order.order_date,
        lines: order.lines.map((line) =>
          line.order_line_id === orderLineId
            ? { ...line, supplier_name: trimmedSupplier }
            : line,
        ),
      });
      saveOrders((current) =>
        current.map((candidate) =>
          candidate.order_id === updatedOrder.order_id
            ? updatedOrder
            : candidate,
        ),
      );
      reloadOrders();
      showToast("success", "Factory assigned to product.");
    } catch (error) {
      showToast(
        "error",
        error instanceof WholesaleApiError
          ? error.message
          : "Could not assign the factory.",
      );
    }
  }

  if (view === "new") {
    return (
      <NewVoucherForm
        nextVoucherNo={nextVoucherNo(vouchers)}
        initialSupplierName={newSupplierName}
        initialOrderLines={newOrderLines}
        lockedSupplier={Boolean(newSupplierName)}
        settings={settings}
        onCancel={() => {
          setNewSupplierName("");
          setNewOrderLines(undefined);
          setView("list");
        }}
        onCreate={addVoucher}
      />
    );
  }

  if (view === "to_order") {
    return (
      <ToOrderView
        orders={orders}
        vouchers={vouchers}
        onOpenVouchers={() => setView("list")}
        onRefresh={reload}
        refreshing={isRefreshing}
        onCreateVoucher={(supplierName, orderLines) =>
          startNewVoucher(supplierName, orderLines)
        }
        onAssignSupplier={assignOrderLineSupplier}
      />
    );
  }

  if (view === "detail" && selected) {
    return (
      <VoucherDetail
        voucher={selected}
        focus={detailFocus}
        onSave={persistVoucher}
        onBack={() => setView("list")}
        onWriteOff={writeOffVoucherLine}
        writeOffs={writeOffs}
        settings={settings}
      />
    );
  }

  return (
    <VoucherList
      vouchers={vouchers}
      toOrderCount={toOrderCount}
      onOpen={openVoucher}
      onPay={openVoucherWithPay}
      onDelete={deleteVoucher}
      onNew={() => startNewVoucher()}
      onToOrder={() => setView("to_order")}
      onRefresh={reload}
      refreshing={isRefreshing}
    />
  );
}
