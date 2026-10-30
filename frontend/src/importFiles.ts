export type ImportedFiles = {
  entries: Map<string, File>;
  htmlPaths: string[];
  currentPath: string;
  folderName: string;
};

function normalizePath(path: string) {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export function collectFiles(selected: File[], folder: boolean): ImportedFiles {
  const entries = new Map<string, File>();
  const folderName = folder ? selected[0]?.webkitRelativePath.split("/")[0] || "Folder" : "";
  for (const file of selected) {
    const relative = folder ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
    entries.set(normalizePath(relative), file);
  }
  const htmlPaths = [...entries.keys()].filter(path => /\.html?$/i.test(path)).sort((a, b) => {
    const score = (value: string) => /(^|\/)index\.html?$/i.test(value) ? 0 : 1;
    return score(a) - score(b) || a.localeCompare(b);
  });
  if (!htmlPaths.length) throw new Error("No .html file was found. Choose an HTML file or a folder containing one.");
  return { entries, htmlPaths, currentPath: htmlPaths[0], folderName };
}

function isLocalReference(value: string) {
  return value && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/)/i.test(value);
}

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read a linked file."));
    reader.readAsDataURL(blob);
  });
}

/** Resolve uploaded sibling resources to in-memory data URLs, without changing the saved HTML. */
export async function resolveImportedAssets(html: string, imported: ImportedFiles) {
  const cache = new Map<string, string>();
  const missing = new Set<string>();
  const directoryOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);
  const resolvePath = (value: string, from: string) => {
    const clean = value.split(/[?#]/, 1)[0];
    return normalizePath(directoryOf(from) + decodeURIComponent(clean));
  };
  const resource = async (value: string, from: string): Promise<string> => {
    if (!isLocalReference(value)) return value;
    let path: string;
    try { path = resolvePath(value, from); }
    catch { missing.add(value); return value; }
    const file = imported.entries.get(path);
    if (!file) { missing.add(value); return value; }
    const cached = cache.get(path);
    if (cached) return cached;
    let url: string;
    if (/\.css$/i.test(path)) {
      // The pending marker also prevents accidental cycles in CSS @import chains.
      cache.set(path, value);
      const css = await rewriteCss(await file.text(), path);
      url = await asDataUrl(new Blob([css], { type: "text/css" }));
    } else {
      url = await asDataUrl(file);
    }
    cache.set(path, url);
    return url;
  };
  const replaceAsync = async (input: string, pattern: RegExp, transform: (match: RegExpExecArray) => Promise<string>) => {
    let result = "";
    let position = 0;
    for (const match of input.matchAll(pattern)) {
      result += input.slice(position, match.index) + await transform(match);
      position = match.index + match[0].length;
    }
    return result + input.slice(position);
  };
  const rewriteCss = async (css: string, from: string) => {
    let output = await replaceAsync(css, /url\(\s*(['"]?)([^'"()]+)\1\s*\)/gi,
      async match => `url("${await resource(match[2].trim(), from)}")`);
    output = await replaceAsync(output, /@import\s+(['"])([^'"]+)\1/gi,
      async match => `@import "${await resource(match[2], from)}"`);
    return output;
  };

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of doc.querySelectorAll<HTMLElement>("[src], [href], [poster], [srcset]")) {
    for (const attribute of ["src", "href", "poster"]) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, await resource(value, imported.currentPath));
    }
    const srcset = element.getAttribute("srcset");
    if (srcset) {
      const candidates = await Promise.all(srcset.split(",").map(async candidate => {
        const [value, ...descriptor] = candidate.trim().split(/\s+/);
        return `${await resource(value, imported.currentPath)} ${descriptor.join(" ")}`.trim();
      }));
      element.setAttribute("srcset", candidates.join(", "));
    }
  }
  for (const style of doc.querySelectorAll("style")) style.textContent = await rewriteCss(style.textContent || "", imported.currentPath);
  for (const element of doc.querySelectorAll<HTMLElement>("[style]")) {
    element.setAttribute("style", await rewriteCss(element.getAttribute("style") || "", imported.currentPath));
  }
  return {
    html: "<!doctype html>\n" + doc.documentElement.outerHTML,
    missing: [...missing],
    dispose: () => {},
  };
}
