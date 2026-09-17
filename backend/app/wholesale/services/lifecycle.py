"""Wholesale lifecycle states, actions, and action guards (FSM).

Defines valid shipment lifecycle states, permitted operations per state, and preconditions/guards
that prevent illegal structural mutations (e.g. splitting or deleting a completed shipment).
"""

from enum import Enum
from fastapi import HTTPException, status

from app.wholesale.models.entities import Shipment
from app.wholesale.services.shipments import shipment_status, cargo_remaining


def _action_values(actions: set) -> list[str]:
    """The wire shape every get_allowed_*_actions function returns: action names, sorted
    so the client always sees them in the same order regardless of set iteration."""
    return sorted(action.value for action in actions)


def _guard_allowed(allowed_map: dict[str, set], status_str: str, action, entity_label: str) -> None:
    """The generic half of every assert_can_perform_*_action guard: once an entity's own
    earlier, state-specific checks have passed, this is what actually stops an action the
    state table doesn't list for the current status."""
    allowed = allowed_map.get(status_str, set())
    if action not in allowed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Action '{action.value}' is not allowed for {entity_label} in '{status_str}' status.",
        )


class ShipmentStatus(str, Enum):
    WAITING_AT_CARGO = "waiting_at_cargo"
    IN_TRANSIT = "in_transit"
    PARTLY_DELIVERED = "partly_delivered"
    COMPLETED = "completed"


class ShipmentAction(str, Enum):
    EDIT = "edit"
    SPLIT = "split"
    DELETE = "delete"
    WRITE_OFF = "write_off"
    RECEIVE = "receive"


ALLOWED_SHIPMENT_ACTIONS: dict[str, set[ShipmentAction]] = {
    ShipmentStatus.WAITING_AT_CARGO.value: {
        ShipmentAction.EDIT,
        ShipmentAction.SPLIT,
        ShipmentAction.DELETE,
        ShipmentAction.RECEIVE,
    },
    ShipmentStatus.IN_TRANSIT.value: {
        ShipmentAction.EDIT,
        ShipmentAction.SPLIT,
        ShipmentAction.DELETE,
        ShipmentAction.WRITE_OFF,
        ShipmentAction.RECEIVE,
    },
    ShipmentStatus.PARTLY_DELIVERED.value: {
        ShipmentAction.EDIT,
        ShipmentAction.SPLIT,
        ShipmentAction.DELETE,
        ShipmentAction.WRITE_OFF,
        ShipmentAction.RECEIVE,
    },
    ShipmentStatus.COMPLETED.value: {
        # Completed shipments are locked from structural edits or splits.
    },
}


def get_allowed_shipment_actions(
    shipment: Shipment,
    final_received_packages: int,
    has_receiving: bool = False,
) -> list[str]:
    """Computes the list of permitted actions for a shipment given its current state."""
    status_str = shipment_status(shipment, final_received_packages)
    actions = set(ALLOWED_SHIPMENT_ACTIONS.get(status_str, set()))

    # If receiving already exists, deletion and splitting are strictly forbidden
    if has_receiving:
        actions.discard(ShipmentAction.DELETE)
        actions.discard(ShipmentAction.SPLIT)

    # If there are physically no packages remaining to split anywhere, remove split action
    can_split_packages = (
        cargo_remaining(shipment) > 0
        or any(
            (leg.packages_received - leg.packages_sent - getattr(leg, "lost_packages", 0)) > 0
            for leg in shipment.legs
        )
    )
    if not can_split_packages:
        actions.discard(ShipmentAction.SPLIT)

    return _action_values(actions)


def assert_can_perform_shipment_action(
    shipment: Shipment,
    action: ShipmentAction,
    final_received_packages: int,
    has_receiving: bool = False,
) -> None:
    """Action guard: raises 409 Conflict if the action is not permitted for the shipment's state."""
    status_str = shipment_status(shipment, final_received_packages)
    if status_str == ShipmentStatus.COMPLETED.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot {action.value} a completed shipment.",
        )
    if has_receiving and action in (ShipmentAction.DELETE, ShipmentAction.SPLIT):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot {action.value} this shipment because it already has a receiving recorded against it.",
        )
    _guard_allowed(ALLOWED_SHIPMENT_ACTIONS, status_str, action, "shipment")


class OrderStatus(str, Enum):
    WAITING_FOR_STOCK = "waiting_for_stock"
    READY_TO_DELIVER = "ready_to_deliver"
    PARTLY_DELIVERED = "partly_delivered"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"


class OrderAction(str, Enum):
    EDIT = "edit"
    ALLOCATE = "allocate"
    DELIVER = "deliver"
    ADD_PAYMENT = "add_payment"
    CANCEL = "cancel"
    DELETE = "delete"
    WRITE_OFF = "write_off"


ALLOWED_ORDER_ACTIONS: dict[str, set[OrderAction]] = {
    OrderStatus.WAITING_FOR_STOCK.value: {
        OrderAction.EDIT,
        OrderAction.ALLOCATE,
        OrderAction.ADD_PAYMENT,
        OrderAction.CANCEL,
        OrderAction.DELETE,
        OrderAction.WRITE_OFF,
    },
    OrderStatus.READY_TO_DELIVER.value: {
        OrderAction.EDIT,
        OrderAction.ALLOCATE,
        OrderAction.DELIVER,
        OrderAction.ADD_PAYMENT,
        OrderAction.CANCEL,
        OrderAction.DELETE,
        OrderAction.WRITE_OFF,
    },
    OrderStatus.PARTLY_DELIVERED.value: {
        # Partially delivered orders cannot be cancelled or deleted without rolling back deliveries.
        # Lines with deliveries cannot be replaced, but owed remaining stock can still be allocated.
        OrderAction.ALLOCATE,
        OrderAction.DELIVER,
        OrderAction.ADD_PAYMENT,
        OrderAction.WRITE_OFF,
    },
    OrderStatus.FULFILLED.value: {
        # Fulfilled orders can still receive payments if there is an outstanding balance,
        # but cannot be edited, cancelled, allocated, or deleted.
        OrderAction.ADD_PAYMENT,
    },
    OrderStatus.CANCELLED.value: {
        # Cancelled orders are read-only; can be deleted only if no financial or stock movements exist.
        OrderAction.DELETE,
    },
}


def get_allowed_order_actions(
    status_str: str,
    has_payments: bool = False,
    has_movements: bool = False,
) -> list[str]:
    """Computes the permitted operations on a customer order given its state and history."""
    actions = set(ALLOWED_ORDER_ACTIONS.get(status_str, set()))

    # If payments or stock movements exist, deletion is strictly forbidden
    if has_payments or has_movements:
        actions.discard(OrderAction.DELETE)

    # If stock movements exist, cancellation is strictly forbidden
    if has_movements:
        actions.discard(OrderAction.CANCEL)

    return _action_values(actions)


def assert_can_perform_order_action(
    action: OrderAction,
    status_str: str,
    has_payments: bool = False,
    has_movements: bool = False,
) -> None:
    """Action guard: raises 409 Conflict if the action is not permitted for the order's state."""
    if status_str == OrderStatus.CANCELLED.value and action != OrderAction.DELETE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot {action.value} a cancelled customer order.",
        )
    if status_str == OrderStatus.FULFILLED.value and action not in (OrderAction.ADD_PAYMENT,):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot {action.value} a fulfilled customer order.",
        )
    if action == OrderAction.DELETE and (has_payments or has_movements):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot delete an order that has recorded payments or stock movements.",
        )
    if action == OrderAction.CANCEL and has_movements:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Some of this order has already gone out to the customer. Take those deliveries back before cancelling it.",
        )
    _guard_allowed(ALLOWED_ORDER_ACTIONS, status_str, action, "customer order")


# ── Receiving Lifecycle ───────────────────────────────────────────────────────


class ReceivingStatus(str, Enum):
    RECORDED = "recorded"
    CHECKING = "checking"
    CHECKED = "checked"
    ISSUE = "issue"


class ReceivingAction(str, Enum):
    EDIT = "edit"
    INSPECT_PACKAGE = "inspect_package"
    UPDATE_COSTS = "update_costs"
    DELETE = "delete"


ALLOWED_RECEIVING_ACTIONS: dict[str, set[ReceivingAction]] = {
    ReceivingStatus.RECORDED.value: {
        ReceivingAction.EDIT,
        ReceivingAction.INSPECT_PACKAGE,
        ReceivingAction.UPDATE_COSTS,
        ReceivingAction.DELETE,
    },
    ReceivingStatus.CHECKING.value: {
        ReceivingAction.EDIT,
        ReceivingAction.INSPECT_PACKAGE,
        ReceivingAction.UPDATE_COSTS,
        ReceivingAction.DELETE,
    },
    ReceivingStatus.CHECKED.value: {
        ReceivingAction.EDIT,
        ReceivingAction.INSPECT_PACKAGE,
        ReceivingAction.UPDATE_COSTS,
        ReceivingAction.DELETE,
    },
    ReceivingStatus.ISSUE.value: {
        ReceivingAction.EDIT,
        ReceivingAction.INSPECT_PACKAGE,
        ReceivingAction.UPDATE_COSTS,
        ReceivingAction.DELETE,
    },
}


def get_allowed_receiving_actions(
    status_str: str,
    opened_packages_count: int = 0,
) -> list[str]:
    """Computes permitted operations for a receiving record."""
    actions = set(ALLOWED_RECEIVING_ACTIONS.get(status_str, set()))
    if opened_packages_count > 0:
        actions.discard(ReceivingAction.DELETE)
    return _action_values(actions)


def assert_can_perform_receiving_action(
    action: ReceivingAction,
    status_str: str,
    opened_packages_count: int = 0,
) -> None:
    """Action guard: raises 409 Conflict if attempting an illegal receiving action."""
    if action == ReceivingAction.DELETE and opened_packages_count > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot delete a receiving that has opened packages. Close or remove package contents first.",
        )
    _guard_allowed(ALLOWED_RECEIVING_ACTIONS, status_str, action, "receiving")


# ── Supplier Voucher Lifecycle ────────────────────────────────────────────────


class VoucherStatus(str, Enum):
    DRAFT = "draft"
    IN_TRANSIT = "in_transit"
    PARTLY_RECEIVED = "partly_received"
    RECEIVED = "received"
    SETTLED = "settled"


class VoucherAction(str, Enum):
    EDIT = "edit"
    ADD_PAYMENT = "add_payment"
    DELETE_PAYMENT = "delete_payment"
    WRITE_OFF = "write_off"
    DELETE = "delete"


ALLOWED_VOUCHER_ACTIONS: dict[str, set[VoucherAction]] = {
    VoucherStatus.DRAFT.value: {
        VoucherAction.EDIT,
        VoucherAction.ADD_PAYMENT,
        VoucherAction.DELETE_PAYMENT,
        VoucherAction.DELETE,
    },
    VoucherStatus.IN_TRANSIT.value: {
        VoucherAction.EDIT,
        VoucherAction.ADD_PAYMENT,
        VoucherAction.DELETE_PAYMENT,
        VoucherAction.WRITE_OFF,
        VoucherAction.DELETE,
    },
    VoucherStatus.PARTLY_RECEIVED.value: {
        VoucherAction.EDIT,
        VoucherAction.ADD_PAYMENT,
        VoucherAction.DELETE_PAYMENT,
        VoucherAction.WRITE_OFF,
        VoucherAction.DELETE,
    },
    VoucherStatus.RECEIVED.value: {
        VoucherAction.EDIT,
        VoucherAction.ADD_PAYMENT,
        VoucherAction.DELETE_PAYMENT,
        VoucherAction.WRITE_OFF,
        VoucherAction.DELETE,
    },
    VoucherStatus.SETTLED.value: {
        VoucherAction.WRITE_OFF,
    },
}


def voucher_status(
    total_quantity_pairs: int,
    received_quantity_pairs: int,
    lost_quantity_pairs: int,
    balance_due: float,
    has_shipments: bool = False,
) -> str:
    accounted = received_quantity_pairs + lost_quantity_pairs
    if accounted >= total_quantity_pairs and total_quantity_pairs > 0 and balance_due <= 0:
        return VoucherStatus.SETTLED.value
    if accounted >= total_quantity_pairs and total_quantity_pairs > 0:
        return VoucherStatus.RECEIVED.value
    if accounted > 0:
        return VoucherStatus.PARTLY_RECEIVED.value
    if has_shipments:
        return VoucherStatus.IN_TRANSIT.value
    return VoucherStatus.DRAFT.value


def get_allowed_voucher_actions(
    status_str: str,
    has_shipments: bool = False,
    has_receivings: bool = False,
    has_payments: bool = False,
) -> list[str]:
    """Computes permitted operations for a supplier voucher."""
    actions = set(ALLOWED_VOUCHER_ACTIONS.get(status_str, set()))
    if has_shipments or has_receivings or has_payments:
        actions.discard(VoucherAction.DELETE)
    return _action_values(actions)


def assert_can_perform_voucher_action(
    action: VoucherAction,
    status_str: str,
    has_shipments: bool = False,
    has_receivings: bool = False,
    has_payments: bool = False,
) -> None:
    """Action guard: raises 409 Conflict if attempting an illegal supplier voucher action."""
    if action == VoucherAction.DELETE:
        reasons = []
        if has_shipments:
            reasons.append("recorded shipments")
        if has_receivings:
            reasons.append("gate receivings")
        if has_payments:
            reasons.append("recorded payments")
        if reasons:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Cannot delete a voucher that has {' and '.join(reasons)}. Remove downstream records first.",
            )

    _guard_allowed(ALLOWED_VOUCHER_ACTIONS, status_str, action, "supplier voucher")

