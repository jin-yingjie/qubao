// src/pomodoro/script.js - 番茄钟 UI 层
// （真正的计时在主进程，窗口关闭也能继续推进。这里只做渲染。）

let totalSeconds = 25 * 60;   // 当前模式总秒数
let remaining = totalSeconds; // 剩余秒数
let running = false;          // 是否运行中（主进程视角）
// "本地模式"按钮显示：开始 / 暂停 / 继续
// 只要 remaining < totalSeconds && !running 且 remaining > 0 => 显示"继续"
// running => "暂停"
// 其他 => "开始"

const displayEl = document.getElementById('timer');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const closeBtn = document.getElementById('closeBtn');
const minimizeBtn = document.getElementById('minimizeBtn');

function fmt(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m}:${s}`;
  }
  return `${m}:${s}`;
}
function updateDisplay() {
  displayEl.textContent = fmt(remaining);
}
function updateBtn() {
  if (running) {
    startBtn.textContent = '暂停';
    startBtn.classList.add('running');
  } else if (remaining < totalSeconds && remaining > 0) {
    startBtn.textContent = '继续';
    startBtn.classList.remove('running');
  } else {
    startBtn.textContent = '开始';
    startBtn.classList.remove('running');
  }
}
function applyState(state) {
  if (!state) return;
  if (typeof state.totalSeconds === 'number') totalSeconds = state.totalSeconds;
  if (typeof state.remaining === 'number') remaining = state.remaining;
  if (typeof state.running === 'boolean') running = state.running;
  updateDisplay();
  updateBtn();
  // 同步模式按钮高亮（根据 totalSeconds，自定义时间不匹配任何预设则高亮"自定义"）
  document.querySelectorAll('.mode-btn').forEach(b => {
    const mins = parseInt(b.dataset.mins);
    if (!isNaN(mins) && mins * 60 === totalSeconds) b.classList.add('active');
    else b.classList.remove('active');
  });
}

// 启动时先拉主进程当前状态（可能已经在计时）
(async function init() {
  try {
    const st = await petAPI.pomodoroGetState();
    applyState(st);
  } catch (e) {
    updateDisplay();
    updateBtn();
  }
})();

// 订阅主进程每秒的 tick
petAPI.pomodoroOnTick((state) => {
  applyState(state);
});
// 订阅主进程的"计时结束"事件（提示由宠物对话框显示，不再用 alert）
petAPI.pomodoroOnFinished(() => {
  // 结束后重置按钮到"开始"状态（双重保险，主进程的 broadcast 也会推一次）
  running = false;
  remaining = 0;
  updateDisplay();
  updateBtn();
});

// 开始 / 暂停 / 继续
startBtn.addEventListener('click', async () => {
  try {
    let st;
    if (running) {
      st = await petAPI.pomodoroPause();
    } else if (remaining < totalSeconds && remaining > 0) {
      st = await petAPI.pomodoroResume();
    } else {
      st = await petAPI.pomodoroStart(totalSeconds);
    }
    applyState(st);
  } catch (e) {
    console.error('番茄钟操作失败', e);
  }
});

// 重置
resetBtn.addEventListener('click', async () => {
  try {
    const st = await petAPI.pomodoroReset(totalSeconds);
    applyState(st);
  } catch (e) {
    console.error('番茄钟重置失败', e);
  }
});

// 模式切换（未运行时直接改总秒数并 reset；运行中则提示用户先暂停或保持模式切换立即生效）
document.querySelectorAll('.mode-btn').forEach(btn => {
  // 跳过自定义按钮，它有独立的点击逻辑
  if (btn.id === 'customBtn') return;
  btn.addEventListener('click', async () => {
    const mins = parseInt(btn.dataset.mins);
    const newTotal = mins * 60;
    totalSeconds = newTotal;
    // 关闭自定义面板（如果开着）
    customPanel.classList.remove('show');
    try {
      const st = await petAPI.pomodoroReset(newTotal);
      applyState(st);
    } catch (e) {
      // 失败时本地兜底
      remaining = newTotal;
      running = false;
      applyState({ totalSeconds: newTotal, remaining: newTotal, running: false });
    }
  });
});

// ------- 自定义倒计时 -------
const customBtn = document.getElementById('customBtn');
const customPanel = document.getElementById('customPanel');
const customHours = document.getElementById('customHours');
const customMins = document.getElementById('customMins');
const customSecs = document.getElementById('customSecs');
const customOk = document.getElementById('customOk');
const customCancel = document.getElementById('customCancel');

// 输入框 clamp：小时 0-23，分秒 0-59
function clampInput(input, max) {
  let v = parseInt(input.value);
  if (isNaN(v) || v < 0) v = 0;
  if (v > max) v = max;
  input.value = v;
}

// 上下按钮循环调整
function spinInput(input, dir, max) {
  let v = parseInt(input.value);
  if (isNaN(v)) v = 0;
  v += dir;
  if (v > max) v = 0;   // 超过最大值循环到 0
  if (v < 0) v = max;   // 小于 0 循环到最大值
  input.value = v;
}

customBtn.addEventListener('click', () => {
  // 切换面板显示/隐藏
  if (customPanel.classList.contains('show')) {
    customPanel.classList.remove('show');
  } else {
    // 打开时预填当前 totalSeconds（拆成时分秒）
    const curH = Math.floor(totalSeconds / 3600);
    const curM = Math.floor((totalSeconds % 3600) / 60);
    const curS = totalSeconds % 60;
    customHours.value = curH;
    customMins.value = curM;
    customSecs.value = curS;
    customPanel.classList.add('show');
    customHours.focus();
    customHours.select();
  }
});

customCancel.addEventListener('click', () => {
  customPanel.classList.remove('show');
});

// 输入时实时 clamp
customHours.addEventListener('input', () => clampInput(customHours, 23));
customMins.addEventListener('input', () => clampInput(customMins, 59));
customSecs.addEventListener('input', () => clampInput(customSecs, 59));

// 上下按钮点击
document.querySelectorAll('.spinner-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const dir = parseInt(btn.dataset.dir);
    const input = document.getElementById(targetId);
    const max = targetId === 'customHours' ? 23 : 59;
    spinInput(input, dir, max);
  });
});

customOk.addEventListener('click', async () => {
  let h = parseInt(customHours.value);
  let m = parseInt(customMins.value);
  let s = parseInt(customSecs.value);
  if (isNaN(h) || h < 0) h = 0;
  if (isNaN(m) || m < 0) m = 0;
  if (isNaN(s) || s < 0) s = 0;
  if (h > 23) h = 23;
  if (m > 59) m = 59;
  if (s > 59) s = 59;
  const newTotal = h * 3600 + m * 60 + s;
  if (newTotal <= 0) {
    // 至少1秒
    s = 1;
    customSecs.value = 1;
    return;
  }
  // 把用户输入写回（避免夹取后用户看到不一致）
  customHours.value = h;
  customMins.value = m;
  customSecs.value = s;
  totalSeconds = newTotal;
  customPanel.classList.remove('show');
  // 清掉其他模式按钮高亮，点亮自定义
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  customBtn.classList.add('active');
  try {
    const st = await petAPI.pomodoroReset(newTotal);
    applyState(st);
    // applyState 会按 totalSeconds 匹配预设按钮，自定义时间匹配不上会全部取消高亮，这里补回自定义高亮
    customBtn.classList.add('active');
  } catch (e) {
    remaining = newTotal;
    running = false;
    updateDisplay();
    updateBtn();
  }
});

// 回车确认
customHours.addEventListener('keydown', (e) => { if (e.key === 'Enter') customOk.click(); });
customMins.addEventListener('keydown', (e) => { if (e.key === 'Enter') customOk.click(); });
customSecs.addEventListener('keydown', (e) => { if (e.key === 'Enter') customOk.click(); });

closeBtn.addEventListener('click', () => petAPI.closeWindow());

// 最小化到任务栏
minimizeBtn.addEventListener('click', () => {
  try { petAPI.minimizeWindow(); } catch (e) {}
});
