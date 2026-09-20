# VoiceLedger 0.6 Beta：火山引擎免费 OCR 配置

0.6 的图片识别链路是：

`iPhone 声账 -> 你的 Cloudflare Worker -> 火山引擎通用文字识别 OCRNormal -> Worker 整理成声账记录`

GitHub 页面里**不保存**火山引擎 Secret Key。

## 你需要准备

1. 火山引擎账号。
2. 开通“通用文字识别”服务。官方当前文档列出 **5000 次免费调用额度，免费 QPS 1**；免费额度之外当前按调用量价格为 0.005 元/次。免费政策以后可能变化，以控制台为准。
3. 一个 Cloudflare 账号。Workers Free 当前有 100,000 请求/日，声账这种个人用量远远够用。

如果火山控制台在“开通 OCR”时要求你直接开启付费、充值或绑定自动扣费，而你只想用免费额度，**先别确认付费**，把那一页截图发给我再判断。

## 第一步：火山引擎

1. 在火山引擎控制台找到视觉 / OCR，开通“通用文字识别”。接口名是 `OCRNormal`。
2. 在“访问控制 / 密钥管理”创建 Access Key。
3. 记下两项：
   - Access Key ID（AK）
   - Secret Access Key（SK）

更稳妥的做法是创建一个权限受限的 IAM 用户，只给 OCR / visual 服务权限；不要把主账号 AK/SK 放进公开代码。

## 第二步：Cloudflare Worker

1. Cloudflare Dashboard -> Workers & Pages -> Create Worker。
2. 打开在线代码编辑器。
3. 用本包 `cloudflare-worker/worker.js` **完整覆盖**默认代码，然后 Deploy。
4. 打开 Worker 的 Settings -> Variables and Secrets，添加两个 **Secret**：

   - `VOLC_ACCESS_KEY_ID` = 你的 AK
   - `VOLC_SECRET_ACCESS_KEY` = 你的 SK

   不要写在普通网页代码里，也不要提交到 GitHub。
5. 可选：添加普通变量 `ALLOWED_ORIGIN`，值写你的 GitHub Pages 域名；测试阶段可以不填。

部署后会得到类似：

`https://voiceledger-ocr.xxxxx.workers.dev`

## 第三步：声账

1. 打开 VoiceLedger 0.6。
2. 设置 -> 云端视觉 OCR。
3. 把 Worker 地址粘进去。
4. 点“保存识别服务” -> “测试连接”。
5. 显示“连接正常 · 火山引擎通用文字识别”后，就可以去拍照页测试。

## 隐私说明

照片会离开 iPhone，经过你自己的 Cloudflare Worker，并发送到火山引擎 OCR 接口处理。声账的书库、金额、结算记录仍然保存在你的浏览器本地；Worker 只接收本次图片和用于简称匹配的书名/简称列表。
