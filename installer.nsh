!include nsDialogs.nsh

Var AutoStartCheckbox

; 在选择安装目录页面之后、安装开始之前，添加自定义页面
!macro customPageAfterChangeDir
  Page custom AutoStartPageCreate AutoStartPageLeave
!macroend

Function AutoStartPageCreate
  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateCheckbox} 0 10u 100% 12u "开机时自动启动趣宝"
  Pop $AutoStartCheckbox
  ; 默认勾选
  ${NSD_SetState} $AutoStartCheckbox ${BST_CHECKED}

  nsDialogs::Show
FunctionEnd

Function AutoStartPageLeave
  ${NSD_GetState} $AutoStartCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    ; 写入标记文件，应用首次启动时读取
    FileOpen $1 "$INSTDIR\.autostart" w
    IfErrors +2
    FileWrite $1 "1"
    FileClose $1
  ${EndIf}
FunctionEnd

; 卸载时清理标记文件
!macro customUnInstall
  Delete "$INSTDIR\.autostart"
!macroend
