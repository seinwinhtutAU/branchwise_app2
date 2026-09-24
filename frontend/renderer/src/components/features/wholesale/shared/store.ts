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
//   • An order's status follows its goods: nothing set aside is waiting for stock, any
//     stock set aside is ready to deliver, delivery moves it through partly delivered to
//     fulfilled. Cancelled is the one status a person sets, and nothing overrides it.
//
// `settle` below is where all of that happens, and it runs after every change, so no
// screen has to remember to keep another screen honest.
//
// Front-end only for what has not moved to the backend yet: shipments, orders and their
// persisted allocations are read from Postgres and pushed in here by the owning pages.
// The remaining seed-backed slices continue to be phased over without changing the
// screen-facing state shape.

import { useSyncExternalStore } from "react";
import { SEED_ORDERS, type CustomerOrder } from "../orders/customerOrders";
import { SEED_VOUCHERS, type SupplierVoucher } from "../vouchers/supplierVouchers";
import { SEED_SHIPMENTS, type Shipment } from "../delivery/shipments";
import { SEED_RECEIVINGS, type Receiving } from "../receiving/receivings";
import { SEED_OUTGOING, type StockMovement } from "../inventory/stock";

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

// ── Settling ─────────────────────────────────────────────────────────────────

/** Re-reads every worked-out figure from the thing that actually happened. Run after each
 *  change, so an edit anywhere leaves the whole workspace agreeing with itself.
 *
 *  Orders are not settled here: the backend is authoritative for them (see
 *  wholesale_orders.py::_out) and returns total_quantity_pairs/received_quantity_pairs/order_status already
 *  computed on every fetch. This store's own `outgoing` field is never updated from the
 *  real backend — Inventory computes its deliveries locally from its own fetch instead of
 *  hydrating them in here — so recomputing an order's received quantity from `outgoing`
 *  would silently overwrite a correct, freshly-fetched status with one based on stale (or
 *  entirely absent) local data the moment `hydrateOrders` ran. */
function settle(next: WholesaleState): WholesaleState {
  return {
    ...next,
    shipments: next.shipments.map((shipment) =>
      settleShipment(shipment, next.receivings),
    ),
  };
}

/** A shipment has finally received however many packages the gate wrote down. Before any
 *  receiving is raised the shipment keeps its own figure, because until then the only
 *  word on what reached us is the one Delivery was given. */
function settleShipment(shipment: Shipment, receivings: Receiving[]): Shipment {
  const mine = receivings.filter(
    (receiving) => receiving.shipment_no === shipment.shipment_no,
  );
  if (mine.length === 0) return shipment;
  const packages = mine.reduce((sum, receiving) => sum + receiving.packages.length, 0);
  return packages === shipment.final_received_packages
    ? shipment
    : { ...shipment, final_received_packages: packages };
}
