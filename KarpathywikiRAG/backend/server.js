/**
 * 天脈知識庫後端服務
 * 職責：知識庫讀取 + LLM API 代理
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import matter from 'gray-matter';

// 加載環境變量
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// 配置
const KB_DIR = path.resolve(__dirname, process.env.KB_DIR || '../knowledge_base');
const MEMORY_DIR = path.resolve(__dirname, process.env.MEMORY_DIR || './data/memory');
const CONVERSATION_DIR = path.resolve(__dirname, process.env.CONVERSATION_DIR || './data/conversations');
const API_KEY = process.env.ANTHROPIC_API_KEY;
const API_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.kimi.com/coding';

// 中間件
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// 確保數據目錄存在
fs.mkdirSync(MEMORY_DIR, { recursive: true });
fs.mkdirSync(CONVERSATION_DIR, { recursive: true });

// ═══════════════════════════════════════════════════════
// 知識庫索引 (啟動時加載到內存)
// ═══════════════════════════════════════════════════════

let kbIndex = {
  version: '',
  concepts: [],
  courses: [],
  metadata: null,
  snapshot: {
    total_files: 0,
    canonical: 0,
    pointer: 0,
    courses: '(待填充)',
    pending: '请在 knowledge_base/raw/ 与 wiki/ 中放入您的资料',
    updated: '—'
  }
};

function loadKnowledgeBase() {
  console.log('📚 正在加載知識庫...');
  console.log(`   路徑: ${KB_DIR}`);

  // 1. 掃描概念頁
  const graphDir = path.join(KB_DIR, 'wiki/3.主题图谱');
  if (fs.existsSync(graphDir)) {
    for (const file of fs.readdirSync(graphDir)) {
      if (!file.endsWith('.md') || file.startsWith('._')) continue;
      try {
        const raw = fs.readFileSync(path.join(graphDir, file), 'utf-8');
        const { data, content } = matter(raw);
        kbIndex.concepts.push({
          title: data.title || file.replace('.md', ''),
          slug: file.replace('.md', ''),
          path: `wiki/3.主题图谱/${file}`,
          fullPath: path.join(graphDir, file),
          category: data.category || '未分類',
          courses: normalizeCourses(data.courses),
          excerpt: content.slice(0, 3000)
        });
      } catch (e) {
        console.warn(`   ⚠️ 讀取概念頁失敗: ${file}`);
      }
    }
  }

  // 2. 掃描課程索引
  const courseDir = path.join(KB_DIR, 'wiki/2.课件分析');
  const courses = [
    { key: 'L1', label: 'L1 公開課', dir: 'L1_公开课' },
    { key: 'L2', label: 'L2 任督二脈', dir: 'L2_任督二脉' },
    { key: 'L3', label: 'L3 中脈', dir: 'L3_中脉' },
    { key: 'L4', label: 'L4 法身', dir: 'L4_法身' },
    { key: 'L6', label: 'L6 經天會', dir: 'L6_經天會' },
    { key: 'L7', label: 'L7 共修', dir: 'L7_共修' }
  ];

  for (const c of courses) {
    const indexPath = path.join(courseDir, c.dir, 'index.md');
    if (fs.existsSync(indexPath)) {
      try {
        const raw = fs.readFileSync(indexPath, 'utf-8');
        const { data, content } = matter(raw);
        kbIndex.courses.push({
          key: c.key,
          label: c.label,
          path: `wiki/2.课件分析/${c.dir}/index.md`,
          fullPath: indexPath,
          excerpt: content.slice(0, 3000)
        });
      } catch (e) {
        console.warn(`   ⚠️ 讀取課程索引失敗: ${c.key}`);
      }
    }
  }

  // 3. 讀取 metadata.json
  const metadataPath = path.join(KB_DIR, 'wiki/metadata.json');
  if (fs.existsSync(metadataPath)) {
    try {
      kbIndex.metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      if (Array.isArray(kbIndex.metadata)) {
        kbIndex.snapshot.total_files = kbIndex.metadata.length;
        kbIndex.snapshot.canonical = kbIndex.metadata.filter(m => !m.is_pointer).length;
        kbIndex.snapshot.pointer = kbIndex.metadata.filter(m => m.is_pointer).length;
      }
    } catch (e) {
      console.warn('   ⚠️ 讀取 metadata.json 失敗');
    }
  }

  // 4. 讀取 CLAUDE.md 等配置
  const claudePath = path.join(KB_DIR, 'CLAUDE.md');
  if (fs.existsSync(claudePath)) {
    kbIndex.claudeMd = fs.readFileSync(claudePath, 'utf-8');
  }
  const overviewPath = path.join(KB_DIR, 'overview.md');
  if (fs.existsSync(overviewPath)) {
    kbIndex.overview = fs.readFileSync(overviewPath, 'utf-8');
  }
  const purposePath = path.join(KB_DIR, 'purpose.md');
  if (fs.existsSync(purposePath)) {
    kbIndex.purpose = fs.readFileSync(purposePath, 'utf-8');
  }

  console.log(`✅ 知識庫加載完成: ${kbIndex.concepts.length} 個概念頁, ${kbIndex.courses.length} 個課程索引`);
}

function normalizeCourses(courses) {
  if (!courses) return '';
  if (Array.isArray(courses)) return courses.join(' / ');
  return String(courses);
}

// ═══════════════════════════════════════════════════════
// 知識庫搜索
// ═══════════════════════════════════════════════════════

function searchKB(query, limit = 5) {
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);
  if (keywords.length === 0) return [];

  const results = [];

  // 概念頁匹配
  for (const concept of kbIndex.concepts) {
    let score = 0;
    const titleLower = (concept.title || '').toLowerCase();
    const textLower = ((concept.title || '') + ' ' + (concept.excerpt || '')).toLowerCase();

    for (const kw of keywords) {
      if (titleLower.includes(kw)) score += 10;
      if (textLower.includes(kw)) score += 1;
    }

    if (score > 0) {
      results.push({ type: 'concept', score, ...concept });
    }
  }

  // 課程索引匹配
  for (const course of kbIndex.courses) {
    let score = 0;
    const labelLower = (course.label || '').toLowerCase();
    const textLower = ((course.label || '') + ' ' + (course.excerpt || '')).toLowerCase();

    for (const kw of keywords) {
      if (labelLower.includes(kw)) score += 8;
      if (textLower.includes(kw)) score += 1;
    }

    if (score > 0) {
      results.push({ type: 'course', score, ...course });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// 讀取完整文件內容
function readFileContent(filePath) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(KB_DIR, filePath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    // 嘗試解析 YAML frontmatter
    try {
      const { content } = matter(raw);
      return content;
    } catch {
      return raw;
    }
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// System Prompt 構建
// ═══════════════════════════════════════════════════════

function buildSystemPrompt({ mode, contextFiles }) {
  const modeDesc = {
    mode_1: `【嚴格問答模式 — 鐵律】
你是天脈修煉助手，專為弟子解答修煉疑問。所有答案只能來自下方提供的知識庫文件內容。
- 每句話必須標注來源文件路徑
- 如果提供的文件中找不到相關信息，必須回答：「知識庫中未找到關於『XXX』的資料。」
- 禁止推斷、聯想、補充任何庫外知識
- 語氣親切、平和，適合指導弟子修煉`,
    mode_2: `【修煉問答模式】
你是天脈修煉助手，專為弟子解答修煉路上的疑問。以知識庫為第一來源，可補充理解，但每段必須標記來源：
- 📚 知識庫：[文件路徑] — 內容
- 💡 補充理解：AI 的解讀、類比或延伸（非知識庫原文）
語氣親切、有智慧，適合引導弟子理解修煉概念。如庫內無資料，說明後再給出理解。`,
    mode_3: '【拆解課件工作流】引導用戶完成課件拆分。',
    mode_4: '【Ingest 工作流】引導用戶將新課件攝入知識庫。每次只處理一個文件。',
    mode_5: `【弟子指引模式】
你是天脈修煉助手，根據弟子描述的修煉狀況，結合知識庫提供個性化的修煉指導。
- 先理解弟子的修煉阶段和問題
- 從知識庫提取相關概念和功法指導（📚 標記）
- 給出具體的修煉建議和注意事項（💡 標記）
- 語氣溫暖、鼓勵，如導師指引弟子前行`,
    mode_6: '【健康檢查】只檢查庫內一致性，不推斷。'
  };

  const fileContents = contextFiles.map(f => {
    const content = readFileContent(f.fullPath || f.path);
    return content ? `【${f.path}】\n${content.slice(0, 4000)}` : `【${f.path}】\n(無法讀取文件內容)`;
  }).join('\n\n---\n\n');

  return `你是天脈修煉助手，協助弟子解答修煉問題。知識庫涵蓋 ${kbIndex.snapshot.total_files} 個天脈課程文件，覆蓋 L1-L7 全課程體系。

=== 知識庫狀態 (${kbIndex.snapshot.updated}) ===
總文件數: ${kbIndex.snapshot.total_files}（正本 ${kbIndex.snapshot.canonical} / 指針 ${kbIndex.snapshot.pointer}）
課程覆蓋: ${kbIndex.snapshot.courses}
待處理: ${kbIndex.snapshot.pending}

=== 當前模式 ===
${modeDesc[mode] || modeDesc.mode_2}

=== 核心原則 ===
1. 以修煉指導為核心，語氣親切平和，如師長引導弟子
2. 來源標記：每段必須標記 📚（知識庫）或 💡（補充理解）
3. 以知識庫原文為準，補充理解需明確標注
4. 對弟子的修煉疑問給予具體、實用的指導

=== 相關知識庫文件 ===
${fileContents || '(未檢索到相關文件，請基於天脈修煉整體框架回答，或說明「未找到」)'}
`;
}

// ═══════════════════════════════════════════════════════
// 記憶管理
// ═══════════════════════════════════════════════════════

function getMemoryPath(userId) {
  return path.join(MEMORY_DIR, `${userId}.json`);
}

function loadMemory(userId) {
  const file = getMemoryPath(userId);
  if (!fs.existsSync(file)) {
    return createDefaultMemory(userId);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return createDefaultMemory(userId);
  }
}

function saveMemory(userId, memory) {
  const file = getMemoryPath(userId);
  memory.updated_at = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(memory, null, 2), 'utf-8');
}

function createDefaultMemory(userId) {
  return {
    user_id: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    profile: { role: 'student', preferred_mode: 'mode_2' },
    short_term: { recent_queries: [] },
    long_term: { custom_rules: [], bookmarks: [] },
    feedback: { corrections: [] }
  };
}

function updateMemoryFromQuery(memory, query, mode) {
  memory.short_term.recent_queries.unshift({
    query,
    mode,
    timestamp: new Date().toISOString()
  });
  if (memory.short_term.recent_queries.length > 10) {
    memory.short_term.recent_queries.pop();
  }

  // 統計模式使用次數
  if (!memory.profile.mode_counts) memory.profile.mode_counts = {};
  memory.profile.mode_counts[mode] = (memory.profile.mode_counts[mode] || 0) + 1;

  // 超過3次自動更新偏好模式
  const maxCount = Math.max(...Object.values(memory.profile.mode_counts));
  const preferred = Object.entries(memory.profile.mode_counts)
    .find(([k, v]) => v === maxCount)?.[0];
  if (preferred && memory.profile.mode_counts[preferred] >= 3) {
    memory.profile.preferred_mode = preferred;
  }

  return memory;
}

// ═══════════════════════════════════════════════════════
// 對話歷史
// ═══════════════════════════════════════════════════════

function getConversationPath(sessionId) {
  return path.join(CONVERSATION_DIR, `${sessionId}.json`);
}

function loadConversation(sessionId) {
  const file = getConversationPath(sessionId);
  if (!fs.existsSync(file)) {
    return { id: sessionId, messages: [], created_at: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return { id: sessionId, messages: [], created_at: new Date().toISOString() };
  }
}

function saveConversation(sessionId, conversation) {
  const file = getConversationPath(sessionId);
  conversation.updated_at = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(conversation, null, 2), 'utf-8');
}

function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ═══════════════════════════════════════════════════════
// API 路由
// ═══════════════════════════════════════════════════════

// 健康檢查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    kb_loaded: kbIndex.concepts.length > 0,
    llm_ready: !!API_KEY,
    kb_stats: kbIndex.snapshot
  });
});

// 知識庫搜索
app.get('/api/search', (req, res) => {
  const q = req.query.q || '';
  const limit = parseInt(req.query.limit) || 5;
  const results = searchKB(q, limit);
  res.json({ query: q, results });
});

// 獲取記憶
app.get('/api/memory', (req, res) => {
  const userId = req.query.user_id || 'anonymous';
  const memory = loadMemory(userId);
  res.json(memory);
});

// 更新記憶
app.patch('/api/memory', (req, res) => {
  const userId = req.body.user_id || 'anonymous';
  const memory = loadMemory(userId);

  if (req.body.profile) Object.assign(memory.profile, req.body.profile);
  if (req.body.custom_rules) memory.long_term.custom_rules = req.body.custom_rules;
  if (req.body.bookmarks) memory.long_term.bookmarks = req.body.bookmarks;

  saveMemory(userId, memory);
  res.json(memory);
});

// 獲取對話歷史
app.get('/api/conversations', (req, res) => {
  const userId = req.query.user_id || 'anonymous';
  const files = fs.readdirSync(CONVERSATION_DIR).filter(f => f.endsWith('.json'));
  const conversations = files.map(f => {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(CONVERSATION_DIR, f), 'utf-8'));
      return {
        id: c.id,
        title: c.title || '未命名對話',
        message_count: c.messages?.length || 0,
        updated_at: c.updated_at,
        created_at: c.created_at
      };
    } catch { return null; }
  }).filter(Boolean)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  res.json({ conversations });
});

// 獲取單個對話
app.get('/api/conversations/:id', (req, res) => {
  const conv = loadConversation(req.params.id);
  res.json(conv);
});

// 刪除對話
app.delete('/api/conversations/:id', (req, res) => {
  const file = getConversationPath(req.params.id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
// 核心：聊天接口 (SSE 流式)
// ═══════════════════════════════════════════════════════

app.post('/api/chat', async (req, res) => {
  const { message, session_id, mode = 'mode_2', user_id = 'anonymous' } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'LLM API Key not configured' });
  }

  console.log(`💬 [${user_id}] ${mode}: ${message.slice(0, 50)}...`);

  // 1. 加載/創建會話
  const sessionId = session_id || generateSessionId();
  const conversation = loadConversation(sessionId);
  const isNewSession = conversation.messages.length === 0;

  // 2. 加載記憶
  const memory = loadMemory(user_id);

  // 3. 知識庫檢索 (非工作流模式下)
  let contextFiles = [];
  if (mode === 'mode_1' || mode === 'mode_2') {
    contextFiles = searchKB(message, 3);
    console.log(`   📚 檢索到 ${contextFiles.length} 個相關文件`);
  }

  // 4. 構建 System Prompt
  const systemPrompt = buildSystemPrompt({ mode, contextFiles });

  // 5. 構建消息歷史
  const apiMessages = [];

  // 添加歷史消息 (最多保留最近 10 條)
  const recentMessages = conversation.messages.slice(-10);
  for (const m of recentMessages) {
    if (m.role === 'user' || m.role === 'assistant') {
      apiMessages.push({ role: m.role, content: m.content });
    }
  }

  // 添加當前消息
  apiMessages.push({ role: 'user', content: message });

  // 6. 保存用戶消息到對話歷史
  conversation.messages.push({
    role: 'user',
    content: message,
    timestamp: new Date().toISOString()
  });

  // 7. 設置 SSE 響應頭
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let fullResponse = '';

  try {
    // 8. 調用 LLM API（非流式，Kimi For Coding 不支持流式）
    const apiBody = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      temperature: mode === 'mode_1' ? 0 : 0.7,
      messages: apiMessages,
      system: systemPrompt
      // 注意: stream 不傳，默認 false
    };

    const apiRes = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(apiBody)
    });

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      console.error('LLM API error:', apiRes.status, errorText);
      res.write(`data: ${JSON.stringify({ error: `API 錯誤 ${apiRes.status}: ${errorText.slice(0, 200)}` })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, session_id: sessionId })}\n\n`);
      res.end();
      return;
    }

    // 9. 非流式響應 — 模擬流式輸出
    const apiData = await apiRes.json();
    let responseText = '';

    // 提取文本內容 (Claude 格式)
    if (apiData.content && Array.isArray(apiData.content)) {
      for (const block of apiData.content) {
        if (block.type === 'text' && block.text) {
          responseText += block.text;
        }
      }
    }
    // 備用: 直接 text 字段
    else if (apiData.text) {
      responseText = apiData.text;
    }
    // 備用: completion 字段
    else if (apiData.completion) {
      responseText = apiData.completion;
    }

    // 模擬流式: 按句子分段發送
    const sentences = responseText.split(/(?<=[。！？.\n])/);
    for (const sentence of sentences) {
      if (sentence.trim()) {
        fullResponse += sentence;
        res.write(`data: ${JSON.stringify({ chunk: sentence })}\n\n`);
        // 小延遲模擬打字效果
        await new Promise(r => setTimeout(r, 30));
      }
    }

    // 10. 保存 AI 回答到對話歷史
    conversation.messages.push({
      role: 'assistant',
      content: fullResponse,
      timestamp: new Date().toISOString(),
      mode,
      sources: contextFiles.map(f => ({ path: f.path, title: f.title }))
    });

    // 自動生成標題 (第一條用戶消息)
    if (!conversation.title && conversation.messages.length >= 2) {
      conversation.title = message.slice(0, 20) + (message.length > 20 ? '...' : '');
    }

    saveConversation(sessionId, conversation);

    // 11. 更新記憶
    updateMemoryFromQuery(memory, message, mode);
    saveMemory(user_id, memory);

    // 12. 發送結束標記
    res.write(`data: ${JSON.stringify({ done: true, session_id: sessionId })}\n\n`);
    res.end();

    console.log(`   ✅ 回答完成 (${fullResponse.length} 字)`);

  } catch (error) {
    console.error('Chat error:', error);
    res.write(`data: ${JSON.stringify({ error: `服務錯誤: ${error.message}` })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true, session_id: sessionId })}\n\n`);
    res.end();
  }
});

// ═══════════════════════════════════════════════════════
// 啟動
// ═══════════════════════════════════════════════════════

// 靜態文件服務（前端 dist/）— 與 API 共用同一端口
app.use(express.static(path.resolve(__dirname, '../web/dist')));

loadKnowledgeBase();

app.listen(PORT, () => {
  console.log(`\n🚀 天脈知識庫後端服務已啟動`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   API 測試: curl http://localhost:${PORT}/api/health`);
  console.log('');
});
