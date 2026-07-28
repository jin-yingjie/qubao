// src/menu/script.js
// 互动面板：点击按钮触发对应互动动作
document.querySelectorAll('.interact-item').forEach(item => {
  item.addEventListener('click', () => {
    const action = item.getAttribute('data-action');
    petAPI.interact(action);
    petAPI.closeMenu();
  });
});
