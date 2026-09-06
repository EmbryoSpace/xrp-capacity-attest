// XRP pay client: send an XRP Payment, get back the validated tx hash (the
// settlementRef an attestation claim binds). YOU run this with YOUR funded
// wallet. The seed is read at runtime from XRPL_SEED (or --wallet-file) and
// never leaves your machine; this file neither generates nor logs a key, and it
// only broadcasts when you run it without --dry-run.
//
// Usage:
//   XRPL_SEED=s... node pay-xrp.mjs --to rPAYEE --drops 100000
//   XRPL_SEED=s... node pay-xrp.mjs --to rPAYEE --xrp 0.1 --tag 12345
//   node pay-xrp.mjs --to rPAYEE --drops 1000 --dry-run --sequence 1 --fee 12 --last-ledger 9  (offline build+sign only)
//
// Network: public XRPL JSON-RPC (XRPL_RPC env, default mainnet). Use
// https://s.altnet.rippletest.net:51234 for testnet.

import { readFile } from 'node:fs/promises';
import { Wallet } from 'xrpl';

const RPC = process.env.XRPL_RPC || 'https://xrplcluster.com';
const arg = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : null; };
const has = (n) => process.argv.includes(n);

async function rpc(method, params = {}) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params: [params] }) });
  if (!r.ok) throw new Error(`XRPL RPC ${r.status}`);
  const j = await r.json();
  if (j.result?.error) throw new Error(`XRPL ${method}: ${j.result.error} ${j.result.error_message || ''}`);
  return j.result;
}

async function loadWallet() {
  let seed = process.env.XRPL_SEED;
  const wf = arg('--wallet-file');
  if (!seed && wf) {
    const raw = JSON.parse(await readFile(wf, 'utf8'));
    seed = raw.seed || raw.secret || raw.xrpl_seed || raw.familySeed;
  }
  if (!seed) throw new Error('provide the wallet via XRPL_SEED=s... or --wallet-file <json with a seed/secret>');
  return Wallet.fromSeed(seed.trim());
}

async function main() {
  const to = arg('--to');
  if (!to) throw new Error('--to <rDestination> is required');
  const drops = arg('--drops') ? String(arg('--drops')) : (arg('--xrp') ? String(Math.round(Number(arg('--xrp')) * 1e6)) : null);
  if (!drops) throw new Error('specify amount with --drops <n> or --xrp <n>');
  const dryRun = has('--dry-run');

  const wallet = await loadWallet();

  // Autofill from the network unless offline values were supplied (for dry-run tests).
  let sequence = arg('--sequence'), fee = arg('--fee'), lastLedger = arg('--last-ledger');
  if (sequence == null || fee == null || lastLedger == null) {
    const info = await rpc('account_info', { account: wallet.classicAddress, ledger_index: 'validated' });
    sequence = sequence ?? info.account_data.Sequence;
    const feeRes = await rpc('fee').catch(() => null);
    fee = fee ?? (feeRes?.drops?.open_ledger_fee || '12');
    const cur = await rpc('ledger_current');
    lastLedger = lastLedger ?? (cur.ledger_current_index + 20);
  }

  const tx = {
    TransactionType: 'Payment',
    Account: wallet.classicAddress,
    Destination: to,
    Amount: drops,
    Fee: String(fee),
    Sequence: Number(sequence),
    LastLedgerSequence: Number(lastLedger),
  };
  if (arg('--tag')) tx.DestinationTag = Number(arg('--tag'));

  const { tx_blob, hash } = wallet.sign(tx);
  console.log('from   :', wallet.classicAddress);
  console.log('to     :', to);
  console.log('amount :', Number(drops) / 1e6, 'XRP (', drops, 'drops )');
  console.log('tx hash:', hash);

  if (dryRun) { console.log('\n--dry-run: signed locally, NOT submitted. tx_blob length', tx_blob.length); return; }

  const res = await rpc('submit', { tx_blob });
  console.log('submit :', res.engine_result, '-', res.engine_result_message);
  if (!String(res.engine_result).startsWith('tes')) { process.exitCode = 1; return; }

  // Poll for validation.
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const t = await rpc('tx', { transaction: hash }).catch(() => null);
    if (t?.validated) {
      console.log('validated: true |', t.meta?.TransactionResult, '| ledger', t.ledger_index);
      console.log('\nsettlementRef (use in the attestation claim):', hash);
      return;
    }
  }
  console.log('submitted; not yet validated after ~45s. Check the hash on an explorer.');
}

main().catch((e) => { console.error('error:', e.message || e); process.exit(1); });
