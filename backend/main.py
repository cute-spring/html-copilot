import os
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")

app = FastAPI(title="AI HTML Editor API")
app.add_middleware(
    CORSMiddleware,
    # Vite may be opened as either hostname during local development.
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Element(BaseModel):
    id: str
    tagName: str
    text: str
    outerHTML: str
    parentHTML: str | None = None


class EditRequest(BaseModel):
    instruction: str
    element: Element
    parentHTML: str | None = None


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/edit")
async def edit(request: EditRequest) -> dict[str, str]:
    prompt = f"""You are an HTML editing assistant.
The user selected an HTML element from a web page. Modify ONLY this selected element.

User instruction:
{request.instruction}

Selected element:
{request.element.outerHTML}

Return ONLY the replacement HTML for this element. Do not return markdown, code fences, explanation, JSON, or unrelated content. The output must be valid HTML that can directly replace the selected element."""
    payload: dict[str, Any] = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "options": {"temperature": 0.2},
        "messages": [{"role": "user", "content": prompt}],
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
            response.raise_for_status()
            content = response.json()["message"]["content"].strip()
    except httpx.ConnectError as exc:
        raise HTTPException(503, "Cannot connect to Ollama. Start it with: ollama serve") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Ollama returned an error: {exc.response.text}") from exc
    except (KeyError, TypeError) as exc:
        raise HTTPException(502, "Ollama returned an unexpected response.") from exc

    # A few models occasionally ignore the no-fences instruction.
    if content.startswith("```html"):
        content = content.removeprefix("```html").removesuffix("```").strip()
    elif content.startswith("```"):
        content = content.removeprefix("```").removesuffix("```").strip()
    if not content.startswith("<"):
        raise HTTPException(502, "Ollama did not return replacement HTML. Try a more specific instruction.")
    return {"html": content}
