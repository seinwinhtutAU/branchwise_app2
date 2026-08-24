import pandas as pd

from app.services.import_common import validate_rows
from app.services.inventory_import import VALIDATION_RULES as INVENTORY_RULES
from app.services.pos_import import VALIDATION_RULES as SALES_RULES
from app.services.purchase_import import VALIDATION_RULES as PURCHASE_RULES


def test_valid_row_has_no_issues():
    df = pd.DataFrame(
        [{"Selling_Price": 100.0, "Qty": 1.0, "Discount_Amount": 0.0, "Amount": 100.0, "Net_Amount": 100.0}]
    )
    assert validate_rows(df, SALES_RULES) == [[]]


def test_unparseable_value_is_flagged_with_plain_message():
    df = pd.DataFrame(
        [{"Selling_Price": 100.0, "Qty": None, "Discount_Amount": 0.0, "Amount": 100.0, "Net_Amount": 100.0}]
    )
    issues = validate_rows(df, SALES_RULES)
    assert issues == [[{"column": "Qty", "message": "Quantity doesn't look like a valid number"}]]


def test_sales_qty_below_minimum_has_plain_message():
    df = pd.DataFrame(
        [{"Selling_Price": 100.0, "Qty": 0.0, "Discount_Amount": 0.0, "Amount": 0.0, "Net_Amount": 0.0}]
    )
    issues = validate_rows(df, SALES_RULES)
    assert issues == [[{"column": "Qty", "message": "Quantity can't be zero — enter at least 1"}]]


def test_sales_negative_price_has_plain_message():
    df = pd.DataFrame(
        [{"Selling_Price": -5.0, "Qty": 1.0, "Discount_Amount": 0.0, "Amount": 0.0, "Net_Amount": 0.0}]
    )
    issues = validate_rows(df, SALES_RULES)
    assert issues == [[{"column": "Selling_Price", "message": "Selling Price can't be a negative number"}]]


def test_multiple_failures_on_one_row():
    df = pd.DataFrame(
        [{"Selling_Price": -5.0, "Qty": 0.0, "Discount_Amount": 0.0, "Amount": 0.0, "Net_Amount": 0.0}]
    )
    issues = validate_rows(df, SALES_RULES)
    assert [i["column"] for i in issues[0]] == ["Selling_Price", "Qty"]


def test_inventory_negative_on_hand_qty_has_plain_message():
    df = pd.DataFrame([{"On_Hand_Qty": -1.0, "Buying_Price": 10.0, "Selling_Price": 20.0}])
    issues = validate_rows(df, INVENTORY_RULES)
    assert issues == [[{"column": "On_Hand_Qty", "message": "Stock Quantity can't be a negative number"}]]


def test_inventory_zero_on_hand_qty_is_valid():
    df = pd.DataFrame([{"On_Hand_Qty": 0.0, "Buying_Price": 10.0, "Selling_Price": 20.0}])
    assert validate_rows(df, INVENTORY_RULES) == [[]]


def test_purchase_zero_quantity_has_plain_message():
    df = pd.DataFrame([{"Quantity": 0.0, "Buying_Price": 10.0}])
    issues = validate_rows(df, PURCHASE_RULES)
    assert issues == [[{"column": "Quantity", "message": "Quantity can't be zero — enter at least 1"}]]


def test_purchase_negative_buying_price_has_plain_message():
    df = pd.DataFrame([{"Quantity": 1.0, "Buying_Price": -10.0}])
    issues = validate_rows(df, PURCHASE_RULES)
    assert issues == [[{"column": "Buying_Price", "message": "Buying Price can't be a negative number"}]]
