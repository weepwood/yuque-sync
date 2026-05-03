---
name: release
description: Yuque Sync 插件发布流程
---

# Yuque Sync 发布流程

执行完整的版本发布，包括：更新版本号、提交、打 tag、推送并触发 CI 自动创建 GitHub Release。

## 流程

1. **构建验证** — 运行 `npm run build`，确保编译通过
2. **更新 manifest 信息**（如需要）— 检查并更新 `manifest.json` 中的 `description`、`author` 等字段
3. **更新版本号** — 运行以下命令之一：
   - `npm version patch --no-git-tag-version`（补丁，1.0.0 → 1.0.1）
   - `npm version minor --no-git-tag-version`（小版本，1.0.0 → 1.1.0）
   - `npm version major --no-git-tag-version`（大版本，1.0.0 → 2.0.0）
4. **运行 version 脚本** — `npm run version`（更新 `manifest.json` 和 `versions.json`）
5. **构建** — `npm run build`
6. **提交** — `git add package.json package-lock.json manifest.json versions.json && git commit -m "release: v<版本号>"`
7. **打 tag** — `git tag <版本号>`
8. **推送** — `git push origin master --tags`
9. **确认** — 到 GitHub Actions 页面确认 CI 运行成功，Release 自动创建
