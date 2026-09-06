# XRP rail: ASM outcome-linkage fixture (template)

The XRP-rail sibling of the Base/USDC fixture ([YE-YI7/asm-spec#18](https://github.com/YE-YI7/asm-spec/pull/18))
and the BSV rail ([YE-YI7/asm-spec#19](https://github.com/YE-YI7/asm-spec/pull/19)).
Same content-addressed claim shape; only the signature envelope (ed25519) and
address encoding (XRPL classic `r...`) are XRP-specific, isolated in the adapter.

This is a **template**. Unlike verification (which needs no funds and works now),
a real fixture pins one real XRPL settlement, which means one real XRP payment
must exist. Populate it like this:

```bash
# 1. Make a small real XRP payment from the buyer wallet (get the tx hash).
XRPL_SEED=s... node ../../pay-xrp.mjs --to rSELLER --xrp 0.01

# 2. Put the content fields (incl settlementRef=<hash>) in content.json, then
#    sign the claim with the SAME buyer wallet.
XRPL_SEED=s... node ../../sign-claim.mjs --content content.json > claim.json

# 3. Commit claim.json, note its commit sha, and fill every FILL: field in
#    fixture.template.json -> linkage.fixture.json (raw_claim_url + sha256 +
#    claim_id + expected_signer + verifier.commit + settlement.*).
```

Then a test mirroring #18/#19 runs the three checks against `linkage.fixture.json`:
claimId recompute, ed25519 signature recovery to the payer address, and the
on-chain XRPL settlement (payer -> payee, delivered drops), with `delivered`, the
`evidenceHash` preimage, task correctness, and `historical_asm_use` kept as
explicit non-claims.

**Sequencing:** do not open the XRP asm-spec PR until #19 (the BSV rail) has a
reaction from the maintainers. This directory prepares it; the upstream PR waits.
