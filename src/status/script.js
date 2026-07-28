// src/status/script.js
// 宠物状态面板逻辑

// 更新面板显示
function renderState(state) {
  // 等级与经验
  document.getElementById('level').textContent = state.level;
  const expPct = (state.exp / state.expMax) * 100;
  document.getElementById('exp-fill').style.width = expPct + '%';
  document.getElementById('exp-text').textContent = `${Math.round(state.exp)} / ${state.expMax}`;

  // 五项状态条
  const stats = ['hunger', 'clean', 'mood', 'energy', 'health'];
  stats.forEach(key => {
    const val = Math.round(state[key] || 0);
    document.getElementById('bar-' + key).style.width = val + '%';
    document.getElementById('val-' + key).textContent = val;
  });
}

// 接收初始状态
petAPI.onStateInit((state) => renderState(state));

// 接收状态更新
petAPI.onStateUpdated((state) => renderState(state));

// 互动按钮
document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.getAttribute('data-action');
    petAPI.interact(action);
    // 按钮反馈
    btn.style.transform = 'scale(0.92)';
    setTimeout(() => btn.style.transform = '', 150);
  });
});

// 关闭按钮：必须走 IPC 通知主进程，Electron 中 window.close() 对非用户触发窗口无效
document.getElementById('close-btn').addEventListener('click', () => {
  try {
    petAPI.closeWindow();
  } catch (e) {
    // 兜底
    window.close();
  }
});

// ------- 登录/绑定相关 -------
const loginBtn = document.getElementById('login-btn');
const cardTitle = document.getElementById('card-title');

async function refreshTitle() {
  try {
    const status = await petAPI.getBindStatus();
    if (status.success && status.bound && status.user && status.user.nickName) {
      cardTitle.textContent = status.user.nickName + '的趣宝桌宠';
      loginBtn.style.display = 'none';
    } else {
      cardTitle.textContent = '趣宝桌宠';
      loginBtn.style.display = 'inline-block';
    }
  } catch (e) {
    cardTitle.textContent = '趣宝桌宠';
    loginBtn.style.display = 'inline-block';
  }
}

loginBtn.addEventListener('click', () => {
  petAPI.menuAction('bind');
});

// 初始化时查询绑定状态
refreshTitle();