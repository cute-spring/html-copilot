import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { collectFiles, resolveImportedAssets, type ImportedFiles } from "./importFiles";
import { createPreviewDocument, SelectedElement, withElementIds } from "./preview";

const DEMO_HTML = `<!doctype html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
    .hero { background: white; padding: 32px; border-radius: 12px; max-width: 680px; }
    .button { display: inline-block; padding: 10px 20px; background: #333; color: white; border: 0; border-radius: 6px; }
  </style>
</head>
<body>
  <section class="hero">
    <h1>Welcome to Our Website</h1>
    <p>We provide professional services to our customers.</p>
    <button class="button">Learn More</button>
  </section>
</body>
</html>`;

// Use the loopback address explicitly: localhost:8000 is used by another
// local service on this machine, while this editor's FastAPI server binds here.
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

type AiProposal = {
  sourceHtml: string;
  proposedHtml: string;
  replacement: string;
  element: SelectedElement;
  instruction: string;
};

function elementText(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.firstElementChild?.textContent?.trim() || "(No text)";
}

function replaceElement(html: string, id: string, replacement: string) {
  const doc = new DOMParser().parseFromString(withElementIds(html), "text/html");
  const target = doc.querySelector(`[data-ai-id="${CSS.escape(id)}"]`);
  if (!target) throw new Error("The selected element is no longer in the document.");
  const wrapper = doc.createElement("div");
  wrapper.innerHTML = replacement.trim();
  const next = wrapper.firstElementChild;
  if (!next) throw new Error("AI did not return a valid HTML element.");
  next.setAttribute("data-ai-id", id);
  // Selection markers belong only to the iframe overlay, never the editable source.
  next.removeAttribute("data-ai-selected");
  next.removeAttribute("data-ai-hover");
  target.replaceWith(next);
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

export default function App() {
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const requestVersion = useRef(0);
  const [html, setHtml] = useState(DEMO_HTML);
  const [history, setHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [textValue, setTextValue] = useState("");
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(() => createPreviewDocument(DEMO_HTML));
  const [imported, setImported] = useState<ImportedFiles | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [runDocumentScripts, setRunDocumentScripts] = useState(false);
  const [missingAssets, setMissingAssets] = useState<string[]>([]);
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [proposalPreview, setProposalPreview] = useState("");
  const [showProposalPreview, setShowProposalPreview] = useState(false);

  const clearProposal = () => {
    requestVersion.current += 1;
    setProposal(null);
    setProposalPreview("");
    setShowProposalPreview(false);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    let dispose = () => {};
    const render = async () => {
      try {
        const resolved = imported ? await resolveImportedAssets(html, imported) : null;
        if (resolved) dispose = resolved.dispose;
        if (!active) { dispose(); return; }
        setPreview(createPreviewDocument(resolved?.html || html, runDocumentScripts));
        setMissingAssets(resolved?.missing || []);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load the imported files.");
      }
    };
    void render();
    return () => { active = false; dispose(); };
  }, [html, imported, runDocumentScripts]);

  useEffect(() => {
    if (!proposal) { setProposalPreview(""); return; }
    let active = true;
    const render = async () => {
      try {
        const resolved = imported ? await resolveImportedAssets(proposal.proposedHtml, imported) : null;
        if (active) setProposalPreview(createPreviewDocument(resolved?.html || proposal.proposedHtml, runDocumentScripts, proposal.element.id));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not preview the AI suggestion.");
      }
    };
    void render();
    return () => { active = false; };
  }, [proposal, imported, runDocumentScripts]);

  useEffect(() => {
    if (!showProposalPreview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowProposalPreview(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showProposalPreview]);

  const importFiles = async (event: ChangeEvent<HTMLInputElement>, folder: boolean) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    try {
      const collection = collectFiles(files, folder);
      clearProposal();
      setHtml(await collection.entries.get(collection.currentPath)!.text());
      setImported(collection);
      setHistory([]); setSelected(null); setError(""); setRunDocumentScripts(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import the selected files.");
    }
  };

  const choosePage = async (path: string) => {
    if (!imported) return;
    clearProposal();
    setHtml(await imported.entries.get(path)!.text());
    setImported({ ...imported, currentPath: path });
    setHistory([]); setSelected(null); setError("");
  };

  const downloadHtml = () => {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = imported?.currentPath.split("/").at(-1) || "edited-page.html";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== previewFrame.current?.contentWindow || event.data?.type !== "ELEMENT_SELECTED") return;
      const element = event.data as SelectedElement;
      clearProposal();
      setSelected(element); setTextValue(element.text); setError("");
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const applyReplacement = (replacement: string) => {
    if (!selected) return;
    try {
      const nextHtml = replaceElement(html, selected.id, replacement);
      clearProposal();
      setHistory(items => [...items, html]);
      setHtml(nextHtml);
      setSelected(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not apply the edit."); }
  };

  const applyText = () => {
    if (!selected) return;
    const doc = new DOMParser().parseFromString(selected.outerHTML, "text/html");
    const element = doc.body.firstElementChild;
    if (!element) return;
    element.textContent = textValue;
    applyReplacement(element.outerHTML);
  };

  const runAi = async () => {
    if (!selected || !instruction.trim()) return;
    const requestId = ++requestVersion.current;
    const sourceHtml = html;
    const element = selected;
    const requestedInstruction = instruction.trim();
    setProposal(null);
    setLoading(true); setError("");
    try {
      const response = await fetch(`${API_URL}/api/edit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: requestedInstruction, element, parentHTML: element.parentHTML }),
      });
      const data = await response.json().catch(() => ({}));
      if (requestId !== requestVersion.current) return;
      if (!response.ok) throw new Error(data.detail || "The AI edit failed.");
      if (typeof data.html !== "string") throw new Error("The AI did not return replacement HTML.");
      const proposedHtml = replaceElement(sourceHtml, element.id, data.html);
      setProposal({ sourceHtml, proposedHtml, replacement: data.html, element, instruction: requestedInstruction });
    } catch (cause) {
      if (requestId === requestVersion.current) setError(cause instanceof Error ? cause.message : "Cannot connect to Ollama. Please make sure it is running.");
    } finally { if (requestId === requestVersion.current) setLoading(false); }
  };

  const applyProposal = () => {
    if (!proposal) return;
    if (html !== proposal.sourceHtml) {
      clearProposal();
      setError("The page changed while the suggestion was open. Ask AI again for the current page.");
      return;
    }
    setHistory(items => [...items, html]);
    setHtml(proposal.proposedHtml);
    setSelected(null);
    setInstruction("");
    clearProposal();
    setError("");
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    clearProposal();
    setHtml(previous); setHistory(items => items.slice(0, -1)); setSelected(null); setError("");
  };

  return <main className="app-shell">
    <header><div><span className="eyebrow">LOCAL OLLAMA • MVP</span><h1>AI HTML Editor</h1></div>
      <div className="header-actions">
        <label className="file-button">Open HTML<input type="file" accept=".html,.htm,text/html" onChange={event => void importFiles(event, false)} /></label>
        <label className="file-button">Open folder<input type="file" multiple ref={element => { if (element) element.setAttribute("webkitdirectory", ""); }} onChange={event => void importFiles(event, true)} /></label>
        <button className="toolbar-button" onClick={() => setShowSource(value => !value)}>{showSource ? "Hide code" : "View code"}</button>
        <button className="toolbar-button" onClick={downloadHtml}>Download HTML</button>
        <button className="undo" onClick={undo} disabled={!history.length}>↶ Undo</button>
      </div></header>
    {showSource && <section className="source-drawer"><div className="panel-heading"><span>HTML source</span><small>Changes update the preview</small></div>
      <textarea aria-label="HTML source" spellCheck="false" value={html} onChange={e => { clearProposal(); setHtml(e.target.value); setSelected(null); }} />
    </section>}
    <section className="workspace">
      <section className="preview-panel"><div className="panel-heading"><span>{imported ? imported.currentPath : "Live Preview"}</span><small>Click any element to select it</small></div>
        {imported && <div className="import-options">
          <span>{imported.folderName ? `${imported.folderName} · ` : ""}{imported.entries.size} file{imported.entries.size === 1 ? "" : "s"} loaded locally</span>
          {imported.htmlPaths.length > 1 && <select aria-label="Choose HTML page" value={imported.currentPath} onChange={event => void choosePage(event.target.value)}>{imported.htmlPaths.map(path => <option key={path} value={path}>{path}</option>)}</select>}
          <label className="script-option"><input type="checkbox" checked={runDocumentScripts} onChange={event => setRunDocumentScripts(event.target.checked)} /> Run imported scripts</label>
        </div>}
        {missingAssets.length > 0 && <p className="asset-warning">{missingAssets.length} linked local file{missingAssets.length === 1 ? "" : "s"} not found. Open the containing folder to load its CSS, images, and scripts.</p>}
        <iframe ref={previewFrame} title="Editable HTML preview" sandbox="allow-scripts" srcDoc={preview} />
      </section>
      <aside className="assistant-panel"><div className="panel-heading"><span>AI Assistant</span><span className="status-dot">Ready</span></div>
        {selected ? <><section className="selected-card"><p className="label">SELECTED ELEMENT</p><div className="tag">&lt;{selected.tagName.toLowerCase()}&gt;</div><p className="selected-text">{selected.text || "No direct text content"}</p><details><summary>HTML details</summary><code>{selected.outerHTML}</code></details></section>
          {proposal && <section className="proposal-card" aria-label="AI suggestion">
            <div className="proposal-heading"><span>AI suggestion</span><span>Not applied</span></div>
            <p className="proposal-note">Your original page stays unchanged until you apply this suggestion.</p>
            <p className="proposal-instruction">“{proposal.instruction}”</p>
            <div className="proposal-comparison"><div><small>BEFORE</small><p>{elementText(proposal.element.outerHTML)}</p></div><div><small>AFTER</small><p>{elementText(proposal.replacement)}</p></div></div>
            <button className="preview-suggestion" onClick={() => setShowProposalPreview(true)} disabled={!proposalPreview}>Preview suggested page ↗</button>
            <div className="proposal-actions"><button className="run-ai" onClick={applyProposal}>Apply suggestion</button><button className="secondary" onClick={() => void runAi()} disabled={loading}>Try again</button><button className="quiet-button" onClick={clearProposal}>Discard</button></div>
          </section>}
          <label>Text <textarea className="text-edit" value={textValue} onChange={e => setTextValue(e.target.value)} /></label>
          <button className="secondary" onClick={applyText}>Apply Text</button>
          <label>Instruction <textarea value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Ask AI to modify this element…" /></label>
          <button className="run-ai" onClick={runAi} disabled={loading || !instruction.trim()}>{loading ? "AI is preparing a suggestion…" : proposal ? "Generate a new suggestion →" : "Run AI →"}</button>
        </> : <div className="empty-state"><div>✦</div><strong>Select an element</strong><p>Click a heading, paragraph, button, image, or section in the preview to start editing.</p><p>Start with the sample page or open your own HTML file or folder above.</p></div>}
        {error && <p role="alert" className="error">{error}</p>}
      </aside>
    </section>
    {proposal && showProposalPreview && <div className="proposal-modal-backdrop" onClick={() => setShowProposalPreview(false)}>
      <section className="proposal-modal" role="dialog" aria-modal="true" aria-label="Suggested page preview" onClick={event => event.stopPropagation()}>
        <div className="proposal-modal-header"><div><strong>Suggested page preview</strong><p>The original page remains unchanged.</p></div><button className="toolbar-button" onClick={() => setShowProposalPreview(false)}>Close</button></div>
        <iframe title="AI suggested page preview" sandbox="allow-scripts" srcDoc={proposalPreview} />
        <div className="proposal-modal-footer"><button className="secondary" onClick={() => setShowProposalPreview(false)}>Back to editor</button><button className="run-ai" onClick={applyProposal}>Apply suggestion</button></div>
      </section>
    </div>}
  </main>;
}
