// Wallet connection — the whole flow in one place: find the installed wallets (EIP-6963, window.ethereum as the
// fallback), connect the one the player picks, get it onto Robinhood Chain, read the test-ETH balance, and turn wallet
// errors into plain words. The page listens for "change" and redraws from `wallet.state`.
//
// Nothing here runs until the player presses a button: looking at the board never wakes a wallet extension.

const MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export function createWallet({ chain, chainIdHex, pub, pick }) {
  const found = []; // EIP-6963 announcements
  window.addEventListener("eip6963:announceProvider", (e) => {
    if (!found.some((w) => w.info.uuid === e.detail.info.uuid)) found.push(e.detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  const events = new EventTarget();
  const state = { provider: null, name: null, icon: null, account: null, chainId: null, balance: null, busy: false };
  const emit = () => events.dispatchEvent(new Event("change"));
  let unwatch = () => {};

  const installed = () => found.length + (found.length === 0 && window.ethereum ? 1 : 0);
  const onChain = () => state.chainId === chainIdHex;

  function watch(p) {
    unwatch();
    if (!p?.on) return;
    const acc = (a) => {
      state.account = a?.[0] ?? null;
      if (!state.account) reset();
      else refreshBalance();
      emit();
    };
    const ch = (id) => {
      state.chainId = typeof id === "string" ? id.toLowerCase() : `0x${Number(id).toString(16)}`;
      emit();
    };
    p.on("accountsChanged", acc);
    p.on("chainChanged", ch);
    unwatch = () => {
      p.removeListener?.("accountsChanged", acc);
      p.removeListener?.("chainChanged", ch);
    };
  }
  function reset() {
    unwatch();
    unwatch = () => {};
    Object.assign(state, { provider: null, name: null, icon: null, account: null, chainId: null, balance: null });
  }

  async function refreshBalance() {
    if (!state.account) return;
    try {
      state.balance = await pub.getBalance({ address: state.account });
    } catch {
      state.balance = null;
    }
    emit();
  }

  async function connect() {
    let choice;
    if (found.length > 1) choice = await pick(found);
    else if (found.length === 1) choice = found[0];
    else if (window.ethereum) choice = { provider: window.ethereum, info: { name: "Browser wallet", icon: null, rdns: null } };
    if (!choice) return null;
    state.busy = true;
    emit();
    try {
      const p = choice.provider;
      const [a] = await p.request({ method: "eth_requestAccounts" });
      if (!a) throw new Error("The wallet returned no account.");
      Object.assign(state, { provider: p, name: choice.info.name, icon: choice.info.icon, account: a });
      try { localStorage.setItem("sc-last-wallet", choice.info.rdns ?? ""); } catch {}
      watch(p);
      state.chainId = String(await p.request({ method: "eth_chainId" })).toLowerCase();
      emit();
      await refreshBalance();
      return a;
    } finally {
      state.busy = false;
      emit();
    }
  }

  async function switchChain() {
    const p = state.provider;
    if (!p) throw new Error("Connect a wallet first.");
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (e) {
      const code = e?.code ?? e?.data?.originalError?.code;
      if (code !== 4902 && !/unrecognized|not added|unknown chain|not been added|no chain/i.test(e?.message ?? "")) throw e;
      await p.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: chainIdHex, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http, blockExplorerUrls: [chain.blockExplorers.default.url] }],
      });
    }
    state.chainId = String(await p.request({ method: "eth_chainId" })).toLowerCase();
    emit();
  }

  async function disconnect() {
    const p = state.provider;
    reset();
    emit();
    // MetaMask and a few others let a site drop its own permission; the rest just forget us locally
    try { await p?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); } catch {}
  }

  const lastRdns = () => { try { return localStorage.getItem("sc-last-wallet"); } catch { return null; } };

  return { state, events, connect, switchChain, disconnect, refreshBalance, installed, onChain, found, lastRdns, mobile: MOBILE };
}

/** open-in-wallet links for a phone with no wallet in its browser */
export function mobileWalletLinks(url) {
  const u = new URL(url);
  const bare = `${u.host}${u.pathname}${u.search}`;
  return [
    { name: "MetaMask", href: `https://metamask.app.link/dapp/${bare}` },
    { name: "Coinbase Wallet", href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
    { name: "Trust Wallet", href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}` },
  ];
}

/** wallet / RPC errors → one plain sentence */
export function explain(e) {
  const code = e?.code ?? e?.cause?.code ?? e?.data?.originalError?.code;
  const msg = String(e?.shortMessage ?? e?.message ?? e ?? "");
  const all = `${msg} ${e?.details ?? ""} ${e?.cause?.message ?? ""}`;
  if (code === 4001 || code === "ACTION_REJECTED" || /user (rejected|denied|cancel)|rejected the request|request rejected|cancelled|canceled/i.test(all)) return "You cancelled in the wallet — nothing was sent.";
  if (code === -32002 || /already pending|request of type .* already/i.test(all)) return "Your wallet already has a request waiting — open the wallet window and answer it.";
  if (/insufficient funds|exceeds (the )?balance|gas required exceeds/i.test(all)) return "Not enough test ETH for this — grab some free from the faucet (link above).";
  if (/NotEnough/.test(all)) return "Prices moved while you were choosing — press Paint again.";
  if (/status code 404|failed with status/i.test(all)) return "Your wallet can't reach Robinhood Chain testnet (Zerion does this) — try MetaMask or Rabby.";
  if (/chain ?mismatch|does not match the target chain|wrong network|switch.*chain/i.test(all)) return "Your wallet is on another network — press “Switch to Robinhood Chain”.";
  if (/network|fetch|timeout|timed out/i.test(all) && !/user/i.test(all)) return "The network didn't answer — check your connection and try again.";
  return msg.split("\n")[0].slice(0, 180) || "Something went wrong — try again.";
}
