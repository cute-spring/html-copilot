export type SelectedElement = {
  id: string;
  tagName: string;
  text: string;
  outerHTML: string;
  parentHTML?: string;
};

/** Adds deterministic IDs so the source, preview, and replacement target agree. */
export function withElementIds(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("body *").forEach((element, index) => {
    if (!element.hasAttribute("data-ai-id")) element.setAttribute("data-ai-id", `ai-${index + 1}`);
  });
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

export function createPreviewDocument(html: string, runDocumentScripts = false, highlightId?: string) {
  const doc = new DOMParser().parseFromString(withElementIds(html), "text/html");
  if (!runDocumentScripts) {
    doc.querySelectorAll("script, iframe, object, embed, meta[http-equiv='refresh']").forEach(element => element.remove());
    doc.querySelectorAll("*").forEach(element => {
      for (const attribute of [...element.attributes]) {
        if (attribute.name.startsWith("on") || /^(?:href|src)$/i.test(attribute.name) && /^javascript:/i.test(attribute.value)) {
          element.removeAttribute(attribute.name);
        }
      }
    });
  }
  const documentWithIds = "<!doctype html>\n" + doc.documentElement.outerHTML;
  const script = `<script>
    (() => {
      let selected;
      const initial = ${JSON.stringify(highlightId || null)};
      if (initial) {
        selected = document.querySelector('[data-ai-id="' + CSS.escape(initial) + '"]');
        if (selected) {
          selected.setAttribute('data-ai-selected', '');
          window.addEventListener('load', () => {
            requestAnimationFrame(() => selected.scrollIntoView({ block: 'center' }));
          }, { once: true });
        }
      }
      const clearHover = () => document.querySelectorAll('[data-ai-hover]').forEach(el => el.removeAttribute('data-ai-hover'));
      document.addEventListener('mouseover', event => {
        const el = event.target.closest('body *');
        if (!el) return;
        clearHover();
        if (el !== selected) el.setAttribute('data-ai-hover', '');
      });
      document.addEventListener('mouseout', clearHover);
      document.addEventListener('click', event => {
        const el = event.target.closest('body *');
        if (!el) return;
        event.preventDefault(); event.stopPropagation();
        if (selected) selected.removeAttribute('data-ai-selected');
        selected = el; selected.setAttribute('data-ai-selected', ''); clearHover();
        window.parent.postMessage({
          type: 'ELEMENT_SELECTED',
          id: el.dataset.aiId,
          tagName: el.tagName,
          text: (el.innerText || el.textContent || '').trim(),
          outerHTML: el.outerHTML,
          parentHTML: el.parentElement ? el.parentElement.outerHTML : ''
        }, '*');
      }, true);
    })();
  <\/script>`;
  const style = `<style>
    [data-ai-hover] { outline: 1px dashed #64748b !important; outline-offset: 3px; cursor: crosshair !important; }
    [data-ai-selected] { outline: 3px solid #2563eb !important; outline-offset: 3px; }
  </style>`;
  return documentWithIds.replace("</head>", `${style}</head>`).replace("</body>", `${script}</body>`);
}
