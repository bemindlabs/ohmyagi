/** D-084 — documents and web pages into memory as markdown. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  convertFile,
  convertUrl,
  decodeEntities,
  docxXmlToMarkdown,
  htmlToMarkdown,
  planImport,
  slugFor,
  splitMarkdown,
  tool,
  urlProblem,
  type Fetcher,
  type Runner,
} from "../../src/memory/import.ts";
import { MAX_MEMORY_BYTES } from "../../src/memory/write.ts";

const scratch: string[] = [];
afterEach(async () => {
  for (const d of scratch.splice(0)) await rm(d, { recursive: true, force: true });
});
async function dir() {
  const d = await mkdtemp(join(tmpdir(), "om-agi-import-"));
  scratch.push(d);
  return d;
}
const NOW = new Date("2026-09-26T10:00:00Z");
const bytes = (s: string) => new TextEncoder().encode(s);

/** A pretend pdftotext / unzip / soffice, so the paths are tested where the tools are not installed. */
const fake: Runner = async (argv) => {
  if (argv[0] === "pdftotext") return { code: 0, stdout: bytes("Page one text.\n\n\nPage two."), stderr: "" };
  if (argv[0] === "unzip") return { code: 0, stdout: bytes('<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Plan</w:t></w:r></w:p><w:p><w:r><w:t>Body.</w:t></w:r></w:p></w:body></w:document>'), stderr: "" };
  if (argv[0] === "soffice") {
    const to = argv[argv.indexOf("--convert-to") + 1]!;
    const outdir = argv[argv.indexOf("--outdir") + 1]!;
    const file = argv[argv.length - 1]!;
    const stem = file.split("/").pop()!.replace(/\.[^.]+$/, "");
    await writeFile(join(outdir, `${stem}.${to}`), to === "csv" ? "a,b\n1,2\n" : "%PDF");
    return { code: 0, stdout: new Uint8Array(), stderr: "" };
  }
  return { code: 127, stdout: new Uint8Array(), stderr: "no such tool" };
};
const broken: Runner = async () => ({ code: 1, stdout: new Uint8Array(), stderr: "exploded" });

describe("html → markdown", () => {
  test("keeps the article's words and structure, drops scripts, styles, navigation", () => {
    const page = `<html><head><title>Ports &amp; Services</title><style>p{}</style></head><body>
      <nav><a href="/">Home</a></nav>
      <article><h1>Ports</h1><p>Use <b>30700</b> and <em>never</em> <code>3000</code>. <a href="/docs?a=1&amp;b=2">docs</a> <a href="javascript:x()">run</a> <a href="#top">up</a></p>
      <ul><li>one</li><li>two</li></ul><table><tr><th>k</th><th>v</th></tr><tr><td>a</td><td>1</td></tr></table>
      <pre><code>if (a &lt; b) {
  go();
}</code></pre><script>alert(1)</script><!-- note --></article><footer>© x</footer></body></html>`;
    const md = htmlToMarkdown(page, "https://example.org/x/");
    expect(md.title).toBe("Ports & Services");
    expect(md.markdown).toContain("# Ports");
    expect(md.markdown).toContain("Use **30700** and *never* `3000`. [docs](https://example.org/docs?a=1&b=2) run up");
    expect(md.markdown).toContain("- one\n- two");
    expect(md.markdown).toContain("| k | v |");
    expect(md.markdown).toContain("```\nif (a < b) {\n  go();\n}\n```");
    for (const gone of ["alert", "Home", "note", "©", "p{}"]) expect(md.markdown).not.toContain(gone);
    expect(htmlToMarkdown("<p>no base <a href='x.html'>x</a></p>").markdown).toBe("no base [x](x.html)");
  });

  test("entities, named and numbered; unknown ones stay", () => {
    expect(decodeEntities("&lt;a&gt; &#3585; &#x0E01; &hellip; &bogus; &#0;")).toBe("<a> ก ก … &bogus; &#0;");
  });
});

describe("docx → markdown", () => {
  test("title, headings, lists, tables, tabs and breaks", () => {
    const xml =
      '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Plan</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Goals</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>ship</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">A </w:t></w:r><w:r><w:tab/><w:t>B&amp;C</w:t><w:br/><w:t>D</w:t></w:r></w:p><w:p/>' +
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>k</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>v</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>";
    expect(docxXmlToMarkdown(xml)).toBe("# Plan\n\n## Goals\n\n- ship\nA B&C\nD\n\n| k | v |");
  });
});

describe("converting a file", () => {
  test("md, txt, html and data as written; the title from a heading or the name", async () => {
    const d = await dir();
    await writeFile(join(d, "a.md"), "# Real title\r\n\r\ntext\r\n");
    expect(await convertFile(join(d, "a.md"), "a.md", d)).toEqual({ title: "Real title", markdown: "# Real title\n\ntext", via: "as written" });
    await writeFile(join(d, "b.txt"), "just words");
    expect((await convertFile(join(d, "b.txt"), "meeting_notes-2.txt", d)).title).toBe("meeting notes 2");
    await writeFile(join(d, "c.html"), "<p>hello</p>");
    expect(await convertFile(join(d, "c.html"), "c.html", d)).toMatchObject({ title: "c", markdown: "hello" });
    await writeFile(join(d, "d.json"), '{"a":1}\n');
    expect((await convertFile(join(d, "d.json"), "d.json", d)).markdown).toBe('```json\n{"a":1}\n```');
    await expect(convertFile(join(d, "b.txt"), "b.exe", d)).rejects.toThrow(".exe is not a kind");
  });

  test("pdf, docx, office documents and sheets through their tools", async () => {
    const d = await dir();
    for (const n of ["x.pdf", "x.docx", "x.pptx", "x.xlsx"]) await writeFile(join(d, n), "bytes");
    expect(await convertFile(join(d, "x.pdf"), "x.pdf", d, fake)).toEqual({ title: "x", markdown: "Page one text.\n\nPage two.", via: "pdftotext" });
    expect(await convertFile(join(d, "x.docx"), "x.docx", d, fake)).toEqual({ title: "x", markdown: "# Plan\n\nBody.", via: "docx → markdown" });
    expect(await convertFile(join(d, "x.pptx"), "x.pptx", d, fake)).toMatchObject({ via: "LibreOffice → pdftotext", markdown: "Page one text.\n\nPage two." });
    expect(await convertFile(join(d, "x.xlsx"), "x.xlsx", d, fake)).toMatchObject({ markdown: "```csv\na,b\n1,2\n```" });
    // A .docx that is not a zip goes to LibreOffice instead.
    const noZip: Runner = (argv) => (argv[0] === "unzip" ? broken(argv) : fake(argv));
    expect((await convertFile(join(d, "x.docx"), "x.docx", d, noZip)).via).toBe("LibreOffice → pdftotext");
    await expect(convertFile(join(d, "x.pdf"), "x.pdf", d, broken)).rejects.toThrow("pdftotext (poppler-utils) did not run (exploded)");
    await expect(convertFile(join(d, "x.pptx"), "x.pptx", d, broken)).rejects.toThrow("LibreOffice (soffice) did not run");
  });

  test("the real tools, where they are installed", async () => {
    const out = await tool(["pdftotext", "-v"]);
    expect(typeof out.code).toBe("number");
    expect((await tool(["definitely-not-a-tool-om-agi"])).code).not.toBe(0);
  });
});

describe("converting a link", () => {
  const reply = (body: string | Uint8Array, type: string, status = 200, url = "https://example.org/docs/page"): Fetcher =>
    async () => Object.defineProperty(new Response(body, { status, headers: { "content-type": type } }), "url", { value: url });

  test("only http and https, no passwords", () => {
    expect(urlProblem("https://example.org")).toBeUndefined();
    expect(urlProblem("file:///etc/passwd")).toContain("only http and https");
    expect(urlProblem("https://u:p@example.org")).toContain("password");
    expect(urlProblem("not a url")).toContain("not a web address");
  });

  test("a page, a text file, a PDF; a failure says why", async () => {
    const page = await convertUrl("https://example.org/docs/page", reply("<title>Docs</title><main><p>See <a href='../a'>a</a></p></main>", "text/html; charset=utf-8"), tmpdir());
    expect(page).toEqual({ title: "Docs", markdown: "See [a](https://example.org/a)", via: "fetched · html → markdown", url: "https://example.org/docs/page" });
    expect((await convertUrl("https://example.org/r.md", reply("# Readme\n\nhi", "text/markdown", 200, "https://example.org/r.md"), tmpdir())).title).toBe("Readme");
    expect((await convertUrl("https://example.org/r.txt", reply("plain", "text/plain", 200, "https://example.org/notes.txt"), tmpdir())).title).toBe("notes");
    expect((await convertUrl("https://example.org/f.pdf", reply(bytes("%PDF"), "application/pdf", 200, "https://example.org/f.pdf"), tmpdir(), fake)).markdown).toBe("Page one text.\n\nPage two.");
    expect((await convertUrl("https://example.org/", reply("<p>x</p>", "text/html", 200, "https://example.org/"), tmpdir())).title).toBe("example.org");
    await expect(convertUrl("https://example.org/x", reply("gone", "text/plain", 404), tmpdir())).rejects.toThrow("answered 404");
    await expect(convertUrl("https://example.org/x", reply(bytes("\x00"), "image/png"), tmpdir())).rejects.toThrow("not a page, a PDF or text");
    await expect(convertUrl("ftp://example.org/x", reply("", "text/plain"), tmpdir())).rejects.toThrow("only http and https");
  });
});

describe("where it goes", () => {
  test("a slug from the title, or a dated one for a Thai title", () => {
    expect(slugFor("Ports & Services — 2026!", NOW, "s")).toBe("ports-services-2026");
    expect(slugFor("Café résumé", NOW, "s")).toBe("cafe-resume");
    expect(slugFor("บันทึกการประชุม", NOW, "a.pdf")).toMatch(/^import-2026-09-26-[0-9a-f]{6}$/);
  });

  test("long text is cut at headings, else paragraphs, under the limit", () => {
    expect(splitMarkdown("short", 100)).toEqual(["short"]);
    const doc = Array.from({ length: 6 }, (_, i) => `## Part ${i}\n\n${"word ".repeat(10).trim()}`).join("\n\n");
    const parts = splitMarkdown(doc, 120);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(120);
    expect(parts.join("\n\n")).toBe(doc);
    expect(parts.every((p) => p.startsWith("## Part"))).toBe(true);
    const flat = splitMarkdown("x".repeat(250), 100);
    expect(flat.map((p) => p.length)).toEqual([100, 100, 50]);
  });

  test("one file with front matter; a taken name gets -2; a long one becomes linked parts", async () => {
    const taken = new Set(["memory/imported/ports.md"]);
    const one = await planImport({ title: "Ports", markdown: "Use 30700.", via: "as written" }, "ports.md", NOW, async (p) => taken.has(p));
    expect(one).toHaveLength(1);
    expect(one[0]!.path).toBe("memory/imported/ports-2.md");
    expect(one[0]!.text).toBe('---\nname: "Ports"\ndescription: "Use 30700."\nsource: "ports.md"\nimported: 2026-09-26\nvia: "as written"\nmetadata:\n  type: reference\n---\n# Ports\n\nUse 30700.\n');
    const long = await planImport({ title: "Manual", markdown: `# Manual\n\n${"para\n\n".repeat(60_000)}`, via: "pdftotext" }, "m.pdf", NOW, async () => false);
    expect(long.length).toBeGreaterThan(1);
    expect(long[0]!.path).toBe("memory/imported/manual/part-01.md");
    expect(long[0]!.text).toContain("[part 2 →](part-02.md)");
    expect(long[1]!.text).toContain("[← part 1](part-01.md)");
    for (const p of long) expect(new TextEncoder().encode(p.text).length).toBeLessThanOrEqual(MAX_MEMORY_BYTES);
    const named = await planImport({ title: "x", markdown: "y", via: "v" }, "s", NOW, async () => false, "memory/notes/mine.md");
    expect(named[0]!.path).toBe("memory/notes/mine.md");
    await expect(planImport({ title: "x", markdown: "y", via: "v" }, "s", NOW, async () => true, "memory/notes/mine.md")).rejects.toThrow("already a memory");
    await expect(planImport({ title: "x", markdown: "  ", via: "pdftotext" }, "scan.pdf", NOW, async () => false)).rejects.toThrow("nothing readable");
  });
});
