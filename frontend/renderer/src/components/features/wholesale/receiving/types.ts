import { z } from "zod";
import { type Unit } from "@renderer/components/features/wholesale/shared/units";
import { type Receiving, type ReceivingStatus } from "@renderer/components/features/wholesale/receiving/receivings";
import { nextReference } from "@renderer/components/features/wholesale/shared/shared";

export const RECEIVINGS_QUERY_KEY = ["wholesale", "receivings"] as const;
export const SHIPMENTS_QUERY_KEY = ["wholesale", "shipments"] as const;
export const STOCK_QUERY_KEY = ["wholesale", "stock"] as const;

export type View = "list" | "detail" | "new";
export type StatusFilter = ReceivingStatus | "all";

export const STATUS_LABELS: Record<ReceivingStatus, string> = {
  recorded: "Not opened",
  checking: "Partly received",
  checked: "All received",
  issue: "Does not match",
};

export const STATUS_STYLES: Record<ReceivingStatus, string> = {
  recorded: "bg-text-secondary text-bg-base",
  checking: "bg-brand text-white",
  checked: "bg-success text-white",
  issue: "bg-error text-white",
};

export const STEPS = ["Receiving", "Review"] as const;

export const receivingDetailItemSchema = z.object({
  item_id: z.string(),
  stock_code: z.string(),
  description: z.string(),
  product_group: z.enum(["man", "lady", "child"]),
  color_breakdown: z.string(),
  quantity: z.number().finite().min(0),
  unit: z.enum(["pair", "set", "dozen"]),
});

export const receivingDetailPackageSchema = z.object({
  package_id: z.string(),
  package_no: z.number().finite().min(1),
  opened: z.boolean(),
  received_on: z.string(),
  items: z.array(receivingDetailItemSchema),
  note: z.string(),
});

export const receivingDetailCostSchema = z.object({
  cost_id: z.string(),
  cost_date: z.string().trim().min(1, "Choose a cost date."),
  stage: z.string(),
  carrier: z.string(),
  kind: z.string(),
  amount: z.number().finite().min(0),
  currency_code: z.string().optional(),
  original_amount: z.number().finite().min(0).nullable().optional(),
  exchange_rate: z.number().finite().min(0).nullable().optional(),
  note: z.string(),
});

export const receivingDetailSchema = z.object({
  receiving: z.object({
    receiving_id: z.string(),
    receiving_no: z.string(),
    shipment_no: z.string(),
    voucher_no: z.string(),
    supplier_name: z.string(),
    gate: z.string().trim().min(1, "Enter a receiving gate."),
    received_on: z.string().trim().min(1, "Choose a received date."),
    total_packages: z.number().finite().min(0),
    costs: z.array(receivingDetailCostSchema),
    total_quantity_pairs: z.number().finite().min(0),
    total_unit: z.enum(["pair", "set", "dozen"]),
    packages: z.array(receivingDetailPackageSchema),
  }),
});

export interface ReceivingDetailFormValues {
  receiving: Receiving;
}

export const receivingFormSchema = z.object({
  shipment_no: z.string().trim().min(1, "Choose a shipment."),
  gate: z.string().trim().min(1, "Enter a receiving gate."),
  received_on: z.string().trim().min(1, "Choose a receiving date."),
  packages: z
    .string()
    .regex(/^\d*$/, "Received packages can only contain numbers.")
    .refine(
      (value) => Number(value) > 0,
      "Enter at least one received package.",
    ),
  sets: z.string().regex(/^\d*$/, "Quantity can only contain numbers."),
  sets_unit: z.enum(["set", "pair", "dozen"]),
  cost: z.string().regex(/^\d*$/, "Cost can only contain numbers."),
});

export interface ReceivingFormValues {
  shipment_no: string;
  gate: string;
  received_on: string;
  packages: string;
  sets: string;
  sets_unit: Unit;
  cost: string;
}

export function nextReceivingNo(receivings: Receiving[]): string {
  return nextReference(
    "RCV",
    receivings.map((receiving) => receiving.receiving_no),
  );
}
