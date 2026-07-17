import json
import os
import time
from typing import Any

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.auth import get_current_user

router = APIRouter(prefix="/llm", tags=["llm"])

def create_openwebui_jwt(user_id: str, secret: str) -> str:
    payload = {
        "id": user_id,
        "exp": int(time.time()) + 300
    }
    return jwt.encode(payload, secret, algorithm="HS256")

@router.post("/chat")
async def proxy_chat_completion(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    secret = os.environ.get("WEBUI_SECRET_KEY")
    if not secret:
        raise HTTPException(status_code=500, detail="WEBUI_SECRET_KEY not configured")

    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user identity")

    jwt_token = create_openwebui_jwt(user_id, secret)
    
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    target_url = "http://open-webui:80/api/chat/completions"
    
    async def stream_proxy():
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", 
                target_url, 
                json=body,
                headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"}
            ) as response:
                if response.status_code != 200:
                    err = await response.aread()
                    yield err
                    return
                async for chunk in response.aiter_bytes():
                    yield chunk

    return StreamingResponse(stream_proxy(), media_type="text/event-stream")

@router.post("/chats/new")
async def proxy_chats_new(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    secret = os.environ.get("WEBUI_SECRET_KEY")
    if not secret:
        raise HTTPException(status_code=500, detail="WEBUI_SECRET_KEY not configured")

    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user identity")

    jwt_token = create_openwebui_jwt(user_id, secret)
    
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    target_url = "http://open-webui:80/api/v1/chats/new"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            target_url, 
            json=body,
            headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"}
        )
        return response.json()
