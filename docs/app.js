// Sherwood Canvas — front end. Plain ES module, no build step. Reads the chain through the public RPC; writes through
// the visitor's own wallet (window.ethereum). Nothing is stored anywhere but the contract.
import { createPublicClient, createWalletClient, custom, http, formatEther, parseAbi } from "https://esm.sh/viem@2.21.0";

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
}

/* ----------------------------------------------------------------- wallet ---- */
const status = (msg, kind = "") => { const s = $("status"); s.textContent = msg; s.className = `status ${kind}`; };
async function ensureChain() {
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CFG.chainIdHex }] });
  } catch (e) {
    if (e?.code !== 4902 && !/Unrecognized|not added/i.test(e?.message ?? "")) throw e;
    await addNetwork();
  }
}
async function addNetwork() {
  await window.ethereum.request({
    method: "wallet_addEthereumChain",
    params: [{ chainId: CFG.chainIdHex, chainName: CFG.chain.name, nativeCurrency: CFG.chain.nativeCurrency, rpcUrls: CFG.chain.rpcUrls.default.http, blockExplorerUrls: [CFG.chain.blockExplorers.default.url] }],
  });
}
async function connect() {
  if (!window.ethereum) { status("No wallet found — install MetaMask or Rabby.", "err"); return null; }
  const [a] = await window.ethereum.request({ method: "eth_requestAccounts" });
  account = a;
  $("connect").textContent = short(a);
  await ensureChain();
  await load();
  return a;
}
$("connect").addEventListener("click", () => connect().catch((e) => status(e.shortMessage ?? e.message, "err")));
$("addnet").addEventListener("click", () => (window.ethereum ? addNetwork().then(() => status("Network added ✓", "ok")) : status("No wallet found.", "err")).catch((e) => status(e.message, "err")));
window.ethereum?.on?.("accountsChanged", (a) => { account = a[0] ?? null; $("connect").textContent = account ? short(account) : "Connect wallet"; load(); });

const wallet = () => createWalletClient({ account, chain: CFG.chain, transport: custom(window.ethereum) });
async function explorerTx(hash) { return `${CFG.chain.blockExplorers.default.url}/tx/${hash}`; }

$("paint").addEventListener("click", async () => {
  try {
    if (!account && !(await connect())) return;
    await ensureChain();
    const ids = [...selected].map(BigInt);
    const rgb = parseInt(color.slice(1), 16);
    const value = await pub.readContract({ address: CFG.address, abi, functionName: "quote", args: [ids] });
    status(`Confirm in your wallet — ${ids.length} px for ${eth(value)}…`);
    const hash = await wallet().writeContract({ address: CFG.address, abi, functionName: "paint", args: [ids, ids.map(() => rgb)], value });
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
    const hash = await wallet().writeContract({ address: CFG.address, abi, functionName: "withdraw" });
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
window.ethereum?.request({ method: "eth_accounts" }).then((a) => { if (a?.[0]) { account = a[0]; $("connect").textContent = short(account); load(); } }).catch(() => {});
