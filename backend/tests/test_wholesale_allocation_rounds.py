"""Allocating and delivering the same order line over and over.

The Fulfill screen is used in rounds — set some aside, hand part of it over, come
back, adjust, hand over the rest. `allocated_color_breakdown` is read net of what
has already gone out and written as the gross figure, so the round trip is the
place where the two meanings can meet and a reservation can quietly vanish.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.test_wholesale_inventory import _branch, _user, _incoming_stock, _order_payload


def _alloc(client, line_id, value):
    return client.put(
        f"/api/wholesale/orders/lines/{line_id}/allocation",
        json={"color_breakdown": value},
    )


def _line(client, order_id):
    return client.get(f"/api/wholesale/orders/{order_id}").json()["lines"][0]


def test_repeat_allocation_changes(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    lid = order["lines"][0]["order_line_id"]

    for value, expect in [("black1s", 6), ("black2s", 12), ("black1s", 6), ("", 0), ("black2s", 12)]:
        r = _alloc(authed_client, lid, value)
        assert r.status_code == 200, r.text
        got = _line(authed_client, order["order_id"])["allocated_quantity_pairs"]
        print(f"  分配 {value!r:10} -> {got:3} (应为 {expect})")
        assert got == expect, f"分配 {value!r} 后得到 {got},应为 {expect}"


def test_reallocate_after_partial_delivery(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    oid, lid = order["order_id"], order["lines"][0]["order_line_id"]

    assert _alloc(authed_client, lid, "black2s").status_code == 200
    assert _line(authed_client, oid)["allocated_quantity_pairs"] == 12

    d = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
        "order_id": oid, "delivered_on": "2026-09-13", "delivery_address": "Y", "note": "",
        "lines": [{"stock_code": "A1001", "location": "Gate", "color_breakdown": "black1s", "unit": "set"}],
    })
    assert d.status_code == 201, d.text

    line = _line(authed_client, oid)
    print(f"\n  交货 1 set 后: allocated={line['allocated_quantity_pairs']} "
          f"breakdown={line['allocated_color_breakdown']!r} delivered={line['delivered_quantity_pairs']}")
    assert line["allocated_quantity_pairs"] == 6

    # 界面把读到的 breakdown 原样存回去 —— 用户在 Allocate 里按一次 Save 就是这个效果
    echoed = line["allocated_color_breakdown"]
    assert _alloc(authed_client, lid, echoed).status_code == 200
    again = _line(authed_client, oid)
    print(f"  原样再存一次 {echoed!r} 之后: allocated={again['allocated_quantity_pairs']} (应仍为 6)")
    assert again["allocated_quantity_pairs"] == 6, (
        f"把界面显示的值存回去,分配从 6 变成了 {again['allocated_quantity_pairs']}"
    )


def test_repeat_partial_deliveries(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    payload = _order_payload()
    payload["lines"][0]["color_breakdown"] = "black2s"
    order = authed_client.post("/api/wholesale/orders", json=payload).json()
    oid = order["order_id"]

    total = 0
    for _ in range(2):
        assert _alloc(authed_client, order["lines"][0]["order_line_id"], "black1s").status_code == 200
        d = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
            "order_id": oid, "delivered_on": "2026-09-13", "delivery_address": "Y", "note": "",
            "lines": [{"stock_code": "A1001", "location": "Gate", "color_breakdown": "black1s", "unit": "set"}],
        })
        assert d.status_code == 201, d.text
        total += 6
        after = authed_client.get(f"/api/wholesale/orders/{oid}").json()
        print(f"  交了 {total}: delivered={after['delivered_quantity_pairs']} "
              f"remaining={after['remaining_quantity_pairs']} status={after['order_status']}")
        assert after["delivered_quantity_pairs"] == total
        assert after["remaining_quantity_pairs"] == 12 - total


def test_changing_the_allocation_after_a_partial_delivery(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    payload = _order_payload()
    payload["lines"][0]["color_breakdown"] = "black2s"
    order = authed_client.post("/api/wholesale/orders", json=payload).json()
    oid, lid = order["order_id"], order["lines"][0]["order_line_id"]

    assert _alloc(authed_client, lid, "black1s").status_code == 200
    d = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
        "order_id": oid, "delivered_on": "2026-09-13", "delivery_address": "Y", "note": "",
        "lines": [{"stock_code": "A1001", "location": "Gate", "color_breakdown": "black1s", "unit": "set"}],
    })
    assert d.status_code == 201, d.text
    assert _line(authed_client, oid)["allocated_quantity_pairs"] == 0

    # 还欠 1 set,把它也预留起来 —— 读回来必须正好是 1 set
    assert _alloc(authed_client, lid, "black1s").status_code == 200
    after = _line(authed_client, oid)
    print(f"\n  交 1 set 后再预留 1 set: allocated={after['allocated_quantity_pairs']} (应为 6)")
    assert after["allocated_quantity_pairs"] == 6

    # 反复按 Save 不应该再改变它
    for _ in range(3):
        assert _alloc(authed_client, lid, after["allocated_color_breakdown"]).status_code == 200
        again = _line(authed_client, oid)["allocated_quantity_pairs"]
        assert again == 6, f"重复保存后变成 {again}"
    print("  重复保存 3 次: 仍为 6 ✓")


def test_allocation_still_cannot_pass_what_is_owed_after_a_delivery(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    payload = _order_payload()
    payload["lines"][0]["color_breakdown"] = "black2s"
    order = authed_client.post("/api/wholesale/orders", json=payload).json()
    oid, lid = order["order_id"], order["lines"][0]["order_line_id"]

    assert _alloc(authed_client, lid, "black1s").status_code == 200
    d = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
        "order_id": oid, "delivered_on": "2026-09-13", "delivery_address": "Y", "note": "",
        "lines": [{"stock_code": "A1001", "location": "Gate", "color_breakdown": "black1s", "unit": "set"}],
    })
    assert d.status_code == 201
    # 只还欠 1 set,想预留 2 set 必须被拒
    too_much = _alloc(authed_client, lid, "black2s")
    assert too_much.status_code == 422, too_much.text
    assert "owed" in too_much.json()["detail"]
