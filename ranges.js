/**
 * ranges.js — GTO Tournament Preflop Range Data & Evaluation
 * 
 * Hand strength ranking (index 0 = strongest) based on tournament equity.
 * Percentage-cutoff system: for each scenario, define what % of top hands
 * should take each action by position and stack depth.
 */

// ===== CONSTANTS =====
const POSITIONS = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUITS = ['s', 'h', 'd', 'c']; // spades, hearts, diamonds, clubs
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };

// Full 169-hand ranking for tournament play (strongest first)
const HAND_RANKINGS = [
  'AA','KK','QQ','JJ','AKs','TT','AQs','AKo','AJs','KQs',
  '99','ATs','KJs','AQo','QJs','KTs','88','A9s','JTs','KQo',
  'A8s','K9s','T9s','QTs','A7s','77','A5s','A6s','A4s','J9s',
  'AJo','Q9s','A3s','98s','KJo','66','A2s','K8s','T8s','87s',
  'QJo','ATo','K7s','97s','76s','55','KTo','K6s','65s','J8s',
  '86s','A9o','K5s','54s','Q8s','75s','44','K4s','T7s','96s',
  'J7s','QTo','A8o','K3s','64s','85s','33','K2s','Q7s','53s',
  'J9o','Q6s','22','43s','J6s','63s','T6s','T9o','A7o','A6o',
  'Q5s','T5s','98o','A5o','95s','Q4s','J5s','84s','52s','42s',
  'K9o','A4o','Q3s','87o','J8o','A3o','Q2s','K8o','T8o','JTo',
  '97o','76o','A2o','Q9o','J4s','65o','J3s','86o','T4s','J2s',
  '54o','K7o','96o','T3s','75o','T2s','64o','94s','93s','K6o',
  '85o','92s','53o','Q8o','K5o','83s','74s','73s','J7o','43o',
  'T7o','K4o','82s','72s','Q7o','74o','K3o','Q6o','63o','62s',
  '32s','K2o','J6o','95o','T6o','Q5o','84o','52o','42o','J5o',
  'Q4o','73o','Q3o','62o','T5o','J4o','32o','Q2o','J3o','T4o',
  'J2o','94o','93o','T3o','92o','T2o','83o','82o','72o'
];

// Build rank lookup: hand notation → index (0 = best)
const HAND_RANK_MAP = {};
HAND_RANKINGS.forEach((h, i) => HAND_RANK_MAP[h] = i);

// ===== GRID UTILITIES =====
// 13x13 grid: row = first rank, col = second rank
// row < col → suited, row === col → pair, row > col → offsuit
function gridToHand(row, col) {
  if (row === col) return RANKS[row] + RANKS[col];
  if (row < col) return RANKS[row] + RANKS[col] + 's';
  return RANKS[col] + RANKS[row] + 'o';
}

function handToGrid(notation) {
  const r1 = RANKS.indexOf(notation[0]);
  const r2 = RANKS.indexOf(notation[1]);
  const suited = notation.length > 2 && notation[2] === 's';
  if (r1 === r2) return { row: r1, col: r1 };
  if (suited) return { row: Math.min(r1, r2), col: Math.max(r1, r2) };
  return { row: Math.max(r1, r2), col: Math.min(r1, r2) };
}

function handToNotation(card1, card2) {
  const r1 = RANKS.indexOf(card1.rank);
  const r2 = RANKS.indexOf(card2.rank);
  const [high, low] = r1 <= r2 ? [card1, card2] : [card2, card1];
  if (high.rank === low.rank) return high.rank + low.rank;
  const suitTag = high.suit === low.suit ? 's' : 'o';
  return high.rank + low.rank + suitTag;
}

// ===== SCENARIO RANGE DEFINITIONS =====
// Each returns an object: { raise: %, call: %, threebet: %, allin: % }
// Percentages refer to top X% of HAND_RANKINGS
// Hands not covered → fold

// Stack depth categories
// push/fold thresholds based on Nash equilibrium for 6-max tournament:
//   shoveShort 12-17BB: explicit push-or-fold zone (most positions)
//   critical <=4BB:     near-any-two shove
function getStackCategory(bb) {
  if (bb >= 40) return 'deep';
  if (bb >= 25) return 'medium';
  if (bb >= 18) return 'short';
  if (bb >= 12) return 'shoveShort';
  if (bb >= 8)  return 'veryShort';
  if (bb >= 5)  return 'desperate';
  return 'critical';
}

// ICM multiplier: tightens ranges under pressure
function getICMMultiplier(icm) {
  switch (icm) {
    case 'extreme': return 0.55;
    case 'high': return 0.7;
    case 'medium': return 0.85;
    default: return 1.0;
  }
}

// ===== RFI (Raise First In) ranges =====
// deep/medium/short → open-raise. shoveShort/veryShort/desperate/critical → all-in or fold.
// Push ranges based on Nash equilibrium for 6-max with antes.
// Early positions tighter (more callers behind); late positions much wider.
const RFI_BASE = {
  UTG: {
    deep:       { raise: 43 }, medium: { raise: 39 }, short: { raise: 35 },
    shoveShort: { allin: 22 },  // 12-17BB: ~13% (pairs 77+, AKo, AQs-ATs, KQs)
    veryShort:  { allin: 42 },  // 8-11BB:  ~25% (pairs 55+, Ax suited, AJo+, KQo)
    desperate:  { allin: 71 },  // 5-7BB:   ~42% (pairs 22+, most Ax, Kx suited, broadways)
    critical:   { allin: 110 }, // ≤4BB:   ~65% (very wide)
  },
  MP: {
    deep:       { raise: 50 }, medium: { raise: 45 }, short: { raise: 41 },
    shoveShort: { allin: 30 },  // ~18% (pairs 66+, AKo-AJo, ATs+, KQs)
    veryShort:  { allin: 51 },  // ~30% (pairs 44+, Ax suited, ATo+, KJo+)
    desperate:  { allin: 81 },  // ~48% (pairs 22+, most broadways, suited connectors)
    critical:   { allin: 118 }, // ~70%
  },
  CO: {
    deep:       { raise: 61 }, medium: { raise: 55 }, short: { raise: 50 },
    shoveShort: { allin: 42 },  // ~25% (pairs 55+, ATo+, A2s-A9s, KJo+, KTs)
    veryShort:  { allin: 68 },  // ~40% (pairs 33+, Ax most, KTo+, QJs+)
    desperate:  { allin: 98 },  // ~58% (very wide)
    critical:   { allin: 132 }, // ~78%
  },
  BTN: {
    deep:       { raise: 101 }, medium: { raise: 90 }, short: { raise: 82 },
    shoveShort: { allin: 64 },  // ~38% (pairs 22+, Ax, Kxs, KTo+, QJo, suited connectors)
    veryShort:  { allin: 93 },  // ~55% (very wide, most suited, broadways)
    desperate:  { allin: 122 }, // ~72%
    critical:   { allin: 147 }, // ~87%
  },
  SB: {
    deep:       { raise: 50 }, medium: { raise: 46 }, short: { raise: 42 },
    shoveShort: { allin: 71 },  // ~42% (widest non-blind: vs BB only)
    veryShort:  { allin: 102 }, // ~60%
    desperate:  { allin: 129 }, // ~76%
    critical:   { allin: 152 }, // ~90%
  },
  BB: {
    deep:       { raise: 0 }, medium: { raise: 0 }, short: { raise: 0 },
    shoveShort: { allin: 0 }, veryShort: { allin: 0 }, desperate: { allin: 0 }, critical: { allin: 0 }
  }
};

// ===== Facing Open Raise ranges =====
// Position facing the raise → depends on opener position
// Returns { threebet: N, call: N } (cumulative from top)
const FACING_RAISE_BASE = {
  // Facing UTG open (tight opener → tighter 3bet, wider call in position/BB)
  // SB: polarized squeeze (OOP post-flop → squeeze or fold, minimal calling)
  // BB: wide defense (already invested 1BB + closes action → defend much wider)
  vs_UTG: {
    MP:  { deep: { threebet: 5, call: 15 }, medium: { threebet: 4, call: 13 }, short: { threebet: 4, call: 11 }, shoveShort: { allin: 8 },  veryShort: { allin: 11 }, desperate: { allin: 20 }, critical: { allin: 30 } },
    CO:  { deep: { threebet: 6, call: 25 }, medium: { threebet: 5, call: 21 }, short: { threebet: 5, call: 18 }, shoveShort: { allin: 12 }, veryShort: { allin: 16 }, desperate: { allin: 28 }, critical: { allin: 42 } },
    BTN: { deep: { threebet: 7, call: 33 }, medium: { threebet: 6, call: 28 }, short: { threebet: 5, call: 24 }, shoveShort: { allin: 15 }, veryShort: { allin: 20 }, desperate: { allin: 32 }, critical: { allin: 48 } },
    SB:  { deep: { threebet: 5, call: 22 }, medium: { threebet: 4, call: 18 }, short: { threebet: 4, call: 16 }, shoveShort: { allin: 12 }, veryShort: { allin: 18 }, desperate: { allin: 28 }, critical: { allin: 42 } },
    BB:  { deep: { threebet: 6, call: 66 }, medium: { threebet: 5, call: 56 }, short: { threebet: 5, call: 48 }, shoveShort: { allin: 17 }, veryShort: { allin: 23 }, desperate: { allin: 40 }, critical: { allin: 58 } },
  },
  // Facing MP open
  vs_MP: {
    CO:  { deep: { threebet: 7, call: 30 }, medium: { threebet: 6, call: 26 }, short: { threebet: 5, call: 22 }, shoveShort: { allin: 14 }, veryShort: { allin: 20 }, desperate: { allin: 32 }, critical: { allin: 46 } },
    BTN: { deep: { threebet: 9, call: 42 }, medium: { threebet: 8, call: 36 }, short: { threebet: 7, call: 30 }, shoveShort: { allin: 18 }, veryShort: { allin: 25 }, desperate: { allin: 38 }, critical: { allin: 55 } },
    SB:  { deep: { threebet: 7, call: 28 }, medium: { threebet: 6, call: 24 }, short: { threebet: 5, call: 20 }, shoveShort: { allin: 14 }, veryShort: { allin: 20 }, desperate: { allin: 32 }, critical: { allin: 46 } },
    BB:  { deep: { threebet: 8, call: 75 }, medium: { threebet: 7, call: 64 }, short: { threebet: 6, call: 54 }, shoveShort: { allin: 18 }, veryShort: { allin: 26 }, desperate: { allin: 44 }, critical: { allin: 64 } },
  },
  // Facing CO open
  vs_CO: {
    BTN: { deep: { threebet: 12, call: 50 }, medium: { threebet: 10, call: 42 }, short: { threebet: 9, call: 36 }, shoveShort: { allin: 20 }, veryShort: { allin: 28 }, desperate: { allin: 42 }, critical: { allin: 60 } },
    SB:  { deep: { threebet: 10, call: 38 }, medium: { threebet: 8, call: 32 }, short: { threebet: 7, call: 28 }, shoveShort: { allin: 18 }, veryShort: { allin: 24 }, desperate: { allin: 36 }, critical: { allin: 52 } },
    BB:  { deep: { threebet: 12, call: 90 }, medium: { threebet: 10, call: 76 }, short: { threebet: 9, call: 65 }, shoveShort: { allin: 22 }, veryShort: { allin: 32 }, desperate: { allin: 52 }, critical: { allin: 76 } },
  },
  // Facing BTN open (BTN opens very wide → SB/BB defend most aggressively)
  vs_BTN: {
    SB:  { deep: { threebet: 20, call: 80 }, medium: { threebet: 17, call: 68 }, short: { threebet: 14, call: 56 }, shoveShort: { allin: 26 }, veryShort: { allin: 36 }, desperate: { allin: 52 }, critical: { allin: 72 } },
    BB:  { deep: { threebet: 18, call: 140 }, medium: { threebet: 15, call: 118 }, short: { threebet: 12, call: 100 }, shoveShort: { allin: 30 }, veryShort: { allin: 42 }, desperate: { allin: 65 }, critical: { allin: 95 } },
  },
  // Facing SB open (BB only: maximize defense vs wide SB range + position advantage)
  vs_SB: {
    BB:  { deep: { threebet: 22, call: 120 }, medium: { threebet: 19, call: 102 }, short: { threebet: 16, call: 86 }, shoveShort: { allin: 30 }, veryShort: { allin: 42 }, desperate: { allin: 62 }, critical: { allin: 95 } },
  }
};

// ===== Facing 3-Bet ranges (you opened, someone 3-bet) =====
const FACING_3BET_BASE = {
  UTG: { deep: { fourbet: 4, call: 20 }, medium: { fourbet: 4, call: 16 }, short: { allin: 14 }, shoveShort: { allin: 14 }, veryShort: { allin: 16 }, desperate: { allin: 22 }, critical: { allin: 30 } },
  MP:  { deep: { fourbet: 5, call: 28 }, medium: { fourbet: 5, call: 22 }, short: { allin: 18 }, shoveShort: { allin: 18 }, veryShort: { allin: 20 }, desperate: { allin: 26 }, critical: { allin: 36 } },
  CO:  { deep: { fourbet: 7, call: 38 }, medium: { fourbet: 6, call: 30 }, short: { allin: 22 }, shoveShort: { allin: 22 }, veryShort: { allin: 26 }, desperate: { allin: 32 }, critical: { allin: 44 } },
  BTN: { deep: { fourbet: 8, call: 45 }, medium: { fourbet: 7, call: 36 }, short: { allin: 26 }, shoveShort: { allin: 26 }, veryShort: { allin: 30 }, desperate: { allin: 36 }, critical: { allin: 50 } },
  SB:  { deep: { fourbet: 6, call: 28 }, medium: { fourbet: 5, call: 22 }, short: { allin: 18 }, shoveShort: { allin: 18 }, veryShort: { allin: 22 }, desperate: { allin: 28 }, critical: { allin: 40 } },
};

// ===== BLUFF RANGES =====
// 3-bet bluff hands (facing a raise, by hero position vs opener)
// Uses blocker hands with backdoor equity. Disabled under high ICM.
// NOTE: bluff hands must rank WORSE than the position's call threshold;
// otherwise they are already captured as 'call' before the bluff check fires.
// BB call thresholds (deep): vs UTG=66, vs MP=75, vs CO=90, vs BTN=140, vs SB=120
// With wider call ranges, bluff hands shift to Kx/Qx/suited connectors outside call range.
const THREEBET_BLUFF = {
  vs_UTG: {
    MP:  [],                                   // MP too early vs UTG to bluff-squeeze
    CO:  ['A2s','A3s','A4s','A5s'],            // CO: call=25; Ax blockers still outside
    BTN: ['A2s','87s','76s','65s'],            // BTN: call=33 absorbs A3s-A5s; use suited connectors
    SB:  ['A2s','A3s','A4s','A5s'],            // SB: call=22; Ax blockers still outside
    BB:  ['Q7s','Q6s'],                        // BB: call=66 absorbs Kx; Qx at rank 68-71
  },
  vs_MP: {
    CO:  ['A2s','A3s','87s','76s'],            // CO: call=30 absorbs A5s/A4s
    BTN: ['K2s','K3s','97s','76s'],            // BTN: call=42 absorbs all Ax; use Kx/connectors
    SB:  ['A2s','A3s','A4s','K2s'],            // SB: call=28 absorbs A5s
    BB:  ['T6s','Q5s'],                        // BB: call=75 absorbs lower Kx/Qx
  },
  vs_CO: {
    BTN: ['K2s','K3s','K4s','86s'],            // BTN: call=50 absorbs Ax; K4s(57) still outside
    SB:  ['K2s','K3s','87s','76s'],            // SB: call=38 absorbs Ax; use Kx/connectors
    BB:  ['K9o','A4o'],                        // BB: call=90 very wide; few bluffs viable
  },
  vs_BTN: {
    SB:  ['Q5s','T5s','95s','Q4s'],            // SB: call=80 absorbs Ax/Kx; use rank 80+ hands
    BB:  [],                                   // BB: call=140 (83%); no bluff range needed
  },
  vs_SB: {
    BB:  [],                                   // BB: call=120 (71%); no bluff range needed
  },
};

// 4-bet bluff hands (hero opened, facing a 3-bet)
// Blocker hands (Ace/King) make villain's premium range less likely.
// With wider call ranges, bluff hands shift to Kx outside the call threshold.
const FOURBET_BLUFF = {
  UTG: ['A2s','A3s','A4s','A5s'],              // call=20; all Ax suited still outside
  MP:  ['A2s','A3s','A4s','K2s'],              // call=28; A5s(26) now inside, drop it
  CO:  ['K2s','K3s','97s','76s'],              // call=38; Ax suited inside, use Kx/connectors
  BTN: ['K2s','K3s','K4s','K5s'],              // call=45; Ax inside, use Kx blockers
  SB:  ['A2s','A3s','A4s'],                    // call=28; A5s(26) inside, drop it
  BB:  [],                                     // BB rarely opens; no 4-bet bluff range
};

// Bluffs only viable when ICM is low enough (medium or low pressure)
function bluffAllowed(icmMult, stackCat) {
  return icmMult >= 0.85 && (stackCat === 'deep' || stackCat === 'medium');
}

// ===== Facing All-in ranges =====
// Calling ranges depend on shover's stack size (pot odds) and hero position.
// Shorter shovers = better pot odds = wider calling range.
// BB calls widest (already invested, closes action); UTG tightest (many left to act).
const FACING_ALLIN_BASE = {
  // 3-7 BB: getting ~1.5:1 or better; call fairly wide
  tiny_shove:   { UTG: 18, MP: 22, CO: 28, BTN: 34, SB: 30, BB: 42 },
  // 8-11 BB: standard short-stack push; moderate calling
  short_shove:  { UTG: 10, MP: 13, CO: 16, BTN: 20, SB: 18, BB: 25 },
  // 12-15 BB: larger risk = tighter call
  medium_shove: { UTG: 6,  MP: 8,  CO: 10, BTN: 14, SB: 12, BB: 18 },
  // 16-20 BB: only premiums push here, need strong hand to call
  deep_shove:   { UTG: 4,  MP: 5,  CO: 7,  BTN: 10, SB: 8,  BB: 13 },
};

// ===== EVALUATION ENGINE =====
function getCorrectAction(handNotation, scenario) {
  const rank = HAND_RANK_MAP[handNotation];
  if (rank === undefined) return 'fold';
  
  const pos = scenario.heroPosition;
  const stackCat = getStackCategory(scenario.heroStack);
  const icmMult = getICMMultiplier(scenario.icmPressure);
  
  switch (scenario.type) {
    case 'rfi':
      return evaluateRFI(rank, pos, stackCat, icmMult);
    case 'facingRaise':
      return evaluateFacingRaise(rank, pos, scenario.openerPosition, stackCat, icmMult, handNotation);
    case 'facing3Bet':
      return evaluateFacing3Bet(rank, pos, stackCat, icmMult, handNotation);
    case 'facingAllin':
      return evaluateFacingAllin(rank, pos, scenario.shoverStack, icmMult);
    default:
      return 'fold';
  }
}

function evaluateRFI(rank, pos, stackCat, icmMult) {
  const base = RFI_BASE[pos]?.[stackCat];
  if (!base) return 'fold';
  
  if (base.allin !== undefined) {
    const threshold = Math.round(base.allin * icmMult);
    return rank < threshold ? 'allin' : 'fold';
  }
  if (base.raise !== undefined) {
    const threshold = Math.round(base.raise * icmMult);
    return rank < threshold ? 'raise' : 'fold';
  }
  return 'fold';
}

function evaluateFacingRaise(rank, pos, openerPos, stackCat, icmMult, handNotation) {
  const key = `vs_${openerPos}`;
  const posRanges = FACING_RAISE_BASE[key]?.[pos];
  if (!posRanges) return 'fold';
  
  const base = posRanges[stackCat];
  if (!base) return 'fold';
  
  // Short stack: allin or fold (no bluffing)
  if (base.allin !== undefined) {
    const threshold = Math.round(base.allin * icmMult);
    return rank < threshold ? 'allin' : 'fold';
  }
  
  const threebetThreshold = Math.round((base.threebet || 0) * icmMult);
  const callThreshold = Math.round((base.call || 0) * icmMult);
  
  if (rank < threebetThreshold) return 'raise'; // value 3-bet
  if (rank < callThreshold) return 'call';
  
  // Check 3-bet bluff (suited blocker hands, only with enough stack & low ICM)
  if (handNotation && bluffAllowed(icmMult, stackCat)) {
    const bluffHands = THREEBET_BLUFF[key]?.[pos] || [];
    if (bluffHands.includes(handNotation)) return 'bluff';
  }
  
  return 'fold';
}

function evaluateFacing3Bet(rank, pos, stackCat, icmMult, handNotation) {
  const base = FACING_3BET_BASE[pos]?.[stackCat];
  if (!base) return 'fold';
  
  if (base.allin !== undefined) {
    const threshold = Math.round(base.allin * icmMult);
    return rank < threshold ? 'allin' : 'fold';
  }
  
  const fourbetThreshold = Math.round((base.fourbet || 0) * icmMult);
  const callThreshold = Math.round((base.call || 0) * icmMult);
  
  if (rank < fourbetThreshold) return 'raise'; // value 4-bet
  if (rank < callThreshold) return 'call';
  
  // Check 4-bet bluff (ace-blocker hands, only with enough stack & low ICM)
  if (handNotation && bluffAllowed(icmMult, stackCat)) {
    const bluffHands = FOURBET_BLUFF[pos] || [];
    if (bluffHands.includes(handNotation)) return 'bluff';
  }
  
  return 'fold';
}

function evaluateFacingAllin(rank, pos, shoverStack, icmMult) {
  let shoveType;
  if (shoverStack <= 7)       shoveType = 'tiny_shove';
  else if (shoverStack <= 11) shoveType = 'short_shove';
  else if (shoverStack <= 15) shoveType = 'medium_shove';
  else                        shoveType = 'deep_shove';
  
  const baseCall = FACING_ALLIN_BASE[shoveType]?.[pos] || 8;
  const threshold = Math.round(baseCall * icmMult);
  return rank < threshold ? 'call' : 'fold';
}

// ===== RANGE CHART GENERATION =====
function getRangeChart(scenario) {
  // Returns 13x13 grid of actions
  const grid = [];
  for (let r = 0; r < 13; r++) {
    grid[r] = [];
    for (let c = 0; c < 13; c++) {
      const hand = gridToHand(r, c);
      grid[r][c] = {
        hand: hand,
        action: getCorrectAction(hand, scenario)
      };
    }
  }
  return grid;
}

// Get action label in Chinese
function getActionLabel(action) {
  switch (action) {
    case 'fold':   return '棄牌';
    case 'call':   return '跟注';
    case 'raise':  return '加注';
    case 'allin':  return '全押';
    case 'bluff':  return '加注詐唬 🎭';
    case 'threebet': return '3-Bet';
    default: return action;
  }
}

// Get available actions for a scenario type
function getAvailableActions(scenarioType, stackCat) {
  switch (scenarioType) {
    case 'rfi':
      if (stackCat === 'veryShort' || stackCat === 'desperate') {
        return ['fold', 'allin'];
      }
      return ['fold', 'raise'];
    case 'facingRaise':
      if (stackCat === 'veryShort' || stackCat === 'desperate') {
        return ['fold', 'allin'];
      }
      return ['fold', 'call', 'raise'];
    case 'facing3Bet':
      if (stackCat === 'short' || stackCat === 'veryShort' || stackCat === 'desperate') {
        return ['fold', 'allin'];
      }
      return ['fold', 'call', 'raise'];
    case 'facingAllin':
      return ['fold', 'call'];
    default:
      return ['fold', 'call', 'raise', 'allin'];
  }
}

// Generate a brief GTO explanation for the result
function getExplanation(scenario, handNotation, correctAction, playerAction) {
  const pos = scenario.heroPosition;
  const stack = scenario.heroStack;
  const handRank = HAND_RANK_MAP[handNotation];
  const totalHands = HAND_RANKINGS.length;
  const topPct = ((handRank + 1) / totalHands * 100).toFixed(1);
  
  // Treat raise+bluff as same for "playerAction matched" message
  const playerMatchedBluff = (playerAction === 'raise' && correctAction === 'bluff');
  if (playerAction === correctAction || playerMatchedBluff) {
    if (correctAction === 'bluff') {
      return `${handNotation} 排名前 ${topPct}%。這手牌是 GTO 詐唬範圍 🎭 —— 有 Ace/King blocker，極化加注可讓對手難以跟注，是正確的詐唬加注選擇。`;
    }
    return `${handNotation} 在手牌中排名前 ${topPct}%，在此情境下${getActionLabel(correctAction)}是正確選擇。`;
  }
  
  let explanation = `${handNotation} 排名前 ${topPct}%。`;
  
  switch (scenario.type) {
    case 'rfi':
      if (correctAction === 'raise') {
        explanation += `在 ${pos} 位前面無人開池，${handNotation} 在開池範圍內，應該加注開池。`;
      } else if (correctAction === 'allin') {
        explanation += `籌碼僅 ${stack} BB，在 ${pos} 位應採取推-蓋策略（push or fold），${handNotation} 夠強應全押。`;
      } else {
        explanation += `在 ${pos} 位，${handNotation} 不在開池範圍內，應棄牌。`;
      }
      break;
    case 'facingRaise':
      if (correctAction === 'raise') {
        explanation += `面對 ${scenario.openerPosition} 的開池加注，${handNotation} 有足夠牌力進行價值 3-bet。`;
      } else if (correctAction === 'bluff') {
        explanation += `面對 ${scenario.openerPosition} 的加注，${handNotation} 雖然不是強牌，但有 Ace/King blocker 適合做 3-bet 詐唬 🎭。對手難以判斷你是真強牌還是詐唬，這是 GTO 極化策略的一部分。`;
      } else if (correctAction === 'call') {
        explanation += `面對 ${scenario.openerPosition} 的加注，${handNotation} 適合跟注但不夠強到 3-bet。`;
      } else if (correctAction === 'allin') {
        explanation += `短籌碼面對加注，${handNotation} 應全押或棄牌。`;
      } else {
        explanation += `面對 ${scenario.openerPosition} 的加注，${handNotation} 不夠強，應棄牌。`;
      }
      break;
    case 'facing3Bet':
      if (correctAction === 'raise') {
        explanation += `面對 3-bet，${handNotation} 夠強可以 4-bet（價值牌）。`;
      } else if (correctAction === 'bluff') {
        explanation += `面對 3-bet，${handNotation} 有 Ace blocker（減少對手 AA 的可能），適合做 4-bet 詐唬 🎭。這是 GTO 的極化 4-bet 範圍，讓對手的 5-bet 決策更困難。`;
      } else if (correctAction === 'call') {
        explanation += `面對 3-bet，${handNotation} 適合跟注。`;
      } else if (correctAction === 'allin') {
        explanation += `短籌碼面對 3-bet，${handNotation} 應全押或棄牌。`;
      } else {
        explanation += `面對 3-bet，${handNotation} 不夠強，應棄牌止損。`;
      }
      break;
    case 'facingAllin':
      if (correctAction === 'call') {
        explanation += `面對全押，根據底池賠率和 ICM，${handNotation} 有足夠勝率應跟注。`;
      } else {
        explanation += `面對全押，${handNotation} 勝率不足以跟注，考慮 ICM 壓力應棄牌。`;
      }
      break;
  }
  
  if (scenario.icmPressure === 'high' || scenario.icmPressure === 'extreme') {
    explanation += ` (ICM壓力${scenario.icmPressure === 'extreme' ? '極高' : '高'}，應比平時更緊。)`;
  }
  
  return explanation;
}
