# Sherwood Canvas 🏹

An on-chain pixel war on **Robinhood Chain testnet**. A shared 64×64 canvas that lives entirely in a smart contract.

- Paint a free pixel for **0.00001 ETH** (testnet).
- Take someone else's pixel for **double its last price** (capped at 256×).
- **When your pixel is taken, you earn half** of what was paid — withdraw any time.
- The other half goes to the season treasury.

**Play:** https://mrtarasyuks.github.io/sherwood-canvas/
**Contract (verified):** [`0x8ed7ffb34b2a25d866e785843fca0dd899291122`](https://explorer.testnet.chain.robinhood.com/address/0x8ed7ffb34b2a25d866e785843fca0dd899291122?tab=contract) on Robinhood Chain testnet (chainId 46630)

Free test ETH: https://faucet.testnet.chain.robinhood.com

## Repo

- `contracts/SherwoodCanvas.sol` — the game (no owner powers over pixels; payouts are pull-based).
- `site/` — the static front end (plain HTML + JS, reads the chain directly, writes through your wallet).
- `scripts/test.mjs` — 32 local EVM tests (`npm i && npm run build && node scripts/test.mjs`).
