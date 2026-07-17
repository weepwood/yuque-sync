# 安全说明

## 凭据

本服务需要：

- `YUQUE_TOKEN`：语雀公开 v2 文档 API；
- `YUQUE_COOKIE`：语雀网页会话，用于非公开图片上传接口。

Cookie 的权限通常高于个人 Token。泄露 Cookie 可能导致他人以你的登录会话操作语雀。

必须做到：

- 只在服务端保存凭据；
- 不写入提示词、MCP 工具参数或工具返回值；
- 不提交 `.env`；
- 不在日志中打印请求头；
- Cookie 失效或疑似泄露时立即退出语雀会话并重新登录。

## MCP 端点

个人测试推荐：

- 服务监听 `127.0.0.1`；
- 使用 Secure MCP Tunnel 或 Cloudflare Tunnel；
- 使用长随机 `MCP_PATH`；
- 不公开完整 URL。

随机路径只能降低误访问概率，不等价于 OAuth。长期、多用户或公开部署必须实现标准 OAuth 和用户级授权。

## SSRF 防护

`save_image_to_yuque` 会下载 ChatGPT 提供的临时文件 URL。服务会：

- 仅允许 HTTPS；
- 阻止 localhost、私有 IP、链路本地地址和常见元数据地址；
- 检查重定向目标；
- 可通过 `DOWNLOAD_ALLOWED_HOSTS` 使用域名白名单；
- 限制响应体大小。

DNS 在预检查和实际连接之间仍可能变化。安全要求较高时，应配置明确的 `DOWNLOAD_ALLOWED_HOSTS`，并通过网络层限制服务的出站访问范围。

## Host 和 Origin

当 `HOST=0.0.0.0` 时，应设置：

```env
ALLOWED_HOSTS=yuque-mcp.example.com,localhost,127.0.0.1
```

浏览器组件需要跨域访问时，再设置 `ALLOWED_ORIGINS`。普通 ChatGPT 服务端 MCP 请求通常不依赖浏览器 CORS。

## 文件限制

默认：

```env
MAX_IMAGE_MB=25
MAX_BATCH_IMAGES=10
```

只接受 `image/*` MIME。语雀接口是否接受某种图片格式仍由语雀决定。

## 日志

Pino 日志会对 Cookie、Authorization、Token 字段脱敏；stdio 模式把日志写入标准错误流，避免破坏 MCP 协议。不要在新增日志中记录：

- `.env` 全量内容；
- 请求参数中的临时 `download_url`；
- 完整 Cookie；
- 语雀 Token；
- 含秘密值的 MCP URL。
