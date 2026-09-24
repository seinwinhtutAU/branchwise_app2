const COLUMN_DESCRIPTIONS: Record<string, string> = {
  Branch: "Branch for this record.",
  Date: "Record date.",
  Time: "Recorded time.",
  Month: "Record month.",
  Name: "Name for this record.",
  StockCode: "Product ID.",
  Description: "Product name.",
  Category: "Record category.",
  Group: "Product group.",
  Location: "Recorded location.",
  Qty: "Units in this record.",
  Quantity: "Units in this record.",
  UOM: "Unit of measure.",
  Selling_Price: "Price per unit.",
  Buying_Price: "Cost per unit.",
  Discount_Amount: "Discount applied.",
  Amount: "Amount before discount.",
  Net_Amount: "Final sale amount.",
  Profit: "Sales minus product cost.",
  Profit_Margin_Pct: "Profit as % of sales.",
  Salary: "Base monthly salary.",
  Bonus: "Extra salary payment.",
  DailyUsage: "Daily operating costs.",
  UsageTotal: "Total operating cost.",
  DigitalIncome: "Digital payment income.",
  DigitalIncomeTotal: "Total digital income.",
  Return: "Returned item details.",
  ReturnTotal: "Total return value.",
  CapitalExpenditure: "Long-term asset spending.",
  CapitalTotal: "Total asset spending.",
  SalesSlips: "Completed sales slips.",
  ZeroSelling: "Visits without a sale.",
  ConversionRate: "Visits that became a sale.",
  Reason: "Recorded reason.",
  Status: "Current record state.",
  On_Hand_Qty: "Current stock.",
  Days_Left: "Days until stock runs out.",
  DaysUnsold: "Days since last sale.",
};

export function getColumnDescription(key: PropertyKey, label: string): string {
  return (
    COLUMN_DESCRIPTIONS[String(key)] ??
    `Shows the ${label.toLowerCase()} for this record.`
  );
}
