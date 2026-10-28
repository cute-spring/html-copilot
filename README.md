# AI HTML Editor MVP

产品功能清单与分阶段计划见 [PDF 编辑器功能借鉴路线图](docs/pdf-editor-inspired-roadmap.md)。

A deliberately small local demo for selecting an element in an HTML preview, changing its text directly, or asking a locally running Ollama model to rewrite it.

## What it does

- Open an HTML file, or a folder containing HTML and its relative CSS, images, and scripts
- Live iframe preview, with HTML source available on demand
- Click-to-select with visible hover and selection outlines
- Direct text edits
- AI element replacement through FastAPI → Ollama
- AI suggestion preview with Apply, Try again, and Discard before the page changes
- One-step-or-more undo history
- Download the edited HTML

## Run it

Prerequisites: Node.js 20+, Python 3.10+, and [Ollama](https://ollama.com/) running locally.

```bash
# Terminal 1
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

```bash
# Terminal 2
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Set `OLLAMA_MODEL` before starting the backend to use a different model (the default is `qwen3:8b`). If necessary, download it with `ollama pull qwen3:8b`.

## Importing a page

Use **Open HTML** for a self-contained HTML document (including inline `<style>`). Use **Open folder** when the HTML references local `.css`, images, fonts, or `.js` files by relative path. The files stay in browser memory and are not uploaded to FastAPI. If the folder has several HTML pages, choose the page from the dropdown above the preview.

Imported scripts are disabled initially. Turn on **Run imported scripts** only for a folder you trust; scripts may make network requests. Classic scripts and inline scripts can run in the sandboxed preview. Module imports, server-rendered pages, and build-tool projects may require their original development server. External web URLs are loaded by the browser and need a network connection. **Download HTML** saves the edited HTML, but related CSS/images/scripts remain in their original files, so keep those files alongside it.

## Intentional MVP limits

There is no database, authentication, validation layer, collaboration, or complex HTML AST. The browser uses simple `data-ai-id` attributes and replaces the selected element with the fragment returned by Ollama.
# html-copilot
