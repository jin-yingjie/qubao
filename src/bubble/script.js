// src/bubble/script.js - 独立对话气泡组件逻辑
// 渲染端职责：
//   1) 监听 bubble:show 事件 → 填入文字 → 测量渲染后实际尺寸 → 通知主进程 setBounds
//   2) 监听 bubble:hide 事件 → 播放退场动画 → 通知主进程 hide
const bubbleRoot = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
let hideTimer = null;

/** 测量当前文字渲染后的真实像素尺寸（内容区域 + padding + 尾巴）*/
function measureContent() {
  // 强制浏览器完成一次 reflow，拿到真实尺寸
  const body = bubbleRoot.querySelector('.bubble-body');
  const rootPadTop    = 2;   // 匹配 CSS padding: 2px 4px 0 4px
  const rootPadLR     = 4;
  const tailH         = 8;   // border-top:8px
  // body.getBoundingClientRect() 包含 padding（box-sizing: border-box）
  const bodyRect  = body.getBoundingClientRect();
  // 最终窗口大小：宽度+左右余量，高度=顶部余量+主体高度+尾巴+最小底部余量
  const winW = Math.ceil(bodyRect.width  + rootPadLR * 2 + 4); // +4 阴影余量
  const winH = Math.ceil(rootPadTop + bodyRect.height + tailH + 2); // +2 极小余量
  return { w: winW, h: winH };
}

/** 显示气泡（被 IPC 调用）*/
function showBubble(text, durationMs) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  bubbleText.textContent = text || '';
  bubbleRoot.classList.remove('show');
  // 下一帧再 set show → 确保重绘后能触发动画，并在测量前先填入文字
  requestAnimationFrame(() => {
    const size = measureContent();
    try { petAPI.bubbleReportSize(size.w, size.h); } catch (_) {}
    bubbleRoot.classList.add('show');
  });
  // duration <=0 表示常驻，不自动隐藏
  if (typeof durationMs === 'number' && durationMs > 0) {
    hideTimer = setTimeout(() => hideBubble(), durationMs);
  }
}

/** 隐藏气泡（播放退场动画 220ms 后通知主进程真正 hide）*/
function hideBubble() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  bubbleRoot.classList.remove('show');
  setTimeout(() => {
    try { petAPI.bubbleHidden(); } catch (_) {}
  }, 230);
}

// 订阅主进程事件
try {
  petAPI.onBubbleShow((payload) => {
    showBubble(payload && payload.text, payload && payload.duration);
  });
  petAPI.onBubbleHide(() => hideBubble());
} catch (e) { console.error('[bubble] 注册监听失败', e); }
