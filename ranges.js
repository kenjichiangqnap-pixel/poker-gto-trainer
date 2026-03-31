/**
 * ranges.js — GTO Tournament Preflop Range Data & Evaluation
 * 
 * Hand strength ranking (index 0 = strongest) based on tournament equity.
 * Percentage-cutoff system: for each scenario, define what % of top hands
 * should take each action by position and stack depth.
 */

// ===== CONSTANTS =====
const POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
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
function getStackCategory(bb) {
  if (bb >= 40) return 'deep';
  if (bb >= 25) return 'medium';
  if (bb >= 15) return 'short';
  if (bb >= 8) return 'veryShort';
  return 'desperate';
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
// Returns { raise: topN, allin: topN } in number of hands from ranking
const RFI_BASE = {
  UTG: { deep: { raise: 22 }, medium: { raise: 20 }, short: { raise: 25 }, veryShort: { allin: 28 }, desperate: { allin: 48 } },
  HJ:  { deep: { raise: 28 }, medium: { raise: 26 }, short: { raise: 30 }, veryShort: { allin: 34 }, desperate: { allin: 55 } },
  CO:  { deep: { raise: 38 }, medium: { raise: 35 }, short: { raise: 40 }, veryShort: { allin: 42 }, desperate: { allin: 65 } },
  BTN: { deep: { raise: 55 }, medium: { raise: 50 }, short: { raise: 52 }, veryShort: { allin: 56 }, desperate: { allin: 80 } },
  SB:  { deep: { raise: 45 }, medium: { raise: 42 }, short: { raise: 46 }, veryShort: { allin: 52 }, desperate: { allin: 75 } },
  BB:  { deep: { raise: 0 }, medium: { raise: 0 }, short: { raise: 0 }, veryShort: { allin: 0 }, desperate: { allin: 0 } }
};

// ===== Facing Open Raise ranges =====
// Position facing the raise → depends on opener position
// Returns { threebet: N, call: N } (cumulative from top)
const FACING_RAISE_BASE = {
  // Facing UTG open (tight opener → tighter 3bet, narrow call range)
  vs_UTG: {
    HJ:  { deep: { threebet: 6, call: 14 }, medium: { threebet: 5, call: 12 }, short: { threebet: 5, call: 10 }, veryShort: { allin: 10 }, desperate: { allin: 18 } },
    CO:  { deep: { threebet: 8, call: 18 }, medium: { threebet: 6, call: 15 }, short: { threebet: 6, call: 12 }, veryShort: { allin: 12 }, desperate: { allin: 22 } },
    BTN: { deep: { threebet: 10, call: 22 }, medium: { threebet: 8, call: 18 }, short: { threebet: 7, call: 14 }, veryShort: { allin: 15 }, desperate: { allin: 25 } },
    SB:  { deep: { threebet: 8, call: 14 }, medium: { threebet: 6, call: 12 }, short: { threebet: 6, call: 10 }, veryShort: { allin: 12 }, desperate: { allin: 20 } },
    BB:  { deep: { threebet: 8, call: 25 }, medium: { threebet: 6, call: 20 }, short: { threebet: 6, call: 16 }, veryShort: { allin: 14 }, desperate: { allin: 25 } },
  },
  // Facing HJ open
  vs_HJ: {
    CO:  { deep: { threebet: 8, call: 18 }, medium: { threebet: 7, call: 15 }, short: { threebet: 6, call: 12 }, veryShort: { allin: 14 }, desperate: { allin: 24 } },
    BTN: { deep: { threebet: 12, call: 24 }, medium: { threebet: 10, call: 20 }, short: { threebet: 8, call: 16 }, veryShort: { allin: 18 }, desperate: { allin: 28 } },
    SB:  { deep: { threebet: 8, call: 15 }, medium: { threebet: 7, call: 12 }, short: { threebet: 6, call: 10 }, veryShort: { allin: 13 }, desperate: { allin: 22 } },
    BB:  { deep: { threebet: 10, call: 28 }, medium: { threebet: 8, call: 22 }, short: { threebet: 7, call: 18 }, veryShort: { allin: 16 }, desperate: { allin: 28 } },
  },
  // Facing CO open
  vs_CO: {
    BTN: { deep: { threebet: 14, call: 28 }, medium: { threebet: 12, call: 24 }, short: { threebet: 10, call: 18 }, veryShort: { allin: 20 }, desperate: { allin: 32 } },
    SB:  { deep: { threebet: 10, call: 16 }, medium: { threebet: 8, call: 14 }, short: { threebet: 7, call: 12 }, veryShort: { allin: 14 }, desperate: { allin: 24 } },
    BB:  { deep: { threebet: 12, call: 32 }, medium: { threebet: 10, call: 26 }, short: { threebet: 8, call: 20 }, veryShort: { allin: 18 }, desperate: { allin: 30 } },
  },
  // Facing BTN open
  vs_BTN: {
    SB:  { deep: { threebet: 14, call: 22 }, medium: { threebet: 12, call: 18 }, short: { threebet: 10, call: 14 }, veryShort: { allin: 18 }, desperate: { allin: 30 } },
    BB:  { deep: { threebet: 14, call: 38 }, medium: { threebet: 12, call: 32 }, short: { threebet: 10, call: 25 }, veryShort: { allin: 22 }, desperate: { allin: 35 } },
  },
  // Facing SB open (from BB only)
  vs_SB: {
    BB:  { deep: { threebet: 16, call: 42 }, medium: { threebet: 14, call: 36 }, short: { threebet: 12, call: 28 }, veryShort: { allin: 25 }, desperate: { allin: 38 } },
  }
};

// ===== Facing 3-Bet ranges (you opened, someone 3-bet) =====
const FACING_3BET_BASE = {
  UTG: { deep: { fourbet: 4, call: 10 }, medium: { fourbet: 4, call: 8 }, short: { allin: 8 }, veryShort: { allin: 10 }, desperate: { allin: 14 } },
  HJ:  { deep: { fourbet: 5, call: 12 }, medium: { fourbet: 4, call: 10 }, short: { allin: 10 }, veryShort: { allin: 12 }, desperate: { allin: 16 } },
  CO:  { deep: { fourbet: 6, call: 15 }, medium: { fourbet: 5, call: 12 }, short: { allin: 12 }, veryShort: { allin: 14 }, desperate: { allin: 20 } },
  BTN: { deep: { fourbet: 8, call: 18 }, medium: { fourbet: 6, call: 14 }, short: { allin: 14 }, veryShort: { allin: 16 }, desperate: { allin: 22 } },
  SB:  { deep: { fourbet: 6, call: 14 }, medium: { fourbet: 5, call: 11 }, short: { allin: 11 }, veryShort: { allin: 14 }, desperate: { allin: 18 } },
};

// ===== Facing All-in ranges =====
const FACING_ALLIN_BASE = {
  // Based on pot odds and ICM — simplified calling ranges
  // Wider call when getting good pot odds (short stack shover)
  short_shove:  { UTG: 12, HJ: 14, CO: 16, BTN: 20, SB: 18, BB: 22 },
  medium_shove: { UTG: 8,  HJ: 10, CO: 12, BTN: 15, SB: 14, BB: 18 },
  deep_shove:   { UTG: 5,  HJ: 6,  CO: 8,  BTN: 10, SB: 8,  BB: 12 },
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
      return evaluateFacingRaise(rank, pos, scenario.openerPosition, stackCat, icmMult);
    case 'facing3Bet':
      return evaluateFacing3Bet(rank, pos, stackCat, icmMult);
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

function evaluateFacingRaise(rank, pos, openerPos, stackCat, icmMult) {
  const key = `vs_${openerPos}`;
  const posRanges = FACING_RAISE_BASE[key]?.[pos];
  if (!posRanges) return 'fold';
  
  const base = posRanges[stackCat];
  if (!base) return 'fold';
  
  // Short stack: allin or fold
  if (base.allin !== undefined) {
    const threshold = Math.round(base.allin * icmMult);
    return rank < threshold ? 'allin' : 'fold';
  }
  
  const threebetThreshold = Math.round((base.threebet || 0) * icmMult);
  const callThreshold = Math.round((base.call || 0) * icmMult);
  
  if (rank < threebetThreshold) return 'raise'; // 3-bet displayed as "raise"
  if (rank < callThreshold) return 'call';
  return 'fold';
}

function evaluateFacing3Bet(rank, pos, stackCat, icmMult) {
  const base = FACING_3BET_BASE[pos]?.[stackCat];
  if (!base) return 'fold';
  
  if (base.allin !== undefined) {
    const threshold = Math.round(base.allin * icmMult);
    return rank < threshold ? 'allin' : 'fold';
  }
  
  const fourbetThreshold = Math.round((base.fourbet || 0) * icmMult);
  const callThreshold = Math.round((base.call || 0) * icmMult);
  
  if (rank < fourbetThreshold) return 'raise'; // 4-bet
  if (rank < callThreshold) return 'call';
  return 'fold';
}

function evaluateFacingAllin(rank, pos, shoverStack, icmMult) {
  let shoveType = 'medium_shove';
  if (shoverStack < 12) shoveType = 'short_shove';
  else if (shoverStack >= 30) shoveType = 'deep_shove';
  
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
    case 'fold': return '棄牌';
    case 'call': return '跟注';
    case 'raise': return '加注';
    case 'allin': return '全押';
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
  
  if (playerAction === correctAction) {
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
        explanation += `面對 ${scenario.openerPosition} 的開池加注，${handNotation} 有足夠牌力進行 3-bet。`;
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
        explanation += `面對 3-bet，${handNotation} 夠強可以 4-bet。`;
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
