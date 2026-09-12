import { createContext, useContext } from "react";
import type { ToastVariant } from "@renderer/components/ui/Toast";

export type ShowToast = (variant: ToastVariant, message: string) => void;

// Provided by ToastProvider (./toast.tsx). The context and hook live here rather
// than beside the provider so that file only exports a component, which is what
// lets Vite Fast Refresh hot-swap it in dev.
export const ToastContext = createContext<ShowToast | null>(null);

export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
