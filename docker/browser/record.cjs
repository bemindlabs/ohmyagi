// Recording, and D-153's always-pause list, for every page the MCP server opens
// (D-151) — independent of what the model asks for.
//
// Recording:
// - a Playwright trace per browser context, named per context, started with
//   `live: true` so the action log, DOM snapshots, screencast frames and
//   network log are written as they happen and survive a `docker kill`;
// - a full-page screenshot after every load, in /out/screens.
//
// Sensitive actions (src/decide/sensitive.ts, bundled here as sensitive.cjs):
// before Playwright touches an element — click, type/fill, press, check,
// select, upload — or the keyboard types into the focused element, the action
// is described (kind, the element's role and accessible text, the kind of
// value being typed — never the value — and the form it is in) and handed to
// `classifyAction`. Paying, sending, deleting, credentials (a password field
// among them), accepting terms, and anything that commits a form without
// saying what it is: **held**. The action does not happen; the model is told
// why; `/out/held.jsonl` records the kind, the rule ids and the reasons, and
// no value. There is no approval channel into the container yet, so a held
// action stays held — "waits for a yes" with nobody here to give one. An
// element that cannot be described is held too (the list errs towards
// stopping).
//
// Dialogs (re-review of PR #19, round 3): accepting a page's `confirm` or
// `prompt` is an action too — a neutral "Next" can open "Delete your account
// permanently?", a neutral "Show" can open "Enter your password". Before
// `Dialog.accept` runs, the dialog is classified like any other step:
// - `confirm` (and any type this file does not know): accepting commits
//   whatever the page asked, so it is a `submit` whose text is the message —
//   held at every level, with the message's own categories (delete, pay, …)
//   named in the reason;
// - `prompt`: typing `promptText` into a field whose label is the message, its
//   value class inferred from the message (password, code, card, …) — held when
//   the list flags it; for a password-like prompt the trace is stopped first;
// - `alert` and `beforeunload`: acknowledging, or leaving the page — allowed.
// A held dialog is dismissed (dismissing is always allowed) so the page is not
// left wedged, and the model is told why. `dismiss` itself is never touched.
//
// Navigation (defence in depth behind the guard's URL check): `page.goto` is
// refused for anything but http:, https: and about:blank, so a `javascript:` or
// `data:` URL cannot run page code or load a page of the caller's making even
// if it reached the server some other way.
//
// If anything is ever typed into a password field anyway, that context's
// trace is stopped first and not restarted, so no snapshot or request body
// after it is recorded; a marker says so.
//
// Files are 600 and directories 700: the entrypoint's umask, and modes here.
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { classifyAction } = require("./sensitive.cjs");

let sequence = 0;
let traces = 0;
const contexts = new WeakMap();
let patched = false;

/** What the list needs to know about an element, read in the page. Never its value. */
function describeElement() {
  // Runs in the page (Playwright serialises it).
  return (element) => {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();
    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();
    const implicit =
      tag === "button" || (tag === "input" && ["submit", "button", "reset", "image"].includes(type))
        ? "button"
        : tag === "a"
          ? "link"
          : tag === "select"
            ? "combobox"
            : tag === "textarea" || (tag === "input" && !["checkbox", "radio", "file", "hidden"].includes(type))
              ? type === "search" ? "searchbox" : "textbox"
              : tag === "input" ? type : "";
    const labelled = element.getAttribute("aria-label") ||
      (element.labels && element.labels.length > 0 ? Array.from(element.labels).map((label) => label.innerText).join(" ") : "") ||
      element.getAttribute("placeholder") || element.getAttribute("title") ||
      (["button", "link"].includes(implicit) ? element.innerText || element.getAttribute("value") || "" : element.getAttribute("name") || "");
    const form = element.closest("form, [role=search], [role=form]");
    const owner = element.form || (form !== null && form.tagName.toLowerCase() === "form" ? form : null);
    const submitsForm =
      owner !== null &&
      ((tag === "button" && (type === "" || type === "submit")) || (tag === "input" && (type === "submit" || type === "image")));
    return {
      tag,
      type,
      autocomplete,
      role: element.getAttribute("role") || implicit,
      text: String(labelled).slice(0, 300),
      formRole: form === null ? undefined : form.getAttribute("role") || (form.tagName.toLowerCase() === "form" ? "form" : undefined),
      submitsForm,
      formHasPassword: owner !== null && owner.querySelector("input[type=password]") !== null,
    };
  };
}

function valueClassOf(info) {
  if (info.autocomplete.includes("cc-")) return "card";
  if (info.autocomplete.includes("one-time-code")) return "otp";
  if (info.autocomplete.includes("password") || info.type === "password") return "password";
  const byType = { email: "email", tel: "phone", url: "url", number: "number", date: "date", search: "search", file: "file" };
  return byType[info.type] || "text";
}

function origin(page) {
  try {
    return new URL(page.url()).origin;
  } catch {
    return "";
  }
}

function held(action, classification) {
  mkdirSync("/out", { recursive: true, mode: 0o700 });
  appendFileSync(
    "/out/held.jsonl",
    `${JSON.stringify({ at: new Date().toISOString(), kind: action.kind, origin: action.origin, role: action.role, rules: classification.rules, reasons: classification.reasons })}\n`,
    { mode: 0o600 },
  );
  const error = new Error(
    `om-agi held this action: ${classification.reasons.join("; ") || classification.rules.join(", ")}. ` +
      "It waits for a person's yes (D-153), and there is no way to give one inside this task yet.",
  );
  error.name = "OmAgiHeld";
  return error;
}

async function stopTrace(context, why) {
  const state = contexts.get(context);
  if (state === undefined || state.stopped) return;
  state.stopped = true;
  try {
    await context.tracing.stop();
  } catch {
    // Already stopped or closing: either way nothing more is recorded.
  }
  mkdirSync("/out/trace", { recursive: true, mode: 0o700 });
  writeFileSync(
    `/out/trace/${state.name}.stopped.txt`,
    `${new Date().toISOString()} trace ${state.name} stopped before ${why}; nothing after this point was recorded for this context.\n`,
    { mode: 0o600 },
  );
}

/** Classify, hold what the list holds, and stop the trace before any password typing. */
async function check(page, info, kind, extra) {
  const action = {
    kind,
    origin: origin(page),
    ...(info === null
      ? {}
      : {
          role: info.role,
          text: info.text,
          submitsForm: info.submitsForm,
          formHasPassword: info.formHasPassword,
          ...(info.formRole === undefined ? {} : { formRole: info.formRole }),
        }),
    ...extra,
  };
  // Nothing could be read about the element: the list errs towards stopping.
  const classification = info === null
    ? { sensitive: true, rules: ["undescribed-element"], reasons: ["the element could not be described, so it waits for a yes"] }
    : classifyAction(action);
  if (classification.sensitive) throw held(action, classification);
  if (action.valueClass === "password") await stopTrace(page.context(), "typing into a password field");
}

const LOCATOR_KINDS = {
  click: "click",
  dblclick: "click",
  tap: "click",
  fill: "fill",
  type: "type",
  pressSequentially: "type",
  press: "press",
  check: "check",
  uncheck: "check",
  setChecked: "check",
  selectOption: "select",
  setInputFiles: "upload",
};

function allowedUrl(raw) {
  if (String(raw).trim() === "about:blank") return true;
  try {
    const url = new URL(String(raw).trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function patchNavigation(page) {
  const proto = Object.getPrototypeOf(page);
  if (proto.__omAgiGoto === true) return;
  const original = proto.goto;
  proto.goto = async function (url, ...rest) {
    if (!allowedUrl(url)) {
      const error = new Error("om-agi refused this URL: only http:, https: and about:blank are opened");
      error.name = "OmAgiRefusedUrl";
      throw error;
    }
    return original.call(this, url, ...rest);
  };
  proto.__omAgiGoto = true;
}

/** The value class a prompt's message asks for. Never the value itself. */
function promptValueClass(message) {
  const text = String(message).toLowerCase();
  if (/(pass(word|phrase|code)?|รหัสผ่าน|\bpin\b)/u.test(text)) return "password";
  if (/(one[- ]time|otp|verification code|2fa|two[- ]factor|รหัสยืนยัน)/u.test(text)) return "otp";
  if (/(card number|credit card|cvv|cvc|expiry|บัตร)/u.test(text)) return "card";
  if (/(secret|token|api key|private key|recovery)/u.test(text)) return "secret";
  if (/e-?mail/u.test(text)) return "email";
  return "text";
}

/** Describe accepting this dialog as a step D-153's list can judge, or null when accepting is harmless. */
function dialogAction(page, dialog) {
  const type = typeof dialog.type === "function" ? dialog.type() : "";
  const message = typeof dialog.message === "function" ? String(dialog.message()).slice(0, 300) : "";
  if (type === "alert" || type === "beforeunload") return null;
  if (type === "prompt") {
    return { kind: "type", origin: origin(page), role: "textbox", text: message, valueClass: promptValueClass(message), submits: false };
  }
  // confirm, and any type not known here: accepting commits whatever the page asked.
  return { kind: "submit", origin: origin(page), role: "button", text: message };
}

let dialogsPatched = false;

function patchDialogs(page) {
  page.on("dialog", (dialog) => {
    if (dialogsPatched) return;
    dialogsPatched = true;
    const proto = Object.getPrototypeOf(dialog);
    const original = proto.accept;
    proto.accept = async function (...args) {
      const action = dialogAction(page, this);
      if (action !== null) {
        if (action.valueClass === "password" || action.valueClass === "otp" || action.valueClass === "secret") {
          await stopTrace(page.context(), `answering a prompt that asks for a ${action.valueClass}`);
        }
        const classification = classifyAction(action);
        if (classification.sensitive) {
          const error = held({ ...action, kind: `dialog-${action.kind}` }, classification);
          // Not left open: a held dialog is dismissed, which is always allowed.
          await this.dismiss().catch(() => undefined);
          throw error;
        }
      }
      return original.apply(this, args);
    };
  });
}

function patchLocators(page) {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(page.locator("html"));
  for (const [method, kind] of Object.entries(LOCATOR_KINDS)) {
    const original = proto[method];
    if (typeof original !== "function") continue;
    proto[method] = async function (...args) {
      let info = null;
      try {
        info = await this.evaluate(describeElement(), undefined, { timeout: 2000 });
      } catch {
        info = null;
      }
      const extra = {};
      if (kind === "fill" || kind === "type") {
        if (info !== null) extra.valueClass = valueClassOf(info);
        extra.submits = false;
      }
      if (kind === "press") {
        extra.key = String(args[0] ?? "");
        if (info !== null) extra.valueClass = valueClassOf(info);
      }
      await check(this.page(), info, kind, extra);
      return original.apply(this, args);
    };
  }
}

function patchKeyboard(page) {
  const keyboard = page.keyboard;
  for (const method of ["type", "insertText", "press", "down"]) {
    const original = keyboard[method];
    if (typeof original !== "function") continue;
    keyboard[method] = async function (...args) {
      let info = null;
      try {
        info = await page.evaluate(`(${describeElement().toString()})(document.activeElement || document.body)`);
      } catch {
        info = null;
      }
      const kind = method === "press" || method === "down" ? "press" : "type";
      const extra = { ...(info === null ? {} : { valueClass: valueClassOf(info) }), ...(kind === "press" ? { key: String(args[0] ?? "") } : { submits: false }) };
      await check(page, info, kind, extra);
      return original.apply(this, args);
    };
  }
}

exports.default = async function record({ page }) {
  const context = page.context();
  if (!contexts.has(context)) {
    traces += 1;
    const name = `trace-${String(traces).padStart(2, "0")}-${Date.now()}`;
    contexts.set(context, { name, stopped: false });
    await context.tracing.start({ name, screenshots: true, snapshots: true, live: true });
  }
  patchNavigation(page);
  patchDialogs(page);
  patchLocators(page);
  patchKeyboard(page);
  mkdirSync("/out/screens", { recursive: true, mode: 0o700 });
  page.on("load", () => {
    sequence += 1;
    const name = `/out/screens/${String(sequence).padStart(4, "0")}-${Date.now()}.png`;
    page.screenshot({ path: name, fullPage: true }).catch(() => undefined);
  });
};
