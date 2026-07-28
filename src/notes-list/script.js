// src/notes-list/script.js - 便签列表逻辑
const container = document.getElementById('notes-container');
const newBtn = document.getElementById('new-btn');

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const h = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${m}-${day} ${h}:${min}`;
}

function renderList(list) {
  if (!list || list.length === 0) {
    container.innerHTML = '<div class="empty-tip">暂无便签，点击右上角新建</div>';
    return;
  }
  // 按更新时间倒序
  const sorted = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  container.innerHTML = '';
  sorted.forEach(note => {
    const item = document.createElement('div');
    item.className = 'note-item';
    const preview = (note.content || '').slice(0, 80) || '(空便签)';
    item.innerHTML = `
      <div class="note-preview">${preview.replace(/</g, '&lt;')}</div>
      <div class="note-meta">
        <span class="note-time">${formatTime(note.updatedAt || note.createdAt)}</span>
        <button class="delete-btn" data-id="${note.id}">删除</button>
      </div>
    `;
    // 点击便签打开
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-btn')) return;
      petAPI.openNote(note.id);
    });
    // 删除按钮
    const delBtn = item.querySelector('.delete-btn');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('确定删除这个便签吗？')) {
        petAPI.deleteNoteFromList(note.id);
      }
    });
    container.appendChild(item);
  });
}

// 接收便签列表
petAPI.onNotesList((list) => renderList(list));

// 新建便签按钮：通过菜单 action 走主进程创建
newBtn.addEventListener('click', () => {
  petAPI.menuAction('note');
  // 刷新列表
  setTimeout(() => petAPI.requestNotesList(), 300);
});

// 初始化时主动请求一次列表
petAPI.requestNotesList();
