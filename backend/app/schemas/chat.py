from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str = Field(description="'user' or 'assistant'")
    content: str


class ChatRequest(BaseModel):
    # Stateless: the frontend keeps the transcript and resends it each turn, so there's
    # no server-side chat-session table to manage yet.
    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    reply: str
