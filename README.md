# Yuque Sync

一个 [Obsidian](https://obsidian.md) 插件，用于在 Obsidian 和[语雀](https://www.yuque.com)之间同步 Markdown 文档。

## 功能

- **上传到语雀** — 将当前文件上传到语雀知识库，使用 YAML 前置元数据中的 `yuque_link` 确定目标文档
- **从语雀下载** — 从语雀下载文档内容到当前文件，下载前自动备份原文件为 `{filename}_{timestamp}.md`，并自动添加 `yuque_title` 字段
- **上传本地图片** — 使用语雀网页登录 Cookie 将 Markdown 中的本地图片上传到语雀并替换链接

## ChatGPT / MCP 图片服务

仓库的 [`mcp-server/`](mcp-server/) 目录提供独立的 Yuque Image MCP 服务，可将 ChatGPT 或其他 MCP 客户端中的图片上传到语雀，并创建包含原始提示词、实际生成提示词和元数据的图片档案文档。

它支持：

- 远程 Streamable HTTP MCP；
- 本地 stdio MCP；
- 单图和批量图片上传；
- 创建或更新语雀图片文档；
- Docker、Windows、Nginx、Cloudflare Tunnel 部署示例。

安装、配置和套餐限制见 [`mcp-server/README.md`](mcp-server/README.md)。

## 使用方法

### 前置要求

1. 在[语雀设置](https://www.yuque.com/settings/tokens)生成一个 Token
2. 在 Obsidian 插件设置中填入该 Token

### 上传文档

1. 在文件 YAML 前置元数据中添加 `yuque_link` 字段，值为语雀文档 URL，例如：

   ```yaml
   ---
   yuque_link: https://www.yuque.com/your_namespace/your_book/slug
   ---
   ```

2. 点击左侧 Ribbon 栏的上传图标 ☁️，确认后即上传

### 下载文档

1. 确保文件已包含 `yuque_link` 字段
2. 点击左侧 Ribbon 栏的下载图标 ⬇️，查看本地与语雀的修改时间对比，确认后即下载

## 安装

### 通过 BRAT

1. 安装 [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) 插件
2. 添加仓库 `weepwood/yuque-sync`
3. 启用插件

### 手动安装

从 [Releases](https://github.com/weepwood/yuque-sync/releases) 下载最新版，将 `main.js`、`manifest.json`、`styles.css` 放入 Obsidian 插件目录的 `yuque-sync` 文件夹。

## 开发

```bash
npm install     # 安装依赖
npm run dev     # 监听模式
npm run build   # 生产构建
```

MCP 服务开发：

```bash
cd mcp-server
npm install
npm run check
npm start
```

## 许可证

MIT
