// ============================================================
// preload.js - 安全桥接层
// ============================================================
// 这个文件是 Electron 的安全机制。
// 渲染进程（网页）不能直接访问 Node.js API，必须通过这里定义的接口。
// 我们在这里暴露有限的 API 给前端代码使用。
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
let PET_IMAGES = { cat: '', dog: '', bao: '' };
try {
  PET_IMAGES = require(path.resolve(__dirname, 'src', 'assets-base64.js'));
} catch (e) {
  console.error('[preload] 加载 assets-base64.js 失败:', e.message);
}

contextBridge.exposeInMainWorld('petAPI', {
  // ------- 桌宠相关 -------
  // 获取内嵌的 base64 宠物图片（不依赖文件系统，即使 PNG 被删也能显示）
  getPetImages: () => PET_IMAGES,

  // 桌宠被点击了，告诉主进程打开菜单
  clickPet: (mouseX, mouseY) => {
    ipcRenderer.send('pet:clicked', { mouseX, mouseY });
  },

  // ------- // ------- 菜单相关 -------
  menuAction: (action) => {
    ipcRenderer.send('menu:action', action);
  },
  closeMenu: () => {
    ipcRenderer.send('menu:close');
  },

  // ------- 配置相关 -------
  // 更新配置
  updateConfig: (config) => {
    ipcRenderer.send('config:update', config);
  },
  // 获取配置（异步）
  getConfig: () => ipcRenderer.invoke('config:get'),
  // 监听配置初始化消息
  onConfigInit: (callback) => {
    ipcRenderer.on('config:init', (_event, config) => callback(config));
  },
  // 监听配置更新消息
  onConfigUpdated: (callback) => {
    ipcRenderer.on('config:updated', (_event, config) => callback(config));
  },

  // ------- 窗口操作 -------
  // 拖动窗口（用于便签/设置等无边框窗口）
  dragWindow: (dx, dy) => {
    ipcRenderer.send('window:drag', { dx, dy });
  },
  // 拖动三件套：主进程统一用屏幕坐标计算，避免 DPI 单位混用
  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove: () => ipcRenderer.send('drag:move'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  // 关闭当前窗口
  closeWindow: () => {
    ipcRenderer.send('window:close');
  },
  // 最小化当前窗口
  minimizeWindow: () => {
    ipcRenderer.send('window:minimize');
  },

  // ------- 便签相关 -------
  onNoteInit: (callback) => {
    ipcRenderer.on('note:init', (_event, data) => callback(data));
  },
  updateNote: (id, content) => {
    ipcRenderer.send('note:update', { id, content });
  },
  deleteNote: (id) => {
    ipcRenderer.send('note:delete', id);
  },

  // ------- 便签列表相关 -------
  onNotesList: (callback) => {
    ipcRenderer.on('notes:list', (_event, list) => callback(list));
  },
  requestNotesList: () => {
    ipcRenderer.send('notes:request-list');
  },
  openNote: (id) => {
    ipcRenderer.send('notes:open', id);
  },
  deleteNoteFromList: (id) => {
    ipcRenderer.send('notes:delete', id);
  },

  // ------- 宠物状态系统 -------
  // 获取当前状态
  getState: () => ipcRenderer.invoke('state:get'),
  // 监听状态初始化
  onStateInit: (callback) => {
    ipcRenderer.on('state:init', (_event, state) => callback(state));
  },
  // 监听状态更新
  onStateUpdated: (callback) => {
    ipcRenderer.on('state:updated', (_event, state) => callback(state));
  },
  // 互动动作（喂食/洗澡/玩耍/睡觉/看病）
  interact: (action) => {
    ipcRenderer.send('pet:interact', action);
  },
  // 监听动作动画指令
  onAction: (callback) => {
    ipcRenderer.on('pet:action', (_event, action) => callback(action));
  },
  // 监听升级
  onLevelUp: (callback) => {
    ipcRenderer.on('pet:levelup', (_event, level) => callback(level));
  },
  // 监听贴边事件
  onSnapEdge: (callback) => {
    ipcRenderer.on('pet:snap-edge', (_event, isSnapped) => callback(isSnapped));
  },

  // ------- 教程相关 -------
  finishTutorial: () => {
    ipcRenderer.send('tutorial:finish');
  },

  // ------- 开机启动相关 -------
  getAutoStart: () => ipcRenderer.invoke('autostart:get'),
  setAutoStart: (enable) => {
    ipcRenderer.send('autostart:set', enable);
  },

  // ------- 小程序绑定相关 -------
  getBindStatus: () => ipcRenderer.invoke('bind:status'),
  bindWithCode: (code) => ipcRenderer.invoke('bind:withCode', code),
  syncPetData: () => ipcRenderer.invoke('bind:sync'),
  unbind: () => ipcRenderer.send('bind:unbind'),
  getInventory: () => ipcRenderer.invoke('inventory:get'),
  interactRemote: (action, itemId) => ipcRenderer.invoke('bind:interact', { action, itemId }),

  // ------- 番茄钟（主进程计时，最小化后任务栏仍能显示倒计时）-------
  pomodoroStart: (totalSeconds) => ipcRenderer.invoke('pomodoro:start', totalSeconds),
  pomodoroPause: () => ipcRenderer.invoke('pomodoro:pause'),
  pomodoroResume: () => ipcRenderer.invoke('pomodoro:resume'),
  pomodoroReset: (totalSeconds) => ipcRenderer.invoke('pomodoro:reset', totalSeconds),
  pomodoroGetState: () => ipcRenderer.invoke('pomodoro:getState'),
  pomodoroOnTick: (callback) => {
    ipcRenderer.on('pomodoro:tick', (_e, state) => callback(state));
  },
  pomodoroOnFinished: (callback) => {
    ipcRenderer.on('pomodoro:finished', () => callback());
  },

  // ------- 检查更新 -------
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  getVersion: () => ipcRenderer.invoke('app:getVersion')
});
