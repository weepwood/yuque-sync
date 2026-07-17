# 获取语雀 Cookie

图片上传接口使用语雀网页登录 Cookie，而不是个人 Token。

## Chrome / Edge

1. 登录语雀网页。
2. 打开任意语雀文档。
3. 按 `F12` 打开开发者工具。
4. 打开 `Network`。
5. 在语雀编辑器中手动上传一张测试图片。
6. 在请求列表中找到包含：

```text
/api/upload/attach
```

7. 点击该请求，在 `Request Headers` 中找到 `Cookie`。
8. 复制 `Cookie:` 后面的完整值，不要包含字段名本身。
9. 写入服务器 `.env`：

```env
YUQUE_COOKIE=复制的完整值
```

10. 重启 MCP 服务。

## 注意

- Cookie 可能包含多个键值对，必须完整复制。
- Cookie 会过期；出现 401、403 或返回登录页时需要重新获取。
- 不要截图、发送或提交真实 Cookie。
- `.env` 已在 `.gitignore` 中，但仍应检查 Git 状态后再提交。
- 远程服务器上建议通过安全的 Secret 管理功能设置环境变量。
