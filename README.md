# xrp-capacity-attest

The **XRP rail** for BSVKey's verifiable, non-custodial, pay-per-call settlement.
It is the XRP analog of [bsv-capacity-attest](https://github.com/EmbryoSpace/bsv-capacity-attest):
the same rail-neutral, content-addressed attestation core, with only the
signature envelope and address encoding swapped for XRP.

Part of the multi-rail story at [xrp.bsvkey.com](https://xrp.bsvkey.com).

## What works

- **Attestation claims** (`xrpl-claim.mjs`): a content-addressed, signed claim.
  `claimId = 0x + sha256(canonical JSON of the content fields)`, byte-identical
  to the BSV and Base rails. The buyer signs the claimId with an XRPL key
  (ed25519), and the claim carries the public key, which must derive to
  `buyerAddress`. Unknown fields are rejected (strict shape).
- **On-chain settlement verification** (`xrpl-verify-settlement.mjs`): confirms a
  validated `tesSUCCESS` XRPL Payment moved drops from payer to payee, via public
  XRPL JSON-RPC. The XRP analog of reading a USDC Transfer log or a BSV P2PKH
  output. Read-only, no keys.
- **Pay client** (`pay-xrp.mjs`): send an XRP Payment and get the validated tx
  hash (the `settlementRef` a claim binds). The seed is read at runtime from
  `XRPL_SEED` or `--wallet-file` and never leaves your machine; it only
  broadcasts when run without `--dry-run`.
- **Receipt signer** (`sign-claim.mjs`): sign an attestation claim over a
  settlement with your wallet.

`test.mjs` covers all of it: adapter unit tests with an ephemeral key, plus two
live checks against XRPL mainnet (verify a real payment, reject a wrong payee).

## Run

```bash
npm install
npm test                 # adapter + live mainnet settlement checks
XRPL_OFFLINE=1 npm test  # skip only the network settlement checks
```

## The full loop (you supply a funded XRPL wallet)

```bash
# 1. Pay, and get the settlement tx hash. Your seed stays local; nothing is
#    broadcast until you drop --dry-run.
XRPL_SEED=s... node pay-xrp.mjs --to rSELLER --xrp 0.01

# 2. Verify the settlement on-chain (no key needed).
node -e "import('./xrpl-verify-settlement.mjs').then(m=>m.verifySettlement({txHash:'<hash>',payer:'<you>',payee:'rSELLER'}).then(console.log))"

# 3. Sign the receipt (content.json holds sellerAddress/assetType/.../settlementRef=<hash>).
XRPL_SEED=s... node sign-claim.mjs --content content.json > claim.json
```

Testnet: set `XRPL_RPC=https://s.altnet.rippletest.net:51234` and fund from a
faucet.

A product of Embryo Space Inc. (DBA BSVKey).
