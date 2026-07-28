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

function fmt(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
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
  // 同步模式按钮高亮（根据 totalSeconds）
  document.querySelectorAll('.mode-btn').forEach(b => {
    const mins = parseInt(b.dataset.mins) * 60;
    if (mins === totalSeconds) b.classList.add('active');
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
// 订阅主进程的"计时结束"事件
petAPI.pomodoroOnFinished(() => {
  try {
    alert('🎉 时间到！休息一下吧～');
  } catch (e) {}
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
  btn.addEventListener('click', async () => {
    const mins = parseInt(btn.dataset.mins);
    const newTotal = mins * 60;
    totalSeconds = newTotal;
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

closeBtn.addEventListener('click', () => petAPI.closeWindow());
