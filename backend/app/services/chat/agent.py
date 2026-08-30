"""LangGraph tool-calling agent for the retail chatbot.

Deliberately retail-only for now (see routers/chat.py's role check) — wholesale runs
on a completely separate data model (app/models/wholesale.py) that tools.py's tools
don't touch. Every tool takes the resolved `User` and applies the same
`if user.branch_id is not None: filter(...)` scoping every other router uses, so a
branch-scoped account never sees another branch's data through the chatbot either.
"""

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.user import User
from app.services.chat.tools import build_tools

# Bounds how much conversation gets replayed to the model each turn — the frontend
# keeps the full transcript, but only the recent tail matters for context and cost.
MAX_HISTORY_MESSAGES = 20

SYSTEM_PROMPT = """You are the in-app assistant for Branchwise, a retail POS data \
system used by a Myanmar retail business with several branches. You help staff \
understand their own sales, inventory, purchases, and data-quality warnings, and you \
can explain how the app's import/warnings workflow works.

Rules:
- Every number you report must come from a tool call — never guess, estimate, or \
invent a figure.
- Dates are always YYYY-MM-DD. When a question doesn't name a date range, use each \
tool's default window rather than asking a clarifying question first.
- You don't know today's date on your own — before handling any relative date \
("today", "yesterday", "this week", "last month"), call get_current_date first and \
compute date_from/date_to from its answer rather than guessing.
- You only ever see the caller's own branch's data (or every branch, for an admin \
account) — the tools already enforce this, so there's no need to ask which branch.
- Keep answers short and concrete: lead with the number/answer, then at most a \
sentence or two of context.

How the app works (for "how do I..." questions):
- Staff upload POS report exports (sales/inventory/purchase CSV/XLS/XLSX) on the \
Import page; the app previews the cleaned data before anything is saved, then Confirm \
persists it.
- Sales import is safe to re-run (it skips slips it already has). Purchase import is \
NOT idempotent — re-uploading the same file double-counts it.
- Inventory keeps every snapshot ever imported; "current stock" is always just the \
most recent snapshot per product per branch.
- Every confirmed import shows up in Import History, and can be reverted there \
(undoes the data, keeps the audit record) — reverting then re-confirming a corrected \
file is the standard way to fix a bad import.
- The Warning page lists data-quality issues found in already-imported data: bad \
numbers on sale/inventory/purchase rows, stock codes sold/purchased with no inventory \
record, and a daily check comparing each product's latest stock snapshot against what \
it should be (previous snapshot plus purchases minus sales). Reverting and \
re-confirming the linked import is the fix for most of these."""


class ChatNotConfigured(RuntimeError):
    """Raised when OPENAI_API_KEY isn't set, so the router can turn it into a clear
    error instead of letting the OpenAI SDK fail deep inside a tool call."""


def _to_langchain_messages(history: list[dict]) -> list[BaseMessage]:
    messages: list[BaseMessage] = [SystemMessage(content=SYSTEM_PROMPT)]
    for m in history[-MAX_HISTORY_MESSAGES:]:
        if m["role"] == "user":
            messages.append(HumanMessage(content=m["content"]))
        else:
            messages.append(AIMessage(content=m["content"]))
    return messages


def run_chat(db: Session, user: User, history: list[dict]) -> str:
    settings = get_settings()
    if not settings.openai_api_key:
        raise ChatNotConfigured("OPENAI_API_KEY is not configured on the backend")

    model = ChatOpenAI(
        model=settings.openai_chat_model,
        api_key=settings.openai_api_key,
        temperature=0,
    )
    agent = create_react_agent(model, build_tools(db, user))
    result = agent.invoke({"messages": _to_langchain_messages(history)})
    reply = result["messages"][-1].content
    return reply if isinstance(reply, str) else str(reply)
