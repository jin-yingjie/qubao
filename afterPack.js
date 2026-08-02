const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function (context) {
  const exeName = context.packager.appInfo.productName + '.exe';
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.packager.info.projectDir, 'assets', 'icon.ico');

  // 在 winCodeSign 缓存中查找 rcedit-x64.exe
  const cacheDir = path.join(context.packager.info.projectDir, '.electron-cache', 'winCodeSign');
  let rceditPath = null;
  if (fs.existsSync(cacheDir)) {
    for (const dir of fs.readdirSync(cacheDir)) {
      const candidate = path.join(cacheDir, dir, 'rcedit-x64.exe');
      if (fs.existsSync(candidate)) { rceditPath = candidate; break; }
    }
  }

  if (!rceditPath) {
    console.log('[afterPack] 未找到 rcedit-x64.exe，跳过图标设置');
    return;
  }

  console.log(`[afterPack] 设置 exe 图标: ${exePath}`);
  execSync(`"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`);
  console.log('[afterPack] 图标设置成功');
};
