// Local EVM tests for SherwoodCanvas (ganache in-process). Run: node scripts/test.mjs
import ganache from "ganache";
import { createPublicClient, createWalletClient, custom, parseEther, formatEther, decodeEventLog, encodeFunctionData, decodeErrorResult, toHex } from "viem";
import { readFileSync } from "node:fs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const { abi, bytecode } = JSON.parse(readFileSync("build/SherwoodCanvas.json", "utf8"));
const keys = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
const provider = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai", chainId: 1337 }, wallet: { accounts: keys.map((k) => ({ secretKey: k, balance: "0x56BC75E2D63100000" })) } });
const chain = { id: 1337, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://x"] } } };
const pub = createPublicClient({ chain, transport: custom(provider) });
const accts = keys.map((k) => privateKeyToAccount(k));
const [alice, bob, carol] = accts.map((a) => a.address);
const byAddr = Object.fromEntries(accts.map((a) => [a.address, a]));
const w = (a) => createWalletClient({ account: byAddr[a], chain, transport: custom(provider) });

let pass = 0, fail = 0;
const check = (name, ok, info = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); };
const expectRevert = async (name, fn, errName) => {
  try { await fn(); check(name, false, "did not revert"); }
  catch (e) { const m = String(e?.shortMessage ?? e?.message ?? e); check(name, !errName || m.includes(errName) || JSON.stringify(e?.cause ?? "").includes(errName), m.slice(0, 90)); }
};

const deployHash = await w(alice).deployContract({ abi, bytecode });
const { contractAddress: C } = await pub.waitForTransactionReceipt({ hash: deployHash });
const read = (fn, args = []) => pub.readContract({ address: C, abi, functionName: fn, args });
// simulate a call and require the named custom error
// raw eth_call through ganache, then decode the revert with the contract ABI (custom errors) or Panic
const sim = async (who, fn, args, value = 0n) => {
  const data = encodeFunctionData({ abi, functionName: fn, args });
  try {
    await provider.request({ method: "eth_call", params: [{ from: who, to: C, data, value: toHex(value) }, "latest"] });
  } catch (e) {
    const raw = e?.data?.data ?? e?.data?.result ?? e?.data;
    let name = "";
    try { name = decodeErrorResult({ abi, data: raw }).errorName; } catch { name = String(raw ?? e.message); }
    if (/^0x4e487b71/.test(String(raw)) && String(raw).endsWith("11")) name = "Panic(0x11) arithmetic underflow";
    throw new Error(`reverted: ${name}`);
  }
};
const paint = async (who, ids, colors, value) => {
  const h = await w(who).writeContract({ address: C, abi, functionName: "paint", args: [ids, colors], value });
  return pub.waitForTransactionReceipt({ hash: h });
};
const BASE = parseEther("0.00001");

check("keeper is the deployer", (await read("keeper")).toLowerCase() === alice.toLowerCase());
check("fresh pixel costs BASE", (await read("priceOf", [0n])) === BASE);

// 1) paint free pixels
const r1 = await paint(alice, [0n, 1n, 4095n], [0xff0000, 0x00ff00, 0x0000ff], BASE * 3n);
check("alice paints 3 free pixels", r1.status === "success");
check("alice owns 3", (await read("owned", [alice])) === 3n);
check("treasury = 3 BASE", (await read("treasury")) === BASE * 3n);
const events = r1.logs.map((l) => { try { return decodeEventLog({ abi, data: l.data, topics: l.topics }); } catch { return null; } }).filter(Boolean);
check("3 Painted events", events.filter((e) => e.eventName === "Painted").length === 3);

// 2) colours read back
const cols = await read("colorsRange", [0n, 2n]);
check("colorsRange packs RGB", cols === "0xff000000ff00", cols);
const last = await read("colorsRange", [4095n, 1n]);
check("last pixel colour", last === "0x0000ff", last);

// 3) takeover: bob takes pixel 0 at 2×? — first takeover price = BASE << 0 = BASE (level 0), then doubles
check("takeover price of pixel 0 = BASE (level 0)", (await read("priceOf", [0n])) === BASE);
await paint(bob, [0n], [0x123456], BASE);
check("bob owns pixel 0", (await read("pixelsRange", [0n, 1n]))[0][0].toLowerCase() === bob.toLowerCase());
check("alice credited half", (await read("credit", [alice])) === BASE / 2n);
check("alice owns 2 now", (await read("owned", [alice])) === 2n);
check("next price doubled", (await read("priceOf", [0n])) === BASE * 2n);

// 4) underpay reverts
await expectRevert("underpay reverts", () => sim(carol, "paint", [[0n], [0]], BASE), "NotEnough");

// 5) overpay goes to credit
await paint(carol, [0n], [0xabcdef], BASE * 5n);
check("carol overpaid → credit 3 BASE", (await read("credit", [carol])) === BASE * 3n);
check("bob credited half of 2 BASE", (await read("credit", [bob])) === BASE);

// 6) price cap at level 8
for (let i = 0; i < 12; i++) { const p = await read("priceOf", [5n]); await paint(i % 2 ? alice : bob, [5n], [i], p); }
check("price capped at 256× BASE", (await read("priceOf", [5n])) === BASE * 256n, formatEther(await read("priceOf", [5n])));

// 7) quote = sum of prices
const q = await read("quote", [[0n, 5n, 100n]]);
check("quote sums prices", q === (await read("priceOf", [0n])) + (await read("priceOf", [5n])) + BASE);

// 8) bad inputs
await expectRevert("id 4096 reverts", () => sim(alice, "paint", [[4096n], [0]], BASE), "BadPixel");
await expectRevert("empty batch reverts", () => sim(alice, "paint", [[], []], 0n), "BadBatch");
await expectRevert("length mismatch reverts", () => sim(alice, "paint", [[7n, 8n], [1]], BASE * 2n), "BadBatch");
await expectRevert("65-pixel batch reverts", () => sim(alice, "paint", [Array.from({ length: 65 }, (_, i) => BigInt(1000 + i)), Array(65).fill(1)], BASE * 65n), "BadBatch");
const r64 = await paint(alice, Array.from({ length: 64 }, (_, i) => BigInt(2000 + i)), Array(64).fill(0x777777), BASE * 64n);
check("64-pixel batch works", r64.status === "success", `gas ${r64.gasUsed}`);

// 9) withdraw
const before = await pub.getBalance({ address: bob });
const cb = await read("credit", [bob]);
const hw = await w(bob).writeContract({ address: C, abi, functionName: "withdraw" });
const rw = await pub.waitForTransactionReceipt({ hash: hw });
const after = await pub.getBalance({ address: bob });
check("withdraw pays credit", after - before + rw.gasUsed * rw.effectiveGasPrice === cb, formatEther(cb));
check("credit zeroed", (await read("credit", [bob])) === 0n);
await expectRevert("withdraw twice reverts", () => sim(bob, "withdraw", []), "NothingToWithdraw");

// 10) treasury: only keeper, can't overdraw
await expectRevert("non-keeper treasury withdraw reverts", () => sim(bob, "withdrawTreasury", [bob, 1n]), "OnlyKeeper");
const t = await read("treasury");
await expectRevert("treasury overdraw reverts (arithmetic underflow)", () => sim(alice, "withdrawTreasury", [alice, t + 1n]), "underflow");
const ht = await w(alice).writeContract({ address: C, abi, functionName: "withdrawTreasury", args: [alice, t] });
check("keeper withdraws treasury", (await pub.waitForTransactionReceipt({ hash: ht })).status === "success" && (await read("treasury")) === 0n);

// 11) accounting invariant: contract balance == treasury + sum(credits)
const bal = await pub.getBalance({ address: C });
const credits = (await read("credit", [alice])) + (await read("credit", [bob])) + (await read("credit", [carol]));
check("balance == treasury + credits", bal === (await read("treasury")) + credits, `${formatEther(bal)} vs ${formatEther(credits)}`);
check("owned counts sum ≤ painted pixels", (await read("owned", [alice])) + (await read("owned", [bob])) + (await read("owned", [carol])) === 3n + 1n + 64n);

// 12) full canvas read in one call
const all = await read("colorsRange", [0n, 4096n]);
check("full canvas read = 12 KB", (all.length - 2) / 2 === 4096 * 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
