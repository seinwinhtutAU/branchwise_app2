// One set of books for the whole wholesale workspace.
//
// Each screen used to hold its own copy of the seed data, which meant the screens could
// not agree with each other: delivering goods to a customer on Inventory left the customer
// order still owing them, counting a package at the gate left the supplier voucher saying
// nothing had arrived, and walking to another screen and back threw the work away. Goods
// move through one business, not five, so the five screens read and write one state.
//
// The rules live here rather than in any screen, because they are what keeps the screens
// telling the same story. Every one of them is the same idea: a figure is worked out from
// the thing that actually happened, never typed in a second place.
//
//   • What a customer has received is what left the shelf for them. Correct the delivery
//     and the order corrects itself; there is nowhere else to adjust it.
//   • Counting a package at the gate is what a supplier voucher means by "received", and
//     the packages recorded at the gate are what the shipment means by "finally received".
//   • An order's status follows its goods: nothing delivered is still created, something
//     delivered is processing, everything delivered is completed. Cancelled is the one
//     status a person sets, and nothing overrides it.
//
// `settle` below is where all of that happens, and it runs after every change, so no
// screen has to remember to keep another screen honest.
//
// Front-end only for what has not moved to the backend yet: as of the Delivery screen
// (phase 1 of the wholesale backend rollout), shipments are read from Postgres and
// pushed in here by hydrateShipments — see wholesale/DeliveryPage.tsx and wholesale/api.ts.
// Everything else here still lives only until the window reloads, phase by phase.

import { useSyncExternalStore } from "react";
import {
  SEED_ORDERS,
  type CustomerOrder,
  type OrderStatus,
  type Payment,
} from "./customerOrders";
import { SEED_VOUCHERS, type SupplierVoucher } from "./supplierVouchers";
import { SEED_SHIPMENTS, type Shipment } from "./shipments";
import { SEED_RECEIVINGS, countedPairs, type Receiving } from "./receivings";
import { SEED_OUTGOING, type StockMovement } from "./stock";

export interface WholesaleState {
  orders: CustomerOrder[];
  vouchers: SupplierVoucher[];
  shipments: Shipment[];
  receivings: Receiving[];
  /** What has gone out to customers. What comes in is read off the receivings. */
  outgoing: StockMovement[];
}

let state: WholesaleState = settle({
  orders: SEED_ORDERS,
  vouchers: SEED_VOUCHERS,
  shipments: SEED_SHIPMENTS,
  receivings: SEED_RECEIVINGS,
  outgoing: SEED_OUTGOING,
});

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(patch: Partial<WholesaleState>): void {
  state = settle({ ...state, ...patch });
  for (const listener of listeners) listener();
}

export function useWholesale(): WholesaleState {
  return useSyncExternalStore(subscribe, () => state);
}

/** The books as they stand, for anything that is not a component. */
export function getState(): WholesaleState {
  return state;
}

type Update<T> = T[] | ((current: T[]) => T[]);

function resolve<T>(update: Update<T>, current: T[]): T[] {
  return typeof update === "function" ? update(current) : update;
}

export function saveOrders(update: Update<CustomerOrder>): void {
  set({ orders: resolve(update, state.orders) });
}

/** Replaces Customer Orders with rows read from the server. Inventory keeps using this
 * slice until its own API phase, so it immediately sees the same orders. */
export function hydrateOrders(orders: CustomerOrder[]): void {
  set({ orders });
}

export function saveVouchers(update: Update<SupplierVoucher>): void {
  set({ vouchers: resolve(update, state.vouchers) });
}

export function hydrateVouchers(vouchers: SupplierVoucher[]): void {
  set({ vouchers });
}

export function saveShipments(update: Update<Shipment>): void {
  set({ shipments: resolve(update, state.shipments) });
}

/** Pushes shipments fetched from the real backend into the shared store, so screens that
 *  have not moved off the store yet (Supplier Vouchers, Receiving) keep reading live data
 *  the moment Delivery has fetched it, without each of them having to fetch shipments a
 *  second time. Deleted once every screen reads shipments from the API directly. */
export function hydrateShipments(shipments: Shipment[]): void {
  set({ shipments });
}

export function saveReceivings(update: Update<Receiving>): void {
  set({ receivings: resolve(update, state.receivings) });
}

/** Replaces the Receiving slice with the server's authoritative rows. */
export function hydrateReceivings(receivings: Receiving[]): void {
  set({ receivings });
}

/** Hands goods to a customer: one movement off the shelf, and the customer's order
 *  follows from it. Nothing else records a delivery, so the two can never disagree. */
export function deliverToCustomer(movement: StockMovement): void {
  set({ outgoing: [...state.outgoing, movement] });
}

/** Corrects a delivery that was written down wrongly. The order it was made against
 *  re-reads itself from the corrected figure, so a fixed delivery is a fixed order. */
export function saveMovement(
  movementId: string,
  patch: Partial<StockMovement>,
): void {
  set({
    outgoing: state.outgoing.map((movement) =>
      movement.movement_id === movementId
        ? { ...movement, ...patch }
        : movement,
    ),
  });
}

/** Takes back a delivery that never happened. What it credited to the order goes with
 *  it. */
export function removeMovement(movementId: string): void {
  set({
    outgoing: state.outgoing.filter(
      (movement) => movement.movement_id !== movementId,
    ),
  });
}

/** Money taken from a customer, against their order. */
export function addOrderPayment(orderNo: string, payment: Payment): void {
  set({
    orders: state.orders.map((order) =>
      order.order_no === orderNo
        ? {
            ...order,
            payment: {
              ...order.payment,
              payments: [...order.payment.payments, payment],
            },
          }
        : order,
    ),
  });
}

export function removeOrderPayment(orderNo: string, paymentId: string): void {
  set({
    orders: state.orders.map((order) =>
      order.order_no === orderNo
        ? {
            ...order,
            payment: {
              ...order.payment,
              payments: order.payment.payments.filter(
                (payment) => payment.payment_id !== paymentId,
              ),
            },
          }
        : order,
    ),
  });
}

/** Money paid to a supplier, against their voucher. */
export function addVoucherPayment(voucherNo: string, payment: Payment): void {
  set({
    vouchers: state.vouchers.map((voucher) =>
      voucher.voucher_no === voucherNo
        ? {
            ...voucher,
            payment: {
              ...voucher.payment,
              payments: [...voucher.payment.payments, payment],
            },
          }
        : voucher,
    ),
  });
}

export function removeVoucherPayment(
  voucherNo: string,
  paymentId: string,
): void {
  set({
    vouchers: state.vouchers.map((voucher) =>
      voucher.voucher_no === voucherNo
        ? {
            ...voucher,
            payment: {
              ...voucher.payment,
              payments: voucher.payment.payments.filter(
                (payment) => payment.payment_id !== paymentId,
              ),
            },
          }
        : voucher,
    ),
  });
}

// ── Settling ─────────────────────────────────────────────────────────────────

/** Re-reads every worked-out figure from the thing that actually happened. Run after each
 *  change, so an edit anywhere leaves the whole workspace agreeing with itself. */
function settle(next: WholesaleState): WholesaleState {
  return {
    ...next,
    orders: next.orders.map((order) => settleOrder(order, next.outgoing)),
    vouchers: next.vouchers.map((voucher) =>
      settleVoucher(voucher, next.receivings),
    ),
    shipments: next.shipments.map((shipment) =>
      settleShipment(shipment, next.receivings),
    ),
  };
}

/** What a customer has been given is the goods that left the shelf against their order,
 *  product by product, and never more of a product than they asked for. The order's own
 *  figure is the sum of its lines, and its status follows both. */
function settleOrder(
  order: CustomerOrder,
  outgoing: StockMovement[],
): CustomerOrder {
  const delivered = new Map<string, number>();
  for (const movement of outgoing) {
    if (movement.kind !== "out" || movement.reference !== order.order_no)
      continue;
    delivered.set(
      movement.stock_code,
      (delivered.get(movement.stock_code) ?? 0) + movement.pairs,
    );
  }

  const lines = order.lines.map((line) => {
    const left = delivered.get(line.stock_code) ?? 0;
    const credit = Math.min(left, line.wanted_qty);
    delivered.set(line.stock_code, left - credit);
    return line.received_qty === credit
      ? line
      : { ...line, received_qty: credit };
  });

  const wanted = lines.reduce((sum, line) => sum + line.wanted_qty, 0);
  const received = lines.reduce((sum, line) => sum + line.received_qty, 0);
  const status: OrderStatus =
    order.order_status === "cancelled"
      ? "cancelled"
      : wanted > 0 && received >= wanted
        ? "completed"
        : received > 0
          ? "processing"
          : "created";

  const same =
    order.total_qty === wanted &&
    order.received_qty === received &&
    order.order_status === status &&
    lines.every((line, index) => line === order.lines[index]);

  return same
    ? order
    : {
        ...order,
        lines,
        total_qty: wanted,
        received_qty: received,
        order_status: status,
      };
}

/** A voucher has received whatever the gate has counted against it — and until a
 *  receiving exists for it, nothing. */
function settleVoucher(
  voucher: SupplierVoucher,
  receivings: Receiving[],
): SupplierVoucher {
  const total = voucher.lines.reduce((sum, line) => sum + line.voucher_qty, 0);
  const received = receivings
    .filter((receiving) => receiving.voucher_no === voucher.voucher_no)
    .reduce((sum, receiving) => sum + countedPairs(receiving), 0);
  return voucher.total_qty === total && voucher.received_qty === received
    ? voucher
    : { ...voucher, total_qty: total, received_qty: received };
}

/** A shipment has finally received however many packages the gate wrote down. Before any
 *  receiving is raised the shipment keeps its own figure, because until then the only
 *  word on what reached us is the one Delivery was given. */
function settleShipment(shipment: Shipment, receivings: Receiving[]): Shipment {
  const mine = receivings.filter(
    (receiving) => receiving.shipment_no === shipment.shipment_no,
  );
  if (mine.length === 0) return shipment;
  const packages = mine.reduce(
    (sum, receiving) => sum + receiving.packages.length,
    0,
  );
  return packages === shipment.final_received_packages
    ? shipment
    : { ...shipment, final_received_packages: packages };
}
