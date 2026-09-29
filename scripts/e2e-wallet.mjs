// Headless end-to-end of the wallet flow with mock EIP-6963 wallets (Chrome required). Nothing is ever sent:
// every eth_sendTransaction is captured and rejected by the mock.
// Run: node scripts/serve.mjs 8798 & node scripts/e2e-wallet.mjs http://127.0.0.1:8798/ <screenshot dir>
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, outDir] = process.argv.slice(2);
const port = 9500 + Math.floor(Math.random() * 300);
const ch = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "wf-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (tabs.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = new Map(), logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result ?? d.error); pend.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") logs.push("EXC " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") logs.push("ERR " + d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(300); } return false; };
const clickSel = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText ?? null`);
await send("Runtime.enable");
await send("Page.enable");

let pass = 0, fail = 0;
const check = (name, ok, info = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + String(info).slice(0, 200) : ""}`); };

const MAIN = "0x2973B942305DF55B6fb1ed676a39e9741e7E1F62"; // has test ETH (read-only use: the mock never signs)
const EMPTY = "0x" + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join(""); // fresh every run → 0 ETH
const mockScript = (wallets) => `(() => {
  window.__calls = []; window.__sent = []; window.__emit = {};
  window.open = (u) => { (window.__opened ||= []).push(u); return null; };
  const cfg = ${JSON.stringify(wallets)};
  const mk = (w) => {
    const L = {}; const st = { chain: w.chain, added: false };
    window.__emit[w.name] = (e, v) => (L[e] || []).forEach((f) => f(v));
    return {
      on(e, f) { (L[e] ||= []).push(f); },
      removeListener(e, f) { L[e] = (L[e] || []).filter((x) => x !== f); },
      async request({ method, params }) {
        window.__calls.push(w.name + ":" + method);
        const err = (msg, code) => Object.assign(new Error(msg), { code });
        switch (method) {
          case "eth_requestAccounts": if (w.pending) throw err("Request of type 'wallet_requestPermissions' already pending", -32002); return [w.account];
          case "eth_accounts": return [w.account];
          case "eth_chainId": return st.chain;
          case "wallet_switchEthereumChain": if (w.needAdd && !st.added) throw err("Unrecognized chain ID", 4902); st.chain = params[0].chainId; (L.chainChanged || []).forEach((f) => f(st.chain)); return null;
          case "wallet_addEthereumChain": st.added = true; st.chain = params[0].chainId; return null;
          case "wallet_revokePermissions": return null;
          case "eth_sendTransaction":
            window.__sent.push({ wallet: w.name, tx: params[0] });
            if (w.send === "404") throw new Error("Request failed with status code 404");
            throw err("User rejected the request.", 4001);
        }
        throw new Error("mock: unsupported " + method);
      },
    };
  };
  const list = cfg.map((w) => ({ info: { uuid: w.rdns, name: w.name, rdns: w.rdns, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" }, provider: mk(w) }));
  const announce = () => list.forEach((d) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze(d) })));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;

let scriptId = null;
async function scenario(name, { wallets = [], mobile = false, w = 1440, h = 900 }) {
  console.log(`\n### ${name}`);
  if (scriptId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
  scriptId = (await send("Page.addScriptToEvaluateOnNewDocument", { source: mockScript(wallets) })).identifier;
  await send("Emulation.setUserAgentOverride", { userAgent: mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send("Page.navigate", { url: `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` });
  await waitFor(`document.getElementById("st-painted")?.innerText !== "–"`);
  await waitFor(`!/loading/.test(document.getElementById("se-board")?.innerText ?? "loading")`);
  await sleep(400);
}
const shot = async (file, w, h, mobile = false) => {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(500);
  const full = await ev("document.documentElement.scrollHeight");
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: full, scale: 1 } });
  writeFileSync(join(outDir, file), Buffer.from(r.data, "base64"));
};
const pickCell = async (cx, cy) => {
  const r = await ev(`(() => { const b = document.getElementById("canvas").getBoundingClientRect(); return [b.left, b.top, b.width]; })()`);
  const x = r[0] + (cx + 0.5) * (r[2] / 64), y = r[1] + (cy + 0.5) * (r[2] / 64);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  await sleep(200);
};

/* 1 — desktop, no wallet at all */
await scenario("desktop, no wallet", {});
check("board loaded", (await text("#st-painted")) !== "–", await text("#st-painted"));
check("checklist visible", await ev(`!document.getElementById("ready").hidden`));
check("says no wallet + install links", /No wallet found/.test(await text("#step-wallet")) && (await ev(`[...document.querySelectorAll("#step-wallet-act a")].map(a => a.textContent).join()`)).includes("MetaMask"));
check("no wallet calls on load", (await ev("window.__calls.length")) === 0);
check("desktop 1440×900 fits one screen", (await ev("document.documentElement.scrollHeight <= innerHeight")), await ev("document.documentElement.scrollHeight + ' vs ' + innerHeight"));
await shot("wf-desktop-nowallet.png", 1440, 900);
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await sleep(400);
check("desktop 1280×720 fits one screen", (await ev("document.documentElement.scrollHeight <= innerHeight")), await ev("document.documentElement.scrollHeight + ' vs ' + innerHeight"));

/* 2 — phone, no wallet → open-in-wallet links */
await scenario("phone, no wallet", { mobile: true, w: 390, h: 844 });
const links = await ev(`[...document.querySelectorAll("#step-wallet-act a")].map(a => a.textContent + "=" + a.href)`);
check("3 open-in-wallet links", links.length === 3, links.join(" | "));
check("MetaMask deep link keeps the page path", links.some((l) => /metamask\.app\.link\/dapp\/[^=]*sherwood-canvas|metamask\.app\.link\/dapp\/127\.0\.0\.1/.test(l)), links[0]);
check("no horizontal scroll on phone", await ev("document.documentElement.scrollWidth <= innerWidth"), await ev("document.documentElement.scrollWidth + ' vs ' + innerWidth"));
await shot("wf-phone-nowallet.png", 390, 844, true);

/* 3 — two wallets; Zerion is on Ethereum and doesn't know Robinhood Chain yet */
await scenario("two wallets, wrong network, add chain", { wallets: [
  { name: "MockMask", rdns: "io.mock.mask", account: MAIN, chain: "0xb626" },
  { name: "MockZerion", rdns: "io.mock.zerion", account: MAIN, chain: "0x1", needAdd: true },
] });
check("checklist offers Connect", (await ev(`[...document.querySelectorAll("#step-wallet-act button")].map(b => b.textContent).join()`)) === "Connect");
await clickSel("#step-wallet-act button");
check("picker lists both wallets", await waitFor(`document.getElementById("wallet-pick").open`, 5000) && (await ev(`[...document.querySelectorAll(".wallet-opt")].length`)) === 2);
await ev(`[...document.querySelectorAll(".wallet-opt")].find(b => b.innerText.includes("MockZerion")).click()`);
await waitFor(`document.getElementById("step-wallet").classList.contains("done")`, 8000);
check("wallet step done", await ev(`document.getElementById("step-wallet").classList.contains("done")`), await text("#step-wallet-sub"));
check("network step asks to switch", /another network/.test(await text("#step-net-sub")));
check("header shows wrong-network state", await ev(`document.getElementById("connect").classList.contains("wrong")`));
await clickSel("#step-net-act button");
await waitFor(`document.getElementById("step-net").classList.contains("done")`, 8000);
check("switch → add chain → on Robinhood", await ev(`document.getElementById("step-net").classList.contains("done")`), (await ev("window.__calls")).join(","));
await waitFor(`document.getElementById("ready").hidden`, 10000);
check("with ETH the checklist disappears", await ev(`document.getElementById("ready").hidden`), await text("#step-eth-sub"));
await clickSel("#connect");
check("account menu opens with balance", !(await ev(`document.getElementById("acct-menu").hidden`)) && /ETH/.test(await text("#acct-bal")), await text("#acct-bal"));
await shot("wf-desktop-connected.png", 1440, 900);
await clickSel("main");
await ev(`document.body.click()`);
// the wallet hops to another network by itself
await ev(`window.__emit.MockZerion("chainChanged", "0x1")`);
await sleep(300);
check("chainChanged → warning back", await ev(`document.getElementById("connect").classList.contains("wrong") && !document.getElementById("ready").hidden`));
await pickCell(0, 0);
check("paint button explains the switch", /Switch network & paint 1 px/.test(await text("#paint")), await text("#paint"));
await clickSel("#paint");
await waitFor(`window.__sent.length > 0 || /cancel|wrong|another/i.test(document.getElementById("status").innerText)`, 20000);
const sent = await ev("window.__sent[0]");
check("paint switched back and sent a complete tx", !!sent && !!sent.tx.gas && !!sent.tx.maxFeePerGas && !!sent.tx.nonce && sent.tx.to.toLowerCase() === "0x8ed7ffb34b2a25d866e785843fca0dd899291122", JSON.stringify(sent?.tx ?? null).slice(0, 160));
check("rejection in plain words", /You cancelled in the wallet/.test(await text("#status")), await text("#status"));
await clickSel("#connect");
await clickSel("#acct-off");
await sleep(300);
check("disconnect resets the header", (await text("#connect")) === "Connect wallet");

/* 4 — connected wallet with 0 ETH */
await scenario("zero balance", { wallets: [{ name: "MockMask", rdns: "io.mock.mask", account: EMPTY, chain: "0xb626" }] });
await clickSel("#step-wallet-act button");
await waitFor(`/0 ETH/.test(document.getElementById("step-eth-sub").innerText)`, 10000);
check("0 ETH → faucet button", /0 ETH/.test(await text("#step-eth-sub")) && (await ev(`[...document.querySelectorAll("#step-eth-act a")].some(a => a.href.includes("faucet"))`)), await text("#step-eth-sub"));
await pickCell(1, 0);
await clickSel("#paint");
await waitFor(`/test ETH|faucet/i.test(document.getElementById("status").innerText)`, 20000);
check("paint with 0 ETH → plain 'not enough test ETH'", /Not enough test ETH/.test(await text("#status")), await text("#status"));
check("nothing reached the wallet", (await ev("window.__sent.length")) === 0);

/* 5 — a request is already pending in the wallet */
await scenario("pending request", { wallets: [{ name: "MockMask", rdns: "io.mock.mask", account: MAIN, chain: "0xb626", pending: true }] });
await clickSel("#step-wallet-act button");
await waitFor(`/request waiting/.test(document.getElementById("status").innerText)`, 8000);
check("pending → 'open the wallet window'", /already has a request waiting/.test(await text("#status")), await text("#status"));

/* 6 — Zerion's 404 on send */
await scenario("zerion 404", { wallets: [{ name: "MockZerion", rdns: "io.mock.zerion", account: MAIN, chain: "0xb626", send: "404" }] });
await clickSel("#step-wallet-act button");
await waitFor(`document.getElementById("ready").hidden`, 10000);
await pickCell(2, 0);
await clickSel("#paint");
await waitFor(`/Zerion|reach/i.test(document.getElementById("status").innerText)`, 20000);
check("404 → 'try MetaMask or Rabby'", /try MetaMask or Rabby/.test(await text("#status")), await text("#status"));

/* 7 — zoom + move, 8 — live tab */
await scenario("zoom + live", { mobile: true, w: 390, h: 844 });
const w0 = await ev(`document.getElementById("canvas").getBoundingClientRect().width`);
await clickSel("#zoom-in"); await sleep(200); await clickSel("#zoom-in"); await sleep(300);
const w3 = await ev(`document.getElementById("canvas").getBoundingClientRect().width`);
check("zoom 3× makes cells 3× bigger", Math.abs(w3 / w0 - 3) < 0.05, `${w0} → ${w3}`);
check("✋ appears when zoomed", !(await ev(`document.getElementById("pan").hidden`)));
await clickSel("#pan");
check("✋ switches the hint", /Drag to move/.test(await text("#hint")));
check("no horizontal page scroll when zoomed", await ev("document.documentElement.scrollWidth <= innerWidth"));
await shot("wf-phone-zoom.png", 390, 844, true);
await clickSel('.tab[data-tab="live"]');
await sleep(1500);
const live = await ev(`[...document.querySelectorAll("#live li")].map(li => li.innerText.replace(/\\s+/g, " "))`);
check("live feed lists recent paints with times", live.length > 0 && /painted \d+ px/.test(live[0]) && /ago|just now/.test(live[0]), live.slice(0, 3).join(" | "));
check("rules hidden on the Live tab", await ev(`document.getElementById("rules").hidden`));

console.log(`\n${pass} passed, ${fail} failed`);
console.log(logs.length ? "PAGE ERRORS:\n" + logs.join("\n") : "no page errors");
ch.kill();
process.exit(fail ? 1 : 0);
