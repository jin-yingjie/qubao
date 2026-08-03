; ============================================================
; 趣宝桌宠 NSIS 安装脚本自定义
; ============================================================

; customInit: 在 .onInit 中、进程检查之前执行
; 这是关闭旧进程的正确时机——在 electron-builder 检测进程是否运行之前
!macro customInit
  ; 使用 PowerShell 按路径匹配关闭进程（避免中文进程名编码问题）
  ; 注意：NSIS 中 $$ 转义为 $，所以 $$_ 转义为 $_
  nsExec::Exec 'powershell -NoProfile -WindowStyle Hidden -Command "Get-Process | Where-Object { $$_.Path -like ''*qubao*'' } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  ; 同时用 taskkill 尝试
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "趣宝.exe" /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "qubao.exe" /T'
!macroend

; customInstall: 写入开机启动标记文件到临时目录
!macro customInstall
  FileOpen $0 "$TEMP\qubao_autostart.tmp" w
  IfErrors +3
    FileWrite $0 "1"
    FileClose $0
!macroend

; customUnInstall: 卸载时清理标记文件
!macro customUnInstall
  Delete "$TEMP\qubao_autostart.tmp"
!macroend
