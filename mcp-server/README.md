# Yuque Image MCP

把 ChatGPT 中用户提供或生成的图片直接上传到语雀，并创建包含原始提示词、实际生成提示词和元数据的语雀文档。

本项目同时支持：

- **远程 Streamable HTTP MCP**：连接 ChatGPT Developer mode。
- **本地 stdio MCP**：连接 VS Code、Cursor、Claude Desktop 等本地 MCP 客户端。
- **单图与批量上传**：图片由语雀托管，返回语雀图片 URL。
- **创建或更新图片文档**：支持知识库、文档 slug、目录追加、公开状态和扩展元数据。
- **安全限制**：文件类型与大小限制、基础 SSRF 防护、速率限制、日志凭据脱敏、Host/Origin 校验。

> 图片上传使用语雀网页端接口 `POST /api/upload/attach` 和登录 Cookie；文档读写使用语雀 v2 Token API。图片接口不是稳定的公开 API，语雀更新后可能需要调整适配器。

## 工具列表

| 工具 | 用途 |
|---|---|
| `check_yuque_connection` | 检查语雀 Token 和默认知识库配置 |
| `upload_yuque_image` | 上传一张图片，返回语雀图片 URL |
| `upload_yuque_images` | 批量上传图片，默认最多 10 张 |
| `create_yuque_image_document` | 使用已有图片 URL 创建或更新语雀文档 |
| `save_image_to_yuque` | 上传图片并创建/更新创作记录文档 |

## 环境要求

- Node.js 20 或更高版本，推荐 Node.js 22。
- 一个语雀个人 Token。
- 一个当前有效的语雀网页登录 Cookie。
- 一个目标语雀知识库，例如 `weepwood/ai-image`。
- 连接 ChatGPT 时，需要可通过 HTTPS 访问的 MCP 地址。
- 截至 2026-07-17，ChatGPT 完整 MCP 写入 App 仅面向 Business、Enterprise 和 Edu 工作区；Plus 账户可先使用本地 stdio 客户端，或升级到受支持的工作区。

## 快速开始

### 1. 安装

```bash
npm install
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
npm install
```

也可以直接运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

### 2. 配置 `.env`

最低必填项：

```env
YUQUE_TOKEN=你的语雀Token
YUQUE_COOKIE=浏览器中复制的完整Cookie
YUQUE_REPO=weepwood/ai-image
```

为远程 ChatGPT MCP 建议生成随机路径：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-mcp-path.ps1
```

将输出写入 `.env`：

```env
MCP_PATH=/mcp/一段足够长的随机值
```

这个随机路径不是完整的 OAuth 身份验证，但比暴露固定 `/mcp` 路径更适合个人开发模式测试。不要公开完整 MCP URL。

### 3. 检查并启动

```bash
npm run check
npm start
```

开发模式：

```bash
npm run dev
```

默认地址：

```text
http://127.0.0.1:8787/mcp
```

健康检查：

```text
http://127.0.0.1:8787/healthz
```

### 4. 本地 MCP 联调

服务启动后执行：

```bash
npm run smoke
```

自定义地址：

```bash
MCP_TEST_URL=http://127.0.0.1:8787/mcp npm run smoke
```

Windows PowerShell：

```powershell
$env:MCP_TEST_URL="http://127.0.0.1:8787/mcp"
npm run smoke
```

## 连接 ChatGPT

> 当前套餐限制：截至 2026-07-17，ChatGPT 完整 MCP 写入 App 仅面向 Business、Enterprise 和 Edu 工作区。Plus 账户中通常不会出现创建写入型自定义 App 的入口。

完整步骤见 [docs/CHATGPT.md](docs/CHATGPT.md)。受支持工作区的概要如下：

1. 由工作区管理员或获授权开发者启用 Developer mode，并启动 MCP 服务。
2. 使用 Secure MCP Tunnel、Cloudflare Tunnel、ngrok 或自己的反向代理暴露 HTTPS 地址。
3. 在 ChatGPT Web 中进入 `Settings → Apps → Advanced Settings` 启用 Developer mode，或由管理员从 `Workspace settings → Apps → Create` 创建。
4. 进入 `Settings → Apps → Create`，创建 Developer-mode app。
5. 填入完整 HTTPS MCP 地址，例如：

```text
https://yuque-mcp.example.com/mcp/你的随机值
```

6. 创建成功后应看到本项目提供的 5 个工具。

## 典型提示词

```text
将这张图片保存到语雀。

标题：Pink Guava 文件夹图标
分类：水果主题文件夹图标
标签：水果、轻拟物、文件夹图标
同时记录原始提示词、实际生成提示词、图片尺寸和创建时间。
```

ChatGPT 应调用：

```text
save_image_to_yuque
```

## Docker

```bash
cp .env.example .env
# 修改 .env

docker compose up -d --build
```

Docker Compose 默认只映射到宿主机 `127.0.0.1:8787`，建议通过宿主机上的 Cloudflare Tunnel 或 Nginx 提供 HTTPS。

当 `HOST=0.0.0.0` 时，必须将公网域名加入：

```env
ALLOWED_HOSTS=yuque-mcp.example.com,localhost,127.0.0.1
```

## 本地 stdio 模式

构建后运行：

```bash
npm run build
npm run start:stdio
```

示例 MCP 客户端配置：

```json
{
  "mcpServers": {
    "yuque-image": {
      "command": "node",
      "args": ["D:/path/to/yuque-image-mcp/dist/src/stdio.js"],
      "env": {
        "YUQUE_TOKEN": "...",
        "YUQUE_COOKIE": "...",
        "YUQUE_REPO": "weepwood/ai-image"
      }
    }
  }
}
```

不要把真实 Cookie 和 Token 提交到客户端配置仓库。

## 目录结构

```text
src/
├─ config/                 环境变量与日志
├─ mcp/server.ts           MCP 工具定义
├─ services/
│  ├─ image-download.ts    ChatGPT 临时文件下载
│  └─ yuque.ts             语雀图片与文档接口
├─ utils/                  安全、文件名和 Markdown 工具
├─ http.ts                 远程 HTTP MCP 入口
└─ stdio.ts                本地 stdio MCP 入口

docs/                     部署、ChatGPT、安全和排错文档
deploy/                   Nginx、systemd、Cloudflare 示例
scripts/                  Windows 安装和联调脚本
tests/                    单元测试
```

## 安全注意事项

- `YUQUE_COOKIE` 等同于网页登录会话凭据，只能保存在服务端。
- 不要把 `.env`、Cookie、Token 或带随机密钥的完整 MCP URL 提交到 Git。
- 建议限制服务只监听 `127.0.0.1`，通过受控隧道或反向代理暴露。
- 若面向多用户或长期公开部署，应增加标准 OAuth，而不是仅依赖随机路径。
- `DOWNLOAD_ALLOWED_HOSTS` 可以进一步限制 ChatGPT 临时文件域名；首次运行可留空，确认实际域名后再收紧。
- 服务日志默认会脱敏 Cookie、Authorization 和 Token 字段。

详见 [docs/SECURITY.md](docs/SECURITY.md)。

## 测试状态

本包包含：

- TypeScript 严格类型检查；
- Markdown 模板测试；
- 环境配置测试；
- 语雀图片上传请求模拟测试；
- 语雀文档创建响应模拟测试；
- MCP HTTP/stdio 工具发现 smoke test。

真实语雀上传需要你自己的 Cookie 和 Token，因此不会在公开测试中执行。

## License

MIT
