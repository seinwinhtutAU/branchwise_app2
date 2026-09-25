/** Puts text on the clipboard. The renderer is not always a secure context — a packaged
 *  app is served from file:// — where `navigator.clipboard` is missing, so the old
 *  hidden-textarea trick is kept as the fallback rather than the copy silently doing
 *  nothing. */
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
