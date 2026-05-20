/**
 * 天脈 AI 聊天助手 — 前端
 * 直接連接後端 API，流式接收 SSE 響應
 */

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════
  // 配置
  // ═══════════════════════════════════════════════════════
  const CONFIG = {
    apiBase: (window.CHAT_CONFIG && window.CHAT_CONFIG.apiBaseUrl) || 'http://localhost:3001/api',
    userId: 'user_' + (localStorage.getItem('tianmai_device_id') || generateId()),
    sessionTimeout: 30 * 60 * 1000  // 30分鐘超時
  };

  // 確保設備ID
  if (!localStorage.getItem('tianmai_device_id')) {
    localStorage.setItem('tianmai_device_id', CONFIG.userId.slice(5));
  }

  // ═══════════════════════════════════════════════════════
  // 狀態
  // ═══════════════════════════════════════════════════════
  const state = {
    isOpen: false,
    isLoading: false,
    currentMode: 'mode_2',
    sessionId: null,
    messages: [],
    settingsOpen: false,
    backendStatus: null
  };

  const MODES = {
    mode_1: { name: '嚴格查詢', icon: '🔒', desc: '只從知識庫提取，零推斷' },
    mode_2: { name: '普通查詢', icon: '📚', desc: '以知識庫為主，可聯想補充' },
    mode_3: { name: '拆解課件', icon: '✂️', desc: '將原始課件拆分為主題文件' },
    mode_4: { name: '新增課件', icon: '📥', desc: '將已拆分課件攝入知識庫' },
    mode_5: { name: '撰寫文章', icon: '✍️', desc: '撰寫文章或整理筆記' },
    mode_6: { name: '健康檢查', icon: '🔍', desc: '知識庫健康檢查' }
  };

  // ═══════════════════════════════════════════════════════
  // Session 管理
  // ═══════════════════════════════════════════════════════

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem('tianmai_chat_session') || 'null');
    } catch { return null; }
  }

  function saveSession(session) {
    localStorage.setItem('tianmai_chat_session', JSON.stringify(session));
  }

  function isNewSession() {
    const session = getSession();
    if (!session) return true;
    if (session.message_count === 0) return true;

    const idle = Date.now() - new Date(session.last_active).getTime();
    return idle > CONFIG.sessionTimeout;
  }

  function createNewSession() {
    const session = {
      session_id: 'sess_' + generateId(),
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
      message_count: 0,
      mode: state.currentMode
    };
    saveSession(session);
    state.sessionId = session.session_id;
    state.messages = [];
    return session;
  }

  function updateSessionActivity() {
    const session = getSession();
    if (session) {
      session.last_active = new Date().toISOString();
      session.message_count = state.messages.length;
      saveSession(session);
    }
  }

  // ═══════════════════════════════════════════════════════
  // DOM 構建
  // ═══════════════════════════════════════════════════════

  function init() {
    // 檢查是否已有 Session
    if (isNewSession()) {
      createNewSession();
    } else {
      const session = getSession();
      state.sessionId = session.session_id;
      state.currentMode = session.mode || 'mode_2';
    }

    // 創建 DOM
    createChatDOM();

    // 檢查後端狀態
    checkBackend();

    console.log('🤖 天脈 AI 聊天助手已初始化');
  }

  function createChatDOM() {
    // 懸浮按鈕
    const floatBtn = document.createElement('button');
    floatBtn.className = 'chat-float-btn';
    floatBtn.innerHTML = '🤖';
    floatBtn.title = '天脈 AI 助手';
    floatBtn.onclick = toggleChat;
    document.body.appendChild(floatBtn);

    // 聊天面板
    const panel = document.createElement('div');
    panel.className = 'chat-panel';
    panel.id = 'tianmai-chat-panel';
    panel.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-left">
          <span class="chat-header-icon">🤖</span>
          <span class="chat-header-title">天脈 AI 助手</span>
          <span class="chat-header-mode" id="chat-mode-badge">${MODES[state.currentMode].icon} ${MODES[state.currentMode].name}</span>
        </div>
        <div class="chat-header-btns">
          <button class="chat-header-btn" id="chat-settings-btn" title="設置">⚙️</button>
          <button class="chat-header-btn" id="chat-new-btn" title="新對話">📝</button>
          <button class="chat-header-btn" id="chat-close-btn" title="關閉">✕</button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-area">
        <textarea class="chat-input" id="chat-input" placeholder="請輸入您的問題..." rows="1"></textarea>
        <button class="chat-send-btn" id="chat-send-btn">發送</button>
      </div>
      <div class="chat-settings" id="chat-settings">
        <div class="chat-settings-title">設置</div>
        <div class="chat-settings-row">
          <label class="chat-settings-label">當前模式</label>
          <select class="chat-settings-select" id="settings-mode">
            ${Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${k === state.currentMode ? 'selected' : ''}>${v.icon} ${v.name}</option>`).join('')}
          </select>
        </div>
        <div class="chat-settings-row">
          <label class="chat-settings-label">快捷指令</label>
          <button class="chat-settings-btn" onclick="window.tianmaiChat.clearConversation()">🗑️ 清空當前對話</button>
        </div>
        <div class="chat-settings-row">
          <button class="chat-settings-btn" onclick="window.tianmaiChat.exportConversation()">📤 導出對話</button>
        </div>
        <div class="chat-settings-status" id="backend-status">
          <span style="color:#999">檢查連接中...</span>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // 綁定事件
    document.getElementById('chat-close-btn').onclick = toggleChat;
    document.getElementById('chat-new-btn').onclick = newConversation;
    document.getElementById('chat-settings-btn').onclick = toggleSettings;
    document.getElementById('chat-send-btn').onclick = sendMessage;
    document.getElementById('chat-input').addEventListener('keydown', handleInputKeydown);
    document.getElementById('settings-mode').addEventListener('change', handleModeChange);

    // 點擊面板外部關閉設置
    document.addEventListener('click', (e) => {
      const settings = document.getElementById('chat-settings');
      const settingsBtn = document.getElementById('chat-settings-btn');
      if (state.settingsOpen && !settings.contains(e.target) && e.target !== settingsBtn) {
        toggleSettings();
      }
    });
  }

  // ═══════════════════════════════════════════════════════
  // UI 操作
  // ═══════════════════════════════════════════════════════

  function toggleChat() {
    const panel = document.getElementById('tianmai-chat-panel');
    state.isOpen = !state.isOpen;
    panel.classList.toggle('active', state.isOpen);

    if (state.isOpen && state.messages.length === 0) {
      // 新對話，輸出問候語
      showGreeting();
    }

    if (state.isOpen) {
      setTimeout(() => document.getElementById('chat-input').focus(), 100);
    }
  }

  function toggleSettings() {
    const settings = document.getElementById('chat-settings');
    state.settingsOpen = !state.settingsOpen;
    settings.classList.toggle('active', state.settingsOpen);
  }

  function newConversation() {
    createNewSession();
    clearMessages();
    showGreeting();
    toggleSettings();
  }

  function clearMessages() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    state.messages = [];
  }

  function handleModeChange(e) {
    state.currentMode = e.target.value;
    document.getElementById('chat-mode-badge').textContent =
      `${MODES[state.currentMode].icon} ${MODES[state.currentMode].name}`;
    updateSessionActivity();
  }

  function handleInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ═══════════════════════════════════════════════════════
  // 消息渲染
  // ═══════════════════════════════════════════════════════

  function renderMessage(role, content, options = {}) {
    const container = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = role === 'user' ? 'chat-user-msg' : 'chat-ai-msg';

    if (role === 'assistant') {
      msgDiv.innerHTML = `<div class="msg-content">${formatContent(content)}</div>`;
    } else {
      msgDiv.textContent = content;
    }

    if (options.id) msgDiv.dataset.msgId = options.id;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv;
  }

  function appendToLastMessage(text, targetMsgDiv) {
    const container = document.getElementById('chat-messages');
    const msgDiv = targetMsgDiv || container.querySelector('.chat-ai-msg:last-of-type');
    if (msgDiv) {
      const contentDiv = msgDiv.querySelector('.msg-content');
      if (contentDiv) {
        // 累積原始文本，然後重新渲染
        const currentText = contentDiv.dataset.raw || '';
        const newText = currentText + text;
        contentDiv.dataset.raw = newText;
        contentDiv.innerHTML = formatContent(newText);
      }
    }
    container.scrollTop = container.scrollHeight;
  }

  function formatContent(text) {
    if (!text) return '';

    // 處理 Markdown 基礎格式
    let html = escapeHtml(text);

    // 代碼塊
    html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
      return `<pre><code>${escapeHtml(code.replace(/^\n/, ''))}</code></pre>`;
    });

    // 行內代碼
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 粗體
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 斜體
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 標題
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

    // 引用塊
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // 分隔線
    html = html.replace(/^---$/gm, '<hr>');

    // 列表
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.+<\/li>\n?)+)/g, '<ul>$1</ul>');

    // 來源標記 📚 / 💡
    html = html.replace(/📚 知識庫：/g, '<span class="source-tag wiki">📚 知識庫</span>');
    html = html.replace(/💡 補充理解：/g, '<span class="source-tag ai">💡 補充</span>');

    // 換行
    html = html.replace(/\n/g, '<br>');

    // 清理多餘 br
    html = html.replace(/(<br>){3,}/g, '<br><br>');

    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showLoading() {
    const container = document.getElementById('chat-messages');
    const loading = document.createElement('div');
    loading.className = 'chat-loading';
    loading.id = 'chat-loading-indicator';
    loading.innerHTML = `
      <div class="chat-loading-dot"></div>
      <div class="chat-loading-dot"></div>
      <div class="chat-loading-dot"></div>
    `;
    container.appendChild(loading);
    container.scrollTop = container.scrollHeight;
  }

  function hideLoading() {
    const loading = document.getElementById('chat-loading-indicator');
    if (loading) loading.remove();
  }

  // ═══════════════════════════════════════════════════════
  // 問候語
  // ═══════════════════════════════════════════════════════

  function showGreeting() {
    const greeting = `你好，我是天脈 AI 知識庫系統。

知識庫快照（2026-04-30）：
- 總文件數：420（正本 367 / 指針 53）
- 課程覆蓋：L1 / L2 / L3 / L4 / L6 / L7
- 待處理：L5 尚未攝入

請問您需要：`;

    renderMessage('assistant', greeting);

    // 顯示模式選項按鈕
    const container = document.getElementById('chat-messages');
    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'mode-options';
    optionsDiv.innerHTML = Object.entries(MODES).map(([key, mode]) => `
      <button class="mode-option" data-mode="${key}">
        <span class="mode-option-num">${mode.icon}</span>
        <span class="mode-option-text">${mode.name}<br><span class="mode-option-desc">${mode.desc}</span></span>
      </button>
    `).join('');

    optionsDiv.querySelectorAll('.mode-option').forEach(btn => {
      btn.onclick = () => {
        state.currentMode = btn.dataset.mode;
        document.getElementById('chat-mode-badge').textContent =
          `${MODES[state.currentMode].icon} ${MODES[state.currentMode].name}`;
        document.getElementById('settings-mode').value = state.currentMode;
        renderMessage('user', `選擇模式：${MODES[state.currentMode].name}`);
        // 模式選擇後給出對應提示
        const modeHints = {
          mode_1: '已切換到嚴格模式。請輸入您的查詢，我將只從知識庫提取答案。',
          mode_2: '已切換到普通模式。請輸入您的查詢，我將以知識庫為主，可適當補充理解。',
          mode_3: '已切換到拆解課件模式。請提供要拆解的課件內容或上傳文件。',
          mode_4: '已切換到 Ingest 模式。請提供要攝入的課件文件。',
          mode_5: '已切換到撰寫文章模式。請告訴我您要寫什麼主題。',
          mode_6: '已切換到健康檢查模式。我將檢查知識庫的一致性問題。'
        };
        renderMessage('assistant', modeHints[state.currentMode]);
      };
    });

    container.appendChild(optionsDiv);
    container.scrollTop = container.scrollHeight;
  }

  // ═══════════════════════════════════════════════════════
  // 發送消息
  // ═══════════════════════════════════════════════════════

  async function sendMessage() {
    if (state.isLoading) return;

    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    // 快捷指令處理
    if (text.startsWith('/')) {
      handleCommand(text);
      input.value = '';
      return;
    }

    // 渲染用戶消息
    renderMessage('user', text);
    input.value = '';
    input.rows = 1;

    // 更新狀態
    state.isLoading = true;
    state.messages.push({ role: 'user', content: text });
    updateSessionActivity();
    showLoading();
    document.getElementById('chat-send-btn').disabled = true;

    try {
      // 創建 AI 消息佔位
      const aiMsgDiv = renderMessage('assistant', '');
      aiMsgDiv.querySelector('.msg-content').dataset.raw = '';

      // 發送請求
      const response = await fetch(`${CONFIG.apiBase}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          session_id: state.sessionId,
          mode: state.currentMode,
          user_id: CONFIG.userId
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // 讀取 SSE 流
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;

          const dataStr = line.slice(6);
          try {
            const data = JSON.parse(dataStr);

            if (data.chunk) {
              fullText += data.chunk;
              appendToLastMessage(data.chunk, aiMsgDiv);
            }

            if (data.done) {
              if (data.session_id) state.sessionId = data.session_id;
              state.messages.push({ role: 'assistant', content: fullText });
              updateSessionActivity();
            }

            if (data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            if (e.message !== 'Unexpected end of JSON input') {
              console.warn('SSE parse error:', e);
            }
          }
        }
      }

    } catch (error) {
      console.error('發送失敗:', error);
      hideLoading();
      renderMessage('assistant', `❌ 發送失敗：${error.message}\n\n請檢查後端服務是否運行（http://localhost:3001）`);
    } finally {
      state.isLoading = false;
      hideLoading();
      document.getElementById('chat-send-btn').disabled = false;
      document.getElementById('chat-input').focus();
    }
  }

  // ═══════════════════════════════════════════════════════
  // 快捷指令
  // ═══════════════════════════════════════════════════════

  function handleCommand(text) {
    const parts = text.slice(1).split(' ');
    const cmd = parts[0];
    const arg = parts[1];

    switch (cmd) {
      case 'mode':
        if (MODES['mode_' + arg]) {
          state.currentMode = 'mode_' + arg;
          document.getElementById('chat-mode-badge').textContent =
            `${MODES[state.currentMode].icon} ${MODES[state.currentMode].name}`;
          document.getElementById('settings-mode').value = state.currentMode;
          renderMessage('system', `已切換到 ${MODES[state.currentMode].name}`);
        } else {
          renderMessage('system', '可用模式: /mode 1~6');
        }
        break;
      case 'clear':
        clearMessages();
        renderMessage('system', '對話已清空');
        break;
      case 'new':
        newConversation();
        break;
      default:
        renderMessage('system', '可用指令: /mode 1-6, /clear, /new');
    }
  }

  // ═══════════════════════════════════════════════════════
  // 後端狀態檢查
  // ═══════════════════════════════════════════════════════

  async function checkBackend() {
    try {
      const res = await fetch(`${CONFIG.apiBase}/health`, { method: 'GET' });
      const data = await res.json();
      state.backendStatus = data;

      const statusEl = document.getElementById('backend-status');
      if (statusEl) {
        if (data.status === 'ok') {
          statusEl.innerHTML = `🟢 後端正常 | 知識庫 ${data.kb_stats?.total_files || '?'} 文件`;
          statusEl.className = 'chat-settings-status ok';
        } else {
          statusEl.innerHTML = `🟡 後端異常`;
          statusEl.className = 'chat-settings-status err';
        }
      }
    } catch (e) {
      state.backendStatus = null;
      const statusEl = document.getElementById('backend-status');
      if (statusEl) {
        statusEl.innerHTML = `🔴 無法連接後端<br><small>http://localhost:3001</small>`;
        statusEl.className = 'chat-settings-status err';
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // 導出/導入
  // ═══════════════════════════════════════════════════════

  function clearConversation() {
    clearMessages();
    renderMessage('system', '對話已清空');
    toggleSettings();
  }

  function exportConversation() {
    if (state.messages.length === 0) {
      alert('當前對話為空');
      return;
    }

    const text = state.messages.map(m => {
      const role = m.role === 'user' ? '【用戶】' : '【AI】';
      return `${role}\n${m.content}\n`;
    }).join('\n---\n\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `天脈對話_${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    toggleSettings();
  }

  // ═══════════════════════════════════════════════════════
  // 暴露全局方法
  // ═══════════════════════════════════════════════════════

  window.tianmaiChat = {
    toggle: toggleChat,
    newConversation,
    clearConversation,
    exportConversation,
    send: sendMessage
  };

  // 啟動
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
