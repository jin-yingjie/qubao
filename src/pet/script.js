// ============================================================
// src/pet/script.js - 桌宠交互逻辑
// ============================================================
// 负责：
//   1. 处理鼠标点击 → 告诉主进程打开菜单
//   2. 处理配置更新（切换角色、大小、工作模式）
//   3. 随机小行为（心情变化）
//   4. 情绪系统（心情随时间变化，互动可提升）
// ============================================================

let currentConfig = null;
let currentCharacter = 'cat';
let petState = { level: 1, exp: 0, expMax: 100, hunger: 80, clean: 80, mood: 80, energy: 80, health: 100 };
let lastInteractionTime = Date.now();

// DOM 引用（DOM 就绪后由 initDomRefs 填充）
let petContainer, moodBubble, actionFx, levelupFx, petCustomImg;

// 拖拽状态
let isDragging = false;
let mouseDownPos = null;

// 动作定时器
let actionTimer = null;
let moodBubbleTimer = null;

// 贴边状态
let isSnappedToEdge = false;

// ------- 注入内嵌 base64 图片（不依赖文件系统，即使 PNG 被删也能显示） -------
function injectPetImages() {
  const imgCat = document.getElementById('pet-cat');
  const imgDog = document.getElementById('pet-dog');
  const imgBao = document.getElementById('pet-dumpling');

  function fallbackToFiles() {
    if (imgCat && !imgCat.src) imgCat.src = '../../assets/cat.png';
    if (imgDog && !imgDog.src) imgDog.src = '../../assets/dog.png';
    if (imgBao && !imgBao.src) imgBao.src = '../../assets/bao.png';
  }

  try {
    if (!window.petAPI || typeof window.petAPI.getPetImages !== 'function') {
      console.warn('[pet] petAPI.getPetImages 未就绪，使用文件路径兜底');
      fallbackToFiles();
      return;
    }
    const images = window.petAPI.getPetImages();
    if (images && typeof images === 'object') {
      if (imgCat && images.cat) imgCat.src = images.cat;
      if (imgDog && images.dog) imgDog.src = images.dog;
      if (imgBao && images.bao) imgBao.src = images.bao;
      console.log('[pet] base64 图片注入成功');
    } else {
      fallbackToFiles();
    }
  } catch (e) {
    console.error('[pet] 注入 base64 图片失败，回退到文件路径:', e);
    fallbackToFiles();
  }
}

function initDomRefs() {
  petContainer = document.getElementById('pet-container');
  moodBubble = document.getElementById('mood-bubble');
  actionFx = document.getElementById('action-fx');
  levelupFx = document.getElementById('levelup-fx');
  petCustomImg = document.getElementById('pet-custom');
}

// ------- 应用配置到界面 -------
function applyConfig(config) {
  const char = config.pet?.character || 'cat';
  if (char === 'custom' && config.pet?.customImage) {
    if (petCustomImg) petCustomImg.src = config.pet.customImage;
  }
  switchCharacter(char);
}

// ------- 切换角色 -------
function switchCharacter(charName) {
  if (charName === currentCharacter) return;
  document.querySelectorAll('.pet-img').forEach(img => img.classList.remove('active'));
  if (charName === 'custom') {
    if (petCustomImg) petCustomImg.classList.add('active');
  } else {
    const target = document.getElementById('pet-' + charName);
    if (target) target.classList.add('active');
  }
  currentCharacter = charName;
}

// ------- 获取当前活动的宠物元素 -------
function getActivePet() {
  if (currentCharacter === 'custom') return petCustomImg;
  return document.querySelector('.pet-img.active:not(#pet-custom)');
}

// ------- 心情系统 -------
function boostMood(amount) {
  petState.mood = Math.min(100, (petState.mood || 80) + amount);
  lastInteractionTime = Date.now();
  updateMoodVisual();
}

function updateMoodVisual() {
  const activePet = getActivePet();
  if (!activePet) return;
  const mood = petState.mood || 80;
  activePet.classList.remove('sad', 'joyful');
  if (mood < 20) {
    activePet.classList.add('sad');
  } else if (mood > 85) {
    activePet.classList.add('joyful');
  }
}

// ------- 动作动画（吃饭/洗澡/睡觉/玩耍） -------
const actionConfig = {
  feed:   { cls: 'action-feed',   fx: '🍚', bubble: '😋' },
  bathe:  { cls: 'action-bathe',  fx: '🛁', bubble: '🫧' },
  sleep:  { cls: 'action-sleep',  fx: '💤', bubble: '😴' },
  play:   { cls: 'action-play',   fx: '🎾', bubble: '🥳' },
  cure:   { cls: 'action-bathe',  fx: '💊', bubble: '🤒' },
  'no-item': { cls: '', fx: '🛒', bubble: '去小程序购买物品' }
};

function playAction(action) {
  const cfg = actionConfig[action];
  if (!cfg) return;
  const activePet = getActivePet();
  if (!activePet) return;

  clearAction();
  activePet.classList.add(cfg.cls);
  actionFx.textContent = cfg.fx;
  actionFx.classList.remove('show');
  void actionFx.offsetWidth;
  actionFx.classList.add('show');
  showMoodBubble(cfg.bubble, 1800);

  if (action !== 'sleep') {
    actionTimer = setTimeout(clearAction, 2500);
  }
}

function clearAction() {
  if (actionTimer) { clearTimeout(actionTimer); actionTimer = null; }
  const activePet = getActivePet();
  if (activePet) {
    activePet.classList.remove('action-feed', 'action-bathe', 'action-sleep', 'action-play');
  }
  if (actionFx) actionFx.classList.remove('show');
}

// ------- 心情气泡 -------
function showMoodBubble(emoji, duration = 2000) {
  if (!moodBubble) return;
  moodBubble.textContent = emoji;
  moodBubble.classList.add('show');

  const activePet = getActivePet();
  if (activePet && emoji === '💕') {
    activePet.classList.remove('happy');
    void activePet.offsetWidth;
    activePet.classList.add('happy');
  }

  if (moodBubbleTimer) clearTimeout(moodBubbleTimer);
  moodBubbleTimer = setTimeout(() => {
    moodBubble.classList.remove('show');
  }, duration);
}

// ------- 随机冒气泡 -------
function scheduleNextBubble() {
  const delay = 5000 + Math.random() * 10000;
  setTimeout(() => {
    const bubbles = ['✨', '💤', '🌸', '🎵', '💭'];
    const pick = bubbles[Math.floor(Math.random() * bubbles.length)];
    const mood = petState.mood || 80;
    if (mood < 30) {
      showMoodBubble('😢', 3000);
    } else if (mood > 80) {
      showMoodBubble('🌟', 2500);
    } else {
      showMoodBubble(pick, 2000);
    }
    scheduleNextBubble();
  }, delay);
}

// ------- 随机闲逛动作 -------
function scheduleIdleAction() {
  const delay = 15000 + Math.random() * 20000;
  setTimeout(() => {
    const activePet = getActivePet();
    if (activePet && !activePet.classList.contains('action-feed') &&
        !activePet.classList.contains('action-bathe') &&
        !activePet.classList.contains('action-sleep') &&
        !activePet.classList.contains('action-play')) {
      activePet.classList.add('stretch');
      setTimeout(() => activePet.classList.remove('stretch'), 1500);
      showMoodBubble('🥱', 1500);
    }
    if (!isSnappedToEdge) scheduleIdleAction();
  }, delay);
}

// ------- 初始化所有事件监听器（DOM 和 preload 都就绪后调用） -------
function initAllEventListeners() {
  if (!petContainer || !window.petAPI) {
    console.warn('[pet] DOM 或 petAPI 未就绪，100ms 后重试');
    setTimeout(initAllEventListeners, 100);
    return;
  }
  console.log('[pet] 初始化事件监听器');

  // ------- 配置同步 -------
  try {
    petAPI.onConfigInit((config) => {
      currentConfig = config;
      applyConfig(config);
    });
    petAPI.onConfigUpdated((config) => {
      currentConfig = config;
      applyConfig(config);
    });
  } catch (e) { console.error('[pet] 配置监听注册失败:', e); }

  // ------- 状态同步 -------
  try {
    petAPI.onStateInit((state) => {
      petState = state;
      updateMoodVisual();
    });
    petAPI.onStateUpdated((state) => {
      petState = state;
      updateMoodVisual();
    });
  } catch (e) { console.error('[pet] 状态监听注册失败:', e); }

  // ------- 贴边检测 -------
  try {
    petAPI.onSnapEdge((isSnapped) => {
      isSnappedToEdge = isSnapped;
      if (isSnapped) {
        const activePet = getActivePet();
        if (activePet) activePet.classList.remove('action-play', 'stretch');
        if (actionTimer) { clearTimeout(actionTimer); actionTimer = null; }
        if (actionFx) actionFx.classList.remove('show');
      }
    });
  } catch (e) { console.error('[pet] 贴边监听注册失败:', e); }

  // ------- 动作同步 -------
  try {
    petAPI.onAction((action) => playAction(action));
  } catch (e) { console.error('[pet] 动作监听注册失败:', e); }

  // ------- 升级特效 -------
  try {
    petAPI.onLevelUp((level) => {
      if (!levelupFx) return;
      levelupFx.classList.remove('show');
      void levelupFx.offsetWidth;
      levelupFx.classList.add('show');
      showMoodBubble(`🎉Lv.${level}`, 2500);
      setTimeout(() => levelupFx.classList.remove('show'), 2000);
    });
  } catch (e) { console.error('[pet] 升级监听注册失败:', e); }

  // ------- 鼠标拖拽 + 点击喂养 -------
  petContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    mouseDownPos = { x: e.screenX, y: e.screenY };
    isDragging = false;
    try { petAPI.dragStart(); } catch (_) {}
  });

  document.addEventListener('mousemove', (e) => {
    if (!mouseDownPos) return;
    const dx = e.screenX - mouseDownPos.x;
    const dy = e.screenY - mouseDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 8 && !isDragging) {
      isDragging = true;
      petContainer.classList.add('dragging');
    }
    if (isDragging) {
      try { petAPI.dragMove(); } catch (_) {}
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (!isDragging && mouseDownPos) {
      // 左键点击 = 喂养互动
      petContainer.classList.add('clicked');
      setTimeout(() => petContainer.classList.remove('clicked'), 200);
      try { petAPI.interact('feed'); } catch (err) {
        // 兜底：本地提升心情
        boostMood(5);
        showMoodBubble('💕');
      }
    }
    petContainer.classList.remove('dragging');
    mouseDownPos = null;
    isDragging = false;
    try { petAPI.dragEnd(); } catch (_) {}
  });

  // ------- 右键点击桌宠 → 弹出功能菜单 -------
  petContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    try { petAPI.clickPet(e.screenX, e.screenY); } catch (_) {}
  });

  // ------- 启动定时任务 -------
  scheduleNextBubble();
  scheduleIdleAction();
}

// ------- 启动入口 -------
function boot() {
  initDomRefs();
  injectPetImages();
  initAllEventListeners();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
