// XRP settlement-linkage check: confirm on-chain that a validated XRPL Payment
// moved value from payer to payee, the XRP analog of reading a USDC Transfer log
// or a BSV P2PKH output. Read-only, no keys. Uses public XRPL JSON-RPC.

const XRPL_RPC = process.env.XRPL_RPC || 'https://xrplcluster.com';

async function rpc(method, params) {
  const r = await fetch(XRPL_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
  });
  if (!r.ok) throw new Error(`XRPL RPC ${r.status}`);
  const j = await r.json();
  if (j.result && j.result.error) throw new Error(`XRPL: ${j.result.error} ${j.result.error_message || ''}`);
  return j.result;
}

// delivered_amount is a drops string for XRP payments, or an object for issued
// currencies. We only treat native-XRP (string) deliveries as drops.
function deliveredDrops(meta) {
  const d = meta && (meta.delivered_amount ?? meta.DeliveredAmount);
  return typeof d === 'string' ? Number(d) : null;
}

export async function verifySettlement({ txHash, payer, payee, minDrops = 1 }) {
  const tx = await rpc('tx', { transaction: txHash, binary: false });
  const meta = tx.meta || tx.metaData;
  const drops = deliveredDrops(meta);
  const ok =
    tx.validated === true &&
    tx.TransactionType === 'Payment' &&
    meta && meta.TransactionResult === 'tesSUCCESS' &&
    tx.Account === payer &&
    tx.Destination === payee &&
    drops !== null && drops >= minDrops;
  return {
    ok,
    txHash,
    validated: tx.validated === true,
    txType: tx.TransactionType,
    result: meta && meta.TransactionResult,
    payer: tx.Account,
    payee: tx.Destination,
    deliveredDrops: drops,
    deliveredXrp: drops !== null ? drops / 1e6 : null,
  };
}

// Find a recent validated native-XRP Payment on mainnet, so tests can verify a
// real settlement without a hardcoded hash. Returns {hash, payer, payee, drops}.
export async function findRecentXrpPayment() {
  const led = await rpc('ledger', { ledger_index: 'validated', transactions: true, expand: true });
  const txs = (led.ledger && led.ledger.transactions) || [];
  for (const t of txs) {
    const meta = t.meta || t.metaData;
    const drops = deliveredDrops(meta);
    if (
      t.TransactionType === 'Payment' &&
      meta && meta.TransactionResult === 'tesSUCCESS' &&
      t.Destination && t.Account && drops !== null && drops > 0
    ) {
      return { hash: t.hash, payer: t.Account, payee: t.Destination, drops };
    }
  }
  return null;
}
