import { lazy, Suspense, useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import { Spinner } from "@renderer/components/ui/Spinner";
import { ChatIcon, CloseIcon } from "@renderer/components/ui/icons";
import type { Profile } from "@renderer/components/features/types";

// The chat, as a button that floats over whatever page you are on rather than a section
// you have to navigate to. Asking "what's low on stock?" is something you do *while*
// looking at something else, and a nav item made it a place you had to leave the page
// for — which is also why the answer is more useful beside the page that prompted the
// question than on a screen of its own.
//
// The panel is kept mounted once it has been opened (hidden, not unmounted) so closing it
// mid-conversation doesn't throw the thread away: chat history lives in component state,
// since there is no server-side session store yet (see ChatPanel).

const ChatPanel = lazy(() => import("@renderer/components/features/chat/ChatPanel"));

interface Props {
  session: Session;
  profile: Profile | null;
}

export function ChatLauncher({ session, profile }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // Nothing is loaded or mounted until the first open — the chat bundle is only fetched
  // by someone who actually wants it.
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function toggle(): void {
    setOpened(true);
    setOpen((value) => !value);
  }

  return (
    <>
      {opened && (
        <div
          role="dialog"
          aria-label="Chat"
          // Hidden by a display class, not the `hidden` attribute: the attribute's
          // display:none comes from the UA stylesheet and loses to any author display
          // rule, so `hidden` next to `flex` left the panel on screen and nothing could
          // close it. Hidden rather than unmounted, per the note above about the thread.
          className={cn(
            "fixed z-40 bg-bg-base border border-border rounded-xl shadow-lg overflow-hidden",
            open ? "flex flex-col" : "hidden",
            // Anchored above the button on a desktop window; on a phone-sized window it
            // fills the screen instead, since a 400px panel on a 380px screen is a worse
            // version of the same thing.
            "inset-x-3 bottom-20 top-16 sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-24",
            "sm:w-[26rem] sm:h-[32rem] sm:max-h-[calc(100vh-9rem)]",
          )}
        >
          <div className="flex items-center justify-between gap-2 px-4 h-12 shrink-0 border-b border-border bg-bg-subtle">
            <span className="text-sm font-semibold text-text-primary">
              Chat
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="p-1 rounded text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center">
                  <Spinner className="w-5 h-5 text-text-muted" />
                </div>
              }
            >
              <ChatPanel session={session} profile={profile} />
            </Suspense>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Close chat" : "Open chat"}
        className={cn(
          "fixed z-40 bottom-5 right-5 w-12 h-12 rounded-full shadow-lg",
          "flex items-center justify-center transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
          open
            ? "bg-bg-raised text-text-primary border border-border"
            : "bg-brand text-white hover:bg-brand-hover",
        )}
      >
        {open ? (
          <CloseIcon className="w-5 h-5" />
        ) : (
          <ChatIcon className="w-5 h-5" />
        )}
      </button>
    </>
  );
}

export default ChatLauncher;
