# Karpathy Wiki RAG

> 一个基于 **Karpathy LLM Wiki 方法论**（nashsu llm_wiki 本地化实践）的知识库 RAG 系统。
>
> 三层结构：**原始层**（人工整理课件）+ **知识层**（LLM 编译的 wiki）+ **应用层**（聊天 + 静态浏览）。
>
> 本仓库是已剥离具体内容的 **纯框架**，clone 后只需填入自己的资料即可立即运行，与原作者使用的效果一致。

---

## 这是什么？

如果你有一批结构化的知识（课程、研报、论文、内部 wiki、产品手册……）想用 LLM 来检索，但又不想：
- 把内容扔给 OpenAI / Anthropic 做向量化
- 自己搭一套 RAG pipeline
- 维护 Embedding / Vector DB

那么这个项目可能适合你。它的核心思路来自 Andrej Karpathy 提出的 LLM Wiki：

> **让 LLM 在编译期一次性把原始资料整理成结构化 wiki，运行期只做关键词检索 + 把相关文件直接喂给 LLM 让它读原文。**

不需要向量库，不需要 Embedding 模型，所有内容以 Markdown 文件维护，肉眼可读、git 友好。

---

## 仓库结构

```
KarpathywikiRAG/
├── backend/                后端 Node.js 服务（Express + SSE）
│   ├── server.js           主服务：知识库读取 + LLM API 代理
│   ├── package.json
│   └── .env.example        填入 API key 后改名为 .env
│
├── web/                    前端
│   ├── chat.js / chat.css  聊天界面
│   ├── build.mjs           将 wiki/ 编译为静态网站
│   ├── start.bat           Windows 启动脚本
│   └── start.command       macOS 启动脚本
│
├── knowledge_base/         知识库（这是你的内容主战场）
│   ├── CLAUDE.md           ← LLM 的行为指南（必读、必改）
│   ├── purpose.md          ← 知识库存在的目的（必改）
│   ├── overview.md         ← 全局规模快照（Ingest 后更新）
│   ├── schema.md           ← 页面类型与 YAML 规范
│   ├── 拆分课件规则.md      ← 课件拆分方法论
│   │
│   ├── raw/整理课件/        ← 原始层（只读）：放入你的原始资料
│   │   └── L1_..., L2_... ← 课程/层级子目录
│   │
│   ├── output/             ← 模式 5（撰写文章）的产出位置
│   │
│   └── wiki/               ← 知识层：LLM 编译产物
│       ├── index.md            主索引 + LLM 快速定位表
│       ├── log.md              操作日志
│       ├── metadata.json       文件元数据
│       ├── 1.总原则/           跨课程的通用原则
│       ├── 2.课件分析/         每个课程一个 index.md
│       └── 3.主题图谱/         跨课程的概念页
│
└── docs/                   附加文档
```

---

## 五分钟跑起来

### 前置要求

- Node.js ≥ 18（自带 `fetch`）
- 一个兼容 Anthropic Messages API 的 API Key
  - 推荐 [Kimi For Coding](https://platform.moonshot.cn/)（默认配置）
  - 也可用 Anthropic 官方、Claude 兼容代理

### 步骤

```bash
# 1. clone
git clone https://github.com/wuli2025/KarpathywikiRAG.git
cd KarpathywikiRAG

# 2. 配置后端 API Key
cd backend
cp .env.example .env          # Windows: Copy-Item .env.example .env
# 编辑 .env，填入你的 ANTHROPIC_API_KEY
npm install

# 3. 编译前端
cd ../web
npm install
node build.mjs

# 4. 启动后端（会同时托管前端 dist/）
cd ../backend
npm start
# 服务启动在 http://localhost:3001
```

打开浏览器访问 **http://localhost:3001**，即可看到聊天界面。

### 一键启动（Windows）

```powershell
# 终端 1：构建前端 + 本地静态服务（3000 端口，浏览 wiki）
cd web
.\start.bat

# 终端 2：聊天后端（3001 端口，知识库 + LLM 代理）
cd backend
npm start
```

---

## 怎么填入自己的知识库？

### 路线 A：从零开始（推荐先看）

1. **改 `knowledge_base/CLAUDE.md`**：替换文件里 `{{KB_NAME}}` 等占位符，定义你的「6 模式」启动行为
2. **改 `purpose.md`**：写清楚这个知识库要解决什么问题、能回答什么、边界在哪
3. **整理你的原始资料**：放到 `knowledge_base/raw/整理课件/<你的分类>/`
4. **用 Claude Code 跑模式 4 Ingest**：在 `knowledge_base/` 目录里启动 Claude Code，对话「我新增了 xxx 文件，请按 Ingest 流程处理」
5. **更新 `overview.md` 和 `wiki/index.md`**：把统计数字和快速定位表填上

### 路线 B：直接用 Claude Code 引导

进入 `knowledge_base/` 目录运行 `claude code`，发任意消息，它会按 CLAUDE.md 的启动行为问你想做什么。选 4（Ingest）让它一步步引导你。

---

## 六种工作模式（CLAUDE.md 中定义）

| # | 模式 | 联想权限 | 用途 |
|---|------|---------|------|
| 1 | 查询（严格） | ❌ 零联想 | 只从知识库提取，找不到就说找不到 |
| 2 | 查询（普通） | ✅ 需标记 | 以知识库为主，可补充 LLM 理解 |
| 3 | 拆解课件 | ✅ 执行时 | 长文本 → 主题文件（预处理） |
| 4 | 新增课件 (Ingest) | ✅ 编译时 | 原始文件 → wiki 知识层 |
| 5 | 撰写文章 | ✅ 需标记 | 基于知识库写新内容 |
| 6 | 健康检查 (Lint) | ❌ 零联想 | 找矛盾、孤岛、缺失 |

详细规则见 `knowledge_base/CLAUDE.md`。

---

## 它为什么不用向量数据库？

Karpathy 在 LLM Wiki 的设计理念里，核心论点是：

1. **结构化的 wiki + LLM 的长上下文** > 平铺文档 + 向量检索
2. **关键词 + 文件路径定位** 在主题图谱清晰时已经够用
3. **向量检索的语义模糊性** 在严肃知识库里反而是问题（容易召回错误的"近似"内容）

所以本项目的检索是：
1. 用户提问 → 按关键词扫 `wiki/3.主题图谱/` 与 `wiki/2.课件分析/` 的标题与摘要
2. 取 top-3 相关文件，把**完整原文**喂给 LLM
3. LLM 在 system prompt 里被强制要求标注来源（📚 知识库 / 💡 补充理解）

---

## API 调用流程

```
浏览器 ──POST /api/chat──> backend/server.js
                              │
                              ├─ searchKB(query, 3)        # 关键词检索
                              ├─ buildSystemPrompt(mode)   # 注入相关文件原文
                              ├─ fetch(ANTHROPIC_BASE_URL/v1/messages)
                              │
                              └──SSE stream──> 浏览器
```

后端代码加起来约 600 行，全在 `backend/server.js`，没有任何隐藏黑魔法。

---

## 自定义模型

`.env` 里改 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_API_KEY` 即可。`backend/server.js` 第 502 行附近指定了模型名：

```js
model: 'claude-sonnet-4-6',
```

改成你想用的模型 ID（Claude 兼容的）。

---

## License

MIT — 随便用，但请保留原作者署名。

## 致谢

- [Andrej Karpathy](https://github.com/karpathy) — LLM Wiki 概念提出者
- [nashsu/llm_wiki](https://github.com/nashsu) — 概念的早期实践参考
- 所有为 LLM 在知识管理领域探索方法论的人

---

## 相关阅读

- `knowledge_base/CLAUDE.md` — LLM 行为指南（包含 6 模式详解）
- `knowledge_base/schema.md` — 页面类型与 YAML 规范
- `knowledge_base/拆分课件规则.md` — 课件拆分方法论（路径 A / 路径 B / 五步流程）
- `docs/` — 附加文档
