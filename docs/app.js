// Sherwood Canvas — front end. Plain ES modules, no build step. Reads the chain through the public RPC; writes through
// the visitor's own wallet (whichever they pick). Nothing is stored anywhere but the contract.
import { createPublicClient, createWalletClient, custom, http, formatEther, parseAbi, parseAbiItem } from "https://esm.sh/viem@2.21.0";
import { score, holdersByWeek, seasonOf, seasonStart } from "./season.js";
import { createWallet, explain, mobileWalletLinks } from "./wallet.js";

const CFG = {
  site: "https://mrtarasyuks.github.io/sherwood-canvas/",
  address: "0x8ed7ffb34b2a25d866e785843fca0dd899291122",
  deployBlock: 125869265n,
  token: "0xB76f7ab3baf2c4220444C73F66793869A811e001", // $SHRWD
  tokenBlock: 125880429n,
  tokenUrl: "https://testnet.vibevibe.fun/token/0xB76f7ab3baf2c4220444C73F66793869A811e001",
  keeper: "0x2973b942305df55b6fb1ed676a39e9741e7e1f62", // the builder's wallet: plays, never ranks
  faucet: "https://faucet.testnet.chain.robinhood.com",
  chainIdHex: "0xb626",
  chain: {
    id: 46630,
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
    blockExplorers: { default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" } },
  },
};
const EXPLORER = CFG.chain.blockExplorers.default.url;
const SIZE = 64, N = SIZE * SIZE, MAX_BATCH = 64;
const BASE = 10n ** 13n; // 0.00001 ETH
const abi = parseAbi([
  "function colorsRange(uint256 from, uint256 count) view returns (bytes)",
  "function pixelsRange(uint256 from, uint256 count) view returns (address[] owners, uint8[] levels)",
  "function quote(uint256[] ids) view returns (uint256)",
  "function paint(uint256[] ids, uint24[] colors) payable",
  "function owned(address) view returns (uint256)",
  "function credit(address) view returns (uint256)",
  "function withdraw()",
]);
const PAINTED = parseAbiItem("event Painted(uint256 indexed id, address indexed painter, address indexed previousOwner, uint24 color, uint256 price)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const pub = createPublicClient({ chain: CFG.chain, transport: http() });
const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const eth = (wei) => {
  if (wei === 0n) return "0 ETH";
  const s = formatEther(wei);
  return `${Number(s) < 0.001 && wei > 0n ? Number(s).toFixed(6) : Number(s).toFixed(4)} ETH`;
};
const ZERO = /^0x0{40}$/i;
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

/* ------------------------------------------------------------------ state ---- */
let colors = new Uint8Array(N * 3);
let owners = new Array(N).fill(null); // lower-cased holder or null
let levels = new Uint8Array(N);
let color = "#a3ff3c";
const selected = new Set();
let hover = -1;
let week = null; // the running week's scores, for the share text
const focusParam = new URLSearchParams(location.search).get("p");
const focus = /^0x[0-9a-fA-F]{40}$/.test(focusParam ?? "") ? focusParam.toLowerCase() : null; // ?p=0x… highlights a player's land

/* ----------------------------------------------------------------- status ---- */
function status(msg, kind = "", link = null) {
  const s = $("status");
  s.className = `status ${kind}`;
  s.replaceChildren(msg);
  if (link) s.append(" ", el("a", { href: link.href, target: "_blank", rel: "noopener", textContent: link.text }));
}

/* ----------------------------------------------------------------- wallet ---- */
function pickDialog(found) {
  const dlg = $("wallet-pick"), list = $("wallet-list");
  const last = W.lastRdns();
  const sorted = [...found].sort((a, b) => Number(b.info.rdns === last) - Number(a.info.rdns === last));
  list.replaceChildren(...sorted.map((w) => {
    const b = el("button", { className: "btn wallet-opt", type: "button" });
    b.dataset.uuid = w.info.uuid;
    if (/^data:image\//.test(w.info.icon ?? "")) b.append(el("img", { src: w.info.icon, alt: "" }));
    b.append(el("span", { textContent: w.info.name }));
    if (w.info.rdns && w.info.rdns === last) b.append(el("small", { textContent: "last used" }));
    return b;
  }));
  dlg.showModal();
  return new Promise((resolve) => {
    list.onclick = (e) => {
      const w = found.find((x) => x.info.uuid === e.target.closest(".wallet-opt")?.dataset.uuid);
      if (!w) return;
      dlg.onclose = null;
      dlg.close();
      resolve(w);
    };
    dlg.onclose = () => resolve(null);
  });
}
const W = createWallet({ chain: CFG.chain, chainIdHex: CFG.chainIdHex, pub, pick: pickDialog });
const account = () => W.state.account;
const isMe = (a) => !!account() && a === account().toLowerCase();
const hasEth = () => W.state.balance !== null && W.state.balance > 0n;

function renderWallet() {
  const s = W.state, on = W.onChain();
  const btn = $("connect");
  btn.textContent = s.busy ? "Connecting…" : s.account ? short(s.account) : "Connect wallet";
  btn.classList.toggle("connected", !!s.account);
  btn.classList.toggle("wrong", !!s.account && !on);
  btn.disabled = s.busy;
  if (!s.account) toggleMenu(false);
  $("acct-dot").className = `dot ${on ? "ok" : "warn"}`;
  $("acct-addr").textContent = s.account ? short(s.account) : "–";
  $("acct-wallet").textContent = s.name ?? "wallet";
  $("acct-net").textContent = on ? "Robinhood Chain testnet" : "another network";
  $("acct-bal").textContent = s.balance === null ? "–" : eth(s.balance);
  $("acct-switch").hidden = on;
  if (s.account) $("acct-explorer").href = `${EXPLORER}/address/${s.account}`;

  // the checklist: shown until wallet + network + test ETH are all in place
  const ready = !!s.account && on && hasEth();
  $("ready").hidden = ready;
  const step = (id, done, sub, ...act) => {
    $(id).classList.toggle("done", done);
    $(`${id}-sub`).textContent = sub;
    $(`${id}-act`).replaceChildren(...act);
  };
  if (s.account) step("step-wallet", true, `${s.name ?? "Wallet"} · ${short(s.account)}`);
  else if (W.installed()) step("step-wallet", false, "", el("button", { className: "btn small primary", type: "button", textContent: "Connect", onclick: () => run(() => W.connect()) }));
  else if (W.mobile) step("step-wallet", false, "No wallet in this browser — open the game inside your wallet app:", ...mobileWalletLinks(location.href.split("#")[0]).map((l) => el("a", { className: "btn small", href: l.href, textContent: l.name })));
  else step("step-wallet", false, "No wallet found in this browser. Install one, then reload:", el("a", { className: "btn small", href: "https://metamask.io/download/", target: "_blank", rel: "noopener", textContent: "MetaMask ↗" }), el("a", { className: "btn small", href: "https://rabby.io/", target: "_blank", rel: "noopener", textContent: "Rabby ↗" }));
  if (!s.account) step("step-net", false, "after the wallet");
  else if (on) step("step-net", true, "connected");
  else step("step-net", false, "Your wallet is on another network.", el("button", { className: "btn small primary", type: "button", textContent: "Switch network", onclick: () => run(() => W.switchChain()) }));
  if (!s.account) step("step-eth", false, "after the wallet");
  else if (hasEth()) step("step-eth", true, eth(s.balance));
  else step("step-eth", false, s.balance === null ? "checking…" : "0 ETH — a pixel costs 0.00001, and test ETH is free:", el("a", { className: "btn small primary", href: CFG.faucet, target: "_blank", rel: "noopener", textContent: "Get test ETH ↗" }), el("button", { className: "btn small", type: "button", textContent: "Recheck", onclick: () => W.refreshBalance() }));
  updateSelection();
}
W.events.addEventListener("change", () => { renderWallet(); if (account()) loadMine().catch(() => {}); });
/** run a wallet step from a button, with the error in plain words */
async function run(fn) {
  try {
    status("");
    await fn();
  } catch (e) {
    status(explain(e), "err");
  }
}

function toggleMenu(open) {
  const m = $("acct-menu");
  m.hidden = !open;
  $("connect").setAttribute("aria-expanded", String(open));
}
$("connect").addEventListener("click", () => {
  if (!account()) return run(() => W.connect());
  toggleMenu($("acct-menu").hidden);
});
document.addEventListener("click", (e) => { if (!e.target.closest(".acct")) toggleMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleMenu(false); });
$("acct-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(account()); $("acct-copy").textContent = "copied ✓"; } catch { $("acct-copy").textContent = "copy failed"; }
  setTimeout(() => { $("acct-copy").textContent = "copy"; }, 1500);
});
$("acct-switch").addEventListener("click", () => run(() => W.switchChain()));
$("acct-off").addEventListener("click", () => { toggleMenu(false); W.disconnect(); $("me-owned").textContent = "–"; $("me-credit").textContent = "–"; $("withdraw").disabled = true; });
$("addnet").addEventListener("click", () => run(async () => {
  if (!account() && !(await W.connect())) return;
  await W.switchChain();
  status("Robinhood Chain testnet is in your wallet ✓", "ok");
}));

/* --------------------------------------------------------------- palette ---- */
const PALETTE = ["#ffffff", "#111111", "#ff3d3d", "#ff8a1f", "#ffd23f", "#fff36b", "#a3ff3c", "#1fdc6a",
  "#00ffc3", "#22e1ff", "#3d7bff", "#9b5cff", "#ff3d8b", "#ff9ecf", "#a0522d", "#7c7a99"];
function renderPalette() {
  $("palette").innerHTML = PALETTE.map((c) => `<button class="swatch${c === color ? " on" : ""}" style="background:${c};color:${c}" data-c="${c}" aria-label="colour ${c}"></button>`).join("");
}
$("palette").addEventListener("click", (e) => {
  const c = e.target.closest(".swatch")?.dataset.c;
  if (!c) return;
  color = c;
  $("custom").value = c;
  renderPalette();
  draw();
});
$("custom").addEventListener("input", (e) => { color = e.target.value; renderPalette(); draw(); });

/* ----------------------------------------------------------------- canvas ---- */
const cv = $("canvas"), ctx = cv.getContext("2d");
const CELL = cv.width / SIZE;
function draw() {
  for (let i = 0; i < N; i++) {
    const x = (i % SIZE) * CELL, y = Math.floor(i / SIZE) * CELL;
    ctx.fillStyle = owners[i]
      ? `rgb(${colors[i * 3]},${colors[i * 3 + 1]},${colors[i * 3 + 2]})`
      : ((i % SIZE) + Math.floor(i / SIZE)) % 2 ? "#1d1446" : "#18103c";
    ctx.fillRect(x, y, CELL, CELL);
  }
  if (focus) { // outline the edge of that player's territory, not every pixel
    const mine = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && owners[y * SIZE + x] === focus;
    ctx.strokeStyle = "#ff3d8b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = i % SIZE, y = Math.floor(i / SIZE);
      if (!mine(x, y)) continue;
      const L = x * CELL, T = y * CELL, R = L + CELL, B = T + CELL;
      if (!mine(x, y - 1)) { ctx.moveTo(L, T); ctx.lineTo(R, T); }
      if (!mine(x, y + 1)) { ctx.moveTo(L, B); ctx.lineTo(R, B); }
      if (!mine(x - 1, y)) { ctx.moveTo(L, T); ctx.lineTo(L, B); }
      if (!mine(x + 1, y)) { ctx.moveTo(R, T); ctx.lineTo(R, B); }
    }
    ctx.stroke();
  }
  for (const i of selected) {
    const x = (i % SIZE) * CELL, y = Math.floor(i / SIZE) * CELL;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
  }
  if (hover >= 0) {
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 2;
    ctx.strokeRect((hover % SIZE) * CELL + 1, Math.floor(hover / SIZE) * CELL + 1, CELL - 2, CELL - 2);
  }
}
const priceOf = (i) => (owners[i] ? BASE << BigInt(levels[i]) : BASE);
function cellAt(ev) {
  const r = cv.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * SIZE), y = Math.floor(((ev.clientY - r.top) / r.height) * SIZE);
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? y * SIZE + x : -1;
}

/* zoom + move: small screens get real cells to aim at; ✋ turns dragging into panning */
const ZOOMS = [1, 2, 3, 4];
let zi = 0, panMode = false, panFrom = null;
function setZoom(next) {
  const sc = $("scroller");
  const cx = (sc.scrollLeft + sc.clientWidth / 2) / sc.scrollWidth, cy = (sc.scrollTop + sc.clientHeight / 2) / sc.scrollHeight;
  zi = Math.max(0, Math.min(ZOOMS.length - 1, next));
  $("board").style.setProperty("--z", ZOOMS[zi]);
  $("zoom-lvl").textContent = `${ZOOMS[zi]}×`;
  $("zoom-out").disabled = zi === 0;
  $("zoom-in").disabled = zi === ZOOMS.length - 1;
  $("pan").hidden = zi === 0;
  if (zi === 0) setPan(false);
  requestAnimationFrame(() => {
    sc.scrollLeft = cx * sc.scrollWidth - sc.clientWidth / 2;
    sc.scrollTop = cy * sc.scrollHeight - sc.clientHeight / 2;
  });
}
function setPan(on) {
  panMode = on;
  $("pan").setAttribute("aria-pressed", String(on));
  $("board").classList.toggle("panning", on);
  $("hint").textContent = on ? "✋ Drag to move around · press ✋ again to pick pixels." : "Click or drag to pick pixels (up to 64) · taking a pixel costs ×2 its last price — the owner earns half.";
}
$("zoom-in").addEventListener("click", () => setZoom(zi + 1));
$("zoom-out").addEventListener("click", () => setZoom(zi - 1));
$("pan").addEventListener("click", () => setPan(!panMode));

let dragMode = null; // "add" | "remove"
function touch(i) {
  if (i < 0) return;
  if (dragMode === "add" && !selected.has(i) && selected.size < MAX_BATCH) selected.add(i);
  if (dragMode === "remove") selected.delete(i);
}
cv.addEventListener("pointerdown", (ev) => {
  cv.setPointerCapture(ev.pointerId);
  if (panMode) {
    const sc = $("scroller");
    panFrom = { x: ev.clientX, y: ev.clientY, l: sc.scrollLeft, t: sc.scrollTop };
    return;
  }
  const i = cellAt(ev);
  if (i < 0) return;
  dragMode = selected.has(i) ? "remove" : "add";
  touch(i);
  updateSelection();
});
cv.addEventListener("pointermove", (ev) => {
  if (panFrom) {
    const sc = $("scroller");
    sc.scrollLeft = panFrom.l - (ev.clientX - panFrom.x);
    sc.scrollTop = panFrom.t - (ev.clientY - panFrom.y);
    return;
  }
  const i = cellAt(ev);
  hover = i;
  if (dragMode) { touch(i); updateSelection(); }
  const tip = $("tip");
  if (i >= 0 && ev.pointerType === "mouse" && !panMode) {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    tip.textContent = `(${x}, ${y}) · ${owners[i] ? `held by ${short(owners[i])}${isMe(owners[i]) ? " (you)" : ""}` : "free"} · ${eth(priceOf(i))}`;
    const r = $("board").getBoundingClientRect();
    tip.style.left = `${Math.min(ev.clientX - r.left, r.width - 230)}px`;
    tip.style.top = `${Math.min(ev.clientY - r.top, r.height - 40)}px`;
    tip.hidden = false;
  } else tip.hidden = true;
  draw();
});
const endDrag = () => { dragMode = null; panFrom = null; };
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("pointerleave", () => { hover = -1; $("tip").hidden = true; draw(); });

function updateSelection() {
  let total = 0n;
  for (const i of selected) total += priceOf(i);
  $("sel-count").textContent = `${selected.size}${selected.size >= MAX_BATCH ? " (max)" : ""}`;
  $("sel-price").textContent = eth(total);
  const p = $("paint");
  p.disabled = selected.size === 0 || W.state.busy;
  p.textContent = !selected.size ? "Pick pixels on the canvas"
    : !account() ? `Connect & paint ${selected.size} px`
    : !W.onChain() ? `Switch network & paint ${selected.size} px`
    : `Paint ${selected.size} px · ${eth(total)}`;
  draw();
}
$("clear").addEventListener("click", () => { selected.clear(); updateSelection(); });

/* ------------------------------------------------------------------- data ---- */
async function load() {
  const hex = await pub.readContract({ address: CFG.address, abi, functionName: "colorsRange", args: [0n, BigInt(N)] });
  const bytes = hex.slice(2);
  for (let i = 0; i < N * 3; i++) colors[i] = parseInt(bytes.slice(i * 2, i * 2 + 2), 16);
  const chunks = await Promise.all([0, 1, 2, 3].map((k) => pub.readContract({ address: CFG.address, abi, functionName: "pixelsRange", args: [BigInt(k * 1024), 1024n] })));
  chunks.forEach(([o, l], k) => o.forEach((a, j) => {
    owners[k * 1024 + j] = ZERO.test(a) ? null : a.toLowerCase();
    levels[k * 1024 + j] = Number(l[j]);
  }));
  const counts = new Map();
  for (const a of owners) if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  const painted = owners.filter(Boolean).length;
  $("st-painted").textContent = painted.toLocaleString("en");
  $("st-players").textContent = counts.size.toLocaleString("en");
  $("st-free").textContent = (N - painted).toLocaleString("en");
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  $("leaders").innerHTML = top.length
    ? top.map(([a, n]) => `<li class="${isMe(a) ? "me" : ""}"><span><b>${short(a)}</b>${a === CFG.keeper ? ' <small class="tagb">builder</small>' : ""}</span><span class="pts">${n} px</span></li>`).join("")
    : `<li class="muted">empty canvas — be the first!</li>`;
  if (focus) {
    const n = counts.get(focus) ?? 0;
    $("focus").textContent = n ? `🎯 ${short(focus)} holds ${n} px (outlined in pink) — take them!` : `🎯 ${short(focus)} holds no pixels right now.`;
    $("focus").hidden = false;
  }
  updateSelection();
  refreshSeason().catch((e) => {
    $("se-board").replaceChildren(el("li", { className: "muted", textContent: `can't read this week's paints (${explain(e)})` }));
  });
}
async function loadMine() {
  const a = account();
  if (!a) return;
  const [own, cr] = await Promise.all([
    pub.readContract({ address: CFG.address, abi, functionName: "owned", args: [a] }),
    pub.readContract({ address: CFG.address, abi, functionName: "credit", args: [a] }),
  ]);
  if (a !== account()) return;
  $("me-owned").textContent = own.toString();
  $("me-credit").textContent = eth(cr);
  $("withdraw").disabled = cr === 0n;
}

/* ---------------------------------------------------------------- seasons ---- */
// Weekly points come from the contract's Painted events and $SHRWD's Transfer events (rules in season.js), so the
// table is the same for everyone and anyone can recompute it.
function logFeed(address, event, fromBlock, map) {
  const items = [];
  let to = fromBlock - 1n;
  return {
    items,
    async sync(latest) {
      if (latest <= to) return;
      const from = to + 1n, q = (a, b) => pub.getLogs({ address, event, fromBlock: a, toBlock: b });
      let got;
      try {
        got = await q(from, latest);
      } catch { // the RPC refused the range: walk it in slices
        got = [];
        for (let a = from; a <= latest; a += 1_000_000n) got.push(...(await q(a, a + 999_999n < latest ? a + 999_999n : latest)));
      }
      got.sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1));
      for (const l of got) items.push(map(l));
      to = latest;
    },
  };
}
const paints = logFeed(CFG.address, PAINTED, CFG.deployBlock, (l) => ({
  block: l.blockNumber,
  tx: l.transactionHash,
  id: Number(l.args.id),
  painter: l.args.painter.toLowerCase(),
  prev: ZERO.test(l.args.previousOwner) ? null : l.args.previousOwner.toLowerCase(),
  color: Number(l.args.color),
  price: l.args.price,
}));
const transfers = logFeed(CFG.token, TRANSFER, CFG.tokenBlock, (l) => ({
  block: l.blockNumber,
  from: l.args.from.toLowerCase(),
  to: l.args.to.toLowerCase(),
  value: l.args.value,
}));
const boundary = new Map(); // week n → its first block
async function firstBlockAt(ts, hi) {
  const key = `sc-week-${ts}`;
  try { const c = localStorage.getItem(key); if (c) return BigInt(c); } catch {}
  let lo = CFG.deployBlock;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (Number((await pub.getBlock({ blockNumber: mid })).timestamp) >= ts) hi = mid;
    else lo = mid + 1n;
  }
  try { localStorage.setItem(key, lo.toString()); } catch {}
  return lo;
}
let seasonBusy = null;
const refreshSeason = () => (seasonBusy ??= updateSeason().finally(() => { seasonBusy = null; }));
async function updateSeason() {
  const latest = await pub.getBlock();
  const current = seasonOf(Number(latest.timestamp));
  for (let n = 2; n <= current; n++) if (!boundary.has(n)) boundary.set(n, await firstBlockAt(seasonStart(n), latest.number));
  await Promise.all([paints.sync(latest.number), transfers.sync(latest.number)]);
  const weekOf = (block) => { let n = 1; while (boundary.has(n + 1) && block >= boundary.get(n + 1)) n++; return n; };
  const weeks = Array.from({ length: current }, (_, k) => ({ n: k + 1, end: k + 1 < current ? boundary.get(k + 2) : null }));
  const holders = holdersByWeek(transfers.items, weeks);
  const seasons = score(paints.items.map((e) => ({ ...e, season: weekOf(e.block) })), current, new Set([CFG.keeper]), holders);
  renderSeason(seasons, current, holders.get(current));
  await renderLive(latest);
}
function renderSeason(seasons, current, holdersNow) {
  const s = seasons.get(current);
  week = s;
  const left = seasonStart(current + 1) - Math.floor(Date.now() / 1000);
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60);
  const leftText = left <= 0 ? "closing…" : d ? `${d}d ${h}h left` : `${h}h ${m}m left`;
  $("se-n").textContent = current;
  $("se-left").textContent = leftText;
  $("st-week").textContent = `Week ${current}`;
  $("st-left").textContent = leftText;

  const me = account()?.toLowerCase() ?? null;
  const mine = me ? s.rows.get(me) : null;
  const holder = !!me && holdersNow.has(me);
  const rank = me ? s.ranked.findIndex((r) => r.addr === me) : -1;
  $("se-me").innerHTML = !me ? "connect to see"
    : me === CFG.keeper ? "builder — doesn't rank"
    : `${mine?.points ?? 0} pts${holder ? '<span class="x2">×2</span>' : ""}${rank >= 0 ? ` · #${rank + 1}` : ""}`;
  $("boost").classList.toggle("on", holder);
  $("boost-sub").textContent = holder
    ? "✓ You hold $SHRWD — your points are doubled this week."
    : me && mine?.base
      ? `You'd have ${mine.base * 2} pts instead of ${mine.base}. Any amount of $SHRWD doubles them — get it on vibe/vibe ↗`
      : "Any amount of $SHRWD doubles your weekly points. Get it on vibe/vibe ↗";

  $("se-board").innerHTML = s.ranked.length
    ? s.ranked.slice(0, 8).map((r) => `<li class="${r.addr === me ? "me" : ""}"><span><b>${short(r.addr)}</b>${r.holder ? '<span class="x2">×2</span>' : ""}</span><span class="pts">${r.points} pts</span><span class="split">${r.free} new · ${r.steal} taken · ${r.held} held</span></li>`).join("")
    : `<li class="muted">no points yet this week — paint first!</li>`;
  const past = [...seasons.values()].filter((x) => x.n < current).sort((a, b) => b.n - a.n);
  $("se-past").hidden = past.length === 0;
  $("se-past-list").innerHTML = past.map((x) => `<li><b>Week ${x.n}</b><br>${x.ranked.slice(0, 3).map((r, i) => `${["🥇", "🥈", "🥉"][i]} ${short(r.addr)} — ${r.points} pts${r.holder ? " (×2)" : ""}`).join("<br>") || '<span class="muted">nobody scored</span>'}</li>`).join("");
}

/* live feed: the last paints, one line per transaction */
const blockTime = new Map(); // block → unix seconds
const ago = (s) => (s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`);
async function renderLive(latest) {
  const groups = [];
  for (let i = paints.items.length - 1; i >= 0 && groups.length < 10; i--) {
    const e = paints.items[i];
    let g = groups.find((x) => x.tx === e.tx);
    if (!g) groups.push((g = { tx: e.tx, block: e.block, painter: e.painter, color: e.color, n: 0, took: new Map() }));
    g.n++;
    if (e.prev && e.prev !== e.painter) g.took.set(e.prev, (g.took.get(e.prev) ?? 0) + 1);
  }
  const need = [...new Set(groups.map((g) => g.block))].filter((b) => !blockTime.has(b));
  await Promise.all(need.map(async (b) => { try { blockTime.set(b, Number((await pub.getBlock({ blockNumber: b })).timestamp)); } catch {} }));
  const now = Number(latest.timestamp);
  $("live").replaceChildren(...(groups.length ? groups.map((g) => {
    const who = isMe(g.painter) ? "you" : g.painter === CFG.keeper ? "builder" : short(g.painter);
    const took = [...g.took].map(([a, k]) => `took ${k} from ${isMe(a) ? "you" : a === CFG.keeper ? "the builder" : short(a)}`).join(", ");
    const t = blockTime.get(g.block);
    return el("li", {},
      el("span", { className: "sw", style: `background:#${g.color.toString(16).padStart(6, "0")}` }),
      el("span", { className: "what", textContent: `${who} painted ${g.n} px${took ? ` · ${took}` : ""}` }),
      el("a", { className: "when", href: `${EXPLORER}/tx/${g.tx}`, target: "_blank", rel: "noopener", textContent: t ? ago(now - t) : "tx ↗" }));
  }) : [el("li", { className: "muted", textContent: "no paints yet" })]));
}

document.querySelector(".tabs").addEventListener("click", (e) => {
  const t = e.target.closest(".tab");
  if (!t) return;
  for (const b of document.querySelectorAll(".tab")) { b.classList.toggle("on", b === t); b.setAttribute("aria-selected", String(b === t)); }
  const tab = t.dataset.tab;
  $("se-board").hidden = tab !== "week";
  $("leaders").hidden = tab !== "land";
  $("live").hidden = tab !== "live";
  $("me-line").hidden = tab !== "week";
  $("rules").hidden = tab !== "week";
});

/* ------------------------------------------------------------------ write ---- */
const walletClient = () => createWalletClient({ account: account(), chain: CFG.chain, transport: custom(W.state.provider) });
// The transaction goes to the wallet complete — gas, fees and nonce come from the public RPC — so wallets that can't
// look this testnet up themselves still have everything they need, and a would-be failure (not enough ETH, a price
// that moved) is caught here in plain words instead of on a confusing wallet screen.
async function send(functionName, args = [], value = 0n) {
  const req = { address: CFG.address, abi, functionName, args, value, account: account() };
  const [gas, fees, nonce, balance] = await Promise.all([
    pub.estimateContractGas(req),
    pub.estimateFeesPerGas(),
    pub.getTransactionCount({ address: account(), blockTag: "pending" }),
    pub.getBalance({ address: account() }),
  ]);
  const limit = (gas * 13n) / 10n, maxFee = fees.maxFeePerGas * 2n;
  if (balance < value + limit * maxFee) throw new Error("insufficient funds");
  return walletClient().writeContract({ ...req, gas: limit, maxFeePerGas: maxFee, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, nonce });
}
let writing = false;
async function write(fn) {
  if (writing) return;
  writing = true;
  $("paint").disabled = true;
  try {
    if (!account() && !(await W.connect())) return;
    if (!W.onChain()) await W.switchChain();
    await fn();
  } catch (e) {
    status(explain(e), "err");
  } finally {
    writing = false;
    W.refreshBalance();
    updateSelection();
  }
}

$("paint").addEventListener("click", () => write(async () => {
  const ids = [...selected].map(BigInt);
  const rgb = parseInt(color.slice(1), 16);
  const value = await pub.readContract({ address: CFG.address, abi, functionName: "quote", args: [ids] });
  status(`Confirm in your wallet — ${ids.length} px for ${eth(value)} + a tiny gas fee…`);
  const hash = await send("paint", [ids, ids.map(() => rgb)], value);
  status("Sent ✓ waiting for the block…", "", { href: `${EXPLORER}/tx/${hash}`, text: "view tx ↗" });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("The transaction failed on-chain — nothing was painted, try again.");
  selected.clear();
  status(`Painted ${ids.length} px ✓`, "ok", { href: `${EXPLORER}/tx/${hash}`, text: "view tx ↗" });
  await load();
  await loadMine();
}));
$("withdraw").addEventListener("click", () => write(async () => {
  status("Confirm the withdrawal in your wallet…");
  const hash = await send("withdraw");
  status("Sent ✓ waiting for the block…", "", { href: `${EXPLORER}/tx/${hash}`, text: "view tx ↗" });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("The withdrawal failed on-chain — try again.");
  status("Earnings withdrawn to your wallet ✓", "ok", { href: `${EXPLORER}/tx/${hash}`, text: "view tx ↗" });
  await loadMine();
}));

/* ------------------------------------------------------------------ share ---- */
$("share").addEventListener("click", () => {
  const me = account()?.toLowerCase() ?? null;
  const held = me ? owners.filter((a) => a === me).length : 0;
  const pts = (me && week?.rows.get(me)?.points) || 0;
  const text = held
    ? `I hold ${held} px on Sherwood Canvas 🏹 an on-chain pixel war on Robinhood Chain${pts ? ` (${pts} pts this week)` : ""}. Come take them 👇 $SHRWD`
    : "Sherwood Canvas 🏹 an on-chain pixel war on Robinhood Chain. Paint a pixel, steal a pixel, earn when yours is taken. Hold $SHRWD for ×2 points 👇";
  const url = held ? `${CFG.site}?p=${me}` : CFG.site;
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener");
});

/* ------------------------------------------------------------------- boot ---- */
$("contract-link").href = $("contract-link2").href = `${EXPLORER}/address/${CFG.address}?tab=contract`;
$("keeper-link").href = `${EXPLORER}/address/${CFG.keeper}`;
$("token-link").href = CFG.tokenUrl;
$("boost").href = CFG.tokenUrl;
renderPalette();
setZoom(0);
draw();
// the checklist needs the EIP-6963 announcements, which arrive right after the request
setTimeout(renderWallet, 250);
load().catch((e) => status(`Can't read the canvas: ${explain(e)}`, "err"));
setInterval(() => { load().catch(() => {}); if (account()) W.refreshBalance(); }, 12000); // a balance change redraws the wallet + your stats
// No wallet is touched until the player presses a button: just looking at the board never wakes a wallet extension
// (Zerion, for one, pops its site warning on the first wallet call).
