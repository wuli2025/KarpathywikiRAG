# 快速上手 (Quickstart)

> 5 分钟内让本框架跑起来，对接你自己的知识库。

---

## 1. 准备工作

### Node.js

确认本机有 Node.js 18 或更高版本：

```bash
node -v   # 应输出 v18.x.x 或更高
```

如未安装，去 [nodejs.org](https://nodejs.org/) 下载 LTS 版本。

### API Key

本项目通过 Anthropic Messages API 协议调用 LLM。任选其一：

| 提供方 | BASE_URL | 备注 |
|--------|----------|------|
| Kimi For Coding | `https://api.kimi.com/coding` | 国内可用，默认配置 |
| Anthropic 官方 | `https://api.anthropic.com` | 需海外信用卡 |
| Claude 兼容代理 | 你的代理地址 | 视服务而定 |

---

## 2. 安装依赖

```bash
# 后端
cd backend
npm install

# 前端（编译静态网站用）
cd ../web
npm install
```

---

## 3. 配置 API Key

```bash
cd backend
cp .env.example .env       # Windows PowerShell: Copy-Item .env.example .env
```

编辑 `.env`：

```env
ANTHROPIC_API_KEY=sk-你的真实key
ANTHROPIC_BASE_URL=https://api.kimi.com/coding
PORT=3001
KB_DIR=../knowledge_base
MEMORY_DIR=./data/memory
CONVERSATION_DIR=./data/conversations
```

---

## 4. 编译前端

```bash
cd ../web
node build.mjs
```

会生成 `web/dist/` 静态站点。后端默认会托管这个目录。

> 若 `knowledge_base/` 是空的，编译会输出空的导航——这是正常的。把你的资料放进 `knowledge_base/wiki/` 后再次编译即可。

---

## 5. 启动后端

```bash
cd ../backend
npm start
```

看到：

```
🚀 知識庫後端服務已啟動
   地址: http://localhost:3001
```

即成功。打开 http://localhost:3001 即可使用。

---

## 6. 接入你的知识库

### 方案 A：从零开始

1. 修改 `knowledge_base/CLAUDE.md`，替换 `{{KB_NAME}}` 等占位符为你的主题
2. 修改 `knowledge_base/purpose.md`，描述你的知识库目的
3. 把原始资料放到 `knowledge_base/raw/整理课件/<你的分类>/`
4. 在 `knowledge_base/` 里启动 Claude Code，按 6 模式工作流编译

### 方案 B：迁移已有 Markdown 库

如果你已经有 markdown 知识库：

1. 把它们放到 `knowledge_base/raw/整理课件/` 下
2. 让 LLM 跑模式 4（Ingest）批量编译概念页与课程索引
3. 手动维护 `wiki/index.md` 的「LLM 快速定位表」

### 方案 C：只用 Web 聊天，不要 wiki 结构

如果你不想做 wiki 编译，只想让 LLM 读你的 markdown 文件：

1. 把全部 `.md` 文件铺到 `knowledge_base/wiki/3.主题图谱/`
2. 在每个文件头加 YAML：
   ```yaml
   ---
   title: 文件标题
   type: concept
   category: 主分类
   ---
   ```
3. 重启后端，即可在聊天界面里检索。

---

## 7. 健康检查

```bash
curl http://localhost:3001/api/health
```

应返回：

```json
{
  "status": "ok",
  "kb_loaded": true,
  "llm_ready": true,
  "kb_stats": {
    "total_files": 0,
    "canonical": 0,
    "pointer": 0,
    "courses": "(待填充)",
    "pending": "...",
    "updated": "—"
  }
}
```

---

## 常见问题

### Q: API key 报 401

检查 `.env` 里的 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_BASE_URL` 是否对应（key 是哪家的就要配哪家的 base url）。

### Q: 聊天回复说「知識庫中未找到」

这是正常的——空仓库本来就没内容。把你的资料放进 `knowledge_base/`，重启后端即可。

### Q: 中文目录名跑不动

Windows 下要保证 Node 进程使用 UTF-8 编码。PowerShell 7+ 默认就是；老 PowerShell 可执行：

```powershell
$env:NODE_OPTIONS="--input-type=module"
chcp 65001
```

### Q: 怎么换模型？

改 `backend/server.js` 中第 502 行附近的 `model:` 字段。所有 Claude 兼容协议的模型都可以。

---

## 下一步

- 读 `knowledge_base/CLAUDE.md` 理解六种工作模式
- 读 `knowledge_base/schema.md` 理解概念页/课程索引的 YAML 规范
- 读 `knowledge_base/拆分课件规则.md` 学习长文本拆分方法
