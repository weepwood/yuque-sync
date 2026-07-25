# Yuque Sync

一个用于在 Obsidian 与语雀之间同步 Markdown 文档的插件。

- 最低支持版本：Obsidian 1.4.4
- 文档同步使用语雀 API v2
- 图片上传依赖语雀网页端 Cookie 和非公开上传接口

## 功能

- **上传当前文档**：根据 YAML 前置元数据中的 `yuque_link` 更新语雀文档
- **创建语雀文档**：当当前文件没有 `yuque_link` 时，在默认知识库中创建文档并自动写回链接
- **下载语雀文档**：比较两端修改时间，确认后覆盖本地正文，并在同目录创建备份
- **上传本地图片**：支持单张图片和当前文档全部图片，兼容 Markdown 图片与 Obsidian Wiki 图片引用
- **命令面板支持**：上传、下载和批量图片上传均可从 Obsidian 命令面板执行
- **并发保护**：同一时间只允许执行一个同步任务，避免重复点击造成竞态

## 配置

在 Obsidian 的“设置 → 第三方插件 → Yuque Sync”中配置：

- `Yuque Token`：用于读取、创建和更新语雀文档
- `默认知识库`：格式为 `namespace/book`，仅在创建新文档时使用
- `Yuque Cookie`：仅用于图片上传

> Token 和 Cookie 会保存在当前 Obsidian 仓库的插件数据目录中。不要提交或分享插件的 `data.json`。
>
> 图片上传依赖语雀网页端的非公开接口和 Cookie，可能随语雀接口调整而失效；文档同步使用语雀 API v2。

## 文档元数据

已关联语雀文档的本地文件需要包含：

```yaml
---
yuque_link: https://www.yuque.com/your_namespace/your_book/document-slug
---
```

插件还会维护以下字段：

- `yuque_title`：语雀文档标题
- `yuque_updated_at`：最近一次下载时语雀返回的更新时间

## 使用方法

### 上传到语雀

点击左侧上传图标，或在命令面板执行“Yuque Sync: 上传当前文档到语雀”。

- 已存在 `yuque_link`：覆盖对应语雀文档
- 不存在 `yuque_link`：在默认知识库创建新文档，并将链接写回 YAML

### 从语雀下载

点击左侧下载图标，或在命令面板执行“Yuque Sync: 从语雀下载当前文档”。

插件会先显示本地和语雀修改时间。确认覆盖后，会在当前文件同目录创建类似以下名称的备份：

```text
文件名.backup-20260725-153000.md
```

### 上传图片

- 在编辑器中右键本地图片引用，选择“上传图片到语雀”
- 在 Markdown 文件上右键，选择“上传文档中的所有图片到语雀”
- 或通过命令面板执行批量上传

批量上传期间如果文档内容发生变化，插件不会自动覆盖文件，防止丢失新的编辑。

## 安装

### 通过 BRAT

1. 安装 [BRAT](https://obsidian.md/plugins?id=obsidian42-brat)
2. 添加仓库 `weepwood/yuque-sync`
3. 启用插件

### 手动安装

从 Releases 下载最新版，将以下文件放入 Obsidian 插件目录的 `yuque-sync` 文件夹：

- `main.js`
- `manifest.json`
- `styles.css`

## 开发

```bash
npm ci
npm run dev
npm run typecheck
npm run build
```

项目结构：

```text
main.ts                    插件入口与工作流编排
src/yuque-client.ts        语雀 API 与图片上传客户端
src/markdown-utils.ts      YAML、链接与图片引用处理
src/settings-tab.ts        插件设置页
src/confirm-modal.ts       确认弹窗
src/types.ts               共享类型
```

## 许可证

MIT
