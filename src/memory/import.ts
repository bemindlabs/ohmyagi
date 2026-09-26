/**
 * Bring a document into memory as markdown (D-084) — what `ohmyagi memory
 * import` and the web page's Import… run.
 *
 * A file (md, txt, html, pdf, docx, and what LibreOffice opens) or a web link
 * becomes one markdown memory under `memory/imported/`, with front matter that
 * says where it came from. Longer than one memory may be (256 KB), it is cut
 * at headings or paragraphs into parts in a folder of their own. Every part
 * then goes through the same gates as `memory write`: the path rules, the
 * credential scan, and the S7.3 basis the caller checks first.
 *
 * Conversion is plain text out, never HTML in: a page's scripts, styles and
 * markup are dropped, so what recall later attaches to a prompt is words.
 *
 * Nothing here reaches for the machine or the network on its own: the caller
 * hands in the scratch directory and the fetch (ambient-env and places tests).
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { spawnGuarded } from "../spawn.ts";
import { MAX_MEMORY_BYTES } from "./write.ts";

/** What a file of this kind is turned into markdown with. */
export const IMPORT_KINDS: Readonly<Record<string, "text" | "markdown" | "html" | "pdf" | "docx" | "office" | "sheet" | "code">> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".html": "html",
  ".htm": "html",
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "office",
  ".odt": "office",
  ".rtf": "office",
  ".pptx": "office",
  ".ppt": "office",
  ".odp": "office",
  ".epub": "office",
  ".xlsx": "sheet",
  ".xls": "sheet",
  ".ods": "sheet",
  ".csv": "code",
  ".json": "code",
  ".yaml": "code",
  ".yml": "code",
};

/** The largest source taken in: a file on disk or a page off the web. */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
/** A part is cut below the memory cap, leaving room for its front matter. */
const PART_BYTES = MAX_MEMORY_BYTES - 4 * 1024;
const TOOL_MS = 120_000;

export interface Converted {
  readonly title: string;
  readonly markdown: string;
  /** How it was turned into markdown, for the plan: "as written", "pdftotext", … */
  readonly via: string;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", middot: "·", bull: "•" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const tidy = (text: string) =>
  text
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * A web page as markdown: the `<article>` or `<main>` if there is one, else
 * the body; headings, paragraphs, lists, links, emphasis, code and table rows
 * kept; everything else — scripts, styles, navigation, forms — dropped.
 */
export function htmlToMarkdown(html: string, base?: string): Converted {
  const title = tidy(decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "") ?? ""));
  let body = html.replace(/<!--[\s\S]*?-->/g, "");
  body = body.replace(/<(script|style|noscript|svg|template|iframe|nav|footer|form|button|select|head)\b[\s\S]*?<\/\1\s*>/gi, "");
  const main = /<(article|main)\b[^>]*>([\s\S]*)<\/\1\s*>/i.exec(body);
  if (main !== null) body = main[2]!;
  const link = (href: string) => {
    try {
      return base === undefined ? href : new URL(href, base).href;
    } catch {
      return href;
    }
  };
  // Code keeps its own spacing: set aside before the whitespace is tidied, put back after.
  const blocks: string[] = [];
  body = body
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => {
      blocks.push(decodeEntities(code.replace(/<[^>]+>/g, "")).replace(/^\n+|\s+$/g, ""));
      return `\n\n\u0000${blocks.length - 1}\u0000\n\n`;
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, text: string) => `\n\n${"#".repeat(Number(level))} ${text.replace(/<[^>]+>/g, "").trim()}\n\n`)
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
      const words = text.replace(/<[^>]+>/g, "").trim();
      return words === "" || /^(javascript|data):/i.test(href) || href.startsWith("#") ? words : `[${words}](${link(decodeEntities(href))})`;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, text: string) => (text.trim() === "" ? text : `**${text.trim()}**`))
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, text: string) => (text.trim() === "" ? text : `*${text.trim()}*`))
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, text: string) => `\`${text.replace(/<[^>]+>/g, "")}\``)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<tr\b[^>]*>/gi, "\n| ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|ul|ol|table|thead|tbody|blockquote|header|aside|figure|figcaption|dl|dt|dd|h[1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  const markdown = tidy(decodeEntities(body)).replace(/\u0000(\d+)\u0000/g, (_, i: string) => `\`\`\`\n${blocks[Number(i)]}\n\`\`\``);
  return { title, markdown, via: "html → markdown" };
}

/** A .docx's `word/document.xml` as markdown: paragraphs, Heading/Title styles, list items, table rows. */
export function docxXmlToMarkdown(xml: string): string {
  const out: string[] = [];
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const paragraphText = (p: string) =>
    decodeEntities(
      [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br)\b[^>]*\/>/g)].map((m) => (m[2] === "tab" ? "\t" : m[2] === "br" ? "\n" : m[1]!)).join(""),
    );
  // An empty `<w:p/>` first: tried as `<w:p …</w:p>` it would run on into the next paragraph or table.
  for (const block of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g)) {
    const b = block[0];
    if (b.startsWith("<w:tbl>")) {
      for (const row of b.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
        const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => paragraphText(p[0]).trim()).join(" "));
        out.push(`| ${cells.join(" | ")} |`);
      }
      out.push("");
      continue;
    }
    const text = paragraphText(b).trim();
    if (text === "") continue;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(b)?.[1] ?? "";
    const heading = /^(?:Heading|heading)\s?([1-6])$/.exec(style)?.[1];
    if (style === "Title") out.push(`# ${text}`, "");
    else if (heading !== undefined) out.push(`${"#".repeat(Math.min(6, Number(heading) + 1))} ${text}`, "");
    else if (b.includes("<w:numPr>")) out.push(`- ${text}`);
    else out.push(text, "");
  }
  return tidy(out.join("\n"));
}

/** How a web address is fetched — the caller's `fetch`, or a test's. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** How a converter is run — `tool` for real; a test hands in its own. */
export type Runner = (argv: readonly string[]) => Promise<{ readonly code: number; readonly stdout: Uint8Array; readonly stderr: string }>;

/** Run a converter, killed if it takes longer than `ms`. */
export async function tool(argv: readonly string[], ms = TOOL_MS): Promise<{ code: number; stdout: Uint8Array; stderr: string }> {
  let child;
  try {
    child = spawnGuarded(argv);
  } catch (error) {
    return { code: 127, stdout: new Uint8Array(), stderr: error instanceof Error ? error.message : String(error) };
  }
  const timer = setTimeout(() => child.kill(), ms);
  try {
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text()]);
    await child.exited;
    return { code: child.exitCode ?? -1, stdout: new Uint8Array(stdout), stderr: stderr.trim() };
  } finally {
    clearTimeout(timer);
  }
}

const missing = (name: string, why: string) => new Error(`${name} did not run (${why || "not found"}) — install it, or convert the file to .md or .pdf first`);

async function pdfText(file: string, run: Runner): Promise<string> {
  const out = await run(["pdftotext", "-enc", "UTF-8", "-nopgbrk", file, "-"]);
  if (out.code !== 0) throw missing("pdftotext (poppler-utils)", out.stderr);
  return tidy(new TextDecoder().decode(out.stdout));
}

/** LibreOffice, headless, into `to` (pdf or csv) in a folder of its own. */
async function office(file: string, to: "pdf" | "csv", run: Runner, scratch: string): Promise<{ dir: string; out: string }> {
  const dir = await mkdtemp(join(scratch, "ohmyagi-convert-"));
  const done = await run(["soffice", `-env:UserInstallation=file://${join(dir, "profile")}`, "--headless", "--convert-to", to, "--outdir", dir, file]);
  const out = join(dir, `${basename(file, extname(file))}.${to}`);
  if (done.code !== 0 || !(await Bun.file(out).exists())) {
    await rm(dir, { recursive: true, force: true });
    throw missing("LibreOffice (soffice)", done.stderr);
  }
  return { dir, out };
}

const stem = (name: string) => basename(name, extname(name)).replace(/[_-]+/g, " ").trim();

/** A file as markdown. `name` is what the person called it — the file on disk may be a temporary one. `scratch` holds LibreOffice's work. */
export async function convertFile(file: string, name: string, scratch: string, run: Runner = tool): Promise<Converted> {
  const ext = extname(name).toLowerCase();
  const kind = IMPORT_KINDS[ext];
  if (kind === undefined) throw new Error(`${name}: ${ext || "no extension"} is not a kind this reads — ${Object.keys(IMPORT_KINDS).join(" ")}`);
  const size = (await Bun.file(file).stat()).size;
  if (size > MAX_SOURCE_BYTES) throw new Error(`${name} is over ${MAX_SOURCE_BYTES / 1024 / 1024} MB`);
  switch (kind) {
    case "markdown":
    case "text": {
      const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n").trim();
      const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
      return { title: heading ?? stem(name), markdown: text, via: "as written" };
    }
    case "html": {
      const html = htmlToMarkdown(await readFile(file, "utf8"));
      return { ...html, title: html.title || stem(name) };
    }
    case "code": {
      const text = (await readFile(file, "utf8")).trim();
      return { title: stem(name), markdown: `\`\`\`${ext.slice(1)}\n${text}\n\`\`\``, via: "as a code block" };
    }
    case "pdf":
      return { title: stem(name), markdown: await pdfText(file, run), via: "pdftotext" };
    case "docx": {
      const xml = await run(["unzip", "-p", file, "word/document.xml"]);
      if (xml.code === 0 && xml.stdout.length > 0) return { title: stem(name), markdown: docxXmlToMarkdown(new TextDecoder().decode(xml.stdout)), via: "docx → markdown" };
      const pdf = await office(file, "pdf", run, scratch);
      try {
        return { title: stem(name), markdown: await pdfText(pdf.out, run), via: "LibreOffice → pdftotext" };
      } finally {
        await rm(pdf.dir, { recursive: true, force: true });
      }
    }
    case "sheet": {
      const csv = await office(file, "csv", run, scratch);
      try {
        return { title: stem(name), markdown: `\`\`\`csv\n${(await readFile(csv.out, "utf8")).trim()}\n\`\`\``, via: "LibreOffice → csv (first sheet)" };
      } finally {
        await rm(csv.dir, { recursive: true, force: true });
      }
    }
    case "office": {
      const pdf = await office(file, "pdf", run, scratch);
      try {
        return { title: stem(name), markdown: await pdfText(pdf.out, run), via: "LibreOffice → pdftotext" };
      } finally {
        await rm(pdf.dir, { recursive: true, force: true });
      }
    }
  }
}

/** Why this cannot be fetched, or `undefined`. Only http and https. */
export function urlProblem(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `${JSON.stringify(raw)} is not a web address`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `only http and https links — not ${url.protocol}`;
  if (url.username !== "" || url.password !== "") return "a link with a password in it is not fetched";
  return undefined;
}

/** A web page (or a PDF, or plain text) off the web, as markdown. */
export async function convertUrl(raw: string, fetcher: Fetcher, scratch: string, run: Runner = tool): Promise<Converted & { readonly url: string }> {
  const problem = urlProblem(raw);
  if (problem !== undefined) throw new Error(problem);
  const res = await fetcher(raw, { redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { "user-agent": "ohmyagi memory import", accept: "text/html,text/markdown,text/plain,application/pdf;q=0.9,*/*;q=0.5" } });
  if (!res.ok) throw new Error(`${raw} answered ${res.status} ${res.statusText}`.trim());
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_SOURCE_BYTES) throw new Error(`${raw} is over ${MAX_SOURCE_BYTES / 1024 / 1024} MB`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`${raw} is over ${MAX_SOURCE_BYTES / 1024 / 1024} MB`);
  const url = res.url || raw;
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const last = decodeURIComponent(new URL(url).pathname.split("/").filter((p) => p !== "").pop() ?? new URL(url).hostname);
  if (type.includes("pdf") || /\.pdf$/i.test(new URL(url).pathname)) {
    const dir = await mkdtemp(join(scratch, "ohmyagi-fetch-"));
    try {
      const file = join(dir, "page.pdf");
      await writeFile(file, bytes, { mode: 0o600 });
      return { title: stem(last), markdown: await pdfText(file, run), via: "fetched · pdftotext", url };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const text = new TextDecoder().decode(bytes);
  if (type.includes("html") || /^\s*<(!doctype|html)/i.test(text)) {
    const html = htmlToMarkdown(text, url);
    if (!thin(html.markdown) || !/<script\b/i.test(text)) return { ...html, title: html.title || new URL(url).hostname, via: "fetched · html → markdown", url };
    // A page that builds its words with JavaScript (a React or Vue app) sends an empty shell: run it, then read it.
    const rendered = await renderPage(url, run, scratch);
    if (rendered.html !== undefined) {
      const after = htmlToMarkdown(rendered.html, url);
      if (!thin(after.markdown)) return { ...after, title: after.title || html.title || new URL(url).hostname, via: `fetched · rendered in ${rendered.browser} · html → markdown`, url };
    }
    throw new Error(
      rendered.browser === undefined
        ? `${url} builds its text with JavaScript, and no headless Chrome or Chromium was found to run it — install one, or save the page as PDF and import that`
        : `${url} builds its text with JavaScript and showed none even after ${rendered.browser} ran it${rendered.why ? ` (${rendered.why})` : ""}`,
    );
  }
  if (type.startsWith("text/") || type.includes("markdown") || type === "") {
    return { title: /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? stem(last), markdown: text.replace(/\r\n/g, "\n").trim(), via: "fetched · as written", url };
  }
  throw new Error(`${url} is ${type} — not a page, a PDF or text`);
}

/** Words enough to be a memory: an empty app shell has a title and not much else. */
const thin = (markdown: string) => markdown.replace(/\s+/g, " ").trim().length < 100;

/** The browsers that can run a page headless, in the order they are tried. */
export const BROWSERS: readonly string[] = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

/** The page's HTML after its scripts have run, from the first headless browser found; which one, or why not. */
async function renderPage(url: string, run: Runner, scratch: string): Promise<{ readonly browser?: string; readonly html?: string; readonly why?: string }> {
  for (const browser of BROWSERS) {
    // A profile of its own each time: nothing of the person's browser is read, and nothing is left behind.
    const profile = await mkdtemp(join(scratch, "ohmyagi-render-"));
    try {
      const out = await run([browser, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--virtual-time-budget=8000", "--dump-dom", url]);
      if (out.code === 127) continue;
      const html = new TextDecoder().decode(out.stdout);
      return out.code === 0 && html.trim() !== "" ? { browser, html } : { browser, why: out.stderr.split("\n")[0] || `exit ${out.code}` };
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
  return {};
}

/** A file-name part from a title: ASCII letters and digits, or a dated fallback for a title in Thai. */
export function slugFor(title: string, now: Date, source: string): string {
  const ascii = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  if (ascii.length >= 3) return ascii;
  const hash = new Bun.CryptoHasher("sha256").update(source).digest("hex").slice(0, 6);
  return `import-${now.toISOString().slice(0, 10)}-${hash}`;
}

/** Cut markdown into pieces under `limit` bytes: at a heading if one is near, else a blank line, else a line. */
export function splitMarkdown(markdown: string, limit: number = PART_BYTES): readonly string[] {
  const enc = new TextEncoder();
  if (enc.encode(markdown).length <= limit) return [markdown];
  const parts: string[] = [];
  let rest = markdown;
  while (enc.encode(rest).length > limit) {
    // Take the longest prefix that fits, by characters, then back off to a good boundary in its last half.
    let lo = 0;
    let hi = rest.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (enc.encode(rest.slice(0, mid)).length <= limit) lo = mid;
      else hi = mid - 1;
    }
    const window = rest.slice(0, lo);
    const floor = Math.floor(lo / 2);
    const at = [window.lastIndexOf("\n#"), window.lastIndexOf("\n\n"), window.lastIndexOf("\n")].find((i) => i > floor) ?? lo;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

export interface ImportPart {
  readonly path: string;
  readonly text: string;
}

/**
 * Where a converted document goes and what each file says. One part is
 * `memory/imported/<slug>.md`; more are `memory/imported/<slug>/part-NN.md`,
 * each naming the one before and after so the map (D-082) links them. `taken`
 * says whether a path is in use; a taken one gets `-2`, `-3`, … rather than
 * writing over a memory that is already there.
 */
export async function planImport(
  converted: Converted,
  source: string,
  now: Date,
  taken: (path: string) => Promise<boolean>,
  as?: string,
): Promise<readonly ImportPart[]> {
  const body = converted.markdown.trim();
  if (body === "") throw new Error(`${source}: nothing readable came out (${converted.via})${converted.via.includes("pdftotext") ? " — a scanned PDF is pictures of text, with no text to take" : ""}`);
  const pieces = splitMarkdown(body);
  let slug = as === undefined ? slugFor(converted.title, now, source) : as.replace(/^memory\//, "").replace(/\.md$/, "");
  const base = as === undefined ? `memory/imported/${slug}` : `memory/${slug}`;
  let root = base;
  for (let n = 2; ; n += 1) {
    const first = pieces.length === 1 ? `${root}.md` : `${root}/part-01.md`;
    if (!(await taken(first))) break;
    if (as !== undefined) throw new Error(`${first} is already a memory — pick another name, or edit that one`);
    root = `${base}-${n}`;
  }
  slug = root.split("/").pop()!;
  const description = body.replace(/^#+\s.*$/gm, "").replace(/[`*_>#|[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
  const day = now.toISOString().slice(0, 10);
  return pieces.map((piece, i) => {
    const multi = pieces.length > 1;
    const partName = (k: number) => `part-${String(k + 1).padStart(2, "0")}`;
    const title = multi ? `${converted.title} (${i + 1}/${pieces.length})` : converted.title;
    // Relative links, not [[names]]: every split document has a part-01.
    const nav = multi ? [i > 0 ? `[← part ${i}](${partName(i - 1)}.md)` : "", i < pieces.length - 1 ? `[part ${i + 2} →](${partName(i + 1)}.md)` : ""].filter((s) => s !== "").join(" · ") : "";
    const front = [
      "---",
      `name: ${JSON.stringify(title)}`,
      `description: ${JSON.stringify(description)}`,
      `source: ${JSON.stringify(source)}`,
      `imported: ${day}`,
      `via: ${JSON.stringify(converted.via)}`,
      "metadata:",
      "  type: reference",
      "---",
      "",
    ].join("\n");
    const heading = /^#\s/.test(piece) ? "" : `# ${title}\n\n`;
    return {
      path: multi ? `${root}/${partName(i)}.md` : `${root}.md`,
      text: `${front}${heading}${piece}\n${nav === "" ? "" : `\n${nav}\n`}`,
    };
  });
}
