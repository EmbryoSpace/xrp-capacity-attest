// Fixture test in the same shape as asm-spec #18 (the Base/USDC fixture) and the
// BSV sibling (#19): follow the pinned link, check the bytes, recompute the
// claimId, recover the signature, and check the on-chain settlement, and encode,
// as explicit assertions, exactly what the fixture does NOT prove. It
// demonstrates the downstream linkage shape for an XRP-settled claim; it is not
// evidence that ASM was used for the original call.
//
// Verifier profile: xrpl-claim adapter (this repo), canonicalize + sha256 content
// address (rail-neutral, identical to capacity-attest) + ed25519 XRPL signature
// recovery to a classic r-address. capacity-attest itself (holistis/tokenizen)
// verifies the Base/USDC sibling; see #18.
//
// The settlement check is a live XRPL JSON-RPC read, matching #18's live on-chain
// verification. Set XRPL_OFFLINE=1 (or FIXTURE_OFFLINE=1) to skip only that
// network step. A transient RPC failure is skipped, not failed; only a real
// contradiction (wrong payee, not validated, short drops) fails the test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyClaim, computeClaimId } from './xrpl-claim.mjs';
import { verifySettlement } from './xrpl-verify-settlement.mjs';

const dir = new URL('./examples/asm-outcome-linkage/', import.meta.url);
const claimBytes = await readFile(new URL('claim.json', dir));
const claim = JSON.parse(claimBytes.toString('utf8'));
const fixture = JSON.parse(await readFile(new URL('linkage.fixture.json', dir), 'utf8'));

test('ASM XRP fixture: bsvkey XRP rail -> ASM outcome linkage', async (t) => {
  await t.test('pinned bytes: sha256(claim.json) matches the fixture digest', () => {
    const digest = 'sha256:' + createHash('sha256').update(claimBytes).digest('hex');
    assert.equal(digest, fixture.external_attestation.raw_claim_sha256);
  });

  await t.test('content addressing: claimId is the sha256 of the canonical content', () => {
    assert.equal(computeClaimId(claim), claim.claimId);
    assert.equal(claim.claimId, fixture.external_attestation.claim_id);
  });

  await t.test('payer signature: ed25519 recovers to buyerPublicKey and that derives to buyerAddress', () => {
    assert.deepEqual(verifyClaim(claim), { ok: true });
    assert.equal(claim.buyerAddress, fixture.external_attestation.expected_signer);
  });

  await t.test('settlement linkage: buyer paid seller on-chain (XRPL Payment to payee)', async (st) => {
    if (process.env.XRPL_OFFLINE || process.env.FIXTURE_OFFLINE)
      return st.skip('XRPL_OFFLINE set, skipping the XRPL settlement read');
    let s;
    try {
      s = await verifySettlement({
        txHash: fixture.settlement.transaction_hash,
        payer: fixture.settlement.payer,
        payee: fixture.settlement.payee,
      });
    } catch (e) {
      return st.skip(`XRPL RPC unavailable (${e.message}); not a fixture failure`);
    }
    assert.equal(s.ok, true, `settlement ${fixture.settlement.transaction_hash} must be a validated Payment from ${fixture.settlement.payer} to ${fixture.settlement.payee}`);
    assert.equal(s.result, 'tesSUCCESS');
    assert.ok(s.deliveredDrops >= Number(fixture.settlement.raw_amount));
  });

  // ---- EXPLICIT NON-CLAIMS (mirrors #18/#19) --------------------------------
  // Asserted, not merely commented, so the fixture cannot silently drift into
  // implying more than it proves.
  await t.test('explicit non-claims: the fixture proves payment + authorship ONLY', () => {
    assert.equal(fixture.historical_asm_use, false);
    assert.ok(['yes', 'no', 'partial'].includes(claim.delivered));
    assert.match(claim.evidenceHash, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(fixture.not_independently_proven, [
      'delivered=yes',
      'evidenceHash preimage',
      'task correctness',
      'historical use of ASM for the paid call',
    ]);
    // No assertion is made about task correctness or that delivered === 'yes'.
    // That boundary is the whole point.
  });
});
