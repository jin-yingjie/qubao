// src/note/script.js - 便签逻辑（通过主进程持久化保存）

const textarea = document.getElementById('note-content');
const closeBtn = document.getElementById('closeBtn');
const deleteBtn = document.getElementById('deleteBtn');

let noteId = null;

// 接收主进程传来的便签数据
petAPI.onNoteInit((data) => {
  if (data && data.id) {
    noteId = data.id;
    if (data.content) {
      textarea.value = data.content;
    }
  }
});

// 自动保存（通过主进程保存到磁盘）
let saveTimer = null;
textarea.addEventListener('input', () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (noteId) {
      petAPI.updateNote(noteId, textarea.value);
    }
  }, 300);
});

// 关闭按钮（隐藏窗口，便签保留）
closeBtn.addEventListener('click', () => petAPI.closeWindow());

// 删除按钮（永久删除便签）
deleteBtn.addEventListener('click', () => {
  if (confirm('确定要删除这个便签吗？')) {
    if (noteId) {
      petAPI.deleteNote(noteId);
    } else {
      petAPI.closeWindow();
    }
  }
});
