import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSeed, deriveKeypair, deriveAddress } from 'ripple-keypairs';
import { signClaim, verifyClaim, computeClaimId, canonicalize } from './xrpl-claim.mjs';
import { verifySettlement, findRecentXrpPayment } from './xrpl-verify-settlement.mjs';

function content(over = {}) {
  return {
    network: 'xrp',
    sellerAddress: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
    assetType: 'api-credits',
    promisedSpec: { service: 'pay-per-call LLM inference' },
    delivered: 'yes',
    evidenceHash: 'a'.repeat(64),
    settlementRef: 'C'.repeat(64),
    timestamp: '2026-09-06T07:00:00.000Z',
    ...over,
  };
}
function newBuyer() {
  const seed = generateSeed();
  return { seed, address: deriveAddress(deriveKeypair(seed).publicKey) };
}

// ---- A: the XRP claim adapter (ephemeral key, no funds) --------------------
test('adapter: sign then verify round-trips', () => {
  const b = newBuyer();
  const c = content({ buyerAddress: b.address });
  const { claimId, signature, buyerPublicKey } = signClaim(b.seed, c);
  assert.deepEqual(verifyClaim({ ...c, buyerPublicKey, claimId, signature }), { ok: true });
});

test('adapter: content-addressing is key-order independent', () => {
  assert.equal(canonicalize({ z: 1, a: 2 }), canonicalize({ a: 2, z: 1 }));
  assert.equal(computeClaimId({ z: 1, a: 2 }), computeClaimId({ a: 2, z: 1 }));
});

test('adapter: tampering a content field breaks claimId', () => {
  const b = newBuyer();
  const c = content({ buyerAddress: b.address });
  const s = signClaim(b.seed, c);
  const r = verifyClaim({ ...c, buyerPublicKey: s.buyerPublicKey, claimId: s.claimId, signature: s.signature, delivered: 'no' });
  assert.equal(r.reason, 'claimId_mismatch');
});

test('adapter: a signature from a different key is rejected', () => {
  const buyer = newBuyer();
  const attacker = newBuyer();
  const c = content({ buyerAddress: buyer.address });
  const s = signClaim(attacker.seed, c); // attacker signs, but claims buyer identity
  const r = verifyClaim({ ...c, buyerPublicKey: deriveKeypair(buyer.seed).publicKey, claimId: s.claimId, signature: s.signature });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'signature_does_not_match_buyer');
});

test('adapter: an unsigned extra field is rejected (strict shape)', () => {
  const b = newBuyer();
  const c = content({ buyerAddress: b.address });
  const s = signClaim(b.seed, c);
  const r = verifyClaim({ ...c, buyerPublicKey: s.buyerPublicKey, claimId: s.claimId, signature: s.signature, forged: 'x' });
  assert.match(r.reason, /^unknown_field:/);
});

// ---- B: on-chain settlement verification (live XRPL mainnet) ---------------
test('settlement: a real validated XRP Payment verifies on-chain', async () => {
  if (process.env.XRPL_OFFLINE) return; // allow skipping the network step
  const p = await findRecentXrpPayment();
  assert.ok(p, 'expected to find a recent native-XRP Payment in the latest validated ledger');
  const s = await verifySettlement({ txHash: p.hash, payer: p.payer, payee: p.payee, minDrops: 1 });
  assert.equal(s.ok, true, `expected ${p.hash} to verify: ${JSON.stringify(s)}`);
  assert.equal(s.validated, true);
  assert.equal(s.payer, p.payer);
  assert.equal(s.payee, p.payee);
  assert.ok(s.deliveredDrops > 0);
});

test('settlement: a wrong payee is rejected', async () => {
  if (process.env.XRPL_OFFLINE) return;
  const p = await findRecentXrpPayment();
  assert.ok(p);
  const s = await verifySettlement({ txHash: p.hash, payer: p.payer, payee: 'rrrrrrrrrrrrrrrrrrrrBZbvji', minDrops: 1 });
  assert.equal(s.ok, false, 'a payment to a different payee must not verify');
});
