const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function (context) {
  const exeName = context.packager.appInfo.productName + '.exe';
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.packager.info.projectDir, 'assets', 'icon.ico');
  const version = context.packager.appInfo.buildVersion || '0.0.0';

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
    console.log('[afterPack] 未找到 rcedit-x64.exe，跳过 exe 资源设置');
    return;
  }

  console.log(`[afterPack] 设置 exe 图标 + 版本信息: ${exePath}`);
  // 设置图标
  execSync(`"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`);
  // 设置版本信息（任务管理器进程名 = FileDescription）
  execSync(`"${rceditPath}" "${exePath}" --set-version-string "FileDescription" "趣宝"`);
  execSync(`"${rceditPath}" "${exePath}" --set-version-string "ProductName" "趣宝"`);
  execSync(`"${rceditPath}" "${exePath}" --set-version-string "CompanyName" "探鑫宝"`);
  execSync(`"${rceditPath}" "${exePath}" --set-version-string "LegalCopyright" "Copyright © 2026 探鑫宝"`);
  execSync(`"${rceditPath}" "${exePath}" --set-version-string "OriginalFilename" "趣宝.exe"`);
  execSync(`"${rceditPath}" "${exePath}" --set-version-string "InternalName" "趣宝"`);
  execSync(`"${rceditPath}" "${exePath}" --set-file-version "${version}"`);
  execSync(`"${rceditPath}" "${exePath}" --set-product-version "${version}"`);
  console.log('[afterPack] 图标 + 版本信息设置成功');
};
