# 连接 ChatGPT

> 套餐限制（截至 2026-07-17）：完整 MCP 写入 App 正在向 ChatGPT Business、Enterprise 和 Edu 工作区提供。Plus 账户目前不能直接创建此类写入 App。Plus 用户可以先使用本项目的 stdio 模式连接 VS Code、Cursor、Claude Desktop 等本地 MCP 客户端。

## 1. 启动本地服务

```powershell
npm install
Copy-Item .env.example .env
# 编辑 .env
npm run check
npm start
```

确认健康检查可访问：

```text
http://127.0.0.1:8787/healthz
```

## 2. 提供 HTTPS 地址

ChatGPT 需要可访问的 HTTPS `/mcp` 端点。本项目推荐三种方式。

### 方式 A：Secure MCP Tunnel

在 ChatGPT 创建 Developer-mode app 时选择 Tunnel，并按界面提示连接本地服务。这种方式不用直接公开本机端口。

### 方式 B：Cloudflare Quick Tunnel

安装 `cloudflared` 后运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\cloudflare-quick-tunnel.ps1
```

终端会返回类似：

```text
https://random.trycloudflare.com
```

最终 MCP 地址为：

```text
https://random.trycloudflare.com + MCP_PATH
```

例如 `.env` 中：

```env
MCP_PATH=/mcp/4f1b8bb6f0944a44b9a37d8e31f675fc
```

则填写：

```text
https://random.trycloudflare.com/mcp/4f1b8bb6f0944a44b9a37d8e31f675fc
```

Quick Tunnel 地址会变化，只适合临时测试。长期使用请创建命名 Tunnel 或使用自己的域名。

### 方式 C：Nginx + 正式域名

参考：

```text
deploy/nginx.conf.example
```

确保：

- 公网只开放 HTTPS；
- MCP 上游仍监听 `127.0.0.1:8787`；
- `ALLOWED_HOSTS` 包含你的域名；
- 代理读取超时足够长；
- 不记录 Cookie、Token 或完整随机 MCP 路径。

## 3. 在 ChatGPT 中创建 App

仅适用于当前支持完整 MCP 的 Business、Enterprise 或 Edu 工作区：

1. 使用 ChatGPT Web。
2. Business 管理员/所有者可从 `Workspace settings → Apps → Create` 启用并创建；Enterprise/Edu 获授权用户可进入 `Settings → Apps → Advanced Settings` 打开 Developer mode。
3. 进入 `Settings → Apps → Create`。
4. 填写：

```text
Name: Yuque Image Manager
Description: 将聊天中的图片上传到语雀，并创建包含提示词和元数据的图片档案文档。
MCP server URL: https://你的域名/完整MCP路径
```

5. 点击 `Scan Tools`，扫描完成后创建。创建后应出现：

```text
check_yuque_connection
upload_yuque_image
upload_yuque_images
create_yuque_image_document
save_image_to_yuque
```

工具或描述更新后，在 App 设置中点击 Refresh。

## 4. 第一次测试

先执行只读检查：

```text
检查我的语雀连接是否正常。
```

这会调用 `check_yuque_connection`。它只能验证 Token，不能证明 Cookie 上传接口仍然有效。

再上传一张测试图：

```text
把这张图片上传到语雀，只返回图片地址，不创建文档。
```

最后测试完整流程：

```text
将这张图片保存到语雀并创建图片档案。
标题：测试图片
分类：MCP 测试
标签：ChatGPT、语雀、MCP
记录本次提示词和图片信息。
```

## 5. 权限确认

上传图片和创建文档都会修改外部系统，因此工具声明为写操作。ChatGPT 可能在调用前要求确认，这是正常行为。

## 6. Bearer Token 模式

若其他 MCP 客户端支持自定义 Authorization Header，可以设置：

```env
MCP_BEARER_TOKEN=一段随机Token
```

客户端需发送：

```http
Authorization: Bearer 一段随机Token
```

ChatGPT Developer-mode app 的认证建议使用平台支持的标准认证流程。个人临时使用时，可以保持 `MCP_BEARER_TOKEN` 为空，并使用长随机 `MCP_PATH` 和受控 HTTPS Tunnel。
