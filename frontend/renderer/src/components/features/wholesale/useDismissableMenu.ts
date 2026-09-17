import { useEffect, useRef, useState } from "react";

/** The open/confirm state behind every wholesale row menu (order/voucher/receiving row
 *  actions): a toggle button opens it, clicking outside or pressing Escape closes it, and
 *  closing it for any reason always drops back out of a pending "are you sure?" step.
 *  What the menu actually shows is still each screen's own — only this interaction
 *  plumbing used to be hand-copied into every one of them. */
export function useDismissableMenu(): {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  confirming: boolean;
  setConfirming: React.Dispatch<React.SetStateAction<boolean>>;
  ref: React.RefObject<HTMLDivElement | null>;
  toggle: () => void;
} {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    function handlePointer(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return { open, setOpen, confirming, setConfirming, ref, toggle: () => setOpen((current) => !current) };
}
