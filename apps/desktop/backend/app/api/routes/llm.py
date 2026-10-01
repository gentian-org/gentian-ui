import base64
import json
import os
import time
from functools import lru_cache
from typing import Any

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from kubernetes import client, config

from app.core.auth import get_current_user

router = APIRouter(prefix="/llm", tags=["llm"])

@lru_cache
def _core_v1_api() -> client.CoreV1Api:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CoreV1Api()

def get_litellm_secret() -> str | None:
    try:
        secret = _core_v1_api().read_namespaced_secret("llm-sensitive-values", "platform-kernel")
        return base64.b64decode(secret.data["litellm_master_key"]).decode('utf-8')
    except Exception as e:
        print(f"Failed to read litellm_master_key: {e}")
        return None

@router.post("/chat")
async def proxy_chat_completion(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    # Retrieve LiteLLM master key to proxy directly (scratchpad widget mode)
    master_key = get_litellm_secret()
    if not master_key:
        raise HTTPException(status_code=500, detail="LITELLM_MASTER_KEY not configured")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    target_url = "http://litellm-proxy.platform-kernel.svc.cluster.local:4000/chat/completions"
    models_url = "http://litellm-proxy.platform-kernel.svc.cluster.local:4000/v1/models"
    
    async def stream_proxy():
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Fetch models to ensure we pass a valid one
            models_resp = await client.get(models_url, headers={"Authorization": f"Bearer {master_key}"})
            if models_resp.status_code == 200:
                models_data = models_resp.json().get("data", [])
                available_models = [m["id"] for m in models_data]
                if available_models and body.get("model") not in available_models:
                    body["model"] = available_models[0]

            async with client.stream(
                "POST", 
                target_url, 
                json=body,
                headers={"Authorization": f"Bearer {master_key}", "Content-Type": "application/json"}
            ) as response:
                if response.status_code != 200:
                    err = await response.aread()
                    yield err
                    return
                async for chunk in response.aiter_bytes():
                    yield chunk

    return StreamingResponse(stream_proxy(), media_type="text/event-stream")


