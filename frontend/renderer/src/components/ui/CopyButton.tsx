import { useState, useRef, useEffect } from "react";
import { cn } from "@renderer/lib/utils";
import { CheckIcon, CopyIcon } from "@renderer/components/ui/icons";

/** Puts text on the clipboard with fallback for non-secure contexts. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fallback below
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    document.body.removeChild(box);
  } catch (err) {
    console.error("Failed to copy text:", err);
  }
}

export interface CopyButtonProps {
  /** The value/text to copy to clipboard */
  value?: string;
  text?: string;
  /** What is being copied, for title and aria-label (e.g. "stock code", "order no.") */
  what?: string;
  className?: string;
}

export function CopyButton({
  value,
  text,
  what = "item",
  className,
}: CopyButtonProps): React.JSX.Element {
  const content = value ?? text ?? "";
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <button
      type="button"
      title={copied ? "Copied" : `Copy ${what}`}
      aria-label={`Copy ${what} ${content}`}
      onClick={(event) => {
        event.stopPropagation();
        if (!content) return;
        void copyText(content).then(() => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={cn(
        "shrink-0 rounded-sm p-0.5 transition-colors duration-150 inline-flex items-center justify-center",
        copied
          ? "text-success"
          : "text-text-muted hover:text-brand hover:bg-brand-subtle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        className,
      )}
    >
      {copied ? (
        <CheckIcon className="w-3.5 h-3.5" />
      ) : (
        <CopyIcon className="w-3.5 h-3.5" />
      )}
    </button>
  );
}
