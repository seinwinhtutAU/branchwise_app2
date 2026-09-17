from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.schemas.chat import ChatRequest, ChatResponse
from app.retail.services.chat import ChatNotConfigured, run_chat

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("")
def send_chat_message(
    payload: ChatRequest,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    # Retail-only for now (see chat_agent.py's docstring) — wholesale runs on a
    # separate data model none of the chatbot's tools touch.
    if user.role == UserRole.WHOLESALE:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Chat is not available for wholesale accounts"
        )
    if not payload.messages or payload.messages[-1].role != "user":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Last message must be from the user")

    try:
        reply = run_chat(db, user, [m.model_dump() for m in payload.messages])
    except ChatNotConfigured as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc

    return ChatResponse(reply=reply)
