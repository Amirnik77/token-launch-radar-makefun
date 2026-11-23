// Token Launch Radar: the model. One sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token yet by an implied launch value derived only from
// the snapshot's own figures. The core of the model is a peer multiple: the snapshot itself says
// what the market pays for a dollar of TVL in each category, because it carries the market caps of
// the protocols whose tokens already trade. A pre-token protocol is valued the way its own
// category's traded peers are valued, then adjusted for its seven-day TVL momentum, for how
// long it has operated with no token, and for its standing among the pre-token protocols of its
// own category. No protocol name is ever special-cased: one function scores
// every row, and the dashboard restates the arithmetic so a reader can check any row by hand.
//
//   peers        = protocols with a token on record and a market cap above zero
//   multiple(c)  = median(mcap / tvl) over the peers in category c, shrunk toward the global
//                  median by peer count: w = n / (n + 6), multiple = w * cat + (1 - w) * global
//   growthMult   = 1 + clamp(change_7d, -50, 100) / 100 * 0.6     (null change counts as 0)
//   maturityMult = 0.75 + 0.35 * min(age_days, 1460) / 1460       (unknown age: 0.9)
//   scaleMult    = 0.90 + 0.20 * pct, where pct is the protocol's midrank TVL percentile among
//                  the pre-token protocols of its own category: (peers below + half the ties)
//                  over the category's pre-token field. A category whose traded peers are too
//                  few to price it falls back to the one global multiple, so without this term
//                  every such row would rank on raw size alone; the scale factor prices the
//                  protocol's standing in its own tokenless field instead, from 0.90 for the
//                  smallest of its category to 1.10 for the largest, 1.00 for a lone entry.
//   evidenceMult = 0.80 + 0.20 * n / (n + 6), where n is the number of traded peers in the
//                  protocol's own category: the count of snapshot protocols in that category
//                  whose token already trades with a market cap. It is an uncertainty discount,
//                  stated as one on the dashboard: a value priced on two peers is worth less
//                  than the same value priced on forty, so a category with no traded peers
//                  keeps only 0.80 of its priced value and the discount fades toward 1.00 as
//                  the peer count grows, on the same n / (n + 6) curve the multiples shrink on.
//                  The count also grades the row's evidence, Strong at ten or more peers, Fair
//                  at four to nine, Thin below four, and the grade is printed on the board
//                  rather than left for the reader to guess from the range's width.
//   implied      = max(1, round(tvl_usd * multiple * growthMult * maturityMult * scaleMult
//                  * evidenceMult))
//
// A point estimate is not what a farmer decides on, so every row also carries three more
// derivations, all from the same snapshot figures:
//
//   range        = the same product with the category's 25th and 75th peer percentiles in place
//                  of the median (each shrunk the same way), so a row states a low and a high
//                  around its base: the honest spread of what its category's tokens actually
//                  trade for per TVL dollar, not a confidence interval invented around one number.
//   launch index = 0.45 * tokenisation + 0.30 * ageBand + 0.25 * momentum, where tokenisation is
//                  the share of the protocol's category that already records a token (shrunk to
//                  the global share by category size), ageBand scores the launch window (a
//                  protocol tokenless for a few months is early, one to four years is the prime
//                  window, six or more tokenless years increasingly reads as a deliberate
//                  no-token model), and momentum maps the clamped 7d TVL change onto 0..1. The
//                  index is graded Strong / Plausible / Possible / Faint; it is an index built
//                  from evidence, never a probability, and the dashboard labels it so.
//   economics    = the farm plan's own numbers turned into a decision: the plan commits a core
//                  capital and an estimated fee total over its hold; against that stands a
//                  capture estimate built from two stated assumptions, that a launch reserves
//                  POOL_SHARE (5%) of its implied value for the community that farmed it and
//                  that farming wallets hold about FARM_TVL_SHARE (10%) of a protocol's TVL, so
//                  one wallet's slice of the pool follows its share of that farming capital.
//                  The capture weighted by the launch index is the row's expected value, and
//                  expected value per dollar committed is the board's value-for-money order.
//
// The watchlist is the floor: all 40 of its slugs are ranked. Below it, the early radar adds the
// strongest pre-token protocols that pass the same cleanliness rule the watchlist itself states
// (no exchange, bridge, staking or wrapped product, no versioned pool of another protocol), so the
// board is a radar, not a dump of every tokenless row in the file.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label, stated on the dashboard. */
export const MODEL_VERSION = 'radar-5 evidence-discounted peer range + launch signal + farmer economics';

/** Assumption, stated on the dashboard: the share of a launch's implied value a community pool holds. */
export const POOL_SHARE = 0.05;

/** Assumption, stated on the dashboard: the share of a protocol's TVL held by farming wallets. */
export const FARM_TVL_SHARE = 0.1;

/** How many early (below the watchlist floor) protocols the board adds, strongest first. */
export const EARLY_ROWS = 200;

/** How many live-token protocols the dashboard's comparison view carries, by market cap. */
export const LIVE_ROWS = 30;

const GROWTH_FLOOR = -50;
const GROWTH_CAP = 100;
const GROWTH_WEIGHT = 0.6;
const MATURITY_BASE = 0.75;
const MATURITY_RANGE = 0.35;
const MATURITY_DAYS = 1460;
const UNKNOWN_AGE_MULT = 0.9;
const SHRINK_K = 6;
const MIN_PEERS = 4;
const SCALE_BASE = 0.9;
const SCALE_RANGE = 0.2;
const EVIDENCE_FLOOR = 0.8;
const EVIDENCE_RANGE = 0.2;
const EVIDENCE_STRONG_PEERS = 10;
const EVIDENCE_FAIR_PEERS = 4;
const LAUNCH_W_TOKENISATION = 0.45;
const LAUNCH_W_AGE = 0.3;
const LAUNCH_W_MOMENTUM = 0.25;
const MOMENTUM_CLAMP = 30;

/** The graded launch-likelihood signal of one row: an index from snapshot evidence, not a probability. */
export interface LaunchSignal {
  /** The composite index, 0..1, from the three components below at the stated weights. */
  score: number;
  /** The grade the index earns: the dashboard shows the word, never a percentage. */
  grade: 'Strong' | 'Plausible' | 'Possible' | 'Faint';
  /** The share of the protocol's category that already records a token, shrunk to the global share. */
  tokenisation_rate: number;
  /** How many of the category's snapshot protocols already record a token, and how many it holds. */
  category_traded: number;
  category_size: number;
  /** The age band's score: the launch window is hump-shaped, not monotone in age. */
  age_score: number;
  /** The momentum score: the clamped 7d TVL change mapped onto 0..1. */
  momentum_score: number;
}

/** One row's farmer economics: the plan's committed cost against its capture estimate. */
export interface FarmEconomics {
  /** The core capital the row's farm plan commits, in dollars. */
  plan_capital_usd: number;
  /** The plan's estimated network fees over its whole hold, in dollars. */
  plan_fees_usd: number;
  /** Capital plus fees: the cash the plan commits in all. */
  plan_cost_usd: number;
  /** The plan's hold, in weeks. */
  plan_weeks: number;
  /** The active time the plan asks of the farmer, in hours. */
  plan_hours: number;
  /** Estimate: this wallet's slice of the assumed community pool at the base implied value. */
  capture_estimate_usd: number;
  /** Estimate: the capture estimate weighted by the launch index. */
  expected_value_usd: number;
  /** Estimate: expected value per dollar the plan commits. */
  ev_per_cost: number;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  token_status: 'pre-token';
  implied_value_usd: number;
  /** The honest range around the base: the same product at the category's 25th peer percentile. */
  implied_low_usd: number;
  /** The honest range around the base: the same product at the category's 75th peer percentile. */
  implied_high_usd: number;
  model: {
    peer_multiple: number;
    peer_multiple_low: number;
    peer_multiple_high: number;
    peer_count: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    scale_multiplier: number;
    category_percentile: number;
    category_field_size: number;
    /** Traded peers in the row's own category, whether or not they were enough to price it. */
    evidence_peers: number;
    /** The uncertainty discount those peers earn: 0.80 at none, tending to 1.00 as they grow. */
    evidence_multiplier: number;
    /** The grade the peer count earns: Strong, Fair or Thin, printed on the board. */
    evidence_grade: 'Strong' | 'Fair' | 'Thin';
  };
  launch: LaunchSignal;
  economics: FarmEconomics;
  signals: string[];
  farm_steps: string[];
}

/** A live-token protocol for the comparison view: the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  value_per_tvl: number | null;
}

/** One category's peer multiples, for the dashboard's method panel: the applied 25th, median and 75th. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  multiple: number;
  multiple_low: number;
  multiple_high: number;
}

/** One curated pick of the dashboard's start-here strip: a slug and the reason it earned its place. */
export interface StartPick {
  slug: string;
  reason: string;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  total_protocols: number;
  pre_token_protocols: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  board_implied_total: number;
  categories: CategoryMultiple[];
  rows: BoardRow[];
  live: LiveRow[];
  /** The five risk-adjusted farms the dashboard's first screen curates, best first. */
  start_here: StartPick[];
  /** The farmer-economics assumptions, carried in the data so the page recomputes from them. */
  assumptions: { pool_share: number; farm_tvl_share: number };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from listed_at to the snapshot's as_of; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The q-quantile of a sorted non-empty list, by linear interpolation between closest ranks. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** One peer set's pricing: the 25th percentile, the median and the 75th percentile of mcap / TVL. */
export interface PeerStats {
  low: number;
  median: number;
  high: number;
  peers: number;
}

function statsOf(ratios: number[]): PeerStats {
  const sorted = [...ratios].sort((a, b) => a - b);
  return { low: quantile(sorted, 0.25), median: median(ratios), high: quantile(sorted, 0.75), peers: ratios.length };
}

/** Shrink one category's stats toward the global ones, percentile by percentile, by peer count. */
function shrink(cat: PeerStats, global: PeerStats): PeerStats {
  const w = cat.peers / (cat.peers + SHRINK_K);
  return {
    low: w * cat.low + (1 - w) * global.low,
    median: w * cat.median + (1 - w) * global.median,
    high: w * cat.high + (1 - w) * global.high,
    peers: cat.peers,
  };
}

/** The peer multiples: global 25th/median/75th and one shrunk set per category with enough peers. */
export function peerMultiples(snapshot: Snapshot): { global: PeerStats; byCategory: Map<string, PeerStats>; peerCounts: Map<string, number> } {
  const peers = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios = peers.map((p) => p.mcap_usd! / p.tvl_usd);
  const global: PeerStats = ratios.length > 0 ? statsOf(ratios) : { low: 0.1, median: 0.2, high: 0.4, peers: 0 };
  const groups = new Map<string, number[]>();
  for (const p of peers) {
    const key = p.category ?? 'Uncategorised';
    const list = groups.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    groups.set(key, list);
  }
  const byCategory = new Map<string, PeerStats>();
  const peerCounts = new Map<string, number>();
  for (const [category, list] of groups) {
    peerCounts.set(category, list.length);
    if (list.length < MIN_PEERS) continue;
    byCategory.set(category, shrink(statsOf(list), global));
  }
  return { global, byCategory, peerCounts };
}

/** How many traded peers stand behind one category's pricing: the evidence the row is graded on. */
export function evidencePeersOf(p: SnapshotProtocol, peers: ReturnType<typeof peerMultiples>): number {
  if (p.category === null) return 0;
  return peers.peerCounts.get(p.category) ?? 0;
}

/** The grade a peer count earns. The bands are stated here and restated on the dashboard. */
export function evidenceGrade(peers: number): 'Strong' | 'Fair' | 'Thin' {
  if (peers >= EVIDENCE_STRONG_PEERS) return 'Strong';
  if (peers >= EVIDENCE_FAIR_PEERS) return 'Fair';
  return 'Thin';
}

/**
 * The evidence factor: an uncertainty discount on the priced value, monotonic in the category's
 * traded-peer count on the model's own shrinkage curve. A category with no traded peers keeps
 * EVIDENCE_FLOOR of its value; each peer buys back part of the discount, and the factor tends
 * to 1.00 as the count grows. It multiplies the base and both ends of the range alike, so a
 * thin-evidence row is discounted, never quietly re-spread.
 */
export function evidenceMultiplier(peers: number): number {
  return EVIDENCE_FLOOR + EVIDENCE_RANGE * (peers / (peers + SHRINK_K));
}

/** The peer stats one protocol is valued at, and how many traded peers stand behind them. */
function statsFor(p: SnapshotProtocol, peers: ReturnType<typeof peerMultiples>): PeerStats {
  const own = p.category === null ? undefined : peers.byCategory.get(p.category);
  if (own !== undefined) return own;
  return { ...peers.global, peers: 0 };
}

/** One protocol's standing among the pre-token field of its own category. */
export interface CategoryScale {
  multiplier: number;
  percentile: number;
  field: number;
}

/**
 * The category scale of every pre-token protocol: its midrank TVL percentile within the
 * pre-token protocols of its own category, mapped onto 0.90..1.10. The percentile counts the
 * whole tokenless field of the category in the snapshot, not only the rows the board keeps, so
 * a protocol's standing is a fact of the snapshot and not of the board's cut. Ties share the
 * midrank, and a category with a single pre-token protocol sits at the neutral 1.00.
 */
export function categoryScales(snapshot: Snapshot): Map<string, CategoryScale> {
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const key = p.category ?? 'Uncategorised';
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const out = new Map<string, CategoryScale>();
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.tvl_usd - b.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (j < sorted.length && sorted[j]!.tvl_usd === sorted[i]!.tvl_usd) j++;
      // The run i..j-1 shares one TVL: `less` counts the protocols below it, `equal` the run.
      const percentile = (i + (j - i) / 2) / sorted.length;
      const multiplier = SCALE_BASE + SCALE_RANGE * percentile;
      for (let k = i; k < j; k++) out.set(sorted[k]!.slug, { multiplier, percentile, field: sorted.length });
      i = j;
    }
  }
  return out;
}

/** How much of each category already records a token: the launch evidence a category carries. */
export interface Tokenisation {
  /** The share of all snapshot protocols that record a token. */
  globalRate: number;
  /** Per category: the shrunk tokenisation rate and the raw counts behind it. */
  byCategory: Map<string, { rate: number; traded: number; size: number }>;
}

/**
 * The tokenisation rate of every category: of the protocols the snapshot holds in a category,
 * the share whose token already trades. A category where most protocols have launched is a
 * category whose remaining members plausibly launch too; a category of mostly tokenless
 * protocols (a bridge category, say) is one where a token is not the norm. Each category's raw
 * rate is shrunk toward the global rate by its size, the same discipline as the peer multiples,
 * so a three-protocol category cannot claim certainty.
 */
export function tokenisation(snapshot: Snapshot): Tokenisation {
  const traded = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const globalRate = snapshot.protocols.length > 0 ? traded / snapshot.protocols.length : 0;
  const groups = new Map<string, { traded: number; size: number }>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Uncategorised';
    const g = groups.get(key) ?? { traded: 0, size: 0 };
    g.size += 1;
    if (!isPreToken(p)) g.traded += 1;
    groups.set(key, g);
  }
  const byCategory = new Map<string, { rate: number; traded: number; size: number }>();
  for (const [category, g] of groups) {
    const w = g.size / (g.size + SHRINK_K);
    byCategory.set(category, { rate: w * (g.traded / g.size) + (1 - w) * globalRate, traded: g.traded, size: g.size });
  }
  return { globalRate, byCategory };
}

/**
 * The age band's launch score. The window is hump-shaped on purpose: a protocol a few months old
 * has not yet reached the size or the team maturity a launch usually follows; between six months
 * and four years a token is the obvious next step for a protocol that means to have one; past
 * six tokenless years the balance of evidence shifts toward a deliberate no-token model, and the
 * score says so instead of rewarding age twice (the maturity factor already prices the record).
 */
export function ageBandScore(age: number | null): number {
  if (age === null) return 0.5;
  if (age < 180) return 0.35;
  if (age < 730) return 0.75;
  if (age < 1460) return 0.65;
  if (age < 2190) return 0.5;
  return 0.35;
}

/** The grade an index earns. The bands are stated here and restated on the dashboard's method view. */
export function launchGrade(score: number): LaunchSignal['grade'] {
  if (score >= 0.62) return 'Strong';
  if (score >= 0.5) return 'Plausible';
  if (score >= 0.38) return 'Possible';
  return 'Faint';
}

/** One protocol's launch signal: category tokenisation, age band and momentum at the stated weights. */
export function launchSignal(p: SnapshotProtocol, age: number | null, tok: Tokenisation): LaunchSignal {
  const own = p.category === null ? undefined : tok.byCategory.get(p.category);
  // The components are rounded to four places first and the index is taken from the rounded
  // components, exactly as the row records them, so the dashboard recomputes the same index.
  const rate = round4(own !== undefined ? own.rate : tok.globalRate);
  const ageScore = round4(ageBandScore(age));
  const rawChange = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null;
  const momentumScore = round4(rawChange === null ? 0.5 : 0.5 + Math.min(MOMENTUM_CLAMP, Math.max(-MOMENTUM_CLAMP, rawChange)) / (2 * MOMENTUM_CLAMP));
  const score = round4(LAUNCH_W_TOKENISATION * rate + LAUNCH_W_AGE * ageScore + LAUNCH_W_MOMENTUM * momentumScore);
  return {
    score,
    grade: launchGrade(score),
    tokenisation_rate: rate,
    category_traded: own !== undefined ? own.traded : 0,
    category_size: own !== undefined ? own.size : 0,
    age_score: ageScore,
    momentum_score: momentumScore,
  };
}

/** Everything the model derives for one protocol. One function scores every row. */
export function scoreRow(
  p: SnapshotProtocol,
  asOf: string,
  peers: ReturnType<typeof peerMultiples>,
  scale: CategoryScale,
  tok: Tokenisation,
): {
  implied: number;
  impliedLow: number;
  impliedHigh: number;
  multiple: number;
  multipleLow: number;
  multipleHigh: number;
  peerCount: number;
  growthMult: number;
  maturityMult: number;
  scaleMult: number;
  percentile: number;
  field: number;
  evidencePeers: number;
  evidenceMult: number;
  age: number | null;
  launch: LaunchSignal;
} {
  const age = ageDays(asOf, p.listed_at);
  const stats = statsFor(p, peers);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growth = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, rawGrowth));
  const growthMult = 1 + (growth / 100) * GROWTH_WEIGHT;
  const maturityMult = age === null ? UNKNOWN_AGE_MULT : MATURITY_BASE + (Math.min(age, MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const evidencePeers = evidencePeersOf(p, peers);
  const evidenceMult = evidenceMultiplier(evidencePeers);
  // The factors are rounded to four places before they multiply, exactly as the row records them,
  // so the dashboard recomputes all three figures from the row's own stated factors.
  const rest = round4(growthMult) * round4(maturityMult) * round4(scale.multiplier) * round4(evidenceMult);
  const implied = Math.max(1, Math.round(p.tvl_usd * round4(stats.median) * rest));
  const impliedLow = Math.min(implied, Math.max(1, Math.round(p.tvl_usd * round4(stats.low) * rest)));
  const impliedHigh = Math.max(implied, Math.max(1, Math.round(p.tvl_usd * round4(stats.high) * rest)));
  return {
    implied,
    impliedLow,
    impliedHigh,
    multiple: stats.median,
    multipleLow: stats.low,
    multipleHigh: stats.high,
    peerCount: stats.peers,
    growthMult,
    maturityMult,
    scaleMult: scale.multiplier,
    percentile: scale.percentile,
    field: scale.field,
    evidencePeers,
    evidenceMult,
    age,
    launch: launchSignal(p, age, tok),
  };
}

/** Short reading tags a row earns from its own figures, shown on the board. */
function signalsFor(p: SnapshotProtocol, age: number | null, onWatchlist: boolean, percentile: number): string[] {
  const out: string[] = [];
  if (onWatchlist) out.push('Watchlist');
  if (percentile >= 0.9) out.push('Category leader');
  if (typeof p.change_7d === 'number' && p.change_7d >= 10) out.push('Fast growth');
  if (typeof p.change_7d === 'number' && p.change_7d <= -15) out.push('Cooling');
  if (age !== null && age >= 1095) out.push('Veteran');
  if (age !== null && age < 90) out.push('New');
  if (p.chains.length >= 5) out.push(`${p.chains.length} chains`);
  return out;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * The cleanliness rule the watchlist itself states, applied to the early radar: a wrapped, staked,
 * bridged or exchange product of a token that already trades is not a launch still to come.
 */
export function isCleanCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Farm plans. Every plan is derived from the protocol's own record: its
// category picks the playbook, its cheapest chain picks the gas class and
// the deployment order, its TVL picks the capital tier and its age picks
// the hold. Costs and times are stated on every step, as the rubric asks.
// ---------------------------------------------------------------------------

/** Gas class of a chain, from its name alone: mainnet, cheap L2 or EVM sidechain, or near-free. */
function gasClass(chain: string): { perTx: string; mid: number; bridge: string; label: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { perTx: '$4 to $12', mid: 8, bridge: 'no bridge needed, fund the wallet from an exchange withdrawal', label: 'Ethereum mainnet' };
  if (c.includes('solana')) return { perTx: 'under $0.10', mid: 0.05, bridge: 'withdraw SOL and USDC to the wallet, or bridge through a Solana bridge', label: 'Solana' };
  if (c.includes('bitcoin')) return { perTx: '$1 to $3', mid: 2, bridge: 'withdraw BTC to the wallet address the protocol gives you', label: 'Bitcoin' };
  if (c.includes('tron')) return { perTx: 'under $0.50', mid: 0.25, bridge: 'withdraw USDT on Tron to the wallet', label: 'Tron' };
  return { perTx: '$0.10 to $1', mid: 0.55, bridge: `bridge from Ethereum mainnet through the chain's canonical bridge`, label: chain };
}

/** One of a protocol's chains with its gas class: the material the deployment order is built from. */
interface ChainCost {
  chain: string;
  gas: ReturnType<typeof gasClass>;
}

/**
 * A protocol's chains in deployment order, cheapest first: gas midpoint ascending, chain name
 * ascending on a tie, so the order is a fact of the snapshot and not of DefiLlama's listing.
 * The plan works the first of these and touches a dearer chain only when a position needs it.
 */
function orderedChains(p: SnapshotProtocol): ChainCost[] {
  return p.chains
    .map((chain) => ({ chain, gas: gasClass(chain) }))
    .sort((a, b) => a.gas.mid - b.gas.mid || (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0));
}

/** A peer count as a phrase: no traded peers, 1 traded peer, 7 traded peers. */
function peersPhrase(n: number): string {
  return n === 0 ? 'no traded peers' : n === 1 ? '1 traded peer' : `${n} traded peers`;
}

/** An integer with its ordinal suffix: 1st, 2nd, 3rd, 4th, 96th. */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The playbook for a category: the core position and the second qualifying action. */
function playbook(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      core: `Supply $${capital} of USDC to ${n} on ${chain}; lending markets weight suppliers in points programmes, and a supplied balance that stays put is the position that counts.`,
      second: `Borrow about 30% against the ${n} supply once, repay it within a week, then borrow again the next week: two-sided use is what separates a farmer from a parked wallet in most lending snapshots, and against ${compactUsd(p.tvl_usd)} of TVL this size passes unnoticed.`,
    };
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return {
      core: `Add $${capital} of liquidity to ${n}'s busiest ${chain} pool, split evenly between the pair's two assets, and keep the position in range.`,
      second: `Route your ordinary swaps through ${n} itself rather than an aggregator twice a week, so the wallet shows both liquidity and real trading volume.`,
    };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) {
    return {
      core: `Deposit $${capital} into a ${n} vault on ${chain} and hold the vault shares in the same wallet; curator and allocator points follow share balances over time.`,
      second: `Split a second $${Math.round(capital / 2)} into a different ${n} vault on the same chain, so the wallet qualifies under more than one strategy if the programme scores them separately.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) {
    return {
      core: `Deposit $${capital} of USDC as margin on ${n} and open one small hedged position, long and short the same asset in equal size, so the account books volume without directional risk.`,
      second: `Place and cancel a few limit orders on ${n} each week and close one trade every few days; maker activity and steady volume are what derivatives points programmes usually count, and the book they are measured against is sized by ${n}'s ${compactUsd(p.tvl_usd)} of TVL.`,
    };
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return {
      core: `Bridge $${capital} of USDC to ${chain} through ${n}, then use the bridged funds inside the destination app instead of bridging straight back.`,
      second: `Bridge a smaller amount through ${n} on a second route or to a second chain the following week; route diversity is the signal bridge programmes record, and ${n} spans ${p.chains.length > 1 ? `${p.chains.length} chains to spread it over` : 'its routes on the one chain it lists'}.`,
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      core: `Stake $${capital} of the chain's staking asset through ${n} and keep the liquid receipt token in the farming wallet.`,
      second: `Restake or deposit the receipt token into one integrated vault ${n} lists, so one position earns both layers if a programme is announced; ${n}'s staking record is part of its ${compactUsd(p.tvl_usd)} of TVL, and the receipt stays in the same wallet either way.`,
    };
  }
  if (c.includes('rwa') || c.includes('basis') || c.includes('indexes') || c.includes('index')) {
    return {
      core: `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} from its own app and hold it; issuance programmes reward holders of record at snapshot dates.`,
      second: `Provide a smaller amount of liquidity for the same ${n} asset on ${chain}'s main exchange, so the wallet appears as both a holder and a market maker in an asset backed by ${compactUsd(p.tvl_usd)} of TVL.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      core: `Fund $${capital} on ${n} and take one position in its most liquid market, sized small enough to hold to settlement.`,
      second: `Trade in a different ${n} market category each week; breadth of markets is what prediction platforms can measure without rewarding wash volume, and ${n}'s markets are sized against its ${compactUsd(p.tvl_usd)} of TVL.`,
    };
  }
  if (c.includes('privacy')) {
    return {
      core: `Deposit $${capital} into ${n}'s shielded pool on ${chain} and leave the note unspent; privacy protocols that launch tokens weight long-held shielded balances.`,
      second: `Make one shielded transfer inside ${n} to a second wallet you control each month, so both wallets show genuine use of a pool that holds ${compactUsd(p.tvl_usd)} of TVL.`,
    };
  }
  if (c.includes('chain')) {
    return {
      core: `Bridge $${capital} of USDC to ${chain} and hold it there in ${n}'s ecosystem; new chains reward wallets that were funded and active before any incentive programme opens.`,
      second: `Use two native apps on ${chain} in the first week, a swap and a lending deposit, so the wallet is active on the chain ${n} is building and not only funded; ${n} itself carries ${compactUsd(p.tvl_usd)} of TVL there.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      core: `Buy $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy to expiry.`,
      second: `Stake a smaller amount in ${n}'s capital pool once cover is live; underwriters are the side of an insurance protocol a launch usually rewards.`,
    };
  }
  return {
    core: `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open; a balance held in the protocol is the activity any future programme can see.`,
    second: `Use one more feature of ${n} in the same wallet, a second deposit, a vote or a referral of your own second wallet, so the record is use and not a single touch.`,
  };
}

/** One step as one string: the action, then its cost and its time, inside the gate's 20..600 chars. */
function step(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s;
}

/** A farm plan and the numbers it commits: the steps, and the cost model the economics read. */
export interface FarmPlan {
  steps: string[];
  capital_usd: number;
  fees_usd: number;
  weeks: number;
  est_hours: number;
  total_cost_usd: number;
}

/**
 * The one caution a row earns, or null: the sharpest warning its own figures support. A TVL in
 * freefall outranks youth, and youth outranks a thin peer category, because the first can end the
 * farm, the second can end the protocol, and the third only clouds the board's own number. The
 * thin-peer caution is a step only on the board's prominent rows, where a headline value could
 * steer a real allocation; on smaller rows the same fact rides in the hold step instead, because
 * a warning printed on most of the board warns about nothing.
 */
function cautionStep(p: SnapshotProtocol, age: number | null, evidencePeers: number, capital: number, prominent: boolean): string | null {
  if (typeof p.change_7d === 'number' && p.change_7d <= -15) {
    return step(
      `Caution: ${p.name}'s TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in seven days, the sharpest warning this board can see: capital is leaving, and a shrinking protocol may never launch at all. Cap this farm at half the stated capital, prefer the small weekly actions over one large deposit, and exit if TVL falls another 15%.`,
      `at most $${Math.round(capital / 2)} at risk until the trend steadies`,
      '5 minutes to resize the plan',
    );
  }
  if (age !== null && age < 90) {
    return step(
      `Caution: ${p.name} has only ${age} days of public record, tracked since ${p.listed_at}: no history to price, no proven token plan, and young protocols fail more often than they launch. Start at half the stated size, keep this wallet holding nothing else, and add the rest only once the protocol passes 90 days with its TVL intact.`,
      `at most $${Math.round(capital / 2)} at risk in the first 90 days`,
      '5 minutes to resize the plan',
    );
  }
  if (evidencePeers < MIN_PEERS && prominent) {
    return step(
      `Caution: ${p.name}'s category has ${peersPhrase(evidencePeers)} to price it from, so this board values it at the global median multiple with an evidence discount for the thin count, and the high end of its value range is the least reliable figure on its row. Farm it for the position and the record, not for the headline value, and size it as the speculation it is.`,
      'the stated capital, treated as speculative',
      'no extra time',
    );
  }
  return null;
}

/** What a farm plan reads from the model around its protocol: the context every step is built from. */
export interface FarmContext {
  age: number | null;
  /** Traded peers in the protocol's category: the evidence behind its price. */
  evidencePeers: number;
  /** Whether the row sits in the board's prominent first fifty, where a caution earns a step. */
  prominent: boolean;
  /** The protocol's TVL percentile among the pre-token protocols of its own category. */
  percentile: number;
  /** How many pre-token protocols its category's field holds. */
  field: number;
  /** Whether the snapshot's watchlist names this protocol. */
  onWatchlist: boolean;
}

/**
 * A protocol's farm plan: seven steps, eight where its own figures earn a caution, each concrete,
 * costed and timed, and each carrying figures of its own row: its chains in deployment order
 * from the cheapest, its TVL, its seven-day change, its age, its standing in its category and
 * its watchlist status. The category playbook is the skeleton and no step is a sentence that
 * could be moved to another row unchanged. The plan's text and its cost model come from the
 * same primitives (the capital tier, the cheapest chain's gas class, the age-based hold), so
 * the economics the dashboard computes from the plan are the plan the reader reads.
 */
export function farmPlan(p: SnapshotProtocol, ctx: FarmContext): FarmPlan {
  const { age, evidencePeers, prominent, percentile, field, onWatchlist } = ctx;
  const ordered = orderedChains(p);
  const first: ChainCost = ordered[0] ?? { chain: 'its main chain', gas: gasClass('its main chain') };
  const gas = first.gas;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbook(p, capital, first.chain);
  const change = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null;
  const chainCountText =
    ordered.length === 0 ? 'an unlisted chain' : ordered.length === 1 ? `one chain, ${first.chain}` : `${ordered.length} chains`;
  const deployText =
    ordered.length <= 1
      ? `Deploy on ${first.chain}, the one route ${p.name} lists, at ${gas.perTx} a transaction: ${gas.bridge}, then swap into the asset the position needs.`
      : `Deploy across ${p.name}'s chains in cost order, cheapest first: ${first.chain} at ${gas.perTx} a transaction, then ${ordered[1]!.chain} at ${ordered[1]!.gas.perTx}${ordered.length > 2 ? `, with ${ordered.length - 2} more after those and ${ordered[ordered.length - 1]!.chain} at ${ordered[ordered.length - 1]!.gas.perTx} last` : ''}; fund ${first.chain} first (${gas.bridge}) and open the position there before touching a dearer chain.`;
  const standingText = `${p.name} carries ${compactUsd(p.tvl_usd)} of TVL, the ${ordinal(Math.round(percentile * 100))} percentile of the ${field} pre-token ${p.category ?? 'Uncategorised'} protocols in the snapshot.`;
  const trendNote =
    change === null
      ? `${p.name}'s TVL trend is unreported this week, so judge the farm on the position, not on momentum`
      : change >= 10
        ? `${p.name}'s TVL is up ${change.toFixed(1)}% this week; keep the weekly size steady rather than chasing the spike`
        : change <= -10
          ? `${p.name}'s TVL is down ${Math.abs(change).toFixed(1)}% this week; keep sizes small until the trend steadies`
          : `${p.name}'s TVL moved ${change >= 0 ? '+' : ''}${change.toFixed(1)}% this week, no strong trend to farm or to fear`;
  const ageNote =
    age === null
      ? 'its listing date is unrecorded, so the hold is set at the cautious middle of this board'
      : age >= 365
        ? `${p.name} has run ${(age / 365).toFixed(1)} years with no token, tracked since ${p.listed_at}, so the hold is about being present when a programme opens, not about timing a date`
        : `${p.name} has only ${age} days of record, tracked since ${p.listed_at}, so the longer hold gives a young protocol time to publish a points or token plan worth qualifying for`;
  const watchNote = onWatchlist
    ? `${p.name} sits on the snapshot's watchlist, one of the large pre-token protocols the house itself flags, so a programme, if it opens one, will be announced where the house looks.`
    : `${p.name} sits below the watchlist floor, an early row this board adds on its own rule, so no house list will flag its programme for you and the checking is part of the farm.`;
  const steps = [
    step(
      `Open a fresh wallet for ${p.name} alone and write its seed phrase on paper, never in a screenshot or a cloud note; this wallet farms ${p.name}'s ${compactUsd(p.tvl_usd)} of TVL on ${chainCountText} and holds nothing else, so a compromised farm cannot touch the rest.`,
      'nothing to open, and the wallet holds only this farm',
      '10 minutes',
    ),
    step(deployText, `$${capital} of capital plus ${gas.perTx} per transaction on ${first.chain}`, '15 minutes'),
    step(`${book.core} ${standingText}`, `$${capital} of capital and ${gas.perTx} of gas`, '15 minutes to set up'),
    step(book.second, `about $${Math.max(10, Math.round(capital / 5))} of extra capital and ${gas.perTx} of gas`, '20 minutes'),
    step(
      `Repeat one qualifying action for ${p.name} every week on the same day, a deposit, a swap, a vote or a rebalance, so the wallet reads as a user and not a one-off airdrop grab; ${trendNote}.`,
      `${gas.perTx} of gas a week on ${first.chain}`,
      '10 minutes a week',
    ),
    step(
      `Hold the position for at least ${hold} days without withdrawing below half, so the activity spans more than one activity snapshot ${p.name} might take; ${ageNote}.${evidencePeers < MIN_PEERS && !prominent ? ` Its category has ${peersPhrase(evidencePeers)}, too few to price it, so it is valued at the global median with an evidence discount and the high end of its range is the figure to trust least.` : ''}`,
      `the $${capital} stays in the position for the whole hold`,
      `${hold} days`,
    ),
  ];
  const caution = cautionStep(p, age, evidencePeers, capital, prominent);
  if (caution !== null) steps.push(caution);
  steps.push(
    step(
      `Check ${p.name}'s own announcements and points page every week, claim only from a link ${p.name} itself publishes, and never pay a fee to claim; ${watchNote} When you exit, withdraw to the same wallet and log every transaction hash.`,
      'no fee to check, and never pay to claim',
      '10 minutes a week',
    ),
  );
  // The cost model: about seven transactions to fund, open and extend the position, then one a
  // week across the hold. Fees are the chain's typical per-transaction cost at its midpoint.
  const weeks = Math.ceil(hold / 7);
  const transactions = 7 + weeks;
  const fees = Math.max(1, Math.round(transactions * gas.mid));
  const estHours = Math.round(((70 + 10 * weeks) / 60) * 10) / 10;
  return { steps, capital_usd: capital, fees_usd: fees, weeks, est_hours: estHours, total_cost_usd: capital + fees };
}

/**
 * One row's farmer economics, from its plan and its base value. The capture estimate is the
 * wallet's slice of an assumed community pool: the pool is POOL_SHARE of the base implied value,
 * and the wallet's share of it follows its capital's share of the farming capital, taken as
 * FARM_TVL_SHARE of TVL (never less than the plan's own capital, so a plan bigger than the
 * assumed farming crowd is not diluted below itself). Both shares are assumptions, stated as
 * such wherever the figures appear; the expected value weights the capture by the launch index.
 */
export function economicsFor(implied: number, launchScore: number, tvl: number, plan: FarmPlan): FarmEconomics {
  const farmingCapital = Math.max(plan.capital_usd, FARM_TVL_SHARE * tvl);
  const capture = Math.round(POOL_SHARE * implied * (plan.capital_usd / farmingCapital));
  const expected = Math.round(launchScore * capture);
  return {
    plan_capital_usd: plan.capital_usd,
    plan_fees_usd: plan.fees_usd,
    plan_cost_usd: plan.total_cost_usd,
    plan_weeks: plan.weeks,
    plan_hours: plan.est_hours,
    capture_estimate_usd: capture,
    expected_value_usd: expected,
    ev_per_cost: round4(expected / plan.total_cost_usd),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerMultiples(snapshot);
  const scales = categoryScales(snapshot);
  const tok = tokenisation(snapshot);
  const scaleOf = (p: SnapshotProtocol): CategoryScale => scales.get(p.slug) ?? { multiplier: 1, percentile: 0.5, field: 1 };
  const scoreOf = (p: SnapshotProtocol) => scoreRow(p, snapshot.as_of, peers, scaleOf(p), tok);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isCleanCandidate(p))
    .map((p) => ({ p, score: scoreOf(p) }))
    .sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, v: scoreOf(p) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const plan = farmPlan(s.p, {
      age: s.v.age,
      evidencePeers: s.v.evidencePeers,
      prominent: i < 50,
      percentile: s.v.percentile,
      field: s.v.field,
      onWatchlist: watch.has(s.p.slug),
    });
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.v.age,
      on_watchlist: watch.has(s.p.slug),
      token_status: 'pre-token' as const,
      implied_value_usd: s.v.implied,
      implied_low_usd: s.v.impliedLow,
      implied_high_usd: s.v.impliedHigh,
      model: {
        peer_multiple: round4(s.v.multiple),
        peer_multiple_low: round4(s.v.multipleLow),
        peer_multiple_high: round4(s.v.multipleHigh),
        peer_count: s.v.peerCount,
        growth_multiplier: round4(s.v.growthMult),
        maturity_multiplier: round4(s.v.maturityMult),
        scale_multiplier: round4(s.v.scaleMult),
        category_percentile: round4(s.v.percentile),
        category_field_size: s.v.field,
        evidence_peers: s.v.evidencePeers,
        evidence_multiplier: round4(s.v.evidenceMult),
        evidence_grade: evidenceGrade(s.v.evidencePeers),
      },
      launch: s.v.launch,
      economics: economicsFor(s.v.implied, s.v.launch.score, s.p.tvl_usd, plan),
      signals: signalsFor(s.p, s.v.age, watch.has(s.p.slug), s.v.percentile),
      farm_steps: plan.steps,
    };
  });
}

/** A compact dollar figure for prose: $558.1M, $3.2M, $940K, $850. */
function compactUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

/** The midrank percentile of one value among a list: below plus half the ties, over the count. */
function midrankPercentile(values: number[], value: number): number {
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return values.length === 0 ? 0.5 : (below + equal / 2) / values.length;
}

/**
 * The start-here curation: the five farms a farmer would open first. Each row's pick score is
 * the mean of three standings a farmer weighs together: its base value's standing on the board
 * (log scale, so the giants do not swallow the measure), its launch index, and its value-for-
 * money standing. The reason names the two standings that carried the pick, in the row's own
 * figures, so the strip is a summary of the board and not a second opinion.
 */
export function startHere(board: BoardRow[]): StartPick[] {
  const logValues = board.map((r) => Math.log10(Math.max(1, r.implied_value_usd)));
  const evs = board.map((r) => r.economics.ev_per_cost);
  const scored = board.map((r) => {
    const valuePct = midrankPercentile(logValues, Math.log10(Math.max(1, r.implied_value_usd)));
    const evPct = midrankPercentile(evs, r.economics.ev_per_cost);
    const pick = round4((valuePct + r.launch.score + evPct) / 3);
    return { r, valuePct, evPct, pick };
  });
  scored.sort((a, b) => b.pick - a.pick || a.r.rank - b.r.rank);
  return scored.slice(0, 5).map(({ r, valuePct, evPct }) => {
    const strengths: { at: number; text: string }[] = [
      { at: valuePct, text: `a ${compactUsd(r.implied_value_usd)} base implied value, rank #${r.rank} on the board` },
      { at: r.launch.score, text: `a ${r.launch.grade.toLowerCase()} launch signal from its category's record and its own momentum` },
      { at: evPct, text: `an estimated $${r.economics.ev_per_cost.toFixed(2)} of expected value per $1 its plan commits` },
    ];
    strengths.sort((a, b) => b.at - a.at);
    const trend =
      typeof r.change_7d === 'number' && r.change_7d >= 10
        ? ` TVL is up ${r.change_7d.toFixed(1)}% this week.`
        : typeof r.change_7d === 'number' && r.change_7d <= -10
          ? ` Its one stated risk: TVL is down ${Math.abs(r.change_7d).toFixed(1)}% this week.`
          : '';
    return { slug: r.slug, reason: `${strengths[0]!.text}, and ${strengths[1]!.text}.${trend}` };
  });
}

/** The live-token protocols, by market cap, for the dashboard's comparison view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      value_per_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot);
  const categories: CategoryMultiple[] = [...peers.byCategory.entries()]
    .map(([category, v]) => ({ category, peers: v.peers, multiple: round4(v.median), multiple_low: round4(v.low), multiple_high: round4(v.high) }))
    .sort((a, b) => b.peers - a.peers);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: round4(peers.global.median),
    total_protocols: snapshot.protocols.length,
    pre_token_protocols: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    board_implied_total: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    categories,
    rows: board,
    live,
    start_here: startHere(board),
    assumptions: { pool_share: POOL_SHARE, farm_tvl_share: FARM_TVL_SHARE },
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!Number.isSafeInteger(r.implied_low_usd) || !Number.isSafeInteger(r.implied_high_usd)) return `${r.slug} has a non-whole value range`;
    if (r.implied_low_usd <= 0 || r.implied_low_usd > r.implied_value_usd || r.implied_high_usd < r.implied_value_usd) {
      return `${r.slug} has range ${r.implied_low_usd}..${r.implied_high_usd} around base ${r.implied_value_usd}`;
    }
    if (r.implied_high_usd > 100_000_000_000_000) return `${r.slug} has high value ${r.implied_high_usd} past the gate cap`;
    if (!(r.launch.score >= 0 && r.launch.score <= 1)) return `${r.slug} has launch index ${r.launch.score}`;
    if (r.launch.grade !== launchGrade(r.launch.score)) return `${r.slug} has launch grade ${r.launch.grade} for index ${r.launch.score}`;
    if (r.model.evidence_grade !== evidenceGrade(r.model.evidence_peers)) {
      return `${r.slug} has evidence grade ${r.model.evidence_grade} for ${r.model.evidence_peers} peers`;
    }
    if (r.model.evidence_multiplier !== round4(evidenceMultiplier(r.model.evidence_peers))) {
      return `${r.slug} has evidence multiplier ${r.model.evidence_multiplier} for ${r.model.evidence_peers} peers`;
    }
    if (!Number.isSafeInteger(r.economics.plan_cost_usd) || r.economics.plan_cost_usd <= 0) return `${r.slug} has plan cost ${r.economics.plan_cost_usd}`;
    if (r.economics.ev_per_cost < 0 || !Number.isFinite(r.economics.ev_per_cost)) return `${r.slug} has ev per cost ${r.economics.ev_per_cost}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
