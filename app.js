/**
 * app.js — Poker GTO Preflop Trainer - Main Application Logic
 * Mobile-first design with chip-amount display
 */

// ===== STATE =====
const state = {
  currentScenario: null,
  history: [],
  handNumber: 0,
  correctCount: 0,
  streak: 0,
  answered: false,
};

// ===== TOURNAMENT STAGE CONFIG =====
const TOURNAMENT_STAGES = [
  { id: 'early',      label: '錦標賽初期',         icm: 'low',     stackRange: [30, 80],  playersLeftRange: [80, 200] },
  { id: 'middle',     label: '錦標賽中期',         icm: 'low',     stackRange: [20, 60],  playersLeftRange: [30, 80] },
  { id: 'bubble',     label: '泡沫圈 🫧',          icm: 'high',    stackRange: [12, 50],  playersLeftRange: [20, 35] },
  { id: 'nearBubble', label: '接近泡沫圈',         icm: 'medium',  stackRange: [15, 55],  playersLeftRange: [25, 40] },
  { id: 'itm',        label: '錢圈內 💰',          icm: 'low',     stackRange: [10, 60],  playersLeftRange: [12, 24] },
  { id: 'payJump',    label: '接近大跳獎金 💎',     icm: 'extreme', stackRange: [10, 50],  playersLeftRange: [8, 15] },
  { id: 'finalTable', label: '決賽桌 🏆',          icm: 'high',    stackRange: [8, 70],   playersLeftRange: [6, 9] },
  { id: 'ftShort',    label: '決賽桌(短碼)',        icm: 'extreme', stackRange: [5, 40],   playersLeftRange: [3, 5] },
];

// ===== HELPER FUNCTIONS =====
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function dealCards() {
  let c1, c2;
  do {
    c1 = { rank: pick(RANKS), suit: pick(SUITS) };
    c2 = { rank: pick(RANKS), suit: pick(SUITS) };
  } while (c1.rank === c2.rank && c1.suit === c2.suit);
  return [c1, c2];
}

function formatCard(card) {
  return card.rank + SUIT_SYMBOLS[card.suit];
}

function isRedSuit(suit) { return suit === 'h' || suit === 'd'; }

// Format BB amount nicely
function formatBB(amount) {
  if (Number.isInteger(amount)) return amount + ' BB';
  return amount.toFixed(1) + ' BB';
}

// ===== SIZING CALCULATIONS =====
function getOpenRaiseSize(heroStack) {
  if (heroStack >= 25) return randFloat(2.0, 2.5);
  if (heroStack >= 15) return randFloat(2.0, 2.3);
  return heroStack; // allin
}

function get3BetSize(openSize, inPosition) {
  // 3x OOP, 2.5x IP as a base
  const mult = inPosition ? randFloat(2.5, 3.0) : randFloat(3.0, 3.5);
  return Math.round(openSize * mult * 10) / 10;
}

function getCallAmount(scenario) {
  switch (scenario.type) {
    case 'facingRaise': {
      const raiseAction = scenario.actionsBefore.find(a => a.action === 'raise' && !a.isHero);
      return raiseAction ? raiseAction.amount : 2.5;
    }
    case 'facing3Bet': {
      const tbAction = scenario.actionsBefore.find(a => a.action === '3bet');
      const heroOpen = scenario.actionsBefore.find(a => a.isHero);
      if (tbAction && heroOpen) return tbAction.amount - heroOpen.amount;
      return tbAction ? tbAction.amount : 7;
    }
    case 'facingAllin': {
      const shoveAction = scenario.actionsBefore.find(a => a.action === 'allin');
      return shoveAction ? shoveAction.amount : scenario.shoverStack;
    }
    default: return 0;
  }
}

function getSuggestedRaiseSize(scenario) {
  switch (scenario.type) {
    case 'rfi':
      return getStackCategory(scenario.heroStack) === 'veryShort' || getStackCategory(scenario.heroStack) === 'desperate'
        ? scenario.heroStack : Math.round(randFloat(2.0, 2.5) * 10) / 10;
    case 'facingRaise': {
      const raiseAction = scenario.actionsBefore.find(a => a.action === 'raise' && !a.isHero);
      const openSize = raiseAction ? raiseAction.amount : 2.5;
      return Math.round(get3BetSize(openSize, true) * 10) / 10;
    }
    case 'facing3Bet': {
      return Math.min(scenario.heroStack, Math.round(randFloat(16, 22) * 10) / 10);
    }
    default: return scenario.heroStack;
  }
}

// ===== ACTIVE POSITIONS BY TABLE SIZE =====
// 6-max: positions removed from early position first
function getActivePositions(tablePlayers) {
  // Full table positions in action order
  const all = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  if (tablePlayers >= 6) return all;
  if (tablePlayers === 5) return ['HJ', 'CO', 'BTN', 'SB', 'BB'];
  if (tablePlayers === 4) return ['CO', 'BTN', 'SB', 'BB'];
  if (tablePlayers === 3) return ['BTN', 'SB', 'BB'];
  return ['SB', 'BB']; // heads up
}

// ===== SCENARIO GENERATION =====
function generateScenario() {
  const stage = pick(TOURNAMENT_STAGES);
  
  // Determine players left first, then table size
  const playersLeft = randInt(stage.playersLeftRange[0], stage.playersLeftRange[1]);
  const tablePlayers = Math.min(6, playersLeft);
  const activePositions = getActivePositions(tablePlayers);
  
  const heroPos = pick(activePositions);
  
  // Generate stacks only for active players
  const stacks = {};
  activePositions.forEach(pos => {
    stacks[pos] = randInt(stage.stackRange[0], stage.stackRange[1]);
  });
  const heroStack = stacks[heroPos];
  const stackCat = getStackCategory(heroStack);
  
  // Determine scenario type
  const scenarioType = pickScenarioType(heroPos, stackCat, activePositions);
  
  // Generate pre-actions
  const { actionsBefore, openerPosition, shoverStack, pot } = generatePreActions(heroPos, stacks, scenarioType, activePositions);
  
  // Deal hand
  const [card1, card2] = dealCards();
  const handNotation = handToNotation(card1, card2);
  
  const paidPlaces = Math.max(3, Math.floor(playersLeft * 0.6));
  
  const scenario = {
    id: state.handNumber + 1,
    heroPosition: heroPos,
    heroStack,
    cards: [card1, card2],
    handNotation,
    stacks,
    stage,
    type: scenarioType,
    actionsBefore,
    openerPosition,
    shoverStack,
    pot,
    playersLeft,
    tablePlayers,
    activePositions,
    paidPlaces,
    icmPressure: stage.icm,
    availableActions: getAvailableActions(scenarioType, stackCat),
    correctAction: null,
  };
  
  scenario.correctAction = getCorrectAction(handNotation, scenario);
  
  // Compute sizing info
  scenario.callAmount = getCallAmount(scenario);
  scenario.suggestedRaiseSize = getSuggestedRaiseSize(scenario);
  
  return scenario;
}

function pickScenarioType(heroPos, stackCat, activePositions) {
  const heroIdx = activePositions.indexOf(heroPos);
  const isFirstToAct = heroIdx === 0;
  const isLastToAct = heroPos === 'BB';
  const playersBeforeHero = activePositions.slice(0, heroIdx);
  const playersAfterHero = activePositions.slice(heroIdx + 1);
  
  // First to act can only open
  if (isFirstToAct) return 'rfi';
  
  // BB (last to act) can't open or be 3-bet
  if (isLastToAct) {
    return Math.random() < 0.6 ? 'facingRaise' : 'facingAllin';
  }
  
  const roll = Math.random();
  if (stackCat === 'veryShort' || stackCat === 'desperate') {
    if (roll < 0.5) return 'rfi';
    if (roll < 0.8) return 'facingAllin';
    return 'facingRaise';
  }
  
  // Need players after hero for 3-bet scenario
  const can3Bet = playersAfterHero.length > 0;
  
  if (roll < 0.40) return 'rfi';
  if (roll < 0.70) return 'facingRaise';
  if (roll < 0.85 && can3Bet) return 'facing3Bet';
  return 'facingAllin';
}

function generatePreActions(heroPos, stacks, scenarioType, activePositions) {
  const posOrder = activePositions;
  const heroIdx = posOrder.indexOf(heroPos);
  const actionsBefore = [];
  let pot = 1.5;
  let openerPosition = null;
  let shoverStack = null;
  
  switch (scenarioType) {
    case 'rfi': {
      for (let i = 0; i < heroIdx; i++) {
        actionsBefore.push({ position: posOrder[i], action: 'fold' });
      }
      break;
    }
    case 'facingRaise': {
      const possibleOpeners = posOrder.slice(0, heroIdx);
      if (possibleOpeners.length === 0) {
        return generatePreActions(heroPos, stacks, 'rfi', activePositions);
      }
      openerPosition = pick(possibleOpeners);
      const raiseSize = Math.round(randFloat(2.0, 2.5) * 10) / 10;
      
      for (let i = 0; i < heroIdx; i++) {
        if (posOrder[i] === openerPosition) {
          actionsBefore.push({ position: posOrder[i], action: 'raise', amount: raiseSize });
          pot += raiseSize;
        } else {
          actionsBefore.push({ position: posOrder[i], action: 'fold' });
        }
      }
      break;
    }
    case 'facing3Bet': {
      openerPosition = heroPos;
      const possibleThreeBettors = posOrder.slice(heroIdx + 1);
      if (possibleThreeBettors.length === 0) {
        return generatePreActions(heroPos, stacks, 'rfi', activePositions);
      }
      const threeBettor = pick(possibleThreeBettors);
      const openSize = Math.round(randFloat(2.0, 2.5) * 10) / 10;
      const threeBetSize = Math.round(randFloat(6.5, 8.5) * 10) / 10;
      pot += openSize + threeBetSize;
      
      for (let i = 0; i < heroIdx; i++) {
        actionsBefore.push({ position: posOrder[i], action: 'fold' });
      }
      actionsBefore.push({ position: heroPos, action: 'raise', amount: openSize, isHero: true });
      for (let i = heroIdx + 1; i < posOrder.indexOf(threeBettor); i++) {
        actionsBefore.push({ position: posOrder[i], action: 'fold' });
      }
      actionsBefore.push({ position: threeBettor, action: '3bet', amount: threeBetSize });
      openerPosition = threeBettor;
      break;
    }
    case 'facingAllin': {
      const possibleShovers = posOrder.slice(0, heroIdx);
      if (possibleShovers.length === 0 && heroPos !== 'BB') {
        return generatePreActions(heroPos, stacks, 'rfi', activePositions);
      }
      const shoverCandidates = possibleShovers.length > 0 ? possibleShovers : activePositions.filter(p => p !== heroPos);
      const shover = pick(shoverCandidates);
      shoverStack = stacks[shover];
      pot += shoverStack;
      
      for (let i = 0; i < heroIdx; i++) {
        if (posOrder[i] === shover) {
          actionsBefore.push({ position: posOrder[i], action: 'allin', amount: shoverStack });
        } else {
          actionsBefore.push({ position: posOrder[i], action: 'fold' });
        }
      }
      break;
    }
  }
  
  return { actionsBefore, openerPosition, shoverStack, pot: Math.round(pot * 10) / 10 };
}

// ===== SCENARIO DESCRIPTION =====
function getScenarioDescription(scenario) {
  const s = scenario;
  let desc = '';
  
  const chipBadge = (bb, cls) => `<span class="chip-badge ${cls || ''}">${formatBB(bb)}</span>`;
  
  switch (s.type) {
    case 'rfi': {
      const heroIdx = s.activePositions.indexOf(s.heroPosition);
      if (heroIdx === 0) {
        desc = `你是第一個行動的玩家。`;
      } else {
        const foldCount = s.actionsBefore.filter(a => a.action === 'fold').length;
        desc = foldCount > 0 ? `前面 ${foldCount} 人蓋牌到你。` : `前面全部蓋牌到你。`;
      }
      desc += `<br>你在 <strong>${s.heroPosition}</strong> 位，籌碼 <strong>${s.heroStack} BB</strong>`;
      const cat = getStackCategory(s.heroStack);
      if (cat === 'veryShort' || cat === 'desperate') {
        desc += '<br>⚡ <em>短碼推-蓋模式 (Push or Fold)</em>';
      }
      break;
    }
    case 'facingRaise': {
      const raiseAction = s.actionsBefore.find(a => a.action === 'raise');
      const raiseAmt = raiseAction ? Math.round(raiseAction.amount * 10) / 10 : 2.5;
      desc = `<strong>${s.openerPosition}</strong> (${s.stacks[s.openerPosition]}BB) 開池加注 ${chipBadge(raiseAmt)}`;
      const foldCount = s.actionsBefore.filter(a => a.action === 'fold' && !a.isHero).length;
      if (foldCount > 1) desc += `，其他人蓋牌`;
      desc += `<br>你在 <strong>${s.heroPosition}</strong> 位，籌碼 <strong>${s.heroStack} BB</strong>`;
      break;
    }
    case 'facing3Bet': {
      const heroOpen = s.actionsBefore.find(a => a.isHero);
      const threeBet = s.actionsBefore.find(a => a.action === '3bet');
      const openAmt = heroOpen ? Math.round(heroOpen.amount * 10) / 10 : 2.5;
      const tbAmt = threeBet ? Math.round(threeBet.amount * 10) / 10 : 7.5;
      const tbPos = threeBet ? threeBet.position : '?';
      desc = `你在 <strong>${s.heroPosition}</strong> 開池加注 ${chipBadge(openAmt)}`;
      desc += `<br><strong>${tbPos}</strong> (${s.stacks[tbPos]}BB) 3-bet 到 ${chipBadge(tbAmt, 'threebet-badge')}`;
      desc += `<br>你的籌碼 <strong>${s.heroStack} BB</strong>`;
      break;
    }
    case 'facingAllin': {
      const shoveAction = s.actionsBefore.find(a => a.action === 'allin');
      const shoverPos = shoveAction ? shoveAction.position : '?';
      desc = `<strong>${shoverPos}</strong> (${s.stacks[shoverPos]}BB) 全押 ${chipBadge(s.stacks[shoverPos], 'allin-badge')} ！`;
      const foldCount = s.actionsBefore.filter(a => a.action === 'fold').length;
      if (foldCount > 0) desc += ` 其他人蓋牌。`;
      desc += `<br>你在 <strong>${s.heroPosition}</strong> 位，籌碼 <strong>${s.heroStack} BB</strong>。底池 ${chipBadge(s.pot)}`;
      break;
    }
  }
  
  return desc;
}

// ===== UI RENDERING =====
function renderScenario(scenario) {
  state.answered = false;
  
  // Tournament info
  const infoEl = document.getElementById('tournament-info');
  const icmClass = `icm-${scenario.icmPressure}`;
  const icmLabels = {low:'低',medium:'中',high:'高',extreme:'極高'};
  infoEl.innerHTML = `
    <span class="info-tag"><span class="label">階段</span><span class="value">${scenario.stage.label}</span></span>
    <span class="info-tag ${icmClass}"><span class="label">ICM</span><span class="value">${icmLabels[scenario.icmPressure]}</span></span>
    <span class="info-tag"><span class="label">剩餘</span><span class="value">${scenario.playersLeft}人</span></span>
    <span class="info-tag"><span class="label">本桌</span><span class="value">${scenario.tablePlayers}人</span></span>
    <span class="info-tag"><span class="label">獎金</span><span class="value">${scenario.paidPlaces}名</span></span>
  `;
  
  // Table seats — show/hide based on active positions
  const activePos = scenario.activePositions;
  POSITIONS.forEach(pos => {
    const seatEl = document.getElementById(`seat-${pos.toLowerCase()}`);
    const isActive = activePos.includes(pos);
    
    // Hide inactive seats
    seatEl.style.display = isActive ? '' : 'none';
    if (!isActive) return;
    
    seatEl.classList.remove('is-hero');
    seatEl.querySelector('.seat-stack').textContent = `${scenario.stacks[pos]}BB`;
    const actionLabel = seatEl.querySelector('.seat-action-label');
    actionLabel.textContent = '';
    actionLabel.className = 'seat-action-label';
    
    if (pos === scenario.heroPosition) {
      seatEl.classList.add('is-hero');
    }
    
    const preAction = scenario.actionsBefore.find(a => a.position === pos && !a.isHero);
    if (preAction) {
      switch (preAction.action) {
        case 'fold':
          actionLabel.textContent = 'Fold';
          actionLabel.classList.add('fold');
          break;
        case 'raise':
          actionLabel.textContent = `⬆ ${formatBB(Math.round(preAction.amount * 10) / 10)}`;
          actionLabel.classList.add('raise');
          break;
        case '3bet':
          actionLabel.textContent = `3B ${formatBB(Math.round(preAction.amount * 10) / 10)}`;
          actionLabel.classList.add('raise');
          break;
        case 'allin':
          actionLabel.textContent = `ALL IN`;
          actionLabel.classList.add('allin');
          break;
      }
    }
  });
  
  // Pot
  document.getElementById('pot-display').textContent = `底池: ${formatBB(scenario.pot)}`;
  
  // Position indicator
  document.getElementById('position-indicator').innerHTML = 
    `你的位置: <strong>${scenario.heroPosition}</strong>`;
  
  // Scenario description
  document.getElementById('scenario-box').innerHTML = `
    <div class="scenario-label">📌 情境</div>
    <div class="scenario-text">${getScenarioDescription(scenario)}</div>
  `;
  
  // Cards
  renderCards(scenario.cards);
  
  // Hand notation
  document.getElementById('hand-notation').textContent = scenario.handNotation;
  
  // Action buttons with sizing
  renderActionButtons(scenario);
  
  // Hide result and next button
  document.getElementById('result-box').style.display = 'none';
  document.getElementById('next-hand-btn').style.display = 'none';
  
  // Enable/disable prev hand button
  document.getElementById('prev-hand-btn').disabled = state.history.length === 0;
}

function renderCards(cards) {
  const [c1, c2] = cards;
  const card1El = document.getElementById('card1');
  const card2El = document.getElementById('card2');
  
  card1El.className = `card ${isRedSuit(c1.suit) ? 'red' : 'black'}`;
  card1El.innerHTML = `<span class="card-rank">${c1.rank}</span><span class="card-suit">${SUIT_SYMBOLS[c1.suit]}</span>`;
  
  card2El.className = `card ${isRedSuit(c2.suit) ? 'red' : 'black'}`;
  card2El.innerHTML = `<span class="card-rank">${c2.rank}</span><span class="card-suit">${SUIT_SYMBOLS[c2.suit]}</span>`;
}

function renderActionButtons(scenario) {
  const available = scenario.availableActions;
  const allActions = ['fold', 'call', 'raise', 'allin'];
  
  allActions.forEach(action => {
    const btn = document.querySelector(`.action-btn[data-action="${action}"]`);
    if (!btn) return;
    const show = available.includes(action);
    btn.disabled = !show;
    btn.style.display = show ? '' : 'none';
  });
  
  // Show amounts on buttons
  const callAmountEl = document.getElementById('call-amount');
  const raiseAmountEl = document.getElementById('raise-amount');
  const allinAmountEl = document.getElementById('allin-amount');
  
  if (callAmountEl) {
    if (scenario.type === 'facingRaise' || scenario.type === 'facing3Bet' || scenario.type === 'facingAllin') {
      callAmountEl.textContent = formatBB(Math.round(scenario.callAmount * 10) / 10);
    } else {
      callAmountEl.textContent = '';
    }
  }
  
  if (raiseAmountEl) {
    if (available.includes('raise')) {
      const size = Math.round(scenario.suggestedRaiseSize * 10) / 10;
      raiseAmountEl.textContent = `→ ${formatBB(size)}`;
    } else {
      raiseAmountEl.textContent = '';
    }
  }
  
  if (allinAmountEl) {
    if (available.includes('allin')) {
      allinAmountEl.textContent = formatBB(scenario.heroStack);
    } else {
      allinAmountEl.textContent = '';
    }
  }
}

// ===== ANSWER HANDLING =====
function handleAction(action) {
  if (state.answered) return;
  state.answered = true;
  
  const scenario = state.currentScenario;
  const correct = scenario.correctAction;
  const isCorrect = action === correct;
  
  state.handNumber++;
  if (isCorrect) {
    state.correctCount++;
    state.streak++;
  } else {
    state.streak = 0;
  }
  
  // Save to history
  const historyEntry = {
    id: state.handNumber,
    scenario: { ...scenario },
    playerAction: action,
    correctAction: correct,
    isCorrect,
  };
  state.history.unshift(historyEntry);
  
  // Show result
  showResult(isCorrect, action, correct, scenario);
  updateStats();
  renderHistory();
  
  // Disable action buttons
  document.querySelectorAll('.action-btn').forEach(btn => btn.disabled = true);
  
  // Show next button
  document.getElementById('next-hand-btn').style.display = '';
  document.getElementById('prev-hand-btn').disabled = false;
  
  // Update history badge
  updateHistoryBadge();
}

function showResult(isCorrect, playerAction, correctAction, scenario) {
  const resultBox = document.getElementById('result-box');
  resultBox.style.display = '';
  
  const explanation = getExplanation(scenario, scenario.handNotation, correctAction, playerAction);
  
  if (isCorrect) {
    resultBox.className = 'result-box correct';
    resultBox.innerHTML = `
      <div class="result-title">✅ 正確！</div>
      <div class="result-detail">${explanation}</div>
    `;
  } else {
    resultBox.className = 'result-box incorrect';
    resultBox.innerHTML = `
      <div class="result-title">❌ 錯誤</div>
      <div class="result-detail">
        你選了 <strong>${getActionLabel(playerAction)}</strong>，最佳選擇是 <strong>${getActionLabel(correctAction)}</strong><br>
        ${explanation}
      </div>
    `;
  }
  
  // Scroll result into view on mobile
  setTimeout(() => resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function updateStats() {
  const accuracy = state.handNumber > 0 
    ? Math.round(state.correctCount / state.handNumber * 100) 
    : 0;
  document.getElementById('accuracy').textContent = `${accuracy}%`;
  document.getElementById('total-hands').textContent = state.handNumber;
  document.getElementById('streak').textContent = state.streak;
}

function updateHistoryBadge() {
  const badge = document.getElementById('history-badge');
  if (state.history.length > 0) {
    badge.style.display = '';
    badge.textContent = state.history.length;
  } else {
    badge.style.display = 'none';
  }
}

// ===== HISTORY =====
function renderHistory() {
  const listEl = document.getElementById('history-list');
  const statsEl = document.getElementById('history-stats');
  
  if (state.history.length === 0) {
    listEl.innerHTML = '<div class="history-empty">尚無紀錄，開始訓練吧！</div>';
    statsEl.innerHTML = '';
    return;
  }
  
  // Stats summary
  const accuracy = state.handNumber > 0 ? Math.round(state.correctCount / state.handNumber * 100) : 0;
  statsEl.innerHTML = `共 ${state.handNumber} 手 · 正確 ${state.correctCount} · 正確率 ${accuracy}% · 🔥 連續 ${state.streak}`;
  
  // Render ALL history entries (no limit)
  listEl.innerHTML = state.history.map(entry => {
    const result = entry.isCorrect ? '✅' : '❌';
    const cls = entry.isCorrect ? 'correct' : 'incorrect';
    const s = entry.scenario;
    const cards = s.cards.map(c => formatCard(c)).join(' ');
    
    // Show sizing info
    let sizingInfo = '';
    if (s.type === 'facingRaise') {
      const ra = s.actionsBefore.find(a => a.action === 'raise' && !a.isHero);
      if (ra) sizingInfo = `面對加注 ${formatBB(Math.round(ra.amount*10)/10)}`;
    } else if (s.type === 'facing3Bet') {
      const tb = s.actionsBefore.find(a => a.action === '3bet');
      if (tb) sizingInfo = `面對3-bet ${formatBB(Math.round(tb.amount*10)/10)}`;
    } else if (s.type === 'facingAllin') {
      sizingInfo = `面對全押 ${formatBB(s.shoverStack)}`;
    } else if (s.type === 'rfi') {
      sizingInfo = '開池';
    }
    
    return `
      <div class="history-item ${cls}" data-history-id="${entry.id}" onclick="showRangeForHistory(${entry.id})">
        <div class="hi-header">
          <span class="hi-hand">#${entry.id} ${cards} (${s.handNotation})</span>
          <span class="hi-result">${result}</span>
        </div>
        <div class="hi-detail">${s.heroPosition} · ${s.heroStack}BB · ${s.stage.label}</div>
        <div class="hi-sizing">${sizingInfo}</div>
        <div class="hi-actions">
          <span class="your-action">你: ${getActionLabel(entry.playerAction)}</span>
          <span class="correct-action">正確: ${getActionLabel(entry.correctAction)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function toggleHistory() {
  const overlay = document.getElementById('history-overlay');
  if (overlay.style.display === 'none') {
    overlay.style.display = '';
    renderHistory();
  } else {
    overlay.style.display = 'none';
  }
}

// ===== RANGE CHART MODAL =====
function showRangeChart(scenario, highlightHand) {
  // Close history drawer first
  document.getElementById('history-overlay').style.display = 'none';
  
  const modal = document.getElementById('range-modal');
  const chart = document.getElementById('range-chart');
  const modalScenario = document.getElementById('modal-scenario');
  const modalTitle = document.getElementById('modal-title');
  
  modalTitle.textContent = `GTO 範圍表 — ${scenario.heroPosition}`;
  
  let scenarioDesc = getScenarioDescription(scenario);
  if (highlightHand) {
    scenarioDesc += `<br>🃏 你的手牌: <strong>${highlightHand}</strong> → ${getActionLabel(scenario.correctAction || getCorrectAction(highlightHand, scenario))}`;
  }
  modalScenario.innerHTML = scenarioDesc;
  
  const grid = getRangeChart(scenario);
  const highlightGrid = highlightHand ? handToGrid(highlightHand) : null;
  
  chart.innerHTML = '';
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const cell = grid[r][c];
      const div = document.createElement('div');
      div.className = `range-cell action-${cell.action}`;
      div.textContent = cell.hand;
      div.title = `${cell.hand}: ${getActionLabel(cell.action)}`;
      
      if (highlightGrid && highlightGrid.row === r && highlightGrid.col === c) {
        div.classList.add('is-hero-hand');
      }
      
      chart.appendChild(div);
    }
  }
  
  modal.style.display = 'flex';
}

function hideRangeChart() {
  document.getElementById('range-modal').style.display = 'none';
}

function showRangeForHistory(historyId) {
  const entry = state.history.find(e => e.id === historyId);
  if (entry) {
    showRangeChart(entry.scenario, entry.scenario.handNotation);
  }
}

function showPreviousHandRange() {
  if (state.history.length > 0) {
    const last = state.history[0];
    showRangeChart(last.scenario, last.scenario.handNotation);
  }
}

// ===== NEXT HAND =====
function nextHand() {
  state.currentScenario = generateScenario();
  renderScenario(state.currentScenario);
  // Scroll to top on mobile
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
  // Action buttons
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (!btn.disabled) handleAction(action);
    });
  });
  
  // Next hand
  document.getElementById('next-hand-btn').addEventListener('click', nextHand);
  
  // Previous hand range
  document.getElementById('prev-hand-btn').addEventListener('click', showPreviousHandRange);
  
  // History toggle
  document.getElementById('history-toggle').addEventListener('click', toggleHistory);
  document.getElementById('history-close').addEventListener('click', () => {
    document.getElementById('history-overlay').style.display = 'none';
  });
  document.getElementById('history-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('history-overlay').style.display = 'none';
    }
  });
  
  // Modal close
  document.getElementById('modal-close').addEventListener('click', hideRangeChart);
  document.getElementById('range-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideRangeChart();
  });
  
  // Keyboard shortcuts (useful on desktop/iPad with keyboard)
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('range-modal').style.display !== 'none') {
      if (e.key === 'Escape') hideRangeChart();
      return;
    }
    if (document.getElementById('history-overlay').style.display !== 'none') {
      if (e.key === 'Escape') document.getElementById('history-overlay').style.display = 'none';
      return;
    }
    
    if (!state.answered) {
      const keyMap = { '1': 'fold', '2': 'call', '3': 'raise', '4': 'allin', 'f': 'fold', 'c': 'call', 'r': 'raise', 'a': 'allin' };
      const action = keyMap[e.key.toLowerCase()];
      if (action && state.currentScenario?.availableActions.includes(action)) {
        handleAction(action);
      }
    } else {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'n') {
        e.preventDefault();
        nextHand();
      }
      if (e.key === 'p' || e.key === 'v') {
        showPreviousHandRange();
      }
    }
  });
  
  // Register service worker (for PWA offline support)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  
  // Start first hand
  nextHand();
});
