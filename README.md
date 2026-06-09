# MyNote

A beautiful, privacy-first markdown note-taking application. WYSIWYG editing, daily diary, task management, knowledge base, and Git sync — all local, all yours.

![Stack](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri) ![Stack](https://img.shields.io/badge/React-18-61DAFB?logo=react) ![Stack](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript) ![Stack](https://img.shields.io/badge/Rust-1.x-000000?logo=rust) ![Stack](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite) ![Stack](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss)

---

## 目录

- [核心功能](#核心功能)
- [编辑器](#编辑器)
- [日记](#日记)
- [待办事项](#待办事项)
- [仪表盘](#仪表盘)
- [知识库](#知识库)
- [侧边栏 & 文件管理](#侧边栏--文件管理)
- [Git 同步](#git-同步)
- [导出](#导出)
- [架构](#架构)
- [数据存储](#数据存储)
- [技术栈](#技术栈)
- [快捷键](#快捷键)
- [开发](#开发)

---

## 核心功能

| 模块 | 说明 |
|------|------|
| 📝 **WYSIWYG 编辑器** | 所见即所得 Markdown，支持斜杠命令、表格、代码高亮、数学公式、图片粘贴 |
| 📅 **日记** | 日历视图 + 时间线拖拽，DDL 截止面板，与待办双向同步 |
| ✅ **待办事项** | 今日/本周/本月卡片视图，历史追溯，与日记 `[待办事项]` 章节同步 |
| 🏠 **仪表盘** | 可编辑 Banner（图片+名言），最近笔记，今日日记 & 待办概览 |
| 📚 **知识库** | 笔记列表，全文搜索，标签过滤，归档/置顶，批量操作，双向链接 |
| 📂 **文件管理** | 侧边栏目录树，右键菜单，拖拽调整面板宽度 |
| 🔄 **Git 同步** | 状态栏一键 Pull / Push，基于 Git 的版本控制和多端同步 |
| 📄 **导出** | Markdown → PDF（带页码，无页眉页脚），图片自动嵌入 base64 |

---

## 编辑器

基于 [Milkdown](https://milkdown.dev/) (ProseMirror) 的 WYSIWYG Markdown 编辑器。

### Markdown 语法支持

| 语法 | 说明 |
|------|------|
| `# ## ### …` | 标题 H1–H6 |
| `**bold**` `*italic*` `***bold+italic***` | 粗体 / 斜体 |
| `` `code` `` ` ```lang ``` ` | 行内代码 / 代码块（Prism 语法高亮） |
| `- [ ]` `- [x]` | 任务列表 |
| `- item` `1. item` | 无序 / 有序列表 |
| `> quote` | 引用块 |
| `---` | 分割线 |
| `[text](url)` `![alt](url)` | 链接 / 图片 |
| `[[page name]]` | Wiki 链接（双向链接） |
| `[#tag]` | 内联标签 |
| `\| table \|` | 表格（支持行列操作） |
| `$x^2$` `$$formula$$` | 行内 / 块级 KaTeX 数学公式 |
| `~~text~~` | 删除线 |

### 斜杠命令

输入 `/` 触发命令面板：

| 命令 | 说明 |
|------|------|
| `/待办事项` | 插入折叠待办列表 |
| `/折叠列表` | 插入 Notion 风格可折叠列表 |
| `/无序列表` | 插入无序列表 |
| `/有序列表` | 插入有序列表 |
| `/代码块` | 插入代码块 |
| `/表格` | 插入表格 |
| `/页面引用` | 创建 Wiki 链接 |

### 图片处理

- **粘贴** — Ctrl+V 粘贴剪贴板图片，自动保存到 `assets/`
- **拖放** — 从文件管理器拖入图片
- **预览** — 实时显示为 base64，无需刷新

### 大纲侧边栏

右侧面板显示当前文档的标题树，点击跳转到对应段落。可折叠/展开。

---

## 日记

路径：`vault/diary/YYYY-MM-DD.md`

### 日历视图

- 月历热力图：有内容的日期高亮
- 点击日期跳转到对应日记
- 月份切换

### 日记模板

每篇日记自动包含标准章节：

```markdown
## [待办事项]
- [ ] 待办项目 1
- [x] 已完成项目

## [今日记录]
- 09:00 - 10:00 上午事项
- 14:30 - 16:00 下午事项
```

### 时间线

- 可拖拽调整时间块范围
- 双击时间块直接编辑文字
- 自动按时间排序

### DDL 截止面板

- 独立面板显示所有截止日期
- 快速添加 DDL（内容 + 日期）
- 删除已完成/过期的 DDL

### 待办同步

日记 `[待办事项]` 章节 ↔ 待办页 ↔ 仪表盘 **三向同步**：
- 在任意一处勾选/取消，其他两处自动更新
- 保存日记时自动同步

---

## 待办事项

路径：待办页独立管理（JSON 存储在 SQLite，同步到日记 markdown）

### 视图

| 视图 | 说明 |
|------|------|
| **当前** | 今日 / 本周 / 本月 卡片分组 |
| **历史** | 所有待办历史，支持筛选（全部/未完成/已完成） |

### 操作

- 添加待办（选择分组：today / week / month）
- 勾选完成 / 取消完成
- 删除

---

## 仪表盘

首页概览，打开应用即可看到。

### Banner

- 点击上传自定义背景图（localStorage 存储 base64）
- 可编辑名言和作者
- 根据时段显示问候语（早上好/下午好/晚上好）

### 最近笔记

- 显示最近 4 个笔记
- 卡片显示标题 + 更新时间
- 点击跳转到笔记

### 今日概览

- 今日日记入口（快速创建/打开）
- 今日待办列表（直接勾选）

---

## 知识库

### 笔记列表

- 按更新时间 / 标题 / 创建时间排序（升序/降序）
- 标签筛选（只显示含特定标签的笔记）
- 归档 — 隐藏不常用笔记
- 置顶 — 常用笔记固定在列表顶部

### 搜索

- 全文搜索（SQLite FTS5，支持中文）
- 高亮显示匹配片段
- 实时过滤

### 批量操作

- 多选笔记
- 批量归档 / 批量删除 / 批量打标签

### 标签管理

- 标签云展示（按使用频率）
- 重命名标签（全局替换）
- 删除标签（从所有笔记移除）

### 双向链接

- 点击 `[[wikilink]]` 跳转到目标页面
- 反向链接面板：查看哪些页面引用了当前笔记
- 前向链接：查看当前笔记引用了哪些页面

---

## 侧边栏 & 文件管理

### 目录树

- 文件夹 / 文件树形展示
- 新建笔记 / 新建文件夹
- 重命名（F2 或右键菜单）
- 删除（右键菜单 → 删除）
- 在文件资源管理器中打开

### 右键菜单

| 操作 | 说明 |
|------|------|
| 新建笔记 | 在选中目录下创建 .md 文件 |
| 新建文件夹 | 在选中目录下创建文件夹 |
| 重命名 | 行内编辑文件名 |
| 删除 | 删除文件或文件夹 |
| 在资源管理器中打开 | 打开系统文件管理器并选中 |

### 面板调整

- 左右侧边栏可拖拽调整宽度
- 日记 DDL 面板可拖拽调整高度

---

## Git 同步

### 状态栏

底部状态栏提供 Git 操作：

| 按钮 | 说明 |
|------|------|
| ↓ 拉取 | `git pull` — 从远程拉取更新 |
| ↑ 推送 | `git push` — 推送到远程 |

操作结果在状态栏短暂显示。

### 工作流

1. 初始化 vault 为 Git 仓库
2. 关联远程仓库（GitHub / GitLab / Gitee）
3. 每次编辑保存后，手动 Push/Pull 同步

> MyNote 不会自动 commit 或 push，由用户完全控制。

---

## 导出

### Markdown → PDF

- 点击编辑器右上角 `📄 导出` 按钮
- 自动调用系统 Edge/Chrome 浏览器（headless 模式）渲染为 PDF
- 保存在 `vault/exports/` 目录
- 导出后弹出确认框，可一键打开导出文件夹

### PDF 样式

- A4 纸张，2.2cm 页边距
- 页脚居中页码 `1 / N`
- 页眉完全清空（无日期、标题、URL）
- 图片自动嵌入 base64，离线可查看
- CSS 排版：标题层级、代码块暗色主题、表格边框、引用块左侧竖线

---

## 架构

```
┌─────────────────────────────────────────────────────┐
│                    前端 (Tauri WebView)               │
│  React 18 + TypeScript + Milkdown + Tailwind CSS     │
│                                                       │
│  ┌──────────┬──────────┬──────────┬──────────┐      │
│  │ 仪表盘    │  编辑器   │  日记    │  知识库   │      │
│  │ Dashboard│ Editor  │ Diary   │Knowledge │      │
│  ├──────────┼──────────┼──────────┼──────────┤      │
│  │  待办     │  侧边栏   │  大纲    │ 状态栏   │      │
│  │  Todo    │ Sidebar │ Outline │StatusBar│      │
│  └──────────┴──────────┴──────────┴──────────┘      │
│                       │                               │
│              api.ts (typed invoke)                    │
└───────────────────────┼───────────────────────────────┘
                        │ IPC (Tauri invoke)
┌───────────────────────┼───────────────────────────────┐
│                    后端 (Rust)                         │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │              Tauri Commands                    │    │
│  │  notes | diary | todos | search | export      │    │
│  │  vault | assets | git | tags                  │    │
│  └──────────────────┬───────────────────────────┘    │
│                     │                                  │
│  ┌──────────────────┼───────────────────────────┐    │
│  │            AppState (Mutex)                    │    │
│  │     vault_path  │  db (SQLite Connection)     │    │
│  └──────────────────┴───────────────────────────┘    │
│                     │                                  │
│  ┌──────────────────┴───────────────────────────┐    │
│  │                File System                     │    │
│  │     *.md  │  assets/  │  .mynote.db           │    │
│  └──────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────┘
```

### 数据流

1. **用户编辑** → React state → `useAutoSave` (800ms 防抖) → `notes.write` → 写 `.md` 文件 + 更新 SQLite 索引
2. **文件变更** → `notify` crate 监听 → 发送 `vault:changed` 事件 → 前端刷新列表
3. **搜索** → SQLite FTS5 全文索引 → 返回带高亮片段的结果
4. **导出** → 前端 `marked` 渲染 HTML → 后端写文件 + headless Chrome → PDF
5. **Git** → `git2` / shell 执行 git 命令 → 返回结果

---

## 数据存储

### 双重存储

| 层级 | 介质 | 内容 |
|------|------|------|
| **主存储** | 文件系统 `*.md` | 笔记正文、日记、待办（嵌入 markdown） |
| **索引** | SQLite `.mynote.db` | 笔记元数据、全文搜索、标签、链接关系 |

### Vault 目录结构

```
MyNote/
├── .mynote.db          # SQLite 数据库
├── notes/              # 普通笔记
│   ├── 项目A.md
│   └── 学习/           # 子文件夹
│       └── Rust笔记.md
├── diary/              # 日记
│   ├── 2026-06-01.md
│   └── 2026-06-09.md
├── assets/             # 图片附件
│   └── screenshot-abc12345.png
├── exports/            # PDF/HTML 导出
│   └── 项目A.pdf
└── .git/               # Git 版本控制（可选）
```

### SQLite 数据库表

| 表 | 用途 |
|----|------|
| `notes` | 笔记索引（path, title, tags, is_diary, archived, pinned, created_at, updated_at） |
| `todos` | 待办事项（note_path, content, completed, priority, deadline） |
| `tags` | 标签字典 |
| `note_tags` | 笔记↔标签 多对多关联 |
| `links` | 双向链接（from_path → to_path, context） |
| `notes_fts` | FTS5 全文搜索索引（title + content, unicode61 tokenizer） |

### 标签格式

标签以 `[#tag]` 方括号格式存储在 markdown 正文中，解析后写入 SQLite 的 JSON 数组字段。

### 前端存储

- **仪表盘 Banner 图片** — localStorage (`dashboard_banner`)
- **最近浏览** — localStorage (`recently_viewed`)
- **侧边栏面板宽度** — localStorage

---

## 技术栈

### 前端

| 技术 | 用途 |
|------|------|
| React 18 | UI 框架 |
| TypeScript 5 | 类型安全 |
| [Milkdown 7](https://milkdown.dev/) | WYSIWYG Markdown 编辑器（ProseMirror 内核） |
| [Tailwind CSS 3](https://tailwindcss.com/) | 原子化 CSS |
| [Zustand 5](https://zustand-demo.pmnd.rs/) | 状态管理 |
| [Lucide React](https://lucide.dev/) | 图标库 |
| [KaTeX](https://katex.org/) | 数学公式渲染 |
| [Prism](https://prismjs.com/) | 代码语法高亮 |
| [marked 18](https://marked.js.org/) | Markdown → HTML（导出） |
| [date-fns 4](https://date-fns.org/) | 日期处理 |

### 后端 (Rust)

| 技术 | 用途 |
|------|------|
| [Tauri 2](https://tauri.app/) | 跨平台桌面框架 |
| [rusqlite 0.31](https://github.com/rusqlite/rusqlite) | SQLite 数据库（bundled 编译） |
| [serde](https://serde.rs/) | 序列化/反序列化 |
| [regex](https://docs.rs/regex/) | 正则（frontmatter 解析、标签提取） |
| [walkdir](https://docs.rs/walkdir/) | 文件系统遍历 |
| [notify](https://docs.rs/notify/) | 文件系统变更监听 |
| [chrono](https://docs.rs/chrono/) | 日期时间处理 |
| [base64](https://docs.rs/base64/) | Base64 编解码 |

---

## 快捷键

| 快捷键 | 作用 |
|--------|------|
| `F2` | 重命名当前笔记标题 |
| `Enter` | 确认重命名 |
| `Escape` | 取消重命名 |
| `/` | 触发斜杠命令面板 |
| `Ctrl+V` | 粘贴图片（自动保存到 assets/） |
| 双击时间块 | 编辑日记时间块文字 |

---

## 开发

### 环境要求

- Node.js 18+
- Rust 1.80+
- Windows 11 / macOS 13+ / Linux

### 本地运行

```bash
# 安装前端依赖
npm install

# 启动开发模式（Vite + Tauri）
npx tauri dev
```

### 构建

```bash
# 生产构建
npx tauri build
```

输出在 `src-tauri/target/release/`。

### 项目结构

```
MyNote/
├── src/                    # React 前端
│   ├── App.tsx             # 主应用 + 路由 + 标签页管理
│   ├── api.ts              # Tauri 后端 API 封装（typed invoke）
│   ├── main.tsx            # 入口
│   ├── global.d.ts         # window.mynote 类型声明
│   ├── components/
│   │   ├── editor/         # Milkdown 编辑器 + 大纲侧边栏
│   │   ├── diary/          # 日记视图
│   │   ├── todo/           # 待办视图
│   │   ├── dashboard/      # 仪表盘
│   │   ├── knowledge/      # 知识库
│   │   └── layout/         # Titlebar, Sidebar, StatusBar, VaultPrompt
│   ├── stores/             # Zustand 状态管理
│   └── styles/             # CSS 文件
├── src-tauri/              # Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs         # 入口
│       ├── lib.rs          # Tauri 插件注册 + 命令注册
│       ├── state.rs        # AppState
│       ├── db.rs           # SQLite 数据库操作
│       ├── vault.rs        # 文件系统 / 类型 / 辅助函数
│       └── commands/       # Tauri 命令
│           ├── notes.rs    # 笔记 CRUD
│           ├── diary.rs    # 日记操作
│           ├── todos.rs    # 待办操作
│           ├── search.rs   # FTS 搜索
│           ├── export.rs   # PDF 导出
│           ├── assets.rs   # 图片 + PDF 文件读写
│           ├── vault_cmd.rs # 文件树 / 移动 / 删除 / 打开
│           └── git.rs      # Git pull/push
├── shared/                 # 前后端共享类型（如果有）
├── package.json
└── README.md
```

---

## License

MIT © Qun-Deng
