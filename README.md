# MyNote

本地优先、所见即所得的 Markdown 笔记应用。支持日记、待办、知识库、Git 同步。

## 功能

- **WYSIWYG 编辑器** — 所见即所得，支持 `/` 斜杠命令、`[[wikilink]]` 双向链接、`[#tag]` 标签、KaTeX 数学公式、表格、代码高亮
- **日记** — 日历视图 + 时间线拖拽 + DDL 截止面板，与待办双向同步
- **待办事项** — 今日/本周/本月卡片视图，同步到日记 `[待办事项]` 章节
- **仪表盘** — 可编辑 Banner + 最近笔记 + 今日概览
- **知识库** — 全文搜索、标签筛选、归档/置顶、批量操作、反向链接
- **侧边栏** — 目录树、右键菜单、F2 重命名、拖拽调整面板
- **Git 同步** — 状态栏一键 Pull / Push
- **PDF 导出** — 点击 📄 导出，图片自动嵌入，页码居中

## 使用

```bash
# 开发
npm install
npx tauri dev

# 构建
npx tauri build
```

### 基本操作

| 操作 | 方式 |
|------|------|
| 新建笔记 | 侧边栏右键 → 新建笔记，或仪表盘点击新建 |
| 斜杠命令 | 编辑器中输入 `/` 弹出命令面板 |
| 插入图片 | 截图后 Ctrl+V 粘贴，或拖入图片文件 |
| 重命名 | 双击标题栏或按 F2 |
| 导出 PDF | 右上角 📄 按钮 |
| Git 同步 | 底部状态栏 ↓ 拉取 / ↑ 推送 |

### Vault 目录

```
MyNote/
├── .mynote.db       # SQLite 索引（FTS5 全文搜索、标签、链接）
├── notes/           # 普通笔记
├── diary/           # 日记 (YYYY-MM-DD.md)
├── assets/          # 图片
├── exports/         # PDF 导出
└── .git/            # 可选 Git 版本控制
```

> 主数据是 `.md` 文件，SQLite 是索引缓存，可从文件重建。

## 技术栈

Tauri 2 + React 18 + TypeScript + Milkdown + Tailwind CSS + SQLite (rusqlite) + Rust

## License

MIT © Qun-Deng
