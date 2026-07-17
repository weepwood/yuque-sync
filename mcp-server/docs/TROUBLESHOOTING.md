# 排错

## ChatGPT 无法连接 MCP

检查：

1. MCP 地址必须是 HTTPS。
2. 地址必须包含正确的 `MCP_PATH`。
3. `ALLOWED_HOSTS` 必须包含公网域名。
4. 反向代理必须支持 POST，并保留流式响应。
5. 查看：

```text
/healthz
```

6. 本地运行：

```bash
npm run smoke
```

## 返回 403 Host not allowed

将实际域名加入：

```env
ALLOWED_HOSTS=实际域名,localhost,127.0.0.1
```

重启服务。

## 语雀 Token 校验失败

- 确认 Token 来自当前语雀账号；
- 确认没有复制空格或换行；
- 重新生成 Token；
- 调用 `check_yuque_connection`。

## 图片上传返回 401 或 403

通常是 `YUQUE_COOKIE` 过期。按 `GET_YUQUE_COOKIE.md` 重新复制 Cookie，并重启服务。

## 图片上传返回 HTML 或登录页

同样说明 Cookie 已失效，或语雀修改了接口行为。

## 图片上传成功但文档创建失败

图片与文档是两步操作。图片可能已经存在于语雀 CDN。此时：

1. 从工具返回或日志中获取已上传图片 URL；
2. 调用 `create_yuque_image_document`；
3. 检查 `YUQUE_TOKEN` 和 `YUQUE_REPO`。

## 文档创建成功但没有出现在目录

创建文档和更新 TOC 是两次请求。工具会返回 `toc_added=false` 和 warning。可以在语雀中手动整理目录，或检查账号对知识库目录的写权限。

## 下载图片被阻止

若设置了 `DOWNLOAD_ALLOWED_HOSTS`，需要加入 ChatGPT 临时文件实际使用的域名。不要为了绕过错误允许私有 IP 或关闭 HTTPS 限制。

## Node 启动失败

确认版本：

```bash
node --version
npm --version
```

要求 Node.js 20+，推荐 22。

重新安装：

```bash
rm -rf node_modules package-lock.json
npm install
npm run check
```

Windows PowerShell：

```powershell
Remove-Item node_modules -Recurse -Force
Remove-Item package-lock.json -Force
npm install
npm run check
```
