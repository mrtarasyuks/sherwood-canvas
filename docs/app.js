// Sherwood Canvas — front end. Plain ES module, no build step. Reads the chain through the public RPC; writes through
// the visitor's own wallet (whichever they pick). Nothing is stored anywhere but the contract.
import { createPublicClient, createWalletClient, custom, http, formatEther, parseAbi, parseAbiItem } from "https://esm.sh/viem@2.21.0";
import { score, seasonOf, seasonStart, prize, WEEK } from "./season.js";

const CFG = {
  address: "0x8ed7ffb34b2a25d866e785843fca0dd899291122",
  chainIdHex: "0xb626",
  chain: {
    id: 46630,
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
    blockExplorers: { default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" } },
  },
  tokenUrl: "https://testnet.vibevibe.fun/token/0xB76f7ab3baf2c4220444C73F66793869A811e001", // $SHRWD on vibe/vibe
  deployBlock: 125869265n,
  keeper: "0x2973b942305df55b6fb1ed676a39e9741e7e1f62", // the builder's wallet: plays, never ranks
};
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
  "function totalPaints() view returns (uint256)",
]);
const PAINTED = parseAbiItem("event Painted(uint256 indexed id, address indexed painter, address indexed previousOwner, uint24 color, uint256 price)");

const pub = createPublicClient({ chain: CFG.chain, transport: http() });
const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const eth = (wei) => {
  if (wei === 0n) return "0 ETH";
  const s = formatEther(wei);
  return `${Number(s) < 0.001 && wei > 0n ? Number(s).toFixed(6) : Number(s).toFixed(4)} ETH`;
};

/* ------------------------------------------------------------------ state ---- */
let colors = new Uint8Array(N * 3);
let owners = new Array(N).fill(null);
let levels = new Uint8Array(N);
let account = null;
let color = "#3ddc84";
const selected = new Set();
let hover = -1;

/* --------------------------------------------------------------- palette ---- */
const PALETTE = ["#0d0d0d", "#ffffff", "#e8505b", "#f28c28", "#f2c14e", "#3ddc84", "#1f8a4c", "#5ab0ff",
  "#2952cc", "#8e5cf6", "#f06fb5", "#8b5a2b", "#7a7a7a", "#c4c4c4", "#00c2c7", "#b6f542"];
function renderPalette() {
  $("palette").innerHTML = PALETTE.map((c) => `<button class="swatch${c === color ? " on" : ""}" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join("");
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
    if (owners[i]) {
      ctx.fillStyle = `rgb(${colors[i * 3]},${colors[i * 3 + 1]},${colors[i * 3 + 2]})`;
    } else {
      ctx.fillStyle = ((i % SIZE) + Math.floor(i / SIZE)) % 2 ? "#15302a" : "#12291f";
    }
    ctx.fillRect(x, y, CELL, CELL);
  }
  for (const i of selected) {
    const x = (i % SIZE) * CELL, y = Math.floor(i / SIZE) * CELL;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
  }
  if (hover >= 0) {
    ctx.strokeStyle = "#f2c14e";
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
let dragMode = null; // "add" | "remove"
function touch(i) {
  if (i < 0) return;
  if (dragMode === "add" && !selected.has(i) && selected.size < MAX_BATCH) selected.add(i);
  if (dragMode === "remove") selected.delete(i);
}
cv.addEventListener("pointerdown", (ev) => {
  const i = cellAt(ev);
  if (i < 0) return;
  cv.setPointerCapture(ev.pointerId);
  dragMode = selected.has(i) ? "remove" : "add";
  touch(i);
  updateSelection();
});
cv.addEventListener("pointermove", (ev) => {
  const i = cellAt(ev);
  hover = i;
  if (dragMode) { touch(i); updateSelection(); }
  const tip = $("tip");
  if (i >= 0 && ev.pointerType === "mouse") {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    tip.textContent = `(${x}, ${y}) · ${owners[i] ? `held by ${short(owners[i])}${account && owners[i].toLowerCase() === account.toLowerCase() ? " (you)" : ""}` : "free"} · ${eth(priceOf(i))}`;
    const r = $("board").getBoundingClientRect();
    tip.style.left = `${Math.min(ev.clientX - r.left, r.width - 220)}px`;
    tip.style.top = `${ev.clientY - r.top}px`;
    tip.hidden = false;
  } else tip.hidden = true;
  draw();
});
const endDrag = () => { dragMode = null; };
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("pointerleave", () => { hover = -1; $("tip").hidden = true; draw(); });

function updateSelection() {
  let total = 0n;
  for (const i of selected) total += priceOf(i);
  $("sel-count").textContent = `${selected.size}${selected.size >= MAX_BATCH ? " (max)" : ""}`;
  $("sel-price").textContent = eth(total);
  $("paint").disabled = selected.size === 0;
  $("paint").textContent = account ? `Paint ${selected.size || ""}`.trim() : "Connect & paint";
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
    owners[k * 1024 + j] = /^0x0{40}$/i.test(a) ? null : a;
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
    ? top.map(([a, n]) => `<li class="${account && a.toLowerCase() === account.toLowerCase() ? "me" : ""}"><b>${short(a)}</b> — ${n} px</li>`).join("")
    : `<li class="muted">empty canvas — be the first!</li>`;
  if (account) {
    const [own, cr] = await Promise.all([
      pub.readContract({ address: CFG.address, abi, functionName: "owned", args: [account] }),
      pub.readContract({ address: CFG.address, abi, functionName: "credit", args: [account] }),
    ]);
    $("me-owned").textContent = own.toString();
    $("me-credit").textContent = eth(cr);
    $("withdraw").disabled = cr === 0n;
  }
  updateSelection();
  refreshSeason().catch((e) => {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = `can't read this week's paints (${String(e.shortMessage ?? e.message).slice(0, 80)})`;
    $("se-board").replaceChildren(li);
  });
}

/* ---------------------------------------------------------------- seasons ---- */
// Weekly points are computed from the contract's Painted events (rules in season.js), so the table is the same for
// everyone and anyone can recompute it.
const events = []; // decoded Painted events in chain order
let logsTo = CFG.deployBlock - 1n;
const boundary = new Map(); // week n → its first block
const ZERO = /^0x0{40}$/i;
async function fetchLogs(latest) {
  if (latest <= logsTo) return;
  const from = logsTo + 1n, q = (fromBlock, toBlock) => pub.getLogs({ address: CFG.address, event: PAINTED, fromBlock, toBlock });
  let got;
  try {
    got = await q(from, latest);
  } catch { // the RPC refused the range: walk it in slices
    got = [];
    for (let a = from; a <= latest; a += 1_000_000n) got.push(...(await q(a, a + 999_999n < latest ? a + 999_999n : latest)));
  }
  got.sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1));
  for (const l of got) {
    events.push({
      block: l.blockNumber,
      id: Number(l.args.id),
      painter: l.args.painter.toLowerCase(),
      prev: ZERO.test(l.args.previousOwner) ? null : l.args.previousOwner.toLowerCase(),
      price: l.args.price,
    });
  }
  logsTo = latest;
}
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
  await fetchLogs(latest.number);
  const weekOf = (block) => { let n = 1; while (boundary.has(n + 1) && block >= boundary.get(n + 1)) n++; return n; };
  renderSeason(score(events.map((e) => ({ ...e, season: weekOf(e.block) })), current, new Set([CFG.keeper])), current);
}
const MEDAL = ["🥇", "🥈", "🥉"];
function renderSeason(seasons, current) {
  const s = seasons.get(current);
  const left = seasonStart(current + 1) - Math.floor(Date.now() / 1000);
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60);
  const leftText = left <= 0 ? "closing…" : d ? `${d}d ${h}h left` : `${h}h ${m}m left`;
  $("se-n").textContent = current;
  $("se-left").textContent = leftText;
  $("st-week").textContent = `Week ${current}`;
  $("st-left").textContent = leftText;
  $("se-pool").textContent = eth(s.pool);
  const me = account?.toLowerCase() ?? null;
  const rank = me ? s.ranked.findIndex((r) => r.addr === me) : -1;
  $("se-me").textContent = !me ? "connect to see" : me === CFG.keeper ? "builder — doesn't rank" : `${s.rows.get(me)?.points ?? 0} pts${rank >= 0 ? ` · #${rank + 1}` : ""}`;
  $("se-board").innerHTML = s.ranked.length
    ? s.ranked.slice(0, 10).map((r, i) => `<li class="${r.addr === me ? "me" : ""}"><b>${short(r.addr)}</b> — ${r.points} pts${i < 3 && s.pool > 0n ? ` <span class="prize">${MEDAL[i]} ${eth(prize(s, i))}</span>` : ""}<span class="split">${r.free} new · ${r.steal} taken · ${r.held} held</span></li>`).join("")
    : `<li class="muted">no points yet this week — paint first!</li>`;
  const past = [...seasons.values()].filter((x) => x.n < current).sort((a, b) => b.n - a.n);
  $("se-past").hidden = past.length === 0;
  $("se-past-list").innerHTML = past.map((x) => `<li><b>Week ${x.n}</b> · pool ${eth(x.pool)}<br>${x.ranked.slice(0, 3).map((r, i) => `${MEDAL[i]} ${short(r.addr)} ${r.points} pts → ${eth(prize(x, i))}`).join("<br>") || "<span class=\"muted\">nobody scored</span>"}</li>`).join("");
}

/* ----------------------------------------------------------------- wallet ---- */
const status = (msg, kind = "") => { const s = $("status"); s.textContent = msg; s.className = `status ${kind}`; };
// Every installed wallet announces itself (EIP-6963); with more than one the player picks. window.ethereum is the fallback.
const wallets = [];
window.addEventListener("eip6963:announceProvider", (e) => {
  if (!wallets.some((w) => w.info.uuid === e.detail.info.uuid)) wallets.push(e.detail);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
let provider = null; // the chosen wallet
const remember = (rdns) => { try { localStorage.setItem("sc-wallet", rdns); } catch {} };
const remembered = () => { try { return localStorage.getItem("sc-wallet"); } catch { return null; } };
function pickWallet() {
  if (wallets.length <= 1) return Promise.resolve(wallets[0]?.provider ?? window.ethereum ?? null);
  const dlg = $("wallet-pick"), list = $("wallet-list");
  list.replaceChildren(...wallets.map((w) => {
    const b = document.createElement("button");
    b.className = "btn wallet-opt";
    b.dataset.uuid = w.info.uuid;
    if (/^data:image\//.test(w.info.icon)) { const i = document.createElement("img"); i.src = w.info.icon; i.alt = ""; b.append(i); }
    b.append(document.createTextNode(w.info.name));
    return b;
  }));
  dlg.showModal();
  return new Promise((resolve) => {
    list.onclick = (e) => {
      const w = wallets.find((x) => x.info.uuid === e.target.closest(".wallet-opt")?.dataset.uuid);
      if (!w) return;
      remember(w.info.rdns);
      dlg.close();
      resolve(w.provider);
    };
    dlg.onclose = () => resolve(null);
  });
}
function watch(p) {
  p?.on?.("accountsChanged", (a) => { account = a[0] ?? null; $("connect").textContent = account ? short(account) : "Connect wallet"; load(); });
}
async function ensureChain() {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CFG.chainIdHex }] });
  } catch (e) {
    if (e?.code !== 4902 && !/Unrecognized|not added|unknown chain/i.test(e?.message ?? "")) throw e;
    await addNetwork();
  }
}
async function addNetwork() {
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [{ chainId: CFG.chainIdHex, chainName: CFG.chain.name, nativeCurrency: CFG.chain.nativeCurrency, rpcUrls: CFG.chain.rpcUrls.default.http, blockExplorerUrls: [CFG.chain.blockExplorers.default.url] }],
  });
}
async function connect() {
  const p = await pickWallet();
  if (!p) { if (!wallets.length && !window.ethereum) status("No wallet found — install MetaMask or Rabby.", "err"); return null; }
  provider = p;
  watch(provider);
  const [a] = await provider.request({ method: "eth_requestAccounts" });
  account = a;
  $("connect").textContent = short(a);
  await ensureChain();
  await load();
  return a;
}
$("connect").addEventListener("click", () => connect().catch((e) => status(e.shortMessage ?? e.message, "err")));
$("addnet").addEventListener("click", async () => {
  try {
    if (!provider) provider = await pickWallet();
    if (!provider) return status("No wallet found.", "err");
    await addNetwork();
    status("Network added ✓", "ok");
  } catch (e) { status(e.message, "err"); }
});

const wallet = () => createWalletClient({ account, chain: CFG.chain, transport: custom(provider) });
async function explorerTx(hash) { return `${CFG.chain.blockExplorers.default.url}/tx/${hash}`; }
// The transaction goes to the wallet complete — gas, fees and nonce come from the public RPC — so wallets that can't
// look this testnet up themselves (Zerion answers "404") still have everything they need. It also turns a would-be
// revert into a clear message here instead of a confusing wallet screen.
async function send(functionName, args = [], value = 0n) {
  const req = { address: CFG.address, abi, functionName, args, value, account };
  const [gas, fees, nonce] = await Promise.all([
    pub.estimateContractGas(req),
    pub.estimateFeesPerGas(),
    pub.getTransactionCount({ address: account, blockTag: "pending" }),
  ]);
  return wallet().writeContract({ ...req, gas: (gas * 13n) / 10n, maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, nonce });
}

$("paint").addEventListener("click", async () => {
  try {
    if (!account && !(await connect())) return;
    await ensureChain();
    const ids = [...selected].map(BigInt);
    const rgb = parseInt(color.slice(1), 16);
    const value = await pub.readContract({ address: CFG.address, abi, functionName: "quote", args: [ids] });
    status(`Confirm in your wallet — ${ids.length} px for ${eth(value)}…`);
    const hash = await send("paint", [ids, ids.map(() => rgb)], value);
    status("Painting… waiting for the block");
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("transaction reverted");
    selected.clear();
    status("", "ok");
    $("status").innerHTML = `Painted ✓ <a href="${await explorerTx(hash)}" target="_blank" rel="noopener">view tx</a>`;
    await load();
  } catch (e) {
    status(e.shortMessage ?? e.message ?? String(e), "err");
  }
});
$("withdraw").addEventListener("click", async () => {
  try {
    await ensureChain();
    const hash = await send("withdraw");
    status("Withdrawing…");
    await pub.waitForTransactionReceipt({ hash });
    status("Earnings withdrawn ✓", "ok");
    await load();
  } catch (e) {
    status(e.shortMessage ?? e.message ?? String(e), "err");
  }
});

/* ------------------------------------------------------------------- boot ---- */
$("contract-link").href = `${CFG.chain.blockExplorers.default.url}/address/${CFG.address}?tab=contract`;
if (CFG.tokenUrl) { $("token-link").href = CFG.tokenUrl; $("token-link").hidden = false; }
renderPalette();
draw();
load().catch((e) => status(`Can't read the canvas: ${e.shortMessage ?? e.message}`, "err"));
setInterval(() => load().catch(() => {}), 12000);
// already connected earlier? pick that wallet back up silently (eth_accounts never opens a prompt)
setTimeout(() => {
  const w = wallets.find((x) => x.info.rdns === remembered()) ?? (wallets.length === 1 ? wallets[0] : null);
  const p = w?.provider ?? (wallets.length ? null : window.ethereum);
  p?.request({ method: "eth_accounts" }).then((a) => {
    if (!a?.[0]) return;
    provider = p;
    watch(p);
    account = a[0];
    $("connect").textContent = short(account);
    load();
  }).catch(() => {});
}, 300);
