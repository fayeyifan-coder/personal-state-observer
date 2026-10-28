# iPhone Safari：验证本机签名点击后无反馈（2026-10-28）

## 真机报告与当前证据

用户在独立 Netlify 虚构测试站运行 PR #12 的本机 ECDSA P-256 密钥保存实验，报告：
**「点击验证本机签名没反应」**。

此报告**尚不能证明密钥损坏或 Safari 某个 WebCrypto API 不兼容**。旧版
`LocalTestDeviceKeyPanel` 在执行 `await verifyLocalTestPhoneKey()` 前没有
更新状态，只有异步完成/抛错后才反馈；若 Safari 的 IndexedDB 读取、
CryptoKey 公钥导入或 ECDSA 签名长期不返回，按钮会被 `busy` 禁用，
但用户看不到任何阶段信息，表现为“没有反应”。

WebKit 过去存在对可持久化 CryptoKey 的浏览器问题，但它们并不能
直接证明这台 iPhone 的 P-256 失败：
- https://bugs.webkit.org/show_bug.cgi?id=312279 （2026-04 非导出 X25519 的 IndexedDB 读取问题，算法不同）
- https://bugs.webkit.org/show_bug.cgi?id=183167 （历史 CryptoKey 结构化克隆问题，已修复）

## 修复内容（纯前端诊断）

- **点击即反馈**「已收到点击，正在开始本机签名验证……」，按钮临时显示「正在本机验证……」。
- 为只读流程显示无敏感内容的阶段名称：打开数据库、读取已保存的密钥、检查密钥信息、恢复公钥、核对指纹、使用私钥签名、验证签名结果。
- 设置**20 秒等待上限**，避免卡在无响应的原生 Promise；超时显示卡住阶段，并声明原测试密钥未删除。超时不会调用清除/轮换。
- 对 Safari 的 `DOMException` 只显示错误名字而不发送错误堆栈、密钥、签名或网站数据；没有联网诊断或遥测。
- 继续使用原独立 IndexedDB `personal-state-observer-synthetic-device-key-v1`，不修改数据表、不清空旧密钥、不会发请求到 Netlify Functions/Database。
- Chromium 新增**模拟原生签名 Promise 一直不返回**的场景，要求 UI 立即显示阶段，并验证刷新后原密钥仍可用。
- 另加一个 **Playwright Linux WebKit 在线测试**：真实独立虚构测试网页中创建密钥、刷新、重复验证，特别关注不同 WebKit 版本的差异。这项 CI 不是 iPhone Safari 真机测试。

## 安全门槛与真机复测

PR 修复尚未被批准合入 Netlify 测试分支时，不要求用户再次点击旧版按钮，
更不应删除原测试密钥、清空 Safari 网站数据或导入真实备份。

在 PR 经审查、CI 验收并**得到用户批准仅合入虚构测试分支**后：

1. iPhone Safari 正常联网打开原 Private 测试站、确认已发布新的版本。
2. 保留设备编号和指纹，不点击「清除未配对测试密钥」。
3. 点击「验证本机签名（不联网）」，应**立刻出现进度文字**；若最终成功可直接记录 PASS。
4. 若失败或超时，把**文字阶段及错误消息**截图发回，不需要暴露私钥、公钥、账号或设备 ID；不再尝试重建密钥，先定位原因。
5. Safari 签名成功后再刷新网页，以同一 ID/指纹重新验证。至此才可将该机本地持久化判定 PASS。

**本 PR 不合并正式 main、不启用设备配对、不建立同步、不访问真实手机记录，线上诊断收集仍为 0。**
