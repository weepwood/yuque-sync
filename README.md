# Yuque Sync

一个用于在 Obsidian 与语雀之间同步 Markdown 文档的插件。

- 最低支持版本：Obsidian 1.4.4
- 文档同步使用语雀 API v2
- 图片上传依赖语雀网页端 Cookie 和非公开上传接口

## 功能

- **上传当前文档**：根据 YAML 前置元数据中的 `yuque_link` 更新语雀文档
- **创建语雀文档**：当当前文件没有 `yuque_link` 时，在默认知识库中创建文档并自动写回链接
- **批量检测同步状态**：扫描整个 Vault，区分已同步、内容不同、未关联、链接异常、远端不存在、YAML 异常等状态
- **批量推送未关联文档**：将没有 `yuque_link` 的 Markdown 文档串行创建到默认语雀知识库，并写回链接
- **下载语雀文档**：比较两端修改时间，确认后覆盖本地正文，并先创建集中备份
- **上传本地图片**：支持单张图片和当前文档全部图片，兼容 Markdown 图片与 Obsidian Wiki 图片引用
- **命令面板支持**：上传、下载、批量检测、批量创建和批量图片上传均可从 Obsidian 命令面板执行
- **并发保护**：同一时间只允许执行一个同步任务，避免重复点击造成竞态
- **创建恢复保护**：语雀文档创建成功但本地 `yuque_link` 写回失败时，会记录待恢复状态，避免下次批量操作重复创建文档

## 配置

在 Obsidian 的“设置 → 第三方插件 → Yuque Sync”中配置：

- `Yuque Token`：用于读取、创建和更新语雀文档
- `默认知识库`：格式为 `namespace/book`，仅在创建新文档时使用
- `Yuque Cookie`：仅用于图片上传

> Token、Cookie 和创建恢复状态会保存在当前 Obsidian 仓库的插件数据目录中。不要提交或分享插件的 `data.json`。
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
- `yuque_updated_at`：最近一次下载或恢复关联时语雀返回的更新时间

如果某个 Markdown 文档不应参与语雀批量扫描和批量推送，可以设置：

```yaml
---
yuque_sync: false
---
```

设置后，手动上传当前文档也会被阻止，防止误同步。

## 使用方法

### 上传到语雀

点击左侧上传图标，或在命令面板执行“Yuque Sync: 上传当前文档到语雀”。

- 已存在 `yuque_link`：覆盖对应语雀文档
- 不存在 `yuque_link`：在默认知识库创建新文档，并将链接写回 YAML

如果远端文档已经创建，但插件在写回本地 `yuque_link` 前中断，下一次创建时会优先尝试恢复已有远端文档关联，而不是直接再次创建。

### 批量检测同步状态

在命令面板执行“Yuque Sync: 检测所有文档同步状态”。

插件会扫描 Vault 中的 Markdown 文档，并显示状态面板：

- `已同步`：本地正文与语雀正文相同
- `内容不同`：本地正文与语雀正文不同
- `未关联`：没有 `yuque_link`
- `链接异常`：`yuque_link` 无法解析为有效语雀文档地址
- `远端不存在`：语雀返回 404
- `YAML 异常`：Frontmatter 无法解析
- `检测失败`：网络、权限或其他 API 错误
- `已忽略`：设置了 `yuque_sync: false`

状态面板可以直接重新检测，也可以一键开始推送所有未关联文档。

> 当前“已同步/内容不同”通过比较两端 Markdown 正文判断，不使用本地文件修改时间作为严格同步依据。

### 批量推送未关联文档

在命令面板执行“Yuque Sync: 批量推送未关联文档到语雀”，或从同步状态面板点击“推送未关联文档”。

插件会：

1. 重新扫描所有未关联 Markdown 文档
2. 自动跳过备份文件和 `yuque_sync: false` 文档
3. 显示本次预计创建数量并只确认一次
4. 串行创建语雀文档，避免一次性高并发请求
5. 为成功创建的文档写回 `yuque_link` 和 `yuque_title`
6. 尝试加入语雀知识库目录
7. 单篇失败时继续处理后续文档，并在最后汇总结果

### 从语雀下载

点击左侧下载图标，或在命令面板执行“Yuque Sync: 从语雀下载当前文档”。

插件会先显示本地和语雀修改时间。确认覆盖后，会先备份原文，再覆盖当前文件。

#### 新备份机制

备份不再创建在原文档旁边，而是统一放在：

```text
.yuque-sync/backups/
```

插件会保留原目录结构。例如：

```text
原文件：
Notes/Programming/TypeScript.md

备份：
.yuque-sync/backups/Notes/Programming/TypeScript.backup-20260810-213000.md
```

这样可以避免备份文件混入普通笔记目录，也不会被批量同步扫描和批量推送识别为待创建文档。

旧版本创建的：

```text
文件名.backup-YYYYMMDD-HHMMSS.md
```

也会被新的批量扫描逻辑自动忽略。

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
src/markdown-utils.ts      YAML、链接、同步过滤与图片引用处理
src/sync-status-modal.ts   批量同步状态面板
src/settings-tab.ts        插件设置页
src/confirm-modal.ts       确认弹窗
src/types.ts               共享类型
```

## 许可证

MIT
