# 参与贡献

## 开始前

1. 先阅读 [`RELEASE_STATUS.md`](RELEASE_STATUS.md)、[`docs/DECISIONS.md`](docs/DECISIONS.md) 和 [`docs/合规说明.md`](docs/合规说明.md)。
2. 不要提交真实雇主、客户、项目、产品、账号、凭证或业务数据。
3. 内容改动遵守 CC BY 4.0；代码改动遵守 MIT。
4. 不得把口播稿存在、文件名或截图当成视频已经发布的证据。

## 提交流程

1. 从最新 `main` 创建短生命周期分支。
2. 尽量保持一次提交只解决一个问题。
3. 运行 `node scripts/verify-release.mjs`。
4. 若改动游戏，运行 `node scripts/serve-local.mjs` 并检查桌面与 360×800 视口。
5. 若改动知识卡片，保留 `card-spec.json`、语义视觉报告、PNG、清单和 QA；未获得人工视觉批准时不得标记 `publishable=true`。
6. 在 PR 中写清变更范围、验证证据和未处理风险。

## 当前商业边界

前三重完整免费；第四重起公开版只展示剧情摘要、能力目标和预期道果，完整步骤进入付费带练或企业内训。贡献不得绕过这条边界。
