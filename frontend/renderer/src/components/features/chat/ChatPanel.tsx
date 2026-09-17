import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Textarea } from "@renderer/components/ui/Textarea";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Spinner } from "@renderer/components/ui/Spinner";
import { ChatIcon, SendIcon } from "@renderer/components/ui/icons";
import type { Profile } from "@renderer/components/features/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  session: Session;
  profile: Profile | null;
}

const SUGGESTIONS = [
  "How much did we sell today?",
  "What are our top-selling products this month?",
  "What's low on stock?",
  "Explain today's warnings.",
];

function ChatBubble({ message }: { message: ChatMessage }): React.JSX.Element {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
          isUser
            ? "bg-brand text-white"
            : "bg-bg-raised text-text-primary border border-border",
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

// The conversation itself: the message list and the composer, sized to fill whatever
// holds it. Its container is ChatLauncher's popup, which owns the header, the close
// button and the open/closed state — this file only knows how to have a conversation.
//
// Chat history lives only in this component's state — there's no server-side chat-
// session table yet (see backend/app/schemas/chat.py), so signing out or reloading
// starts a fresh conversation. The launcher keeps this mounted while the popup is
// closed, so closing the popup mid-conversation does not throw the thread away.
function ChatPanel({ session, profile }: Props): React.JSX.Element {
  const showToast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function sendMessage(content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed || sending) return;

    const next = [...messages, { role: "user" as const, content: trimmed }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: next }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        showToast("error", detail?.detail ?? `Chat failed: ${response.status}`);
        return;
      }
      const body = await response.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: body.reply as string },
      ]);
    } catch {
      showToast(
        "error",
        "Failed to reach the chat assistant — is the backend running?",
      );
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 px-4 py-3">
        {messages.length === 0 ? (
          <EmptyState
            icon={<ChatIcon />}
            title="Ask me anything about your data"
            description={`Ask about ${profile?.branch_name ?? "your"} sales, inventory, purchases or warnings — or try one of these.`}
            action={
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s}
                    variant="secondary"
                    size="sm"
                    onClick={() => setInput(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            }
          />
        ) : (
          messages.map((m, i) => <ChatBubble key={i} message={m} />)
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3.5 py-2.5 bg-bg-raised border border-border">
              <Spinner className="w-4 h-4 text-text-muted" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 p-3 border-t border-border">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about sales, inventory, purchases, or warnings…"
          className="flex-1"
        />
        <Button
          onClick={() => sendMessage(input)}
          disabled={!input.trim()}
          loading={sending}
          size="md"
        >
          <SendIcon className="w-4 h-4" />
          Send
        </Button>
      </div>
    </div>
  );
}

export default ChatPanel;
