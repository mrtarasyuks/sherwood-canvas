# Sherwood Canvas 🏹

An on-chain pixel war on **Robinhood Chain testnet**. A shared 64×64 canvas that lives entirely in a smart contract.

- Paint a free pixel for **0.00001 ETH** (testnet).
- Take someone else's pixel for **double its last price** (capped at 256×).
- **When your pixel is taken, you earn half** of what was paid — withdraw any time.
- The other half goes to the season treasury.

### Weekly points

Every week (Monday 00:00 UTC → next Monday) is a season, scored straight from the contract's `Painted` events:

| action | points |
|---|---|
| paint a free pixel | +1 |
| take someone else's pixel | +3 |
| every pixel you hold when the week ends | +1 |
| **hold any $SHRWD** (at week end) | **×2** |

Repainting your own pixel scores nothing. $SHRWD holdings are rebuilt from the token's `Transfer` events, so past
weeks stay fixed. The builder's wallet plays but never ranks. Scoring lives in `docs/season.js` — anyone can re-run it.

### Fair play

- Testnet only — Robinhood Chain testnet ETH is free and worth nothing; $SHRWD is a testnet token on vibe/vibe.
- A new pixel's price goes to the canvas treasury; a takeover pays half to the previous owner (withdraw any time) and half to the treasury.
- Only the builder's wallet (`0x2973…1F62`) can withdraw the treasury. Nothing is promised from it.
- The builder's wallet plays too (the hat, the arrow, "Vibe") and holds $SHRWD, but never ranks in the weekly table.
- The site only ever asks a wallet for `paint` and `withdraw` transactions — never a signature, an approval or a recovery phrase — and touches no wallet until you press a button.

**Play:** https://mrtarasyuks.github.io/sherwood-canvas/
**Contract (verified):** [`0x8ed7ffb34b2a25d866e785843fca0dd899291122`](https://explorer.testnet.chain.robinhood.com/address/0x8ed7ffb34b2a25d866e785843fca0dd899291122?tab=contract) on Robinhood Chain testnet (chainId 46630)

**Token:** [$SHRWD on vibe/vibe](https://testnet.vibevibe.fun/token/0xB76f7ab3baf2c4220444C73F66793869A811e001)

Free test ETH: https://faucet.testnet.chain.robinhood.com

## Repo

- `contracts/SherwoodCanvas.sol` — the game (no owner powers over pixels; payouts are pull-based).
- `docs/` — the static front end (served by GitHub Pages) (plain HTML + JS, reads the chain directly, writes through your wallet).
- `scripts/test.mjs` — 32 local EVM tests (`npm i && npm run build && node scripts/test.mjs`).
- `docs/season.js` + `scripts/test-season.mjs` — weekly scoring and its tests (`node scripts/test-season.mjs`).
- `docs/wallet.js` — the wallet flow (EIP-6963 picker, network switch/add, balance, plain-words errors, open-in-wallet links on phones); `scripts/e2e-wallet.mjs` walks it end to end in headless Chrome with mock wallets.
