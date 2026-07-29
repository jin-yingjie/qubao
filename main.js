// ============================================================
// main.js - Electron 主进程
// ============================================================
// 这个文件负责：
//   1. 创建桌宠窗口（透明、无边框、永远置顶）
//   2. 创建系统托盘图标和菜单
//   3. 管理其他功能窗口（便签、番茄钟、设置）
//   4. 处理窗口之间的通信
// ============================================================

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const PET_IMAGES = require('./src/assets-base64.js');

// 当前版本（来自 package.json，自动更新检测的唯一真源）
const APP_VERSION = require('./package.json').version || '0.0.0';
// GitHub 仓库坐标（用于检查 Releases 最新版本）
const GITHUB_OWNER = 'jin-yingjie';
const GITHUB_REPO = 'qubao';

// ------- 全局变量 -------
let petWindow = null;       // 桌宠主窗口
let tray = null;            // 系统托盘
let menuWindow = null;      // 点击桌宠弹出的菜单
let settingsWindow = null;  // 设置面板
let noteWindows = [];       // 便签窗口（可以有多个）
let pomodoroWindow = null;  // 番茄钟窗口
let statusWindow = null;    // 状态面板窗口
let tutorialWindow = null;  // 新手教程窗口
let bindWindow = null;        // 绑定小程序窗口
let isDragging = false;     // 拖动中标志，用于跳过 moved 事件的高频干扰
let dragState = null;       // 拖动状态（窗口起点+鼠标起点）

// 用户配置（保存在本地）
const userConfigPath = path.join(app.getPath('userData'), 'config.json');
const notesPath = path.join(app.getPath('userData'), 'notes.json');
let config = loadConfig();
let notesData = loadNotes();

// ------- 确保宠物图片文件存在（防止用户删除） -------
function ensurePetImages() {
  const assetsDir = path.join(__dirname, 'assets');
  const imageMap = {
    'cat.png': PET_IMAGES.cat,
    'dog.png': PET_IMAGES.dog,
    'bao.png': PET_IMAGES.bao,
  };
  
  try {
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
  } catch (e) {
    console.error('创建 assets 目录失败:', e.message);
    return;
  }
  
  Object.keys(imageMap).forEach(filename => {
    const filePath = path.join(assetsDir, filename);
    if (!fs.existsSync(filePath)) {
      try {
        const base64Data = imageMap[filename].replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        console.log('恢复宠物图片:', filename);
      } catch (e) {
        console.error('恢复图片失败 ' + filename + ':', e.message);
      }
    }
  });
}

// ------- 工具函数：读写用户配置 -------
function loadConfig() {
  const defaults = {
    pet: {
      character: 'cat',
      scale: 1.0,
      speed: 1,
      alwaysOnTop: true,
      workMode: false,
      customImage: null
    },
    position: { x: null, y: null },
    petState: {
      level: 1, exp: 0, expMax: 100,
      hunger: 80, clean: 80, mood: 80, energy: 80, health: 100
    },
    bind: { openid: null, envId: null },
    inventory: [],
    firstLaunch: true,
    autoStart: false
  };
  try {
    if (fs.existsSync(userConfigPath)) {
      const saved = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
      // 深度合并：确保 petState 所有字段都存在（兼容旧配置）
      return {
        pet: { ...defaults.pet, ...(saved.pet || {}) },
        position: { ...defaults.position, ...(saved.position || {}) },
        petState: { ...defaults.petState, ...(saved.petState || {}) },
        bind: { ...defaults.bind, ...(saved.bind || {}) },
        inventory: Array.isArray(saved.inventory) ? saved.inventory : defaults.inventory,
        firstLaunch: saved.firstLaunch !== undefined ? saved.firstLaunch : defaults.firstLaunch,
        autoStart: saved.autoStart !== undefined ? saved.autoStart : defaults.autoStart
      };
    }
  } catch (e) {
    console.log('配置文件读取失败，使用默认配置');
  }
  return defaults;
}

function saveConfig() {
  try {
    fs.writeFileSync(userConfigPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.log('保存配置失败:', e);
  }
}

// ------- 工具函数：读写便签数据 -------
function loadNotes() {
  try {
    if (fs.existsSync(notesPath)) {
      return JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
    }
  } catch (e) {
    console.log('便签文件读取失败，使用空便签');
  }
  return [];
}

function saveNotes() {
  try {
    fs.writeFileSync(notesPath, JSON.stringify(notesData, null, 2));
  } catch (e) {
    console.log('保存便签失败:', e);
  }
}


// ============================================================
// 云函数调用工具（通过 HTTP 触发调用 petApi 云函数）
// ============================================================
function callCloudApi(action, data) {
  return new Promise((resolve, reject) => {
    const envId = (config.bind && config.bind.envId) ? config.bind.envId : 'cloud1-d9gjbey4a7a8fd907';
    const postData = JSON.stringify({ action: action, ...data });
    const options = {
      hostname: envId + '.service.tcloudbase.com',
      path: '/petApi',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('解析云函数响应失败')); }
      });
    });
    req.on('error', (e) => reject(new Error('网络请求失败')));
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(postData);
    req.end();
  });
}

// ============================================================
// 自动更新检测（方案一：查 GitHub Releases 最新版本 → 弹提示 → 打开下载页）
//   - 不需要 electron-updater，零额外依赖
//   - 启动后 3 秒自动检查一次（静默，仅提示有新版本）
//   - 也可从托盘菜单「检查更新」手动触发
// ============================================================
function compareVersions(a, b) {
  // 返回 1 表示 a>b，-1 表示 a<b，0 表示相等
  const pa = a.replace(/^v/, '').split('.').map(x => parseInt(x) || 0);
  const pb = b.replace(/^v/, '').split('.').map(x => parseInt(x) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function checkForUpdates(silent = false) {
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    method: 'GET',
    headers: { 'User-Agent': 'qubao-desktop-pet' }
  };
  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      try {
        const release = JSON.parse(body);
        if (!release || !release.tag_name) {
          if (!silent) dialog.showMessageBoxSync({ type: 'info', title: '检查更新', message: '暂无可用更新', detail: '当前已是最新版本。' });
          return;
        }
        const latestVersion = release.tag_name; // 形如 "v0.2.0"
        if (compareVersions(latestVersion, APP_VERSION) > 0) {
          // 发现新版本
          const result = dialog.showMessageBoxSync({
            type: 'info',
            title: '发现新版本',
            message: `检测到新版本 ${latestVersion}！\n当前版本：v${APP_VERSION}`,
            detail: release.body || '点击「立即更新」前往下载页面。',
            buttons: ['立即更新', '稍后提醒'],
            defaultId: 0,
            cancelId: 1
          });
          if (result === 0) {
            // 打开该 Release 的下载页面（用户自行下载新安装包覆盖安装即可）
            shell.openExternal(release.html_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
          }
        } else {
          if (!silent) {
            dialog.showMessageBoxSync({ type: 'info', title: '检查更新', message: '已是最新版本', detail: `当前版本：v${APP_VERSION}\n最新版本：${latestVersion}` });
          }
        }
      } catch (e) {
        if (!silent) dialog.showMessageBoxSync({ type: 'error', title: '检查更新', message: '检查更新失败', detail: '无法解析服务器返回的数据，请稍后重试。' });
      }
    });
  });
  req.on('error', () => {
    if (!silent) dialog.showMessageBoxSync({ type: 'error', title: '检查更新', message: '网络请求失败', detail: '请检查网络连接后重试。' });
  });
  req.setTimeout(10000, () => { req.destroy(); if (!silent) dialog.showMessageBoxSync({ type: 'error', title: '检查更新', message: '请求超时', detail: '请检查网络连接后重试。' }); });
  req.end();
}

// ============================================================
// 番茄钟核心（主进程统一计时，任务栏显示倒计时进度条+标题）
//   - 即使 pomodoroWindow 被最小化/销毁，计时仍在主进程持续推进
//   - 窗口存在时：setProgressBar 任务栏进度条 + setTitle 标题显示 "🍅 24:59 专注中"
//   - 时间到：若窗口存在则恢复显示并弹提示；若已销毁则系统通知提醒
// ============================================================
const pomodoro = {
  totalSeconds: 25 * 60,
  remaining: 25 * 60,
  running: false,
  intervalId: null,
  // 把秒格式化为 MM:SS
  fmt(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  },
  // 把最新状态推给渲染进程
  broadcast() {
    if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
      pomodoroWindow.webContents.send('pomodoro:tick', {
        totalSeconds: pomodoro.totalSeconds,
        remaining: pomodoro.remaining,
        running: pomodoro.running
      });
    }
  },
  // 更新任务栏进度条 + 窗口标题（用户要求"只在任务栏显示倒计时"）
  updateTaskbar() {
    if (!pomodoroWindow || pomodoroWindow.isDestroyed()) return;
    const ratio = pomodoro.totalSeconds > 0
      ? Math.max(0, Math.min(1, pomodoro.remaining / pomodoro.totalSeconds))
      : 0;
    if (pomodoro.running) {
      pomodoroWindow.setProgressBar(ratio, { mode: 'normal' });
      pomodoroWindow.setTitle(`🍅 ${pomodoro.fmt(pomodoro.remaining)} 专注中`);
    } else if (pomodoro.remaining < pomodoro.totalSeconds && pomodoro.remaining > 0) {
      pomodoroWindow.setProgressBar(ratio, { mode: 'paused' });
      pomodoroWindow.setTitle(`⏸ ${pomodoro.fmt(pomodoro.remaining)} 已暂停`);
    } else {
      pomodoroWindow.setProgressBar(0, { mode: 'none' });
      pomodoroWindow.setTitle('番茄钟');
    }
    // 同时刷新任务栏悬停预览底部的"开始/暂停/重置"按钮
    pomodoro.refreshThumbar();
    // 把倒计时文字直接画到任务栏按钮图标上，不用悬停也能一眼看到 🍅 24:59
    pomodoro.refreshTaskbarIcon();
  },
  tick() {
    if (!pomodoro.running) return;
    pomodoro.remaining--;
    pomodoro.broadcast();
    pomodoro.updateTaskbar();
    if (pomodoro.remaining <= 0) {
      // 计时结束
      pomodoro.running = false;
      clearInterval(pomodoro.intervalId);
      pomodoro.intervalId = null;
      if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
        pomodoroWindow.setProgressBar(1, { mode: 'normal' });
        pomodoroWindow.setTitle('🎉 时间到！');
        try {
          if (pomodoroWindow.isMinimized()) pomodoroWindow.restore();
          pomodoroWindow.show();
          pomodoroWindow.focus();
        } catch (_) {}
        pomodoroWindow.webContents.send('pomodoro:finished');
      } else {
        // 窗口已销毁，走系统通知（没窗口的兜底提醒）
        try {
          const { Notification } = require('electron');
          const n = new Notification({
            title: '番茄钟 时间到！',
            body: '🎉 休息一下吧～',
            icon: path.join(__dirname, 'assets', 'icon.png'),
            silent: false
          });
          n.show();
        } catch (_) {}
      }
      pomodoro.resetTaskbarAfter();
    }
  },
  // 结束后 3 秒把任务栏恢复成常态
  resetTaskbarAfter() {
    setTimeout(() => {
      if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
        pomodoroWindow.setProgressBar(0, { mode: 'none' });
        pomodoroWindow.setTitle('番茄钟');
        // 恢复默认趣宝 icon.ico，不再显示动态倒计时图标
        const def = pomodoro.getDefaultIcon();
        if (def) pomodoroWindow.setIcon(def);
      }
    }, 3000);
  },
  start(totalSeconds) {
    if (totalSeconds && totalSeconds > 0) {
      pomodoro.totalSeconds = totalSeconds;
      pomodoro.remaining = totalSeconds;
    }
    pomodoro.running = true;
    if (pomodoro.intervalId) clearInterval(pomodoro.intervalId);
    pomodoro.intervalId = setInterval(pomodoro.tick, 1000);
    pomodoro.broadcast();
    pomodoro.updateTaskbar();
    // 开始后自动最小化到任务栏（用户需求：点击开始后只在任务栏显示倒计时）
    if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
      try { pomodoroWindow.minimize(); } catch (_) {}
    }
  },
  pause() {
    pomodoro.running = false;
    if (pomodoro.intervalId) {
      clearInterval(pomodoro.intervalId);
      pomodoro.intervalId = null;
    }
    pomodoro.broadcast();
    pomodoro.updateTaskbar();
  },
  resume() {
    if (pomodoro.remaining <= 0) return;
    pomodoro.running = true;
    if (pomodoro.intervalId) clearInterval(pomodoro.intervalId);
    pomodoro.intervalId = setInterval(pomodoro.tick, 1000);
    pomodoro.broadcast();
    pomodoro.updateTaskbar();
  },
  reset(totalSeconds) {
    pomodoro.running = false;
    if (pomodoro.intervalId) {
      clearInterval(pomodoro.intervalId);
      pomodoro.intervalId = null;
    }
    if (totalSeconds && totalSeconds > 0) {
      pomodoro.totalSeconds = totalSeconds;
    }
    pomodoro.remaining = pomodoro.totalSeconds;
    pomodoro.broadcast();
    pomodoro.updateTaskbar();
  },
  getState() {
    return {
      totalSeconds: pomodoro.totalSeconds,
      remaining: pomodoro.remaining,
      running: pomodoro.running
    };
  },
  // ------- 任务栏缩略图工具栏（悬停/Alt+Tab 预览底部直接显示操作按钮）-------
  // 用纯 SVG 生成 16x16 小图标，不依赖外部图片文件
  mkIcon(svg) {
    try {
      const buf = Buffer.from(svg, 'utf-8');
      const img = nativeImage.createFromBuffer(buf, { width: 16, height: 16, scaleFactor: 1 });
      return img.isEmpty() ? nativeImage.createEmpty() : img;
    } catch (_) { return nativeImage.createEmpty(); }
  },
  get iconPlay()  { return pomodoro.mkIcon('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><polygon points="3,1 14,8 3,15" fill="#333"/></svg>'); },
  get iconPause() { return pomodoro.mkIcon('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="3" y="1" width="4" height="14" fill="#333"/><rect x="9" y="1" width="4" height="14" fill="#333"/></svg>'); },
  get iconReset() { return pomodoro.mkIcon('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M13.6 8A5.6 5.6 0 1 1 8 2.4V0L4 4l4 4V5.6A2.4 2.4 0 1 0 10.4 8h3.2z" fill="#333"/></svg>'); },
  // 根据运行状态刷新缩略图按钮
  refreshThumbar() {
    if (!pomodoroWindow || pomodoroWindow.isDestroyed()) return;
    try {
      const btn1 = pomodoro.running
        ? { tooltip: '暂停', icon: pomodoro.iconPause, click: () => pomodoro.pause() }
        : { tooltip: (pomodoro.remaining < pomodoro.totalSeconds && pomodoro.remaining > 0) ? '继续' : '开始',
            icon: pomodoro.iconPlay,
            click: () => {
              if (pomodoro.remaining < pomodoro.totalSeconds && pomodoro.remaining > 0) pomodoro.resume();
              else pomodoro.start(pomodoro.totalSeconds || 25 * 60);
            } };
      const btn2 = {
        tooltip: '重置',
        icon: pomodoro.iconReset,
        click: () => pomodoro.reset(pomodoro.totalSeconds || 25 * 60)
      };
      pomodoroWindow.setThumbarButtons([btn1, btn2]);
    } catch (_) {}
  },
  // 设置缩略图裁剪区域：只保留"倒计时大字"那一块，Alt+Tab/悬停直接看得到
  setThumbnailClipTimer() {
    if (!pomodoroWindow || pomodoroWindow.isDestroyed()) return;
    try {
      // 根据 style.css 估算：pomo-card 内 padding 14 + header 38 + timer-display 起 12 padding
      // 窗口 280x320，timer-display 在 x≈14, y≈50~60, w≈252, h≈72
      // 留一点余量，确保数字完整
      pomodoroWindow.setThumbnailClip({ x: 14, y: 52, width: 252, height: 80 });
    } catch (_) {}
  },
  // ---------- 动态任务栏图标（把倒计时文字直接画到图标上，任务栏按钮不用悬停也能看倒计时）----------
  // 方案：纯 SVG 128x128 → base64 dataURL → nativeImage.createFromDataURL
  // 优势：不需要装 sharp/canvas 等原生依赖，Electron 自带 Chromium 可直接渲染 SVG+emoji
  _cachedDefaultIcon: null,
  getDefaultIcon() {
    if (!pomodoro._cachedDefaultIcon) {
      try {
        const p = path.join(__dirname, 'assets', 'icon.ico');
        if (fs.existsSync(p)) pomodoro._cachedDefaultIcon = p;
      } catch (_) {}
    }
    return pomodoro._cachedDefaultIcon;
  },
  // 生成一张带 🍅 + MM:SS + 状态文字 的 PNG 图标，返回 nativeImage
  makeTimerIcon({ timeStr, statusText, running }) {
    const bg = running ? '#ff9d1a' : '#b0b0b0';      // 运行中橙色，暂停灰色
    const subColor = running ? '#fff6e5' : '#e8e8e8';
    // 注意：SVG 必须声明 xmlns + 明确 width/height（Chromium rasterize 必须），
    //       foreignObject 可以用完整的 HTML + 系统字体栈（支持 emoji🍅）
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${running ? '#ffc97a' : '#c9c9c9'}"/>
      <stop offset="100%" stop-color="${bg}"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="124" height="124" rx="22" ry="22" fill="url(#bg)" stroke="${running ? '#e88800' : '#8f8f8f'}" stroke-width="2"/>
  <g font-family="'Segoe UI Emoji','Segoe UI Symbol','Apple Color Emoji','Microsoft YaHei',sans-serif"
     text-anchor="middle" dominant-baseline="central" fill="#fff">
    <text x="64" y="42" font-size="30">🍅</text>
    <text x="64" y="84" font-size="38" font-weight="700" letter-spacing="1"
          font-family="'Segoe UI','Microsoft YaHei',monospace">${timeStr}</text>
    <text x="64" y="114" font-size="16" font-weight="500" fill="${subColor}">${statusText}</text>
  </g>
</svg>`;
    try {
      const b64 = Buffer.from(svg, 'utf-8').toString('base64');
      const dataURL = 'data:image/svg+xml;base64,' + b64;
      const img = nativeImage.createFromDataURL(dataURL);
      if (!img || img.isEmpty()) throw new Error('empty');
      return img;
    } catch (e) {
      // fallback：如果 SVG 解析失败则退回默认图标
      const def = pomodoro.getDefaultIcon();
      return def ? nativeImage.createFromPath(def) : nativeImage.createEmpty();
    }
  },
  // 把当前状态渲染成图标，设置给任务栏按钮
  refreshTaskbarIcon() {
    if (!pomodoroWindow || pomodoroWindow.isDestroyed()) return;
    try {
      // 未开始/未暂停 → 用默认 icon.ico（避免不必要的动态图标渲染）
      const idle = !pomodoro.running && pomodoro.remaining >= pomodoro.totalSeconds;
      if (idle) {
        const def = pomodoro.getDefaultIcon();
        if (def) pomodoroWindow.setIcon(def);
        return;
      }
      const timeStr = pomodoro.fmt(pomodoro.remaining);
      let statusText;
      if (pomodoro.running) statusText = '专注中';
      else if (pomodoro.remaining <= 0) statusText = '已完成';
      else statusText = '已暂停';
      const icon = pomodoro.makeTimerIcon({
        timeStr,
        statusText,
        running: pomodoro.running
      });
      pomodoroWindow.setIcon(icon);
    } catch (_) {}
  }
};

// ============================================================
// 创建绑定窗口
// ============================================================
function createBindWindow() {
  if (bindWindow && !bindWindow.isDestroyed()) {
    bindWindow.show();
    bindWindow.focus();
    return;
  }
  bindWindow = new BrowserWindow({
    width: 420, height: 560,
    frame: true, title: '绑定小程序', resizable: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  bindWindow.setMenuBarVisibility(false);
  bindWindow.setAlwaysOnTop(true, 'screen-saver');
  bindWindow.loadFile(path.join(__dirname, 'src', 'bind', 'index.html'));
  bindWindow.on('closed', () => { bindWindow = null; });
}


// ============================================================
// 1. 创建桌宠窗口
// ============================================================
function createPetWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const winW = 60;   // 桌宠窗口宽度
  const winH = 120;  // 桌宠窗口高度（上 60 气泡区 + 下 60 图区）

  // 默认位置：屏幕右下角，保证在 workArea 内
  const savedX = config.position.x;
  const savedY = config.position.y;
  let x = (savedX !== null && savedX !== undefined) ? savedX : (workArea.x + workArea.width - winW - 40);
  let y = (savedY !== null && savedY !== undefined) ? savedY : (workArea.y + workArea.height - winH - 80);

  // 强制夹在 workArea 内部，防止屏幕外
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - winW));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - winH));

  console.log('[createPetWindow] 初始位置 x=' + x + ', y=' + y + ', workArea=' + JSON.stringify(workArea));

  petWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: x,
    y: y,
    frame: false,           // 无边框
    transparent: true,      // 透明背景
    alwaysOnTop: config.pet.alwaysOnTop,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,            // 先不显示，等 did-finish-load 再显示
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (config.pet.alwaysOnTop) {
    petWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  petWindow.once('ready-to-show', () => {
    console.log('[createPetWindow] ready-to-show，显示窗口');
    petWindow.show();
    petWindow.focus();
  });

  // 加载桌宠页面
  petWindow.loadFile(path.join(__dirname, 'src', 'pet', 'index.html'));

  // 无条件打开 DevTools（方便排查，排查完可删除此行）
  petWindow.webContents.openDevTools({ mode: 'detach' });
  petWindow.webContents.once('did-finish-load', () => {
    console.log('[createPetWindow] did-finish-load，发送配置与状态');
    petWindow.webContents.send('config:init', config);
    petWindow.webContents.send('state:init', config.petState);
  });

  petWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[createPetWindow] did-fail-load: code=' + code + ', desc=' + desc);
  });

  petWindow.webContents.on('console-message', (ev, level, message, line, sourceId) => {
    const lv = ['LOG', 'WARN', 'ERR', 'DEBUG'][level] || level;
    console.log('[pet-console:' + lv + '] ' + message + ' (' + sourceId + ':' + line + ')');
  });

  let snapInitialized = false;
  // 窗口移动后：检测是否靠近边缘 → 自动贴边一半
  petWindow.on('moved', () => {
    if (isDragging) return;
    // 首次 moved（loadFile 后触发的那一次）不贴边，避免启动时直接跑屏幕外
    if (!snapInitialized) { snapInitialized = true; return; }

    const [x, y] = petWindow.getPosition();
    const [w, h] = petWindow.getSize();
    const { workArea: wa } = screen.getPrimaryDisplay();
    const edgeThreshold = 5;

    let snapX = null, snapY = null;
    let needSnap = false;

    if (x - wa.x <= edgeThreshold) {
      snapX = wa.x - Math.round(w / 2);
      needSnap = true;
    } else if (wa.x + wa.width - (x + w) <= edgeThreshold) {
      snapX = wa.x + wa.width - Math.round(w / 2);
      needSnap = true;
    }

    if (y - wa.y <= edgeThreshold) {
      snapY = wa.y - Math.round(h / 2);
      needSnap = true;
    } else if (wa.y + wa.height - (y + h) <= edgeThreshold) {
      snapY = wa.y + wa.height - Math.round(h / 2);
      needSnap = true;
    }

    if (needSnap) {
      const finalX = snapX !== null ? snapX : x;
      const finalY = snapY !== null ? snapY : y;
      petWindow.setPosition(finalX, finalY);
      config.position.x = finalX;
      config.position.y = finalY;
      petWindow.webContents.send('pet:snap-edge', true);
    } else {
      config.position.x = x;
      config.position.y = y;
      petWindow.webContents.send('pet:snap-edge', false);
    }
    saveConfig();
  });

  petWindow.on('blur', () => {
    setTimeout(() => {
      if (menuWindow && !menuWindow.isFocused() && menuWindow.isVisible()) {
        menuWindow.hide();
      }
    }, 200);
  });
}

// ============================================================
// 2. 创建系统托盘
// ============================================================
function createTray() {
  // 用一个简单的图标（这里用程序自带的，你可以替换成自己的png）
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('icon not found');
  } catch (e) {
    // 如果没有图标文件，用一个空的16x16图标（你应该替换成真实的图标）
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('趣宝 🐾');

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示/隐藏趣宝', click: () => togglePet() },
    { label: '📝 便签', click: () => createNotesListWindow() },
    { label: '⏰ 番茄钟', click: () => createPomodoroWindow() },
    { type: 'separator' },
    { label: '⚙️ 设置', click: () => createSettingsWindow() },
    { label: '🔄 检查更新', click: () => checkForUpdates(false) },
    { type: 'separator' },
    { label: '退出', click: () => {
      app.isQuiting = true;
      app.quit();
    }}
  ]);

  tray.setContextMenu(contextMenu);

  // 左键点击托盘图标 → 打开宠物状态面板
  tray.on('click', () => createStatusWindow());
}

function togglePet() {
  if (!petWindow) return;
  if (petWindow.isVisible()) {
    petWindow.hide();
  } else {
    petWindow.show();
  }
}

// ============================================================
// 3. 创建"点击桌宠弹出的菜单"窗口
// ============================================================
function createMenuWindow(mouseX, mouseY) {
  const menuW = 220;
  const menuH = 40;
  if (menuWindow && !menuWindow.isDestroyed()) {
    if (menuWindow.isVisible()) {
      menuWindow.hide();
      return;
    }
    menuWindow.setPosition(Math.round(mouseX - menuW / 2), Math.round(mouseY + 8));
    menuWindow.show();
    menuWindow.focus();
    return;
  }

  menuWindow = new BrowserWindow({
    width: menuW,
    height: menuH,
    x: Math.round(mouseX - menuW / 2),
    y: Math.round(mouseY + 8),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  menuWindow.loadFile(path.join(__dirname, 'src', 'menu', 'index.html'));
  menuWindow.setAlwaysOnTop(true, 'pop-up-menu');

  menuWindow.on('blur', () => {
    if (menuWindow) menuWindow.hide();
  });
}

// 关闭菜单
ipcMain.on('menu:close', () => {
  if (menuWindow && !menuWindow.isDestroyed()) {
    menuWindow.hide();
  }
});

// ============================================================
// 4. 便签窗口
// ============================================================
function createNoteWindow(noteData = null) {
  const noteWin = new BrowserWindow({
    width: 300,
    height: 300,
    minWidth: 200,
    minHeight: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  let noteId;
  let noteContent = '';
  let notePosition = null;

  if (noteData && noteData.id) {
    noteId = noteData.id;
    noteContent = noteData.content || '';
    notePosition = noteData.position || null;
  } else {
    noteId = 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    // 不立即保存空便签，等用户输入内容后再保存
  }

  if (notePosition) {
    noteWin.setPosition(notePosition.x, notePosition.y);
  }

  noteWin.loadFile(path.join(__dirname, 'src', 'note', 'index.html'));
  noteWin.webContents.once('did-finish-load', () => {
    noteWin.webContents.send('note:init', { id: noteId, content: noteContent });
  });

  noteWindows.push({ win: noteWin, id: noteId });

  noteWin.on('moved', () => {
    const [x, y] = noteWin.getPosition();
    const note = notesData.find(n => n.id === noteId);
    if (note) {
      note.position = { x, y };
      saveNotes();
    }
  });

  noteWin.on('closed', () => {
    const idx = noteWindows.findIndex(n => n.id === noteId);
    if (idx > -1) noteWindows.splice(idx, 1);
    // 清理空内容的便签
    const dataIdx = notesData.findIndex(n => n.id === noteId);
    if (dataIdx > -1 && !notesData[dataIdx].content) {
      notesData.splice(dataIdx, 1);
      saveNotes();
    }
  });
}

function restoreNotes() {
  // 便签数据已加载到 notesData，但不自动弹出窗口
  // 用户通过托盘菜单「显示便签列表」查看历史便签
}

// ============================================================
// 4.5 便签列表窗口（查看/打开/删除历史便签）
// ============================================================
let notesListWindow = null;
function createNotesListWindow() {
  if (notesListWindow && !notesListWindow.isDestroyed()) {
    notesListWindow.show();
    notesListWindow.focus();
    return;
  }
  notesListWindow = new BrowserWindow({
    width: 360,
    height: 460,
    frame: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    title: '便签列表',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  notesListWindow.setMenuBarVisibility(false);
  notesListWindow.loadFile(path.join(__dirname, 'src', 'notes-list', 'index.html'));
  notesListWindow.webContents.once('did-finish-load', () => {
    notesListWindow.webContents.send('notes:list', notesData);
  });
  notesListWindow.on('closed', () => { notesListWindow = null; });
}

// 便签列表请求最新数据
ipcMain.on('notes:request-list', () => {
  if (notesListWindow && !notesListWindow.isDestroyed()) {
    notesListWindow.webContents.send('notes:list', notesData);
  }
});

// 从便签列表打开某条便签
ipcMain.on('notes:open', (event, noteId) => {
  const note = notesData.find(n => n.id === noteId);
  if (note) createNoteWindow(note);
});

// 从便签列表删除某条便签
ipcMain.on('notes:delete', (event, noteId) => {
  const idx = notesData.findIndex(n => n.id === noteId);
  if (idx > -1) {
    notesData.splice(idx, 1);
    saveNotes();
  }
  // 关闭已打开的便签窗口
  const winInfo = noteWindows.find(n => n.id === noteId);
  if (winInfo && !winInfo.win.isDestroyed()) {
    winInfo.win.close();
  }
  // 刷新列表
  if (notesListWindow && !notesListWindow.isDestroyed()) {
    notesListWindow.webContents.send('notes:list', notesData);
  }
});

// ============================================================
// 5. 番茄钟窗口
// ============================================================
function createPomodoroWindow() {
  if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
    pomodoroWindow.show();
    pomodoroWindow.focus();
    return;
  }

  pomodoroWindow = new BrowserWindow({
    width: 280,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  pomodoroWindow.loadFile(path.join(__dirname, 'src', 'pomodoro', 'index.html'));
  // 窗口创建后，立即同步主进程当前计时状态（用户中途重新打开也能接上）
  pomodoroWindow.webContents.once('did-finish-load', () => {
    // 1) 缩略图只裁"倒计时大字"那块 —— Alt+Tab / 任务栏悬停预览直接显示倒计时
    pomodoro.setThumbnailClipTimer();
    // 2) 预览底部加 开始/暂停 + 重置 按钮，悬停即可操作
    pomodoro.refreshThumbar();
    // 3) 同步标题/进度条/UI
    pomodoro.updateTaskbar();
    pomodoro.broadcast();
  });

  // 任务栏悬停预览底部按钮点击（更可靠的事件监听兜底）
  pomodoroWindow.on('thumbar-button-clicked', (_e, index) => {
    if (index === 0) {
      // 第一个按钮：开始 / 暂停 / 继续
      if (pomodoro.running) pomodoro.pause();
      else if (pomodoro.remaining < pomodoro.totalSeconds && pomodoro.remaining > 0) pomodoro.resume();
      else pomodoro.start(pomodoro.totalSeconds || 25 * 60);
    } else if (index === 1) {
      // 第二个按钮：重置
      pomodoro.reset(pomodoro.totalSeconds || 25 * 60);
    }
  });

  pomodoroWindow.on('closed', () => {
    pomodoroWindow = null;
  });
}

// ============================================================
// 5.5 状态面板窗口（QQ宠物式状态栏）
// ============================================================
function createStatusWindow() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.show();
    statusWindow.focus();
    return;
  }

  statusWindow = new BrowserWindow({
    width: 300,
    height: 460,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  statusWindow.loadFile(path.join(__dirname, 'src', 'status', 'index.html'));
  statusWindow.setAlwaysOnTop(true, 'pop-up-menu');

  statusWindow.webContents.once('did-finish-load', () => {
    statusWindow.webContents.send('state:init', config.petState);
  });

  statusWindow.on('closed', () => {
    statusWindow = null;
  });
}

// 广播状态更新给状态面板和宠物窗口
function broadcastState() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.webContents.send('state:updated', config.petState);
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('state:updated', config.petState);
  }
}

// 状态自然衰减/恢复定时器（每30秒）
function startStateDecay() {
  setInterval(() => {
    const s = config.petState;
    // 饱食度下降
    s.hunger = Math.max(0, s.hunger - 2);
    // 清洁度下降
    s.clean = Math.max(0, s.clean - 1.5);
    // 体力：醒着缓慢下降，低饱食度时下降更快
    const hungerPenalty = s.hunger < 30 ? 2 : 1;
    s.energy = Math.max(0, s.energy - hungerPenalty);
    // 心情：饥饿/脏/累会降低心情
    if (s.hunger < 30 || s.clean < 30 || s.energy < 20) {
      s.mood = Math.max(0, s.mood - 2);
    } else {
      s.mood = Math.max(0, s.mood - 0.5);
    }
    // 健康值：长期饥饿/脏/心情极低会扣健康，否则缓慢恢复
    if (s.hunger < 10 || s.clean < 10 || s.mood < 10) {
      s.health = Math.max(0, s.health - 3);
    } else if (s.hunger > 50 && s.clean > 50 && s.mood > 50) {
      s.health = Math.min(100, s.health + 0.5);
    }
    saveConfig();
    broadcastState();
  }, 30000);
}

// ============================================================
// 6. 设置面板
// ============================================================
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 520,
    frame: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    title: '设置',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings', 'index.html'));

  settingsWindow.webContents.once('did-finish-load', () => {
    settingsWindow.webContents.send('config:init', config);
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ============================================================
// 6.5 新手教程窗口
// ============================================================
function createTutorialWindow() {
  if (tutorialWindow && !tutorialWindow.isDestroyed()) {
    tutorialWindow.show();
    tutorialWindow.focus();
    return;
  }

  tutorialWindow = new BrowserWindow({
    width: 420,
    height: 520,
    frame: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    title: '欢迎使用趣宝',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  tutorialWindow.setMenuBarVisibility(false);
  tutorialWindow.loadFile(path.join(__dirname, 'src', 'tutorial', 'index.html'));

  tutorialWindow.on('closed', () => {
    tutorialWindow = null;
  });
}

// ============================================================
// 7. IPC 通信：处理渲染进程发来的消息
// ============================================================

// 7.1 桌宠被点击 → 弹出菜单
ipcMain.on('pet:clicked', (event, { mouseX, mouseY }) => {
  createMenuWindow(mouseX, mouseY);
});

// 7.2 从菜单中选择了一个功能
ipcMain.on('menu:action', (event, action) => {
  if (menuWindow) menuWindow.hide();
  switch (action) {
    case 'note': createNoteWindow(); break;
    case 'pomodoro': createPomodoroWindow(); break;
    case 'settings': createSettingsWindow(); break;
    case 'status': createStatusWindow(); break;
    case 'bind': createBindWindow(); break;
  }
});

// 7.2.1 互动动作：喂食/洗澡/玩耍/睡觉/看病
// 已绑定小程序 → 走云端（带物品检查）；未绑定 → 走本地（保留原逻辑）
ipcMain.on('pet:interact', async (event, action) => {
  const openid = config.bind?.openid
  // 已绑定：走云端
  if (openid) {
    try {
      // 先获取本地库存，找到第一个匹配类别的物品
      const itemId = await findItemForAction(action)
      const result = await callCloudApi('interact', { openid, action, itemId })
      if (result.success) {
        // 更新本地状态
        if (result.pet) {
          config.petState = {
            level: result.pet.level, exp: result.pet.exp, expMax: result.pet.expMax,
            hunger: result.pet.hunger, clean: result.pet.clean, mood: result.pet.mood,
            energy: result.pet.energy, health: result.pet.health
          }
        }
        if (result.inventory) {
          config.inventory = result.inventory
        }
        saveConfig()
        broadcastState()
        if (petWindow && !petWindow.isDestroyed()) {
          petWindow.webContents.send('pet:action', action)
          if (result.leveledUp) {
            petWindow.webContents.send('pet:levelup', result.level)
          }
        }
      } else if (result.needItem) {
        // 物品不足，提示用户去小程序购买
        if (result.inventory) {
          config.inventory = result.inventory
          saveConfig()
        }
        broadcastState()
        if (petWindow && !petWindow.isDestroyed()) {
          petWindow.webContents.send('pet:action', 'no-item')
        }
      }
      return
    } catch (e) {
      console.error('云端互动失败，回退本地:', e)
    }
  }
  // 未绑定或云端失败：走本地原逻辑
  const s = config.petState;
  let expGain = 0;
  switch (action) {
    case 'feed':
      s.hunger = Math.min(100, s.hunger + 30);
      s.mood = Math.min(100, s.mood + 5);
      expGain = 10;
      break;
    case 'bathe':
      s.clean = Math.min(100, s.clean + 40);
      s.mood = Math.min(100, s.mood + 5);
      expGain = 10;
      break;
    case 'play':
      s.mood = Math.min(100, s.mood + 25);
      s.energy = Math.max(0, s.energy - 10);
      s.hunger = Math.max(0, s.hunger - 5);
      expGain = 15;
      break;
    case 'sleep':
      s.energy = Math.min(100, s.energy + 50);
      expGain = 8;
      break;
    case 'cure':
      s.health = Math.min(100, s.health + 50);
      expGain = 5;
      break;
  }
  if (expGain > 0) {
    s.exp += expGain;
    while (s.exp >= s.expMax) {
      s.exp -= s.expMax;
      s.level += 1;
      s.expMax = Math.round(s.expMax * 1.2);
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('pet:levelup', s.level);
      }
    }
  }
  saveConfig();
  broadcastState();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:action', action);
  }
});

// 根据动作查找本地库存中第一个匹配类别的物品
async function findItemForAction(action) {
  const ACTION_CATEGORY = {
    feed: 'food', bathe: 'clean', cure: 'medicine'
  }
  const category = ACTION_CATEGORY[action]
  if (!category) return null
  const inventory = config.inventory || []
  // 库存物品需要有 category 字段或通过 id 前缀匹配
  const item = inventory.find(i => i.count > 0 && (i.category === category || i.id?.startsWith(category)))
  return item ? item.id : null
}

// 7.2.2 获取当前状态
ipcMain.handle('state:get', () => config.petState);

// 7.3 配置更新 → 保存并通知所有窗口
ipcMain.on('config:update', (event, newConfig) => {
  config = { ...config, ...newConfig };
  saveConfig();
  // 通知桌宠窗口更新
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('config:updated', config);
    // 同步更新置顶级别
    if (config.pet?.alwaysOnTop !== undefined) {
      if (config.pet.alwaysOnTop) {
        petWindow.setAlwaysOnTop(true, 'screen-saver');
      } else {
        petWindow.setAlwaysOnTop(false);
      }
    }
  }
});

// 7.4 请求当前配置
ipcMain.handle('config:get', () => config);

// 7.4.1 教程完成
ipcMain.on('tutorial:finish', () => {
  config.firstLaunch = false;
  saveConfig();
  if (tutorialWindow && !tutorialWindow.isDestroyed()) {
    tutorialWindow.close();
  }
});

// 7.4.2 开机启动设置
ipcMain.handle('autostart:get', () => {
  return app.getLoginItemSettings().openAtLogin;
});

// ------- 绑定相关 IPC -------
// 绑定状态查询
ipcMain.handle('bind:status', async () => {
  const openid = config.bind?.openid
  if (!openid) return { success: true, bound: false }
  try {
    const result = await callCloudApi('bindStatus', { openid })
    return result
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 配对码绑定
ipcMain.handle('bind:withCode', async (event, code) => {
  try {
    const result = await callCloudApi('bindVerify', { code })
    if (result.success) {
      config.bind.openid = result.openid
      if (result.pet) {
        config.petState = {
          level: result.pet.level || 1, exp: result.pet.exp || 0,
          expMax: result.pet.expMax || 100, hunger: result.pet.hunger || 80,
          clean: result.pet.clean || 80, mood: result.pet.mood || 80,
          energy: result.pet.energy || 80, health: result.pet.health || 100
        }
      }
      saveConfig()
      broadcastState()
      try {
        const invRes = await callCloudApi('getInventory', { openid: result.openid })
        if (invRes.success) {
          config.inventory = invRes.inventory || []
          saveConfig()
        }
      } catch (e) {}
    }
    return result
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 同步宠物数据到云端
ipcMain.handle('bind:sync', async () => {
  const openid = config.bind?.openid
  if (!openid) return { success: false, error: '未绑定' }
  try {
    const result = await callCloudApi('syncPet', { openid, pet: config.petState })
    if (result.success) {
      try {
        const invRes = await callCloudApi('getInventory', { openid })
        if (invRes.success) {
          config.inventory = invRes.inventory || []
          saveConfig()
        }
      } catch (e) {}
    }
    return result
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 解除绑定
ipcMain.on('bind:unbind', () => {
  config.bind.openid = null
  config.inventory = []
  saveConfig()
})

// 获取物品库存
ipcMain.handle('inventory:get', () => config.inventory || [])

// ------- 番茄钟 IPC -------
ipcMain.handle('pomodoro:start', (_e, totalSeconds) => {
  pomodoro.start(totalSeconds);
  return pomodoro.getState();
});
ipcMain.handle('pomodoro:pause', () => {
  pomodoro.pause();
  return pomodoro.getState();
});
ipcMain.handle('pomodoro:resume', () => {
  pomodoro.resume();
  return pomodoro.getState();
});
ipcMain.handle('pomodoro:reset', (_e, totalSeconds) => {
  pomodoro.reset(totalSeconds);
  return pomodoro.getState();
});
ipcMain.handle('pomodoro:getState', () => pomodoro.getState());

// ------- 检查更新 IPC（供设置窗口调用）-------
ipcMain.handle('app:check-update', () => {
  checkForUpdates(false);
  return APP_VERSION;
});
// 获取当前版本号
ipcMain.handle('app:getVersion', () => APP_VERSION);

// 远程互动（带物品检查）
ipcMain.handle('bind:interact', async (event, { action, itemId }) => {
  const openid = config.bind?.openid
  if (!openid) return { success: false, error: '未绑定' }
  try {
    const result = await callCloudApi('interact', { openid, action, itemId })
    if (result.success) {
      if (result.pet) {
        config.petState = {
          level: result.pet.level, exp: result.pet.exp, expMax: result.pet.expMax,
          hunger: result.pet.hunger, clean: result.pet.clean, mood: result.pet.mood,
          energy: result.pet.energy, health: result.pet.health
        }
      }
      if (result.inventory) {
        config.inventory = result.inventory
      }
      saveConfig()
      broadcastState()
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('pet:action', action)
        if (result.leveledUp) {
          petWindow.webContents.send('pet:levelup', result.level)
        }
      }
    }
    return result
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.on('autostart:set', (event, enable) => {
  config.autoStart = enable;
  saveConfig();
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: process.execPath
  });
});

// 7.5 窗口通用操作（拖动 / 关闭 / 最小化）
ipcMain.on('window:drag', (event, { dx, dy }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }
});

// 拖动状态：主进程统一用 screen 坐标(DIP)计算，避免 DPI 单位混用导致偏移
// （isDragging / dragState 已在文件顶部全局声明）

ipcMain.on('drag:start', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const [w, h] = win.getSize();
  dragState = {
    win,
    w, h,
    startMouse: screen.getCursorScreenPoint(),
    startWinPos: win.getPosition()
  };
  isDragging = true;
});

ipcMain.on('drag:move', (event) => {
  if (!dragState) return;
  const cur = screen.getCursorScreenPoint();
  const newX = dragState.startWinPos[0] + (cur.x - dragState.startMouse.x);
  const newY = dragState.startWinPos[1] + (cur.y - dragState.startMouse.y);
  // 用 setBounds 固定宽高，避免 transparent 窗口 setPosition 的渲染异常
  dragState.win.setBounds({
    x: Math.round(newX),
    y: Math.round(newY),
    width: dragState.w,
    height: dragState.h
  });
});

ipcMain.on('drag:end', (event) => {
  if (dragState && dragState.win && !dragState.win.isDestroyed()) {
    // 拖动结束后保存最终位置
    const [x, y] = dragState.win.getPosition();
    config.position.x = x;
    config.position.y = y;
    saveConfig();
  }
  dragState = null;
  isDragging = false;
});

ipcMain.on('window:close', (event) => {
  const wc = event.sender;
  let win = BrowserWindow.fromWebContents(wc);
  if (!win) {
    try { win = wc.getOwnerBrowserWindow && wc.getOwnerBrowserWindow(); } catch(_) {}
  }
  // 兜底：遍历所有窗口，匹配 webContents
  if (!win) {
    const all = BrowserWindow.getAllWindows();
    for (const w of all) {
      const wcs = w.webContents;
      if (wcs === wc || (wcs.hostWebContents && wcs.hostWebContents === wc)
          || wc.id && wcs.id === wc.id) {
        win = w;
        break;
      }
    }
  }
  if (win && !win.isDestroyed()) {
    console.log('[window:close] 关闭窗口 id=' + win.id);
    win.removeAllListeners('close');
    win.setAlwaysOnTop(false);
    win.hide();
    setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 50);
  } else {
    console.warn('[window:close] 未找到对应窗口，尝试通过 remote.destroy()');
    try { wc.close(); } catch(e) {}
  }
});

ipcMain.on('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

// 7.6 便签相关
ipcMain.on('note:update', (event, { id, content }) => {
  let note = notesData.find(n => n.id === id);
  if (!note) {
    // 新便签首次输入内容时才加入保存
    note = { id, content: '', position: null, createdAt: Date.now() };
    notesData.push(note);
  }
  note.content = content;
  note.updatedAt = Date.now();
  saveNotes();
});

ipcMain.on('note:delete', (event, id) => {
  const idx = notesData.findIndex(n => n.id === id);
  if (idx > -1) {
    notesData.splice(idx, 1);
    saveNotes();
  }
  const noteWin = noteWindows.find(n => n.id === id);
  if (noteWin && !noteWin.win.isDestroyed()) {
    noteWin.win.close();
  }
});

// ============================================================
// 8. 应用生命周期
// ============================================================

// 设置 AppUserModelID（Windows 任务栏图标/缩略图正确识别的关键）
app.setAppUserModelId('com.qubao.desktop-pet');

app.whenReady().then(() => {
  ensurePetImages();
  createPetWindow();
  createTray();
  restoreNotes();
  startStateDecay();

  // 启动后 3 秒静默检查更新（有新版本才弹提示，无新版本不打扰用户）
  setTimeout(() => checkForUpdates(true), 3000);

  if (config.autoStart) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath
    });
  }

  if (config.firstLaunch) {
    createTutorialWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow();
    }
  });
});

// Windows/Linux：所有窗口关闭时退出
app.on('window-all-closed', () => {
  // 注意：桌宠是常驻的，不会被关闭，这里只是兜底
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 防止关闭最后一个可见窗口时整个程序退出
app.on('before-quit', (e) => {
  // 如果不是托盘菜单里点的退出，就阻止退出（让它常驻托盘）
  if (!app.isQuiting) {
    e.preventDefault();
    if (petWindow) petWindow.hide();
  }
});
