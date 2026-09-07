# XRP rail: ASM outcome-linkage fixture

The XRP-rail sibling of the Base/USDC fixture ([YE-YI7/asm-spec#18](https://github.com/YE-YI7/asm-spec/pull/18))
and the BSV rail ([YE-YI7/asm-spec#19](https://github.com/YE-YI7/asm-spec/pull/19)).
Same content-addressed claim shape; only the signature envelope (ed25519) and
address encoding (XRPL classic `r...`) are XRP-specific, isolated in the adapter.

This fixture is **populated against a real XRP mainnet settlement**, not a
template. It pins:

- `claim.json`: the signed attestation claim (byte-exact, referenced by sha256).
- `linkage.fixture.json`: the linkage record (raw claim URL + digest, claimId,
  expected signer, verifier package and commit, and the settlement reference).

The settlement it links is XRPL mainnet tx
`9B11FCBBB120D274407322A23398A3B3616842F5D137A9789D37CFE8B7BC6A4E`
(1.5 XRP, `tesSUCCESS`, payer `rhtRtNa...KAL7y` to payee `rUu3fKF...pgUXK1`).

## Verify it

From the repo root:

```bash
npm ci
node --test fixture.test.mjs                 # claim bytes + claimId + ed25519 + live settlement
XRPL_OFFLINE=1 node --test fixture.test.mjs   # skip only the on-chain read
```

The test mirrors #18/#19: it checks that the raw claim bytes match the pinned
digest, that the content recomputes to the claimId, that the ed25519 signature
verifies under the payer public key which derives to `buyerAddress`, and that the
XRPL Payment is validated and delivered drops from payer to payee. It asserts, as
explicit non-claims, that `delivered=yes`, the `evidenceHash` preimage, task
correctness, and historical ASM use are **not** independently proven.

Note on the crypto: ed25519 signatures are not public-key-recoverable (unlike the
BSV rail's secp256k1 ECDSA, which recovers the signer from the signature). So the
XRP claim carries the payer public key and the adapter verifies the signature
under it, then requires `deriveAddress(publicKey) == buyerAddress`. That is the
accurate description of what the check establishes.

## How it was produced

```bash
# 1. A real XRP payment from the buyer wallet gave the settlement tx hash.
XRPL_SEED=s... node ../../pay-xrp.mjs --to rPAYEE --xrp 1.5 --memo "asm xrp rail demo"

# 2. The content fields (incl settlementRef=<hash>) went in content.json, signed
#    with the SAME buyer wallet to produce claim.json.
XRPL_SEED=s... node ../../sign-claim.mjs --content content.json > claim.json

# 3. claim.json was committed (pinned by commit), its bytes hashed, and every
#    field in linkage.fixture.json filled: raw_claim_url + sha256 + claim_id +
#    expected_signer + verifier.commit + settlement.*.
```

**Sequencing:** do not open the XRP asm-spec PR until #19 (the BSV rail) has a
reaction from the maintainers. This directory prepares it; the upstream PR waits.
`fixture.template.json` is kept as the blank reference shape.
