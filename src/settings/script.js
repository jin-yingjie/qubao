// src/settings/script.js
let currentConfig = null;
let pendingImageData = null; // 弹窗中待保存的图片

// 弹窗相关元素
const openCustomBtn = document.getElementById('open-custom-btn');
const customModal = document.getElementById('custom-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const uploadBtn = document.getElementById('upload-btn');
const saveCustomBtn = document.getElementById('save-custom-btn');
const resetCustomBtn = document.getElementById('reset-custom-btn');
const fileInput = document.getElementById('file-input');
const customPreview = document.getElementById('custom-preview');
const customPlaceholder = document.getElementById('custom-placeholder');
const customThumb = document.getElementById('custom-thumb');
const customCharBtn = document.querySelector('.custom-char-btn');
const autostartToggle = document.getElementById('autostart-toggle');
const pomoSoundToggle = document.getElementById('pomo-sound-toggle');

petAPI.onConfigInit(async (config) => {
  currentConfig = config;
  const char = config.pet?.character || 'cat';
  updateCharButtons(char);

  // 如果已有自定义图片，在宠物形象卡片中展示
  if (config.pet?.customImage) {
    customThumb.src = config.pet.customImage;
    customCharBtn.style.display = 'flex';
    // 弹窗预览也显示已有图片
    customPreview.src = config.pet.customImage;
    customPlaceholder.style.display = 'none';
    resetCustomBtn.style.display = 'inline-block';
  }

  try {
    const isAutoStart = await petAPI.getAutoStart();
    autostartToggle.checked = isAutoStart;
  } catch (e) {
    autostartToggle.checked = !!config.autoStart;
  }

  // 番茄钟闹铃开关（默认开启）
  try {
    pomoSoundToggle.checked = await petAPI.pomodoroGetSound();
  } catch (e) {
    pomoSoundToggle.checked = true;
  }
});

// 更新角色按钮高亮状态
function updateCharButtons(char) {
  document.querySelectorAll('.char-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.char === char);
  });
}

// 角色按钮点击（包括自定义）
document.querySelectorAll('.char-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const char = btn.dataset.char;
    // 自定义角色需要有图片才能选
    if (char === 'custom' && !currentConfig.pet?.customImage) {
      return;
    }
    updateCharButtons(char);
    petAPI.updateConfig({ pet: { ...currentConfig.pet, character: char } });
  });
});

// ------- 弹窗逻辑 -------
openCustomBtn.addEventListener('click', () => {
  // 重置待保存状态
  pendingImageData = null;
  // 如果已有自定义图片，预览显示已有图片
  if (currentConfig.pet?.customImage) {
    customPreview.src = currentConfig.pet.customImage;
    customPlaceholder.style.display = 'none';
    saveCustomBtn.disabled = true;
  } else {
    customPreview.src = '';
    customPlaceholder.style.display = 'block';
    saveCustomBtn.disabled = true;
  }
  customModal.style.display = 'flex';
});

modalCloseBtn.addEventListener('click', () => {
  customModal.style.display = 'none';
});

// 点击遮罩关闭
customModal.addEventListener('click', (e) => {
  if (e.target === customModal) {
    customModal.style.display = 'none';
  }
});

// 选择图片
uploadBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('请选择图片文件');
    return;
  }
  const reader = new FileReader();
  reader.onload = (evt) => {
    pendingImageData = evt.target.result;
    customPreview.src = pendingImageData;
    customPlaceholder.style.display = 'none';
    saveCustomBtn.disabled = false;
  };
  reader.readAsDataURL(file);
});

// 保存：应用自定义图片为宠物形象
saveCustomBtn.addEventListener('click', () => {
  if (pendingImageData) {
    // 新上传的图片
    petAPI.updateConfig({
      pet: {
        ...currentConfig.pet,
        character: 'custom',
        customImage: pendingImageData
      }
    });
    currentConfig.pet.customImage = pendingImageData;
    currentConfig.pet.character = 'custom';
    // 更新宠物形象卡片中的缩略图
    customThumb.src = pendingImageData;
    customCharBtn.style.display = 'flex';
    updateCharButtons('custom');
    resetCustomBtn.style.display = 'inline-block';
  }
  customModal.style.display = 'none';
});

// 删除自定义
resetCustomBtn.addEventListener('click', () => {
  pendingImageData = null;
  customPreview.src = '';
  customPlaceholder.style.display = 'block';
  saveCustomBtn.disabled = true;
  resetCustomBtn.style.display = 'none';
  customThumb.src = '';
  customCharBtn.style.display = 'none';
  petAPI.updateConfig({
    pet: {
      ...currentConfig.pet,
      character: 'cat',
      customImage: null
    }
  });
  currentConfig.pet.customImage = null;
  currentConfig.pet.character = 'cat';
  updateCharButtons('cat');
  customModal.style.display = 'none';
});

autostartToggle.addEventListener('change', async () => {
  const want = autostartToggle.checked;
  try {
    const res = await petAPI.setAutoStart(want);
    if (!res || !res.success) {
      // 系统实际状态与期望不一致 → 回弹开关并提示
      autostartToggle.checked = res ? res.actual : !want;
      alert(want ? '开机自启设置失败，可能是系统权限不足。' : '取消开机自启失败，请稍后重试。');
    }
  } catch (e) {
    autostartToggle.checked = !want;
    alert('设置开机启动时发生错误：' + (e.message || e));
  }
});

pomoSoundToggle.addEventListener('change', () => {
  petAPI.pomodoroSetSound(pomoSoundToggle.checked);
});

// ------- 检查更新 -------
const checkUpdateBtn = document.getElementById('check-update-btn');
checkUpdateBtn.addEventListener('click', () => {
  petAPI.checkUpdate();
});

// ------- 退出趣宝 -------
const quitBtn = document.getElementById('quit-btn');
quitBtn.addEventListener('click', () => {
  try { petAPI.appQuit(); } catch (e) {}
});