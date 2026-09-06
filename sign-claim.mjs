// Sign an XRP attestation claim over a settlement. YOU run this with YOUR wallet;
// the seed is read at runtime from XRPL_SEED (or --wallet-file) and never leaves
// your machine. buyerAddress is filled from the key.
//
//   XRPL_SEED=s... node sign-claim.mjs --content content.json > claim.json
//
// content.json holds the content fields (network defaults to "xrp"): sellerAddress,
// assetType, promisedSpec, delivered, evidenceHash, settlementRef (the XRPL tx
// hash from pay-xrp.mjs), timestamp.

import { readFile } from 'node:fs/promises';
import { deriveKeypair, deriveAddress } from 'ripple-keypairs';
import { signClaim, computeClaimId } from './xrpl-claim.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : null; };

// Read and parse JSON, tolerating a leading UTF-8 BOM (Windows PowerShell's
// `Out-File -Encoding utf8` writes one, which otherwise breaks JSON.parse).
async function readJson(path) {
  let text = await readFile(path, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip UTF-8 BOM
  return JSON.parse(text);
}

async function loadSeed() {
  let seed = process.env.XRPL_SEED;
  const wf = arg('--wallet-file');
  if (!seed && wf) {
    const raw = await readJson(wf);
    seed = raw.seed || raw.secret || raw.xrpl_seed || raw.familySeed;
  }
  if (!seed) throw new Error('provide the wallet via XRPL_SEED=s... or --wallet-file <json with a seed/secret>');
  return seed.trim();
}

const seed = await loadSeed();
const buyerAddress = deriveAddress(deriveKeypair(seed).publicKey);

const contentPath = arg('--content');
if (!contentPath) throw new Error('pass --content <file.json> with the claim content fields');
const content = await readJson(contentPath);

if (content.buyerAddress && content.buyerAddress !== buyerAddress) {
  throw new Error(`content.buyerAddress (${content.buyerAddress}) does not match the signing key's address (${buyerAddress})`);
}
content.buyerAddress = buyerAddress;
content.network = content.network || 'xrp';

const { claimId, signature, buyerPublicKey } = signClaim(seed, content);
const claim = { ...content, buyerPublicKey, claimId, signature };
if (computeClaimId(claim) !== claimId) throw new Error('internal: claimId recompute mismatch');

process.stdout.write(JSON.stringify(claim, null, 2) + '\n');
