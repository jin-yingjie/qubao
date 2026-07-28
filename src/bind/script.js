// src/bind/script.js - 绑定窗口逻辑
const codeInput = document.getElementById('code-input')
const bindBtn = document.getElementById('bind-btn')
const msgBox = document.getElementById('msg-box')
const unboundView = document.getElementById('unbound-view')
const boundView = document.getElementById('bound-view')
const boundUser = document.getElementById('bound-user')
const boundPoints = document.getElementById('bound-points')
const syncBtn = document.getElementById('sync-btn')
const unbindBtn = document.getElementById('unbind-btn')
const syncMsg = document.getElementById('sync-msg')

function showMsg(el, text, type) {
  el.textContent = text
  el.className = 'msg-box ' + (type || '')
}

// 初始化：查询绑定状态
async function init() {
  try {
    const status = await petAPI.getBindStatus()
    if (status.success && status.bound) {
      showBoundView(status)
    } else {
      unboundView.style.display = 'block'
      boundView.style.display = 'none'
    }
  } catch (e) {
    showMsg(msgBox, '查询状态失败：' + e.message, 'error')
  }
}

// 显示已绑定视图
function showBoundView(status) {
  unboundView.style.display = 'none'
  boundView.style.display = 'block'
  boundUser.textContent = '👤 ' + (status.user?.nickName || '探鑫宝用户')
  boundPoints.textContent = '💰 ' + (status.user?.points || 0) + ' 金币'
}

// 绑定按钮
bindBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim()
  if (code.length !== 6) {
    showMsg(msgBox, '请输入6位配对码', 'error')
    return
  }

  bindBtn.disabled = true
  showMsg(msgBox, '正在验证...', 'loading')

  try {
    const result = await petAPI.bindWithCode(code)
    if (result.success) {
      showMsg(msgBox, '✅ 绑定成功！正在同步数据...', 'success')
      // 自动同步一次数据
      setTimeout(async () => {
        await petAPI.syncPetData()
        const status = await petAPI.getBindStatus()
        if (status.success) showBoundView(status)
      }, 1000)
    } else {
      showMsg(msgBox, result.error || '绑定失败', 'error')
      bindBtn.disabled = false
    }
  } catch (e) {
    showMsg(msgBox, '绑定失败：' + e.message, 'error')
    bindBtn.disabled = false
  }
})

// 回车提交
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') bindBtn.click()
})
// 只允许输入数字
codeInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '')
})

// 立即同步
syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true
  showMsg(syncMsg, '同步中...', 'loading')
  try {
    const result = await petAPI.syncPetData()
    if (result.success) {
      showMsg(syncMsg, '✅ 同步成功', 'success')
      // 刷新显示
      const status = await petAPI.getBindStatus()
      if (status.success) showBoundView(status)
    } else {
      showMsg(syncMsg, result.error || '同步失败', 'error')
    }
  } catch (e) {
    showMsg(syncMsg, '同步失败：' + e.message, 'error')
  }
  syncBtn.disabled = false
})

// 解除绑定
unbindBtn.addEventListener('click', async () => {
  if (!confirm('确定解除绑定吗？本地数据将保留，但不再与小程序同步。')) return
  petAPI.unbind()
  unboundView.style.display = 'block'
  boundView.style.display = 'none'
  codeInput.value = ''
  showMsg(msgBox, '已解除绑定', 'success')
})

init()