import { useEffect, useRef, useState } from "react";

// Measures a pinned toolbar (title/description/actions above a table) so a sticky
// table header can stack right below it — Excel-style frozen panes — instead of
// overlapping it. Apply `containerStyle` to the outer wrapper (it sets the
// `--sticky-offset` CSS var, which Thead reads) and `aboveRef` to the pinned block
// itself (give it `sticky top-14 lg:top-0 z-30 bg-bg-base`).
export function useStickyAbove(): {
  aboveRef: React.RefObject<HTMLDivElement | null>;
  containerStyle: React.CSSProperties;
} {
  const aboveRef = useRef<HTMLDivElement>(null);
  const [aboveHeight, setAboveHeight] = useState(0);

  useEffect(() => {
    const el = aboveRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setAboveHeight(entries[0].contentRect.height),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return {
    aboveRef,
    containerStyle: {
      "--sticky-offset": `${aboveHeight}px`,
    } as React.CSSProperties,
  };
}
