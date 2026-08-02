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
const crypto = require('crypto');
const PET_IMAGES = require('./src/assets-base64.js');

// 当前版本（来自 package.json，自动更新检测的唯一真源）
const APP_VERSION = require('./package.json').version || '0.0.0';
// GitHub 仓库坐标（用于检查 Releases 最新版本）
const GITHUB_OWNER = 'jin-yingjie';
const GITHUB_REPO = 'qubao';

// ------- 启动日志文件（用于诊断"安装后宠物不显示"类问题） -------
const LOG_FILE = path.join(app.getPath('userData'), 'qubao.log');
const _origLog = console.log;
const _origErr = console.error;
function _ts() { return new Date().toISOString().replace('T', ' ').slice(0, 23); }
console.log = function () { const s = '[' + _ts() + '] ' + Array.from(arguments).map(String).join(' '); _origLog(s); try { fs.appendFileSync(LOG_FILE, s + '\n'); } catch (_) {} };
console.error = function () { const s = '[' + _ts() + '] [ERR] ' + Array.from(arguments).map(String).join(' '); _origErr(s); try { fs.appendFileSync(LOG_FILE, s + '\n'); } catch (_) {} };

console.log('========== 趣宝启动 ==========');
console.log('version:', APP_VERSION);
console.log('process.execPath:', process.execPath);
console.log('__dirname:', __dirname);
console.log('userData:', app.getPath('userData'));
console.log('argv:', process.argv.join(' '));

// ------- 单例锁：防止多实例同时运行导致窗口冲突 -------
if (!app.requestSingleInstanceLock()) {
  console.log('已有实例在运行，本进程退出');
  app.quit();
} else {
  app.on('second-instance', () => {
    console.log('收到 second-instance，尝试聚焦主窗口');
    if (petWindow) {
      if (petWindow.isMinimized()) petWindow.restore();
      petWindow.show();
      petWindow.focus();
    }
  });
}

// 捕获未处理异常，写入日志文件，避免静默崩溃
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

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
let bubbleWindow = null;       // 独立对话气泡窗口（挂在宠物头顶，尺寸随文字自适应）
let isDragging = false;     // 拖动中标志，用于跳过 moved 事件的高频干扰
let dragState = null;       // 拖动状态（窗口起点+鼠标起点）
let bubbleLowPriority = false;  // 当前气泡是否为"弱提示"（如悬停"点我"，可被重要提示覆盖，鼠标移开立即消失）

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
    autoStart: true,
    pomodoro: { soundEnabled: true }
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
        autoStart: saved.autoStart !== undefined ? saved.autoStart : defaults.autoStart, // 旧配置没设过则默认开启
        pomodoro: { ...defaults.pomodoro, ...(saved.pomodoro || {}) }
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
// 云函数调用工具（通过 TCB HTTP API 调用 petApi）
//   - 使用 TC3-HMAC-SHA256 签名认证
//   - URL: https://{env-id}.api.tcloudbasegateway.com/v1/functions/{function-name}
//   - petApi 是普通云函数（非 web 函数），不需要 webfn=true
// ============================================================

const CLOUD_ENV_ID = 'cloud1-d9gjbey4a7a8fd907';
const CLOUD_FUNCTION_NAME = 'petApi';
const CLOUD_SECRET_ID = 'AKIDOsCJDweBUm4IKQVRHwT0a8kEYifQyMZ3';
const CLOUD_SECRET_KEY = 'NYYL3av67xZKyUzRk5NViiV4PYUChz3v';

// TC3-HMAC-SHA256 签名生成
function getTC3Signature(secretKey, date, service, stringToSign) {
  const secretDate = crypto.createHmac('sha256', 'TC3' + secretKey).update(date).digest();
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
  return crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
}

function callCloudApi(action, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action: action, ...data });

    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date().toISOString().substring(0, 10);
    const service = 'tcb';
    const host = `${CLOUD_ENV_ID}.api.tcloudbasegateway.com`;
    const path = `/v1/functions/${CLOUD_FUNCTION_NAME}`;

    // 生成 TC3 签名（无查询参数）
    const contentType = 'application/json; charset=utf-8';
    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:httpinvoke\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const hashedRequestPayload = crypto.createHash('sha256').update(body).digest('hex');
    const canonicalRequest = `POST\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`;
    const algorithm = 'TC3-HMAC-SHA256';
    const credentialScope = `${date}/${service}/tc3_request`;
    const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;
    const signature = getTC3Signature(CLOUD_SECRET_KEY, date, service, stringToSign);

    const authorization = `${algorithm} Credential=${CLOUD_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}, Timestamp=${timestamp}`;

    console.log(`[callCloudApi] action=${action} | path=${path}`);

    const options = {
      hostname: host,
      path: path,
      method: 'POST',
      headers: {
        'Authorization': authorization,
        'Content-Type': contentType,
        'Host': host,
        'X-Tc-Action': 'httpinvoke',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        console.log(`[callCloudApi] 响应状态: ${res.statusCode} | body=`, responseBody.substring(0, 500));

        if (res.statusCode !== 200) {
          reject(new Error(`云函数调用失败(状态码${res.statusCode}): ${responseBody.substring(0, 200)}`));
          return;
        }

        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          reject(new Error('解析云函数响应失败: ' + responseBody.substring(0, 200)));
        }
      });
    });

    req.on('error', (e) => {
      console.error('[callCloudApi] 网络错误:', e.message);
      reject(new Error('网络请求失败: ' + e.message));
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(body);
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
  // 把秒格式化为 HH:MM:SS（>=1 小时时）或 MM:SS
  fmt(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m}:${s}`;
    }
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
  // 更新任务栏进度条 + 窗口标题（仅显示倒计时数字，不显示番茄图标和状态文字）
  updateTaskbar() {
    if (!pomodoroWindow || pomodoroWindow.isDestroyed()) return;
    const ratio = pomodoro.totalSeconds > 0
      ? Math.max(0, Math.min(1, pomodoro.remaining / pomodoro.totalSeconds))
      : 0;
    if (pomodoro.running) {
      pomodoroWindow.setProgressBar(ratio, { mode: 'normal' });
      pomodoroWindow.setTitle(pomodoro.fmt(pomodoro.remaining));
    } else if (pomodoro.remaining < pomodoro.totalSeconds && pomodoro.remaining > 0) {
      pomodoroWindow.setProgressBar(ratio, { mode: 'paused' });
      pomodoroWindow.setTitle(pomodoro.fmt(pomodoro.remaining));
    } else {
      pomodoroWindow.setProgressBar(0, { mode: 'none' });
      pomodoroWindow.setTitle('番茄钟');
    }
    // 把倒计时文字直接画到任务栏按钮图标上
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
      pomodoro.remaining = 0;
      clearInterval(pomodoro.intervalId);
      pomodoro.intervalId = null;
      // 把 running=false、remaining=0 的最新状态推给渲染端，让按钮从"暂停"回到"开始"
      pomodoro.broadcast();
      pomodoro.updateTaskbar();
      if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
        pomodoroWindow.setProgressBar(1, { mode: 'normal' });
        pomodoroWindow.setTitle('时间到');
        // 不再强制 show/focus 番茄钟窗口，避免抢焦点
        pomodoroWindow.webContents.send('pomodoro:finished');
      }
      // 1) 让宠物头顶气泡显示提示（独立气泡窗口，按文字长度自适应宽度）
      showBubble('🎉 番茄钟时间到！休息一下吧～', 5000);
      if (!petWindow || petWindow.isDestroyed()) {
        // 宠物窗口不在，走系统通知兜底
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
      // 2) 闹铃提醒（受用户配置控制，默认开启）
      try {
        if (config.pomodoro?.soundEnabled !== false) {
          // 用 shell.beep 触发系统提示音；连续响 3 次更易听见
          shell.beep();
          setTimeout(() => shell.beep(), 600);
          setTimeout(() => shell.beep(), 1200);
        }
      } catch (_) {}
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
  // 清空任务栏缩略图按钮（用户要求去掉暂停和重置按钮）
  refreshThumbar() {
    if (!pomodoroWindow || pomodoroWindow.isDestroyed()) return;
    try {
      pomodoroWindow.setThumbarButtons([]);
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
  // 生成一张带 🍅 + 时间 + 状态文字 的 PNG 图标，返回 nativeImage（时间 HH:MM:SS 时自动缩小字体避免溢出）
  makeTimerIcon({ timeStr, statusText, running }) {
    const bg = running ? '#ff9d1a' : '#b0b0b0';      // 运行中橙色，暂停灰色
    const subColor = running ? '#fff6e5' : '#e8e8e8';
    // 字长自适应：MM:SS(5字) → 38px；HH:MM:SS(8字) → 26px；中间线性过渡
    const len = (timeStr || '').length;
    const fontSize = len <= 5 ? 38 : (len <= 7 ? 30 : 26);
    const timeY = len <= 5 ? 84 : 80;
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
    <text x="64" y="40" font-size="28">🍅</text>
    <text x="64" y="${timeY}" font-size="${fontSize}" font-weight="700" letter-spacing="1"
          font-family="'Segoe UI','Microsoft YaHei',monospace">${timeStr}</text>
    <text x="64" y="116" font-size="15" font-weight="500" fill="${subColor}">${statusText}</text>
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
  try {
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
      show: false,            // 先不显示，等 ready-to-show / 超时再显示
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
      try { petWindow.show(); petWindow.focus(); } catch (e) { console.error('[createPetWindow] show 失败:', e.message); }
    });

    // 超时强制 show：3 秒后如果 ready-to-show 还没触发（透明窗口在某些显卡上会卡），
    // 直接尝试 show()，避免"宠物不显示"问题
    setTimeout(() => {
      try {
        if (petWindow && !petWindow.isDestroyed() && !petWindow.isVisible()) {
          console.warn('[createPetWindow] 3 秒未 ready-to-show，强制 show');
          petWindow.show();
          petWindow.focus();
        }
      } catch (e) { console.error('[createPetWindow] 强制 show 失败:', e.message); }
    }, 3000);

    // 加载桌宠页面
    petWindow.loadFile(path.join(__dirname, 'src', 'pet', 'index.html'));

  // 仅开发环境下打开 DevTools，生产打包版不再自动弹出
  if (process.argv.includes('--dev') || process.env.NODE_ENV === 'development') {
    petWindow.webContents.openDevTools({ mode: 'detach' });
  }
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
    if (!snapInitialized) { snapInitialized = true; syncBubblePosition(); return; }

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
    // 宠物位置变了 → 气泡跟着走
    syncBubblePosition();
  });

  petWindow.on('show', syncBubblePosition);
  petWindow.on('hide', () => hideBubble());
  petWindow.on('closed', () => {
    if (bubbleWindow && !bubbleWindow.isDestroyed()) {
      try { bubbleWindow.close(); } catch (_) {}
    }
  });

  petWindow.on('blur', () => {
    setTimeout(() => {
      if (menuWindow && !menuWindow.isFocused() && menuWindow.isVisible()) {
        menuWindow.hide();
      }
    }, 200);
  });

  } catch (e) {
    console.error('[createPetWindow] 创建失败:', e && e.stack ? e.stack : e);
    try {
      dialog.showErrorBox('趣宝启动失败', '宠物窗口创建失败：\n' + (e && e.message ? e.message : e) + '\n\n日志文件位置：' + LOG_FILE);
    } catch (_) {}
  }
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
  tray.setToolTip('趣宝 🧸');

  // 动态构建右键菜单：根据宠物当前可见状态显示"隐藏"或"显示"
  function buildTrayMenu() {
    const petVisible = petWindow && !petWindow.isDestroyed() && petWindow.isVisible();
    return Menu.buildFromTemplate([
      { label: petVisible ? '🧸 隐藏' : '🧸 显示', click: () => togglePet() },
      { label: '📝 便签', click: () => createNotesListWindow() },
      { label: '⏰ 番茄钟', click: () => createPomodoroWindow() },
      { label: '⚙️ 设置', click: () => createSettingsWindow() }
    ]);
  }
  function refreshTrayMenu() {
    if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu());
  }
  refreshTrayMenu();

  // 宠物显示/隐藏时同步刷新菜单标签
  if (petWindow) {
    petWindow.on('show', refreshTrayMenu);
    petWindow.on('hide', refreshTrayMenu);
  }

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
// 1.5 独立对话气泡窗口（挂在宠物头顶，尺寸按文字自适应）
//   - 不占任务栏、不可聚焦、鼠标穿透到桌面
//   - 尺寸由 bubble 渲染端测量后上报，主进程 setBounds
//   - 位置始终跟随宠物窗口头顶
// ============================================================
function createBubbleWindow() {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) return bubbleWindow;
  bubbleWindow = new BrowserWindow({
    width: 220,
    height: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,             // 初始隐藏，需要 showBubble 才显示
    movable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  // 与宠物同样的置顶级别，确保贴屏时不会被其他窗口遮挡
  try { bubbleWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
  // 让气泡窗口完全鼠标穿透（点击气泡时直接点到桌面上的图标/窗口）
  try { bubbleWindow.setIgnoreMouseEvents(true, { forward: true }); } catch (_) {}
  bubbleWindow.loadFile(path.join(__dirname, 'src', 'bubble', 'index.html'));
  bubbleWindow.on('closed', () => { bubbleWindow = null; });
  return bubbleWindow;
}

/** 把气泡窗口锚定到宠物头顶上方（水平居中） */
function syncBubblePosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  try {
    const [px, py] = petWindow.getPosition();
    const [pw, ph] = petWindow.getSize();
    const [bw, bh] = bubbleWindow.getSize();
    // 水平：气泡中心与宠物中心对齐
    const bx = Math.round(px + pw / 2 - bw / 2);
    // 垂直：气泡整个贴在宠物窗口顶部之上（尾巴刚好在宠物顶部边缘，衔接视觉上气泡"长"在宠物头上）
    const by = py - bh + 2;   // +2 让尾巴和宠物顶部稍微重叠，视觉无断层
    // 夹在屏幕工作区内，防止跑出屏幕外
    const { workArea } = screen.getPrimaryDisplay();
    const safeX = Math.max(workArea.x, Math.min(bx, workArea.x + workArea.width - bw));
    const safeY = Math.max(workArea.y, Math.min(by, workArea.y + workArea.height - bh));
    bubbleWindow.setPosition(safeX, safeY, false);
  } catch (_) {}
}

/** 显示气泡（文字 + 持续时间，<=0 表示常驻；lowPriority=true 表示弱提示，可被重要提示覆盖且悬停时才显示） */
function showBubble(text, durationMs, lowPriority = false) {
  if (!text) return hideBubble();
  // 如果已有气泡正在显示且是重要提示（非弱提示），新的弱提示不得覆盖它
  if (lowPriority && bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible() && !bubbleLowPriority) return;
  bubbleLowPriority = !!lowPriority;
  const bw = createBubbleWindow();
  const sendAndShow = () => {
    bw.webContents.send('bubble:show', { text, duration: durationMs });
    syncBubblePosition();
    try { bw.showInactive(); } catch (_) {}
  };
  bw.webContents.once('did-finish-load', sendAndShow);
  if (!bw.webContents.isLoading()) sendAndShow();
}

/** 立即隐藏气泡（onlyIfLowPriority=true 时：仅当气泡是弱提示才隐藏，避免把番茄钟等重要提示误关） */
function hideBubble(onlyIfLowPriority = false) {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  if (onlyIfLowPriority && !bubbleLowPriority) return;
  bubbleLowPriority = false;
  try { bubbleWindow.webContents.send('bubble:hide'); } catch (_) {}
}

// 气泡渲染端测量完尺寸 → 主进程 setBounds，然后重新同步位置
ipcMain.on('bubble:report-size', (_e, { w, h }) => {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  const W = Math.max(100, Math.min(420, Math.round(w)));
  const H = Math.max(40,  Math.min(240, Math.round(h)));
  try { bubbleWindow.setBounds({ width: W, height: H }, false); } catch (_) {}
  syncBubblePosition();
});

// 气泡渲染端退场动画结束 → 主进程真正 hide
ipcMain.on('bubble:hidden', () => {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  try { bubbleWindow.hide(); } catch (_) {}
});

// 外部触发显示/隐藏气泡
ipcMain.on('bubble:show', (_e, payload) => {
  showBubble(payload && payload.text, payload && payload.duration, payload && payload.lowPriority);
});
ipcMain.on('bubble:hide', (_e, payload) => {
  hideBubble(payload && payload.onlyIfLowPriority);
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
    // 2) 清空缩略图底部按钮（用户要求去掉暂停和重置按钮）
    pomodoro.refreshThumbar();
    // 3) 同步标题/进度条/UI
    pomodoro.updateTaskbar();
    pomodoro.broadcast();
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

// 广播绑定信息变更（昵称、积分）给所有窗口，无需重新打开即可更新
function broadcastBindInfo() {
  const bindInfo = {
    bound: !!config.bind?.openid,
    nickName: config.bind?.nickName || '',
    points: config.bind?.points || 0
  }
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.webContents.send('bind:updated', bindInfo)
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('bind:updated', bindInfo)
  }
  if (bindWindow && !bindWindow.isDestroyed()) {
    bindWindow.webContents.send('bind:updated', bindInfo)
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
    // 同步更新本地缓存的用户信息
    if (result.success && result.user) {
      config.bind.nickName = result.user.nickName || ''
      config.bind.points = result.user.points || 0
      saveConfig()
      // 广播绑定信息变更，让所有已打开窗口（状态面板/宠物窗口等）即时刷新昵称和积分
      broadcastBindInfo()
    }
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
      // 保存用户信息（昵称、积分）到本地配置
      if (result.user) {
        config.bind.nickName = result.user.nickName || ''
        config.bind.points = result.user.points || 0
      }
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
      // 通知所有窗口（状态面板/宠物窗口等）绑定信息已变更
      broadcastBindInfo()
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
  config.bind.nickName = ''
  config.bind.points = 0
  config.inventory = []
  saveConfig()
  // 通知所有窗口绑定已解除
  broadcastBindInfo()
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
// 番茄钟结束闹铃开关
ipcMain.handle('pomodoro:getSound', () => config.pomodoro?.soundEnabled !== false);
ipcMain.on('pomodoro:setSound', (_e, enabled) => {
  if (!config.pomodoro) config.pomodoro = { soundEnabled: true };
  config.pomodoro.soundEnabled = !!enabled;
  saveConfig();
});

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

ipcMain.handle('autostart:set', async (event, enable) => {
  config.autoStart = enable;
  saveConfig();
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: process.execPath
  });
  // 立即回读系统实际状态，确认是否设置成功
  const actual = app.getLoginItemSettings().openAtLogin;
  // 如果系统实际状态和期望不一致，更新本地配置以反映真实情况
  if (actual !== enable) {
    config.autoStart = actual;
    saveConfig();
  }
  return { success: actual === enable, actual };
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

// 退出整个应用（由设置窗口的"退出趣宝"按钮触发）
ipcMain.on('app:quit', () => {
  app.isQuiting = true;
  app.quit();
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

  // 根据配置同步开机自启状态（首次运行 autoStart 默认 true，会自动注册开机启动）
  app.setLoginItemSettings({
    openAtLogin: !!config.autoStart,
    path: process.execPath
  });
  // 回读系统实际状态，更新本地配置（防止系统拒绝设置后配置与实际不符）
  const actualAutoStart = app.getLoginItemSettings().openAtLogin;
  if (actualAutoStart !== config.autoStart) {
    config.autoStart = actualAutoStart;
    saveConfig();
  }

  if (config.firstLaunch) {
    createTutorialWindow();
  }

  // 开机静默刷新绑定信息（已绑定的用户从云端拉取最新昵称/积分，不影响宠物显示）
  if (config.bind?.openid) {
    setTimeout(async () => {
      try {
        const result = await callCloudApi('bindStatus', { openid: config.bind.openid });
        if (result.success && result.user) {
          config.bind.nickName = result.user.nickName || '';
          config.bind.points = result.user.points || 0;
          saveConfig();
          broadcastBindInfo();
        }
      } catch (_) {}
    }, 5000);
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
