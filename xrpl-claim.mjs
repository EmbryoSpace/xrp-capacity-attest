// XRP rail adapter for content-addressed delivery claims (BSVKey multi-rail).
//
// The content-addressing core is rail-neutral and byte-identical to the BSV and
// Base rails: claimId = '0x' + sha256(canonical JSON of the content fields),
// canonical = recursive key-sort + JSON.stringify. Only two things are XRP-
// specific and live here:
//   - buyerAddress / sellerAddress are XRPL classic addresses (base58, 'r...').
//   - the buyer signs the claimId with the XRPL key (ed25519 by default via
//     ripple-keypairs). The claim carries the payer's public key; verification
//     checks the signature under it and that the key derives to buyerAddress.
//
// Same shape as the BSV adapter (bsv-capacity-attest); this proves the receipt
// layer is genuinely multi-rail: swap the signature envelope + address codec,
// keep the hash route and the claim format unchanged.

import { createHash } from 'node:crypto';
import { deriveKeypair, deriveAddress, sign, verify } from 'ripple-keypairs';

const MAX_DEPTH = 32;

function sortKeysDeep(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error(`nesting exceeds max depth of ${MAX_DEPTH}`);
  if (Array.isArray(value)) return value.map((v) => sortKeysDeep(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key], depth + 1);
    return out;
  }
  return value;
}
export function canonicalize(value) {
  return JSON.stringify(sortKeysDeep(value, 0));
}

const CONTENT_FIELDS = [
  'network', 'sellerAddress', 'buyerAddress', 'assetType',
  'promisedSpec', 'delivered', 'evidenceHash', 'settlementRef', 'timestamp',
];
// buyerPublicKey is carried alongside (like the signature and claimId), not
// hashed. Unknown keys are rejected so no unsigned field can ride along.
const ALLOWED_KEYS = new Set([...CONTENT_FIELDS, 'claimId', 'signature', 'buyerPublicKey']);

function pickContent(claim) {
  const c = {};
  for (const k of CONTENT_FIELDS) if (claim[k] !== undefined) c[k] = claim[k];
  return c;
}

export function computeClaimId(content) {
  return '0x' + createHash('sha256').update(canonicalize(pickContent(content)), 'utf8').digest('hex');
}

const toMsgHex = (claimId) => Buffer.from(String(claimId), 'utf8').toString('hex');

// Sign a claim as the buyer. `seed` is an XRPL family seed (s...) the caller
// holds on their own machine; this module never generates or persists keys in
// production use (the test generates an ephemeral seed).
export function signClaim(seed, content) {
  const { publicKey, privateKey } = deriveKeypair(seed);
  const claimId = computeClaimId(content);
  const signature = sign(toMsgHex(claimId), privateKey);
  return { claimId, signature, buyerPublicKey: publicKey };
}

// Verify a claim is internally consistent: strict shape, claimId recompute,
// the public key derives to buyerAddress, and the signature verifies under it.
export function verifyClaim(claim) {
  if (claim === null || typeof claim !== 'object') return { ok: false, reason: 'not_an_object' };
  for (const k of Object.keys(claim)) if (!ALLOWED_KEYS.has(k)) return { ok: false, reason: `unknown_field:${k}` };
  if (computeClaimId(claim).toLowerCase() !== String(claim.claimId).toLowerCase()) return { ok: false, reason: 'claimId_mismatch' };
  let derived;
  try { derived = deriveAddress(claim.buyerPublicKey); } catch (e) { return { ok: false, reason: `bad_buyerPublicKey: ${e.message}` }; }
  if (derived !== claim.buyerAddress) return { ok: false, reason: 'pubkey_does_not_match_buyerAddress' };
  let ok;
  try { ok = verify(toMsgHex(claim.claimId), claim.signature, claim.buyerPublicKey); }
  catch (e) { return { ok: false, reason: `signature_verify_failed: ${e.message}` }; }
  return ok ? { ok: true } : { ok: false, reason: 'signature_does_not_match_buyer' };
}
