/**
 * 天脈課件知識庫 — 靜態網站構建腳本
 * Markdown wiki/ → 靜態 HTML → dist/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { marked } from 'marked';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = process.env.KB_DIR
  ? path.resolve(__dirname, process.env.KB_DIR)
  : path.join(__dirname, '../knowledge_base');
const WIKI_DIR = path.join(KB_DIR, 'wiki');
const DIST_DIR = path.join(__dirname, 'dist');
const GRAPH_DIR = path.join(WIKI_DIR, '3.主题图谱');
const COURSE_DIR = path.join(WIKI_DIR, '2.课件分析');

// YAML courses 可能是字符串 "L1 / L2" 或数组 ["L1","L2"]，统一转为字符串
function normalizeCourses(courses) {
  if (!courses) return '';
  if (Array.isArray(courses)) return courses.join(' / ');
  return String(courses);
}

// ── 分類定義（決定側邊欄順序） ─────────────────────────
const CATEGORIES = [
  { key: '天脈核心義理', label: '天脈核心義理', icon: '☯️' },
  { key: 'L1核心框架',   label: 'L1 核心框架',  icon: '🌱' },
  { key: '修煉功法',     label: '修煉功法',      icon: '⚡' },
  { key: 'L6外部哲學',   label: 'L6 外部哲學',  icon: '📚' },
  { key: 'L6商業交易',   label: 'L6 商業交易',  icon: '💼' },
  { key: '課程體系',     label: '課程體系',      icon: '🏛️' },
];

const COURSES = [
  { key: 'L1', label: 'L1 公開課',   dir: 'L1_公开课' },
  { key: 'L2', label: 'L2 任督二脈', dir: 'L2_任督二脉' },
  { key: 'L3', label: 'L3 中脈',     dir: 'L3_中脉' },
  { key: 'L4', label: 'L4 法身',     dir: 'L4_法身' },
  { key: 'L6', label: 'L6 經天會',   dir: 'L6_經天會' },
  { key: 'L7', label: 'L7 共修',     dir: 'L7_共修' },
];

// ── Raw 課件目錄配置 ────────────────────────────────────
const RAW_DIR = path.join(KB_DIR, 'raw/整理课件');

// multi：多個版本/屆次子文件夾；single：直接就是文件目錄
const COURSE_RAW = {
  L1: { type: 'multi',  baseDir: 'L1_公开课' },
  L2: { type: 'single', baseDir: 'L2_任督二脉', singleDir: 'L2_任督課程_知識庫合併版_V8',     label: '完整課件' },
  L3: { type: 'single', baseDir: 'L3_中脉',     singleDir: 'L3_中脈課程_知識庫_完整版_v1_1',  label: '完整課件' },
  L4: { type: 'single', baseDir: 'L4_法身',     singleDir: '高階',                            label: '完整課件' },
  L6: { type: 'multi',  baseDir: 'L6_經天會' },
  L7: { type: 'multi',  baseDir: 'L7_共修' },
};

// 文件分類標籤（文件名第二段）
const FILE_TYPE_LABELS = {
  '知見': '📖 知見', '功法': '⚡ 功法', '升班': '🎯 升班', '儀軌': '🔮 儀軌',
  '素材': '📋 素材', '助道': '💎 助道', '法脈': '🌿 法脈', '修炼': '🧘 修炼',
  '特殊活動': '🎉 特殊活動', '外部': '📚 外部', '其他': '📄 其他',
};

const SKIP_FILES = new Set(['INDEX.md', '架构.md', 'index.md']);
function shouldSkipFile(name) {
  return SKIP_FILES.has(name) || name.startsWith('分析') || name.startsWith('分析記錄') || name.startsWith('._');
}

// 提取文件類型（L1_知見_xxx → 知見）
function extractFileType(filename) {
  const parts = filename.replace('.md', '').split('_');
  if (parts.length >= 2) {
    const t = parts[1];
    return FILE_TYPE_LABELS[t] ? t : '其他';
  }
  return '其他';
}

// 遞迴收集目錄下所有 .md 文件
function findMdFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      results.push(...findMdFiles(full));
    } else if (entry.endsWith('.md') && !shouldSkipFile(entry)) {
      results.push({ name: entry, path: full });
    }
  }
  return results;
}

// 美化 L6 屆次名稱：20230322-第02屆-澳門-... → 第02屆 · 澳門
function prettifyGroupLabel(courseKey, folderName) {
  if (courseKey === 'L6') {
    const parts = folderName.split('-');
    const session = parts.find(p => /第\d+屆/.test(p)) || '';
    const loc = parts[2] || '';
    return session ? `${session} · ${loc}` : folderName;
  }
  return folderName;
}

// 讀取課程所有分組（版本/屆次）及其文件
function loadRawGroups(courseKey) {
  const config = COURSE_RAW[courseKey];
  if (!config) return [];
  const baseDir = path.join(RAW_DIR, config.baseDir);
  if (!fs.existsSync(baseDir)) return [];

  if (config.type === 'single') {
    const groupDir = path.join(baseDir, config.singleDir);
    if (!fs.existsSync(groupDir)) return [];
    const files = findMdFiles(groupDir);
    return [{ name: config.singleDir, label: config.label, files }];
  }

  // multi：枚舉子目錄，L6 按屆次數字排序，其他按名稱排序
  const groups = [];
  const subdirs = fs.readdirSync(baseDir)
    .filter(d => fs.statSync(path.join(baseDir, d)).isDirectory())
    .sort((a, b) => {
      if (courseKey === 'L6') {
        const numA = parseInt((a.match(/第(\d+)屆/) || [])[1] || '0');
        const numB = parseInt((b.match(/第(\d+)屆/) || [])[1] || '0');
        return numA - numB;
      }
      return a.localeCompare(b);
    });
  for (const subdir of subdirs) {
    const files = findMdFiles(path.join(baseDir, subdir));
    if (files.length > 0) {
      groups.push({ name: subdir, label: prettifyGroupLabel(courseKey, subdir), files });
    }
  }
  return groups;
}

// 全局文件索引：filename → filepath（main() 中填充，供指針頁查找正本）
const rawFileIndex = new Map();

// ── Raw 頁面 URL 函數 ────────────────────────────────────
// 注意：HTML href 使用 URL 編碼版，磁盤文件名使用原始 UTF-8（節省空間）

// 版本/屆次目錄頁 URL（HTML href 用）
function groupPageUrl(courseKey, groupName) {
  return `grp_${encodeURIComponent(courseKey + '_' + groupName)}.html`;
}
// 版本/屆次目錄頁 文件名（fs.writeFileSync 用）
function groupPageFile(courseKey, groupName) {
  return `grp_${courseKey}_${groupName}.html`;
}

// 課件內容頁 URL（HTML href 用）：只用文件名，同名指針文件內容相同可覆蓋
function docPageUrl(filename) {
  return `doc_${encodeURIComponent(filename.replace('.md', ''))}.html`;
}
// 課件內容頁 文件名（fs.writeFileSync 用）
function docPageFile(filename) {
  return `doc_${filename.replace('.md', '')}.html`;
}

// ── 工具函數 ───────────────────────────────────────────

function slugify(title) {
  // 文件名即 slug，中文直接用 encodeURIComponent 處理
  return title;
}

function pageUrl(title) {
  return `${encodeURIComponent(title)}.html`;
}

/** 把 [[目標]] 和 [[目標|顯示名]] 轉為 <a> 標籤 */
function resolveWikilinks(html, allPageTitles) {
  // 處理已被 marked 轉換後的文本中的 wikilink（marked 不知道 wikilink）
  return html.replace(/\[\[([^\]|\\]+?)(?:[|\\][^\]]+?)?\]\]/g, (match, target) => {
    const cleanTarget = target.trim().replace(/\\$/, '');
    if (allPageTitles.has(cleanTarget)) {
      return `<a href="${pageUrl(cleanTarget)}" class="wikilink">${cleanTarget}</a>`;
    }
    // 目標不存在，用虛連結
    return `<span class="wikilink-missing">${cleanTarget}</span>`;
  });
}

/** markdown 原文的 wikilink → 先保護再轉 HTML */
function preprocessWikilinks(md) {
  // marked 會把 [[...]] 裡的 | 搞亂，先替換為佔位符
  return md.replace(/\[\[([^\]]+)\]\]/g, (match, inner) => {
    // 取目標（| 前面的部分）
    const target = inner.split('|')[0].split('\\|')[0].trim();
    return `WIKILINK_START${target}WIKILINK_END`;
  });
}

function postprocessWikilinks(html, allPageTitles) {
  return html.replace(/WIKILINK_START(.+?)WIKILINK_END/g, (_, target) => {
    const clean = target.trim();
    if (allPageTitles.has(clean)) {
      return `<a href="${pageUrl(clean)}" class="wikilink">${clean}</a>`;
    }
    return `<span class="wikilink-missing">${clean}</span>`;
  });
}

// ── 讀取所有頁面 ──────────────────────────────────────

function loadConceptPages() {
  const pages = [];
  for (const file of fs.readdirSync(GRAPH_DIR)) {
    if (!file.endsWith('.md') || file.startsWith('._')) continue;
    const raw = fs.readFileSync(path.join(GRAPH_DIR, file), 'utf-8');
    const { data, content } = matter(raw);
    pages.push({
      type: 'concept',
      slug: file.replace('.md', ''),
      title: data.title || file.replace('.md', ''),
      category: data.category || '未分類',
      courses: normalizeCourses(data.courses),
      updated: data.updated || '',
      content,
    });
  }
  return pages;
}

function loadCourseIndexPages() {
  const pages = [];
  for (const course of COURSES) {
    const indexPath = path.join(COURSE_DIR, course.dir, 'index.md');
    if (!fs.existsSync(indexPath)) continue;
    const raw = fs.readFileSync(indexPath, 'utf-8');
    const { data, content } = matter(raw);
    pages.push({
      type: 'course',
      slug: course.key,
      title: data.title || course.label,
      courseKey: course.key,
      courseLabel: course.label,
      content,
    });
  }
  return pages;
}

// ── HTML 模板 ─────────────────────────────────────────

function buildSidebar(conceptPages, coursePages, activePage) {
  // 課程導航
  const courseNav = coursePages.map(p => {
    const active = activePage?.slug === p.slug ? 'active' : '';
    return `<a href="${pageUrl(p.slug)}" class="nav-item course-item ${active}">${p.courseLabel}</a>`;
  }).join('\n');

  // 概念頁按分類分組
  const grouped = {};
  for (const cat of CATEGORIES) grouped[cat.key] = [];
  for (const p of conceptPages) {
    if (grouped[p.category]) grouped[p.category].push(p);
    else {
      grouped['未分類'] = grouped['未分類'] || [];
      grouped['未分類'].push(p);
    }
  }

  const conceptNav = CATEGORIES.map(cat => {
    const pages = grouped[cat.key] || [];
    if (pages.length === 0) return '';
    const items = pages.map(p => {
      const active = activePage?.slug === p.slug ? 'active' : '';
      return `<a href="${pageUrl(p.slug)}" class="nav-item ${active}">${p.title}</a>`;
    }).join('\n');
    return `
      <div class="nav-section">
        <div class="nav-section-title">${cat.icon} ${cat.label}</div>
        ${items}
      </div>`;
  }).join('\n');

  return `
    <nav class="sidebar">
      <a href="index.html" class="site-logo">
        <span class="logo-text">天脈知識庫</span>
      </a>
      <div class="nav-section">
        <div class="nav-section-title">📖 課程索引</div>
        ${courseNav}
      </div>
      <div class="nav-divider"></div>
      <div class="nav-section-title nav-main-title">核心概念</div>
      ${conceptNav}
    </nav>`;
}

function buildPage({ title, content, sidebar, meta = {}, includeChat = false }) {
  const coursesBadge = meta.courses
    ? `<div class="page-courses">${normalizeCourses(meta.courses).split('/').map(c => `<span class="badge">${c.trim()}</span>`).join('')}</div>`
    : '';
  const categoryBadge = meta.category
    ? `<span class="category-tag">${meta.category}</span>`
    : '';
  const updatedInfo = meta.updated
    ? `<span class="updated-info">更新於 ${meta.updated}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — 天脈知識庫</title>
  <style>
    /* ── Reset & Base ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #faf8f4;
      --sidebar-bg: #1a1a2e;
      --sidebar-text: #c8c8d8;
      --sidebar-active: #e8c46a;
      --sidebar-hover: rgba(232,196,106,0.12);
      --accent: #c0392b;
      --gold: #d4a017;
      --text: #2c2c2c;
      --text-light: #666;
      --border: #e0d8cc;
      --code-bg: #f0ede6;
      --sidebar-width: 260px;
      --content-max: 860px;
    }
    html { font-size: 16px; }
    body {
      font-family: "Noto Serif SC", "Source Han Serif TC", Georgia, serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      min-height: 100vh;
    }

    /* ── Sidebar ── */
    .sidebar {
      width: var(--sidebar-width);
      min-height: 100vh;
      background: var(--sidebar-bg);
      position: fixed;
      top: 0; left: 0;
      overflow-y: auto;
      padding: 0 0 40px;
      z-index: 100;
    }
    .site-logo {
      display: block;
      padding: 24px 20px 20px;
      text-decoration: none;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 12px;
    }
    .logo-text {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--sidebar-active);
      letter-spacing: 0.05em;
    }
    .nav-section { margin-bottom: 4px; }
    .nav-section-title {
      font-size: 0.7rem;
      font-weight: 700;
      color: rgba(200,200,216,0.45);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 14px 20px 6px;
    }
    .nav-main-title {
      padding-top: 6px;
      color: rgba(200,200,216,0.35);
    }
    .nav-divider {
      height: 1px;
      background: rgba(255,255,255,0.07);
      margin: 8px 16px 4px;
    }
    .nav-item {
      display: block;
      padding: 6px 20px;
      font-size: 0.85rem;
      color: var(--sidebar-text);
      text-decoration: none;
      border-radius: 4px;
      margin: 1px 8px;
      transition: background 0.15s, color 0.15s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .nav-item:hover { background: var(--sidebar-hover); color: #fff; }
    .nav-item.active { background: rgba(232,196,106,0.18); color: var(--sidebar-active); font-weight: 600; }
    .course-item { font-weight: 500; }

    /* ── Main Content ── */
    .main {
      margin-left: var(--sidebar-width);
      flex: 1;
      padding: 48px 40px 80px;
      display: flex;
      justify-content: center;
    }
    .content-wrap {
      width: 100%;
      max-width: var(--content-max);
    }

    /* ── Page Header ── */
    .page-header { margin-bottom: 32px; border-bottom: 2px solid var(--border); padding-bottom: 20px; }
    .page-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
    .category-tag {
      font-size: 0.72rem;
      font-family: sans-serif;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: var(--gold);
      background: rgba(212,160,23,0.1);
      border: 1px solid rgba(212,160,23,0.3);
      padding: 2px 10px;
      border-radius: 20px;
    }
    .updated-info { font-size: 0.75rem; color: var(--text-light); font-family: sans-serif; }
    .page-title { font-size: 2rem; font-weight: 700; color: var(--text); line-height: 1.3; margin-bottom: 8px; }
    .page-courses { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .badge {
      font-size: 0.72rem;
      font-family: sans-serif;
      color: var(--accent);
      background: rgba(192,57,43,0.08);
      border: 1px solid rgba(192,57,43,0.2);
      padding: 2px 8px;
      border-radius: 3px;
      font-weight: 500;
    }

    /* ── Article Content ── */
    .article { font-size: 1.15rem; }
    .article h1 { display: none; } /* title already in header */
    .article h2 {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text);
      margin: 36px 0 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
    }
    .article h3 {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text);
      margin: 24px 0 8px;
    }
    .article h4 { font-size: 0.95rem; font-weight: 700; margin: 18px 0 6px; }
    .article p { line-height: 1.85; margin-bottom: 14px; color: var(--text); }
    .article ul, .article ol { padding-left: 1.6em; margin-bottom: 14px; }
    .article li { line-height: 1.75; margin-bottom: 4px; }
    .article blockquote {
      border-left: 3px solid var(--gold);
      background: rgba(212,160,23,0.06);
      margin: 16px 0;
      padding: 12px 18px;
      font-style: italic;
      color: #4a3f2a;
      border-radius: 0 4px 4px 0;
    }
    .article code {
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 0.85em;
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 3px;
      color: var(--accent);
    }
    .article pre {
      background: #1e1e2e;
      color: #cdd6f4;
      padding: 16px 20px;
      border-radius: 6px;
      overflow-x: auto;
      margin-bottom: 16px;
    }
    .article pre code { background: none; color: inherit; padding: 0; }
    .article table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0 20px;
    }
    .article th {
      background: var(--sidebar-bg);
      color: var(--sidebar-active);
      padding: 10px 16px;
      text-align: left;
      font-weight: 600;
      font-size: 1rem;
      letter-spacing: 0.04em;
    }
    .article td {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
      line-height: 1.7;
    }
    .article tr:nth-child(even) td { background: rgba(0,0,0,0.02); }
    .article hr { border: none; border-top: 1px solid var(--border); margin: 28px 0; }

    /* ── Wikilinks ── */
    a.wikilink {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(192,57,43,0.3);
      transition: border-color 0.15s;
    }
    a.wikilink:hover { border-bottom-color: var(--accent); }
    .wikilink-missing {
      color: var(--text-light);
      text-decoration: none;
      border-bottom: 1px dashed var(--text-light);
      cursor: default;
    }

    /* ── Home Page ── */
    .home-hero {
      padding: 20px 0 36px;
      border-bottom: 2px solid var(--border);
      margin-bottom: 40px;
    }
    .home-title { font-size: 2.2rem; font-weight: 800; margin-bottom: 10px; }
    .home-subtitle { font-size: 1.05rem; color: var(--text-light); line-height: 1.7; }
    .stats-bar {
      display: flex;
      gap: 32px;
      margin: 28px 0 0;
      flex-wrap: wrap;
    }
    .stat-item { text-align: center; }
    .stat-number { font-size: 2rem; font-weight: 800; color: var(--accent); line-height: 1; }
    .stat-label { font-size: 0.78rem; color: var(--text-light); font-family: sans-serif; margin-top: 4px; }
    .category-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
      margin-top: 12px;
    }
    .category-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      background: #fff;
      transition: box-shadow 0.2s, transform 0.2s;
    }
    .category-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); transform: translateY(-2px); }
    .category-card-title { font-size: 1.2rem; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .category-card-links { display: flex; flex-direction: column; gap: 6px; }
    .category-card-links a {
      font-size: 1.05rem;
      color: var(--accent);
      text-decoration: none;
      padding: 2px 0;
      border-bottom: 1px solid transparent;
      transition: border-color 0.1s;
    }
    .category-card-links a:hover { border-bottom-color: rgba(192,57,43,0.3); }
    .section-title {
      font-size: 1.1rem;
      font-weight: 700;
      margin: 36px 0 16px;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
      margin-left: 12px;
    }
    .course-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }
    .course-card {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      background: #fff;
      text-decoration: none;
      color: var(--text);
      transition: box-shadow 0.2s;
    }
    .course-card:hover { box-shadow: 0 3px 12px rgba(0,0,0,0.08); }
    .course-card-title { font-weight: 700; font-size: 1.15rem; margin-bottom: 6px; }
    .course-card-desc { font-size: 0.95rem; color: var(--text-light); font-family: sans-serif; }

    /* ── Breadcrumb ── */
    .breadcrumb {
      font-size: 0.8rem;
      font-family: sans-serif;
      color: var(--text-light);
      margin-bottom: 20px;
    }
    .breadcrumb a { color: var(--accent); text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    .page-subtitle { font-size: 0.85rem; color: var(--text-light); font-family: sans-serif; margin-top: 6px; }

    /* ── Version/Group Grid（課程索引頁） ── */
    .version-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
      margin-bottom: 40px;
    }
    .version-link {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 16px;
      background: #fff;
      text-decoration: none;
      color: var(--text);
      transition: box-shadow 0.15s, border-color 0.15s;
    }
    .version-link:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.08); border-color: var(--gold); }
    .version-name { font-size: 1.1rem; font-weight: 600; color: var(--text); }
    .version-count {
      font-size: 0.75rem;
      font-family: sans-serif;
      color: #fff;
      background: var(--accent);
      padding: 2px 7px;
      border-radius: 10px;
      min-width: 28px;
      text-align: center;
    }

    /* ── File Directory（版本目錄頁） ── */
    .file-directory { margin-top: 8px; }
    .file-group { margin-bottom: 32px; }
    .file-group-title {
      font-size: 1rem;
      font-family: sans-serif;
      font-weight: 800;
      letter-spacing: 0.06em;
      color: #b8860b;
      background: rgba(212,160,23,0.12);
      border: 2px solid rgba(212,160,23,0.4);
      padding: 6px 18px;
      border-radius: 6px;
      display: inline-block;
      margin-bottom: 12px;
    }
    .file-list {
      list-style: none;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .file-list li { padding: 0; }
    a.file-link {
      display: block;
      padding: 9px 16px;
      font-size: 1.25rem;
      font-weight: 500;
      color: #1a1a2e;
      text-decoration: none;
      border-radius: 4px;
      border-left: 3px solid transparent;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
    }
    a.file-link:hover {
      background: rgba(192,57,43,0.06);
      border-left-color: var(--accent);
      color: var(--accent);
    }

    /* ── Doc Content Page ── */
    .doc-article { font-size: 1.15rem; }
    .doc-article h1 { font-size: 1.5rem; font-weight: 700; margin: 24px 0 12px; }
    .doc-article h2 {
      font-size: 1.15rem; font-weight: 700; color: var(--text);
      margin: 28px 0 10px; padding-bottom: 5px; border-bottom: 1px solid var(--border);
    }
    .doc-article h3 { font-size: 1rem; font-weight: 700; margin: 18px 0 7px; }
    .doc-article p { line-height: 1.9; margin-bottom: 14px; }
    .doc-article ul, .doc-article ol { padding-left: 1.6em; margin-bottom: 14px; }
    .doc-article li { line-height: 1.8; margin-bottom: 4px; }
    .doc-article blockquote {
      border-left: 3px solid var(--gold); background: rgba(212,160,23,0.06);
      margin: 16px 0; padding: 12px 18px; font-style: italic; color: #4a3f2a;
    }
    .doc-article table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .doc-article th { background: var(--sidebar-bg); color: var(--sidebar-active); padding: 10px 16px; text-align: left; font-size: 1rem; font-weight: 600; }
    .doc-article td { padding: 10px 16px; border-bottom: 1px solid var(--border); line-height: 1.7; }
    .doc-article tr:nth-child(even) td { background: rgba(0,0,0,0.02); }
    .doc-article hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
    .doc-article code { font-family: monospace; font-size: 0.85em; background: var(--code-bg); padding: 2px 6px; border-radius: 3px; color: var(--accent); }
    .doc-nav {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--border);
    }
    .doc-nav a {
      font-size: 0.85rem; color: var(--accent); text-decoration: none;
      padding: 6px 14px; border: 1px solid rgba(192,57,43,0.2); border-radius: 4px;
      font-family: sans-serif; transition: background 0.15s;
    }
    .doc-nav a:hover { background: rgba(192,57,43,0.05); }

    /* ── 指針文件（正本預覽） ── */
    .pointer-banner {
      background: #fffbf0;
      border: 2px solid #e6a817;
      border-radius: 8px;
      padding: 18px 22px;
      margin-bottom: 32px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pointer-label {
      font-size: 0.82rem;
      font-family: sans-serif;
      font-weight: 700;
      color: #9a6c00;
      letter-spacing: 0.06em;
    }
    .pointer-canonical-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--accent);
      text-decoration: none;
      padding: 10px 20px;
      background: #fff;
      border: 2px solid var(--accent);
      border-radius: 6px;
      transition: background 0.15s, color 0.15s;
      align-self: flex-start;
    }
    .pointer-canonical-link:hover { background: var(--accent); color: #fff; }
    .pointer-canonical-name {
      font-size: 0.9rem;
      color: #666;
      font-family: sans-serif;
    }
    .excerpt-box {
      margin-top: 8px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .excerpt-header {
      background: var(--sidebar-bg);
      color: var(--sidebar-active);
      font-size: 0.78rem;
      font-family: sans-serif;
      font-weight: 700;
      letter-spacing: 0.08em;
      padding: 8px 18px;
    }
    .excerpt-content {
      padding: 20px 22px;
      background: #fefefe;
      font-size: 1.05rem;
      line-height: 1.9;
      color: var(--text);
      position: relative;
    }
    .excerpt-content::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 80px;
      background: linear-gradient(transparent, #fefefe);
    }
    .excerpt-goto {
      display: block;
      text-align: center;
      padding: 12px;
      background: #f8f5ef;
      font-size: 0.95rem;
      font-family: sans-serif;
      font-weight: 600;
      color: var(--accent);
      text-decoration: none;
      border-top: 1px solid var(--border);
      transition: background 0.15s;
    }
    .excerpt-goto:hover { background: rgba(192,57,43,0.06); }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .sidebar { width: 100%; min-height: auto; position: relative; }
      .main { margin-left: 0; padding: 24px 16px 60px; }
    }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body>
  ${sidebar}
  <main class="main">
    <div class="content-wrap">
      ${content}
    </div>
  </main>
  ${includeChat ? `
  <script>window.CHAT_CONFIG = { apiBaseUrl: "http://localhost:3001/api" };</script>
  <script src="chat.js"></script>
  <link rel="stylesheet" href="chat.css">
  ` : ''}
</body>
</html>`;
}

// ── 構建首頁 ──────────────────────────────────────────

function buildHomePage(conceptPages, coursePages, sidebar, docFileCount) {
  const grouped = {};
  for (const cat of CATEGORIES) grouped[cat.key] = [];
  for (const p of conceptPages) {
    if (grouped[p.category]) grouped[p.category].push(p);
  }

  const categoryCards = CATEGORIES.map(cat => {
    const pages = grouped[cat.key] || [];
    if (pages.length === 0) return '';
    const links = pages.map(p =>
      `<a href="${pageUrl(p.slug)}">${p.title}</a>`
    ).join('\n');
    return `
      <div class="category-card">
        <div class="category-card-title">${cat.icon} ${cat.label}</div>
        <div class="category-card-links">${links}</div>
      </div>`;
  }).join('\n');

  const courseCards = coursePages.map(p => `
    <a href="${pageUrl(p.slug)}" class="course-card">
      <div class="course-card-title">${p.courseLabel}</div>
      <div class="course-card-desc">點擊查看課程結構與版本演化</div>
    </a>`).join('\n');

  const content = `
    <div class="home-hero">
      <div class="page-meta">
        <span class="category-tag">天脈課件知識庫</span>
      </div>
      <h1 class="home-title">天脈修煉知識庫</h1>
      <p class="home-subtitle">
        涵蓋 L1–L7 全課程體系的結構化知識圖譜。<br>
        每個核心概念跨課程追蹤，每個修煉方法有來源索引。
      </p>
      <div class="stats-bar">
        <div class="stat-item">
          <div class="stat-number">${conceptPages.length}</div>
          <div class="stat-label">核心概念頁</div>
        </div>
        <div class="stat-item">
          <div class="stat-number">${coursePages.length}</div>
          <div class="stat-label">課程索引</div>
        </div>
        <div class="stat-item">
          <div class="stat-number">${docFileCount}</div>
          <div class="stat-label">知識文件</div>
        </div>
        <div class="stat-item">
          <div class="stat-number">${conceptPages.length + coursePages.length}</div>
          <div class="stat-label">知識架構</div>
        </div>
      </div>
    </div>

    <div class="section-title">📖 課程索引</div>
    <div class="course-grid">${courseCards}</div>

    <div class="section-title">🧭 核心概念圖譜</div>
    <div class="category-grid">${categoryCards}</div>
  `;

  return buildPage({ title: '天脈知識庫', content, sidebar, includeChat: true });
}

// ── 構建概念頁 ────────────────────────────────────────

function buildConceptPage(page, allPageTitles, sidebar) {
  const preprocessed = preprocessWikilinks(page.content);
  let html = marked(preprocessed);
  html = postprocessWikilinks(html, allPageTitles);

  const content = `
    <div class="page-header">
      <div class="page-meta">
        ${page.category ? `<span class="category-tag">${page.category}</span>` : ''}
        ${page.updated ? `<span class="updated-info">更新於 ${page.updated}</span>` : ''}
      </div>
      <h1 class="page-title">${page.title}</h1>
      ${page.courses ? `<div class="page-courses">${normalizeCourses(page.courses).split('/').map(c => `<span class="badge">${c.trim()}</span>`).join('')}</div>` : ''}
    </div>
    <article class="article">${html}</article>
  `;

  return buildPage({ title: page.title, content, sidebar });
}

// ── 構建課程索引頁 ────────────────────────────────────

function buildCoursePage(page, allPageTitles, sidebar) {
  const preprocessed = preprocessWikilinks(page.content);
  let html = marked(preprocessed);
  html = postprocessWikilinks(html, allPageTitles);

  // 掃描 raw/ 生成課件目錄區塊
  const groups = loadRawGroups(page.courseKey);
  let directorySection = '';
  if (groups.length > 0) {
    const totalFiles = groups.reduce((s, g) => s + g.files.length, 0);
    const cards = groups.map(g => `
      <a href="${groupPageUrl(page.courseKey, g.name)}" class="version-link">
        <span class="version-name">${g.label}</span>
        <span class="version-count">${g.files.length}</span>
      </a>`).join('\n');
    directorySection = `
      <div class="section-title">📂 課件目錄 <span style="font-size:0.8rem;font-weight:400;color:var(--text-light);font-family:sans-serif">共 ${totalFiles} 份課件</span></div>
      <div class="version-grid">${cards}</div>`;
  }

  const content = `
    <div class="page-header">
      <div class="page-meta"><span class="category-tag">課程索引</span></div>
      <h1 class="page-title">${page.courseLabel}</h1>
    </div>
    ${directorySection}
    <article class="article">${html}</article>
  `;

  return buildPage({ title: page.courseLabel, content, sidebar });
}

// ── 構建版本/屆次目錄頁 ──────────────────────────────

function buildGroupPage(courseKey, courseLabel, group, allPageTitles, sidebar) {
  // 按文件類型分組
  const byType = {};
  for (const f of group.files) {
    const t = extractFileType(f.name);
    (byType[t] = byType[t] || []).push(f);
  }

  const fileListHtml = Object.entries(byType).map(([type, files]) => {
    const label = FILE_TYPE_LABELS[type] || type;
    const items = files.map(f => {
      const displayName = f.name.replace('.md', '');
      return `<li><a href="${docPageUrl(f.name)}" class="file-link">${displayName}</a></li>`;
    }).join('\n');
    return `
      <div class="file-group">
        <div class="file-group-title">${label}</div>
        <ul class="file-list">${items}</ul>
      </div>`;
  }).join('\n');

  const content = `
    <div class="breadcrumb">
      <a href="index.html">首頁</a> ›
      <a href="${courseKey}.html">${courseLabel}</a> ›
      ${group.label}
    </div>
    <div class="page-header">
      <div class="page-meta"><span class="category-tag">${courseLabel}</span></div>
      <h1 class="page-title">${group.label}</h1>
      <p class="page-subtitle">${group.files.length} 份課件</p>
    </div>
    <div class="file-directory">${fileListHtml}</div>
  `;

  return buildPage({ title: group.label + ' — ' + courseLabel, content, sidebar });
}

// ── 構建課件內容頁 ────────────────────────────────────

// 提取正文前 N 段作為摘錄預覽
function extractExcerpt(mdContent, maxParas = 6, maxChars = 700) {
  const paras = mdContent
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 15 && !p.startsWith('#') && !p.startsWith('>') && !p.startsWith('---'));
  let out = '';
  for (const p of paras) {
    if (out.length + p.length > maxChars) break;
    out += p + '\n\n';
    if (out.split(/\n{2,}/).length > maxParas) break;
  }
  return out.trim();
}

// YAML 預處理：修復 flow collection 中裸 #tag（如 [#商業, #修煉]）
// YAML 規範把 # 視為注釋符，裸標籤會導致解析失敗，需加引號
function fixYamlHashTags(raw) {
  return raw.replace(
    /^([ \t]*(?:主[題题][標标][籤签]|主题标签|tags|tag):[ \t]*\[)(.*?)(\])$/mg,
    (_, prefix, inner, suffix) => {
      const fixed = inner.split(',').map(t => {
        const trimmed = t.trim();
        if (trimmed.startsWith('#') && !trimmed.startsWith('"') && !trimmed.startsWith("'")) {
          return t.replace(trimmed, `"${trimmed}"`);
        }
        return t;
      }).join(',');
      return prefix + fixed + suffix;
    }
  );
}

function buildDocPage(courseKey, courseLabel, group, fileInfo, prevFile, nextFile, sidebar) {
  const rawText = fs.readFileSync(fileInfo.path, 'utf-8');
  const raw = fixYamlHashTags(rawText);
  let data = {}, md;
  try {
    const parsed = matter(raw);
    data = parsed.data;
    md = parsed.content;
  } catch (_) {
    md = rawText.replace(/^---[\s\S]*?---\s*\n/, '') || rawText;
  }

  // ── 檢測指針文件 ──────────────────────────────────────
  const canonicalFilename = data['正本文件'] || data['canonical_file'];
  const isPointer = canonicalFilename || md.trim().startsWith('> ⚠️');

  let pointerSection = '';
  if (isPointer && canonicalFilename) {
    const canonicalPath = rawFileIndex.get(canonicalFilename);
    let excerptHtml = '';
    if (canonicalPath && fs.existsSync(canonicalPath)) {
      let canonMd;
      try { canonMd = matter(fs.readFileSync(canonicalPath, 'utf-8')).content; }
      catch (_) { canonMd = fs.readFileSync(canonicalPath, 'utf-8').replace(/^---[\s\S]*?---\s*\n/, ''); }
      const excerpt = extractExcerpt(canonMd);
      if (excerpt) {
        excerptHtml = `
          <div class="excerpt-box">
            <div class="excerpt-header">📄 正本內容預覽（節選）</div>
            <div class="excerpt-content">${marked(excerpt)}</div>
            <a href="${docPageUrl(canonicalFilename)}" class="excerpt-goto">
              閱讀完整正本 →
            </a>
          </div>`;
      }
    }
    const canonDisplayName = canonicalFilename.replace('.md', '');
    pointerSection = `
      <div class="pointer-banner">
        <div class="pointer-label">⚠️ 此文件為重複版本（遺漏更新），正本如下</div>
        <a href="${docPageUrl(canonicalFilename)}" class="pointer-canonical-link">
          → 跳轉正本
        </a>
        <div class="pointer-canonical-name">${canonDisplayName}</div>
      </div>
      ${excerptHtml}`;
    // 指針頁不再渲染自身的重複警告正文
    md = '';
  }

  const html = marked(md);
  const displayName = fileInfo.name.replace('.md', '');

  const prevNav = prevFile
    ? `<a href="${docPageUrl(prevFile.name)}">← ${prevFile.name.replace('.md', '')}</a>`
    : `<a href="${groupPageUrl(courseKey, group.name)}">← 返回目錄</a>`;
  const nextNav = nextFile
    ? `<a href="${docPageUrl(nextFile.name)}">${nextFile.name.replace('.md', '')} →</a>`
    : '<span></span>';

  const content = `
    <div class="breadcrumb">
      <a href="index.html">首頁</a> ›
      <a href="${courseKey}.html">${courseLabel}</a> ›
      <a href="${groupPageUrl(courseKey, group.name)}">${group.label}</a> ›
      ${displayName}
    </div>
    <div class="page-header">
      <div class="page-meta"><span class="category-tag">${courseLabel} · ${group.label}</span></div>
      <h1 class="page-title">${displayName}</h1>
    </div>
    ${pointerSection}
    ${html ? `<article class="doc-article">${html}</article>` : ''}
    <div class="doc-nav">${prevNav}${nextNav}</div>
  `;

  return buildPage({ title: displayName, content, sidebar });
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  console.log('🏗️  天脈知識庫 — 開始構建...\n');

  // 清空並創建 dist/
  if (fs.existsSync(DIST_DIR)) fs.rmSync(DIST_DIR, { recursive: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 讀取所有頁面
  const conceptPages = loadConceptPages();
  const coursePages = loadCourseIndexPages();
  console.log(`📄 概念頁：${conceptPages.length} 個`);
  console.log(`📚 課程索引：${coursePages.length} 個`);

  // 建立全量 title 索引（用於 wikilink 解析）
  const allPageTitles = new Set();
  for (const p of conceptPages) allPageTitles.add(p.title);
  for (const p of conceptPages) allPageTitles.add(p.slug); // slug = title（中文頁面相同）
  for (const p of coursePages) allPageTitles.add(p.slug);
  // 課程縮寫也加入
  for (const c of COURSES) allPageTitles.add(c.key);

  // 建立全局文件索引（供指針文件查找正本路徑）
  for (const course of COURSES) {
    const groups = loadRawGroups(course.key);
    for (const group of groups) {
      for (const f of group.files) {
        rawFileIndex.set(f.name, f.path);
      }
    }
  }
  console.log(`🗂️  文件索引：${rawFileIndex.size} 個文件`);

  // 構建首頁 sidebar（不 active 任何頁）
  const homeSidebar = buildSidebar(conceptPages, coursePages, null);

  // 構建首頁
  const homeHtml = buildHomePage(conceptPages, coursePages, homeSidebar, rawFileIndex.size);
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), homeHtml, 'utf-8');
  console.log('✅ index.html');

  // 構建所有概念頁
  for (const page of conceptPages) {
    const sidebar = buildSidebar(conceptPages, coursePages, page);
    const html = buildConceptPage(page, allPageTitles, sidebar);
    const filename = `${page.slug}.html`;
    fs.writeFileSync(path.join(DIST_DIR, filename), html, 'utf-8');
    console.log(`✅ ${filename}`);
  }

  // 構建所有課程索引頁
  let grpCount = 0;
  let docCount = 0;
  for (const page of coursePages) {
    const sidebar = buildSidebar(conceptPages, coursePages, page);
    const html = buildCoursePage(page, allPageTitles, sidebar);
    const filename = `${page.slug}.html`;
    fs.writeFileSync(path.join(DIST_DIR, filename), html, 'utf-8');
    console.log(`✅ ${filename}`);

    // 構建該課程的所有版本/屆次目錄頁 + 課件內容頁
    const groups = loadRawGroups(page.courseKey);
    for (const group of groups) {
      // 版本目錄頁
      const grpHtml = buildGroupPage(page.courseKey, page.courseLabel, group, allPageTitles, sidebar);
      const grpFile = groupPageFile(page.courseKey, group.name);
      fs.writeFileSync(path.join(DIST_DIR, grpFile), grpHtml, 'utf-8');
      grpCount++;

      // 每份課件內容頁
      for (let i = 0; i < group.files.length; i++) {
        const f = group.files[i];
        const prev = i > 0 ? group.files[i - 1] : null;
        const next = i < group.files.length - 1 ? group.files[i + 1] : null;
        const docHtml = buildDocPage(page.courseKey, page.courseLabel, group, f, prev, next, sidebar);
        const docFile = docPageFile(f.name);
        fs.writeFileSync(path.join(DIST_DIR, docFile), docHtml, 'utf-8');
        docCount++;
      }
    }
  }

  console.log(`✅ ${grpCount} 個版本/屆次目錄頁`);
  console.log(`✅ ${docCount} 個課件內容頁`);

  // 複製聊天組件到 dist/
  const chatJsSrc = path.join(__dirname, 'chat.js');
  const chatCssSrc = path.join(__dirname, 'chat.css');
  const chatJsDst = path.join(DIST_DIR, 'chat.js');
  const chatCssDst = path.join(DIST_DIR, 'chat.css');

  if (fs.existsSync(chatJsSrc)) {
    fs.copyFileSync(chatJsSrc, chatJsDst);
    console.log('✅ chat.js');
  } else {
    console.warn('⚠️ chat.js 未找到，跳過複製');
  }

  if (fs.existsSync(chatCssSrc)) {
    fs.copyFileSync(chatCssSrc, chatCssDst);
    console.log('✅ chat.css');
  } else {
    console.warn('⚠️ chat.css 未找到，跳過複製');
  }

  const total = 1 + conceptPages.length + coursePages.length + grpCount + docCount;
  console.log(`\n🎉 構建完成！共 ${total} 個頁面 + 2 個聊天組件`);
  console.log(`📁 輸出目錄：${DIST_DIR}`);
  console.log('\n本地預覽：npx serve dist -p 3000');
  console.log('後端啟動：cd ../backend && npm install && npm start');
}

main();
