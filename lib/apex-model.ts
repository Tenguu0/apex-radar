// Apex Radar — the valuation model for token-radar-01.
//
// SPDX-License-Identifier: MIT
//
// The entry reads one sealed DefiLlama snapshot and ranks every protocol
// that could still launch a token. The ranking is a peer-multiple model
// computed from the snapshot itself — no name is ever special-cased, and
// every number the board shows can be traced back to the snapshot's own
// figures:
//
//   peer multiple   the median market-cap / TVL of the token-bearing
//                   protocols in the same category, shrunk toward the
//                   global median when the category has few peers.
//                   Each peer's own ratio is winsorised at 3x first:
//                   a token trading at 400x its TVL is a thin-TVL
//                   artefact, not a pricing anchor. Two guards keep one
//                   thin peer from setting a whole category's price:
//                   the shrink needs eight peers before a category's own
//                   median dominates, and no category's multiple may
//                   exceed twice the global median. (In this snapshot the
//                   Risk Curators peer set is a single token at 2.97x
//                   and Prediction Market's is a single token winsorised
//                   from 400x — without the cap both categories would
//                   price near 0.77x, four times the field median.)
//   growth          1 + clamp(change_7d, -50, +150) / 100 * 0.6
//   maturity        0.80 + 0.20 * min(age_days, 1095) / 1095
//                   (age unknown: 0.90 — a protocol that has run for years
//                   with no token has had longer to earn a launch)
//   breadth         1 + 0.02 * min(chains - 1, 5)
//
//   implied_value_usd = round(tvl_usd * peer * growth * maturity
//                             * breadth), at least $1.
//
// What the board ranks, and what it does not: the house's own watchlist
// rule, applied to the whole board. A wrapped, staked or bridged product
// of a token that already trades is not a launch of its own — WBTC is
// Bitcoin on Ethereum, Binance staked ETH is ETH in Binance's staking
// product, a bridge moves other tokens rather than issuing its own — so
// the board ranks only protocols that pass the rule: pre-token, not an
// exchange, not a bridge, not a liquid-staking/restaking product, not a
// versioned pool (V2, 2.0) and not a wrapped/staked name. The ones the
// rule leaves out are not hidden: the dashboard lists them apart under
// "Not a launch", each with the reason, so the separation the board
// makes is visible instead of silent. Protocols whose token already
// trades are set aside the same way and shown with the market's own
// value, so the board stays a list of launches that have not happened yet.

export interface ApexProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface ApexSnapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ApexProtocol[];
  watchlist: string[];
}

export interface ApexModelBreakdown {
  peer_multiple: number;
  category_peers: number;
  growth_pct: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  age_days: number | null;
}

export interface ApexBoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  on_watchlist: boolean;
  model: ApexModelBreakdown;
  farm_steps: string[];
}

export interface ApexExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

export interface ApexLiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

export interface ApexRadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  excluded_size: number;
  live_size: number;
  global_peer_multiple: number;
  global_median_7d: number;
  rows: ApexBoardRow[];
  excluded: ApexExcludedRow[];
  live: ApexLiveRow[];
  category_median_7d: Record<string, number>;
}

export class ApexSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApexSnapshotError';
  }
}

export const APEX_MODEL_VERSION = 'apex-comps-2';

// Categories that cannot be a token launch: an exchange, a bridge, or a
// wrapped / staked product of a token that already trades. The house's
// watchlist rule, applied to every row, not just the watchlist.
const NON_LAUNCH_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_NAME = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

const DAY_MS = 86_400_000;
const SHRINK_K = 8; // peers needed before a category's own median dominates
const WINSOR_CAP = 3; // no peer's mcap/TVL counts above 3x (thin-TVL artefacts)
const PEER_CAP_X = 2; // no category's multiple may exceed 2x the global median
const GROWTH_WEIGHT = 0.6;
const GROWTH_FLOOR = -50;
const GROWTH_CAP = 150;
const MATURITY_DAYS = 1095;
const UNKNOWN_AGE_FACTOR = 0.9;

/** Whole days from `listedAt` to `asOf`; null when either date is missing. */
export function apexAgeDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** A protocol is pre-token when the snapshot records no token for it. */
export function apexIsPreToken(p: ApexProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/**
 * Why a pre-token protocol is not a launch candidate, or null when it is
 * one. The house's watchlist rule, stated per protocol so the dashboard
 * can show the reason beside each excluded name.
 */
export function apexExclusionReason(p: ApexProtocol): string | null {
  if (NON_LAUNCH_CATEGORIES.has(p.category ?? '')) {
    if (p.category === 'CEX') return 'a centralised exchange, not a protocol launch';
    if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') {
      return 'a staked product of a token that already trades';
    }
    return 'a bridge moves other tokens rather than issuing its own';
  }
  if (VERSIONED_NAME.test(p.name)) return 'a versioned pool of another protocol, not a launch of its own';
  if (WRAPPED_NAME.test(p.name)) return 'a wrapped or staked product of a token that already trades';
  if (EXCHANGE_START.test(p.name)) return "an exchange's own product, not an independent launch";
  return null;
}

/** Whether a protocol is one the board may rank. */
export function apexIsRankable(p: ApexProtocol): boolean {
  return apexIsPreToken(p) && apexExclusionReason(p) === null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * The peer multiples: for every category, the median mcap/TVL of its
 * token-bearing protocols, shrunk toward the global median, and capped at
 * twice the global median. Categories with no live peer at all fall back
 * to the global median.
 */
export function apexPeerMultiples(
  protocols: ApexProtocol[],
): { byCategory: Map<string, { multiple: number; peers: number }>; global: number } {
  const live = protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  // Winsorise each peer's ratio at WINSOR_CAP before any median is taken.
  const ratioOf = (p: ApexProtocol): number => Math.min(p.mcap_usd! / p.tvl_usd, WINSOR_CAP);
  const ratios = live.map(ratioOf);
  const global = ratios.length > 0 ? median(ratios) : 0.2;
  const cap = PEER_CAP_X * global;

  const perCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const bucket = perCategory.get(key) ?? [];
    bucket.push(ratioOf(p));
    perCategory.set(key, bucket);
  }

  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, bucket] of perCategory) {
    const own = median(bucket);
    const shrunk = (bucket.length * own + SHRINK_K * global) / (bucket.length + SHRINK_K);
    byCategory.set(key, { multiple: Math.min(shrunk, cap), peers: bucket.length });
  }
  return { byCategory, global };
}

/** Score one rankable pre-token protocol; every factor comes from the snapshot. */
export function apexScore(
  p: ApexProtocol,
  asOf: string,
  peers: { byCategory: Map<string, { multiple: number; peers: number }>; global: number },
): { implied: number; breakdown: ApexModelBreakdown } {
  const cat = peers.byCategory.get(p.category ?? 'Uncategorised');
  const peerMultiple = cat ? cat.multiple : peers.global;
  const categoryPeers = cat ? cat.peers : 0;

  const growthPct = p.change_7d === null ? 0 : clamp(p.change_7d, GROWTH_FLOOR, GROWTH_CAP);
  const growthFactor = 1 + (growthPct / 100) * GROWTH_WEIGHT;

  const age = apexAgeDays(asOf, p.listed_at);
  const maturityFactor =
    age === null ? UNKNOWN_AGE_FACTOR : 0.8 + (0.2 * Math.min(age, MATURITY_DAYS)) / MATURITY_DAYS;

  const breadthFactor = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 5);

  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * peerMultiple * growthFactor * maturityFactor * breadthFactor),
  );
  return {
    implied,
    breakdown: {
      peer_multiple: peerMultiple,
      category_peers: categoryPeers,
      growth_pct: growthPct,
      growth_factor: growthFactor,
      maturity_factor: maturityFactor,
      breadth_factor: breadthFactor,
      age_days: age,
    },
  };
}

// ---------------------------------------------------------------- farm plans

/** Rough cost of one plain transaction on a chain, in whole dollars, from public fee levels. */
const GAS_USD: Record<string, number> = {
  Ethereum: 3.5,
  Base: 0.08,
  Arbitrum: 0.15,
  Optimism: 0.12,
  'BNB Chain': 0.25,
  BSC: 0.25,
  Polygon: 0.05,
  Solana: 0.01,
  Avalanche: 0.3,
  Blast: 0.05,
  Linea: 0.1,
  Scroll: 0.08,
  'zkSync Era': 0.12,
  Mantle: 0.05,
  Mode: 0.03,
  Fraxtal: 0.05,
  Berachain: 0.1,
  Unichain: 0.08,
  Gnosis: 0.1,
  Fantom: 0.1,
};

function gasUsd(chain: string): string {
  const v = GAS_USD[chain] ?? 0.5;
  return `$${v.toFixed(2)}`;
}

type FarmCtx = { name: string; chain: string; gas: string };

function dexPlan(c: FarmCtx): string[] {
  return [
    `Open ${c.name} on ${c.chain} and connect a fresh wallet holding $100-$300 in stablecoins plus gas; keep this wallet only for this farm so the activity is easy to prove. (Gas ~${c.gas} to set up, 10 min.)`,
    `Swap $25-$75 into the pool's two assets on ${c.name}'s swap page, in 2-3 trades a week apart, so the volume looks organic instead of farmed in a single day. (Gas ~${c.gas} per swap, 5 min each.)`,
    `Add the swapped assets as liquidity in ${c.name}'s main pool and hold the LP position; collect the trading fees while the position stays open. (Gas ~${c.gas}, 10 min to deposit.)`,
    `Return weekly for 4-8 weeks: one small swap or a rebalance of the LP range each visit, and vote if ${c.name} opens a governance poll. (Gas ~${c.gas} per visit, 10 min.)`,
    `Before any snapshot rumour, withdraw half the LP, keep the rest deployed, and save your position history and wallet address as proof of use. (Gas ~${c.gas}, 15 min; total farm time 4-8 weeks.)`,
  ];
}

function lendPlan(c: FarmCtx): string[] {
  return [
    `Supply $100-$300 of a blue-chip asset (ETH, USDC or wBTC) into ${c.name} on ${c.chain} from a dedicated farming wallet; this is your base deposit. (Gas ~${c.gas}, 10 min.)`,
    `Borrow $20-$60 against the deposit at a loan-to-value under 50%, then repay half of it a week later so the account shows real borrow-and-repay activity. (Gas ~${c.gas} per action, 10 min.)`,
    `Leave the supply position open for at least 4 weeks and top it up once with another $25-$50, so the position ages instead of looking like a one-day deposit. (Gas ~${c.gas}, 5 min.)`,
    `Use the borrowed funds inside ${c.name} only - repay into the same market or re-supply - and avoid moving them to another protocol mid-farm. (Gas ~${c.gas}, 10 min.)`,
    `Keep the health factor above 2.0 at all times, then repay the loan fully and withdraw half the supply, leaving the rest supplied as a long-term position. (Gas ~${c.gas}, 15 min; total farm time 4-6 weeks.)`,
  ];
}

function vaultPlan(c: FarmCtx): string[] {
  return [
    `Deposit $100-$250 into ${c.name}'s main vault on ${c.chain} from a dedicated wallet; pick the vault with the largest TVL, not the highest advertised APY. (Gas ~${c.gas}, 10 min.)`,
    `Claim or compound the vault's rewards once a week for 4-6 weeks; weekly compounding shows sustained use and costs less gas than daily claims. (Gas ~${c.gas} per claim, 5 min.)`,
    `Add a second deposit of $25-$50 in week 3 so the position grows over time instead of sitting flat from day one. (Gas ~${c.gas}, 5 min.)`,
    `If ${c.name} offers a second vault or strategy on ${c.chain}, split 20% of the deposit into it to show breadth of use across the product. (Gas ~${c.gas}, 10 min.)`,
    `Withdraw half the position after 6 weeks, keep the rest compounding, and save the deposit and reward transactions as your activity record. (Gas ~${c.gas}, 15 min; total farm time 6 weeks.)`,
  ];
}

function rwaPlan(c: FarmCtx): string[] {
  return [
    `Deposit $100-$250 into ${c.name}'s tokenised-asset vault on ${c.chain} from a dedicated wallet; read the vault's terms first, as RWA products often lock funds for a fixed term. (Gas ~${c.gas}, 15 min.)`,
    `Hold the position for the full minimum term ${c.name} states - usually 30-90 days - and do not withdraw early if an early-exit fee applies. (No gas, just wait.)`,
    `Claim any yield ${c.name} distributes monthly and re-deposit it into the same vault to show compounding use. (Gas ~${c.gas} per claim, 5 min.)`,
    `If ${c.name} lists a second asset or vault, allocate 20% of the deposit there in month two to show breadth across its catalogue. (Gas ~${c.gas}, 10 min.)`,
    `At term end, withdraw half, keep the rest invested, and save the deposit, yield and withdrawal records as your activity proof. (Gas ~${c.gas}, 15 min; total farm time 1-3 months.)`,
  ];
}

function tradePlan(c: FarmCtx): string[] {
  return [
    `Open a small $25-$75 position on ${c.name} on ${c.chain} from a dedicated wallet, using 1-2x leverage only; high leverage gets liquidated and ends the farm. (Gas ~${c.gas}, 10 min.)`,
    `Close the position after a few days with a small win or loss, then open a second one the following week; two or three completed trades beat one big trade. (Gas ~${c.gas} per trade, 10 min.)`,
    `Provide $50-$100 of liquidity to ${c.name}'s main market or vault for 4 weeks so the account shows both trading and LP activity. (Gas ~${c.gas}, 10 min.)`,
    `Keep every position under 5% of the wallet's value and never trade during high-volatility news events; a liquidation wipes the activity record. (No gas, just wait.)`,
    `After 4-6 weeks, close the open positions, withdraw the LP, and save the trade history as proof of use. (Gas ~${c.gas}, 15 min; total farm time 4-6 weeks.)`,
  ];
}

function genericPlan(c: FarmCtx): string[] {
  return [
    `Open ${c.name} on ${c.chain} from a dedicated farming wallet funded with $100-$300 plus gas; use this wallet only for ${c.name} so the activity is easy to prove. (Gas ~${c.gas}, 10 min.)`,
    `Make a first real transaction in ${c.name}'s core product - a deposit, swap or stake of $25-$75 - and confirm it settles before doing more. (Gas ~${c.gas}, 10 min.)`,
    `Repeat the core action once a week for 4-6 weeks, varying the amount between $25 and $100 so the pattern looks like genuine use. (Gas ~${c.gas} per week, 10 min.)`,
    `Try a second feature of ${c.name} in week 3 - a different pool, market or tool - so the wallet touches more than one part of the product. (Gas ~${c.gas}, 10 min.)`,
    `After 6 weeks, withdraw or close half the position, keep the rest active, and save every transaction hash as your activity record. (Gas ~${c.gas}, 15 min; total farm time 6 weeks.)`,
  ];
}

const FAMILY: Record<string, (c: FarmCtx) => string[]> = {
  Dexs: dexPlan,
  Lending: lendPlan,
  'Uncollateralized Lending': lendPlan,
  CDP: lendPlan,
  'CDP Manager': lendPlan,
  'Collateral Markets': lendPlan,
  Yield: vaultPlan,
  'Yield Aggregator': vaultPlan,
  'Onchain Capital Allocator': vaultPlan,
  'Risk Curators': vaultPlan,
  'Liquidity Manager': vaultPlan,
  'Onchain Capital Allocator ': vaultPlan,
  'Basis Trading': vaultPlan,
  RWA: rwaPlan,
  'Anchor BTC': rwaPlan,
  'Decentralized BTC': rwaPlan,
  Derivatives: tradePlan,
  'Options Vault': tradePlan,
  'Leveraged Farming': tradePlan,
  'Interest Rate Derivatives': tradePlan,
  'Prediction Market': tradePlan,
  'Perpetuals': tradePlan,
};

/**
 * A farm plan: the category family's five steps, then a shared tail — a
 * position-size rule and a record-keeping rule. Every step is 20-600
 * characters, concrete, with a cost and a time.
 */
export function apexFarmSteps(p: ApexProtocol): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const ctx: FarmCtx = { name: p.name, chain, gas: gasUsd(chain) };
  const build = (p.category !== null && FAMILY[p.category]) || genericPlan;
  const steps = build(ctx);
  steps.push(
    `Size the whole farm at an amount you can leave untouched for 60 days, and never more than 5% of your portfolio in any single unlaunched protocol.`,
    `Keep a one-line log of every transaction hash, date and amount in a notes file, so you can prove each touch later; about 2 minutes after each interaction.`,
  );
  return steps.slice(0, 7);
}

// ---------------------------------------------------------------- the board

/** Parse and validate the sealed snapshot; throws ApexSnapshotError. */
export function apexParseSnapshot(text: string): ApexSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApexSnapshotError('snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new ApexSnapshotError('snapshot is not an object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || typeof doc.source !== 'string') {
    throw new ApexSnapshotError('snapshot is missing as_of or source');
  }
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new ApexSnapshotError('snapshot is missing protocols or watchlist');
  }
  return doc as unknown as ApexSnapshot;
}

/**
 * Build the ranked board: every rankable pre-token protocol in the
 * snapshot, ranked by implied value (ties broken by TVL, then slug), plus
 * the protocols the launch rule leaves out (with reasons) and the
 * live-token set aside for the dashboard's market view.
 */
export function apexBuildBoard(snapshot: ApexSnapshot): {
  rows: ApexBoardRow[];
  excluded: ApexExcludedRow[];
  live: ApexLiveRow[];
  data: ApexRadarData;
} {
  const peers = apexPeerMultiples(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);

  const scored = snapshot.protocols
    .filter(apexIsRankable)
    .map((p) => {
      const { implied, breakdown } = apexScore(p, snapshot.as_of, peers);
      return { p, implied, breakdown };
    })
    .sort((a, b) => b.implied - a.implied || b.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: ApexBoardRow[] = scored.map(({ p, implied, breakdown }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: breakdown.age_days,
    implied_value_usd: implied,
    on_watchlist: watchlist.has(p.slug),
    model: breakdown,
    farm_steps: apexFarmSteps(p),
  }));

  const excluded: ApexExcludedRow[] = snapshot.protocols
    .filter((p) => apexIsPreToken(p) && !apexIsRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: apexExclusionReason(p) ?? 'not a launch candidate',
    }));

  const live: ApexLiveRow[] = snapshot.protocols
    .filter((p) => !apexIsPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 60)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null,
    }));

  // Category median 7-day change across the pre-token field, for the
  // detail view's comparison bars (categories with <3 readings fall back
  // to the global median there).
  const growths = snapshot.protocols
    .filter(apexIsPreToken)
    .map((p) => p.change_7d)
    .filter((v): v is number => v !== null);
  const globalMedian7d = growths.length > 0 ? median(growths) : 0;
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (!apexIsPreToken(p) || p.category === null || p.change_7d === null) continue;
    const arr = byCat.get(p.category) ?? [];
    arr.push(p.change_7d);
    byCat.set(p.category, arr);
  }
  const categoryMedian7d: Record<string, number> = {};
  for (const [cat, arr] of byCat) {
    if (arr.length >= 3) categoryMedian7d[cat] = median(arr);
  }

  // The dashboard must name no network address: the snapshot's own source
  // string carries the fetch URL, so the data file carries the endpoint's
  // name and date instead of the URL.
  const cleanSource = `DefiLlama protocols API, fetched ${snapshot.as_of}`;

  const data: ApexRadarData = {
    as_of: snapshot.as_of,
    source: cleanSource,
    floor_usd: snapshot.floor_usd,
    model_version: APEX_MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    excluded_size: excluded.length,
    live_size: live.length,
    global_peer_multiple: peers.global,
    global_median_7d: globalMedian7d,
    rows,
    excluded,
    live,
    category_median_7d: categoryMedian7d,
  };
  return { rows, excluded, live, data };
}

/** A board the gate refuses, named, or null when it passes. */
export function apexBoardIssue(
  rows: ApexBoardRow[],
  excluded: ApexExcludedRow[],
  snapshot: ApexSnapshot,
): string | null {
  if (rows.length < 100) return `board holds ${rows.length} rows, under the 100-row floor`;
  const slugs = new Set<string>();
  for (const r of rows) {
    if (slugs.has(r.slug)) return `slug ${r.slug} appears twice`;
    slugs.add(r.slug);
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug}: a farm step is ${t.length} characters`;
    }
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1) {
      return `${r.slug}: implied value ${r.implied_value_usd} is not a positive whole number`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `watchlist slugs missing from the board: ${missing.slice(0, 5).join(', ')}`;
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `ranks are not exactly 1..${rows.length}`;
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) {
      return `implied value rises from rank ${i} to rank ${i + 1}`;
    }
  }
  if (rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd)) {
    return 'every implied value is the same: not a ranking';
  }
  // The partition must be complete: every pre-token protocol is either
  // ranked or excluded with a reason, never lost.
  const pre = snapshot.protocols.filter(apexIsPreToken);
  const exSlugs = new Set(excluded.map((e) => e.slug));
  for (const p of pre) {
    if (!slugs.has(p.slug) && !exSlugs.has(p.slug)) return `pre-token protocol ${p.slug} is neither ranked nor excluded`;
    if (slugs.has(p.slug) && exSlugs.has(p.slug)) return `protocol ${p.slug} is both ranked and excluded`;
  }
  for (const e of excluded) {
    if (e.reason.trim().length === 0) return `excluded protocol ${e.slug} has no reason`;
  }
  return null;
}

/** The dashboard's data as a script: one global, no network, no imports. */
export function apexDataScript(data: ApexRadarData): string {
  const compact = {
    as_of: data.as_of,
    source: data.source,
    floor_usd: data.floor_usd,
    model_version: data.model_version,
    watchlist_size: data.watchlist_size,
    board_size: data.board_size,
    excluded_size: data.excluded_size,
    live_size: data.live_size,
    global_peer_multiple: data.global_peer_multiple,
    global_median_7d: data.global_median_7d,
    rows: data.rows.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      on_watchlist: r.on_watchlist,
      peer_multiple: r.model.peer_multiple,
      category_peers: r.model.category_peers,
      growth_factor: r.model.growth_factor,
      maturity_factor: r.model.maturity_factor,
      breadth_factor: r.model.breadth_factor,
      farm_steps: r.farm_steps,
    })),
    excluded: data.excluded,
    live: data.live,
    category_median_7d: data.category_median_7d,
  };
  return `// Apex Radar data — generated from the sealed snapshot by main.ts.\n// SPDX-License-Identifier: MIT\nwindow.APEX_RADAR = ${JSON.stringify(compact)};\n`;
}
