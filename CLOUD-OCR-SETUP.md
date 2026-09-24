# VoiceLedger 0.9 · Cloudflare / 火山 OCR 更新说明

## 这次为什么要更新 Worker？

0.6～0.8 的 Worker 已经能稳定处理 AU 文件列表。0.9 新增“呱呱录音宝月账”表格识别，因此 Worker 增加了第二种解析模式：

- `mode: "au"`（或不传 mode）：原 AU 录音文件列表解析
- `mode: "guagua"`：呱呱账单表格解析

前端 0.9 如果连接到旧 Worker，AU 仍可能正常，但呱呱导入会明确提示“需要更新到 0.9 Worker”。

## 用户现有部署的最短更新路径

你已经有 Worker：`voiceledger-ocr`，也已经配置好火山 AK/SK，所以：

1. 打开原来的 Worker GitHub 仓库（此前是 `Baijunheng22/Githubocr`）。
2. 用 0.9 包里的 `cloudflare-worker/worker.js` 覆盖仓库根目录 `worker.js`。
3. 提交到 `main`。
4. 等 Cloudflare Builds 自动执行原来的 `npx wrangler deploy`。
5. 不要重新创建 Worker，不要重新填写 AK/SK。

原有运行时 Secret 名称仍然是：

- `VOLC_ACCESS_KEY_ID`
- `VOLC_SECRET_ACCESS_KEY`

## 部署后验证

打开原 Worker 的 `/health`。正确的 0.9 返回应包含类似：

```json
{
  "ok": true,
  "provider": "火山引擎通用文字识别",
  "model": "OCRNormal",
  "version": "0.9",
  "features": ["au", "guagua"],
  "configured": true
}
```

`/health` 只验证 Worker 已部署并能读取 Secret。第一次真正导入呱呱账单，才是端到端 OCR 测试。

## 安全提醒

AK/SK 只放在 Cloudflare Runtime Secrets。不要写进 `worker.js`、GitHub、VoiceLedger 前端，也不要把真实 Key 发到聊天里。
