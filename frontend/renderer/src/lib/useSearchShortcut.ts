import { useEffect, useRef, type RefObject } from "react";

/** Pressing "/" (unless already typing somewhere) or Cmd/Ctrl+F jumps straight to a
 *  list's search box — the shortcut every wholesale list page answers to, so a search
 *  box on a new page doesn't have to hand-roll its own copy of this listener. */
export function useSearchShortcut<
  T extends HTMLInputElement = HTMLInputElement,
>(): RefObject<T | null> {
  const inputRef = useRef<T>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const activeEl = document.activeElement;
      const isTyping =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement;

      if (
        (event.key === "/" && !isTyping) ||
        ((event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "f")
      ) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return inputRef;
}
