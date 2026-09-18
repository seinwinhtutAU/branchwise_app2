import { z } from "zod";
import {
  cargoRemaining,
  legRemaining,
  type Shipment,
  type ShipmentStatus,
} from "@renderer/components/features/wholesale/delivery/shipments";
import { type Unit } from "@renderer/components/features/wholesale/shared/units";
import { quantityShorthandProblem } from "@renderer/components/features/wholesale/shared/shared";

export const SHIPMENTS_QUERY_KEY = ["wholesale", "shipments"] as const;

export type View = "list" | "detail" | "new";
export type StatusFilter = ShipmentStatus | "all";

export const STATUS_LABELS: Record<ShipmentStatus, string> = {
  waiting_at_cargo: "Waiting at cargo",
  in_transit: "On the way",
  partly_delivered: "Partly shipped",
  completed: "All shipped",
};

export const STATUS_STYLES: Record<ShipmentStatus, { bg: string; dot: string }> = {
  waiting_at_cargo: {
    bg: "bg-bg-raised text-text-secondary border border-border-strong",
    dot: "bg-text-muted",
  },
  in_transit: {
    bg: "bg-brand-subtle text-brand border border-brand-pill",
    dot: "bg-brand",
  },
  partly_delivered: {
    bg: "bg-warning-subtle text-warning border border-warning-pill",
    dot: "bg-warning",
  },
  completed: {
    bg: "bg-success-subtle text-success border border-success-pill",
    dot: "bg-success",
  },
};

export const shipmentDetailLegSchema = z.object({
  leg_id: z.string(),
  leg_order: z.number().finite().min(0),
  stop_name: z.string(),
  carrier_name: z.string(),
  packages_received: z.number().finite().min(0),
  packages_sent: z.number().finite().min(0),
});

export const shipmentDetailSchema = z.object({
  shipment: z.object({
    shipment_id: z.string(),
    shipment_no: z.string(),
    voucher_no: z.string(),
    supplier_name: z.string(),
    carrier_name: z.string().trim().min(1, "Enter a cargo name."),
    final_destination: z.string().trim().min(1, "Enter a receiving gate."),
    sent_on: z.string().trim().min(1, "Choose a shipment date."),
    total_packages: z.number().finite().min(0),
    total_quantity_pairs: z.number().finite().min(0),
    total_unit: z.enum(["pair", "set", "dozen"]),
    packages_sent_by_cargo: z.number().finite().min(0),
    final_received_packages: z.number().finite().min(0),
    legs: z.array(shipmentDetailLegSchema),
  }),
});

export interface ShipmentDetailFormValues {
  shipment: Shipment;
}

export interface ShipmentMismatchTarget {
  subjectId: string;
  legId?: string;
  subject: string;
  remaining: number;
  currentCount: number;
}

export function isLegFinished(shipment: Shipment, index: number): boolean {
  const leg = shipment.legs[index];
  if (!leg) return false;
  if (leg.packages_received === 0 && shipment.total_packages > 0) return false;
  if (leg.packages_received !== leg.packages_sent) return false;
  if (cargoRemaining(shipment) > 0) return false;
  for (let i = 0; i <= index; i++) {
    if (legRemaining(shipment, i) > 0) return false;
  }
  return true;
}

export interface DraftStop {
  stop_name: string;
  carrier_name: string;
}

export const EMPTY_STOP: DraftStop = { stop_name: "", carrier_name: "" };

export const shipmentFormSchema = z.object({
  voucher_no: z.string().trim().min(1, "Choose a supplier voucher."),
  carrier_name: z.string().trim().min(1, "Enter a cargo provider."),
  final_destination: z.string().trim().min(1, "Enter a receiving gate."),
  sent_on: z.string().trim().min(1, "Choose a shipment date."),
  total_packages: z
    .string()
    .regex(/^\d*$/, "Packages can only contain numbers."),
  total_sets: z.string().superRefine((value, context) => {
    const problem = quantityShorthandProblem(value);
    if (problem) context.addIssue({ code: "custom", message: problem });
  }),
  total_unit: z.enum(["set", "pair", "dozen"]),
  stops: z.array(
    z.object({
      stop_name: z.string(),
      carrier_name: z.string(),
    }),
  ),
});

export interface ShipmentFormValues {
  voucher_no: string;
  carrier_name: string;
  final_destination: string;
  sent_on: string;
  total_packages: string;
  total_sets: string;
  total_unit: Unit;
  stops: DraftStop[];
}

export const STEPS = ["Shipment", "Destinations", "Review"] as const;
