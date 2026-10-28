# P12｜iPhone 现有测试私钥与服务端配对格式的离线演练（2026-10-28）

## 已完成的独立背景

- 真实 iPhone Safari 已经验证过独立测试站 `personal-state-observer-synthetic-device-key-v1` 中不可导出 P-256 私钥可以跨刷新使用（PR #12、#13）。
- PR #14 已在另一条**未部署**的开发分支中定义「待审核申请 → P-256 私钥持有证明 → 独立审批 → 发布授权 / 撤销」服务器合同，使用 GitHub 临时 PostgreSQL 通过自动化验收。
- 现在只在 `test/isolated-phone-lab-20261028` 的派生开发分支添加**零联网、非正式的演练**，明确保持两个开发线隔离。

## 演练体验

- 在黄色「独立测试站 · 仅限虚构数据」横幅中，原有本机密钥区域下方增加
  「**配对协议 · 本地演练（不联网）**」。
- 「生成本地模拟配对申请」读取**现有**测试设备的公钥与设备 UUID，不创建、替换或删除私钥。计算完整的 64 位十六进制 SHA-256 公钥指纹，展示给用户核对。
- 一次性申请 `siteId`、`ownerId`、`requestId`、`nonce` 都由浏览器**临时生成虚构随机 UUID**，有效期为 5 分钟。**没有使用真实 Netlify 账户或服务器挑战**。
- 「使用原密钥证明持有（不联网）」从原测试站 IndexedDB 读取不可导出的私钥，按 PR #14 相同的定界规则签名并使用公钥本机验签。到期、指纹不一致、原密钥被清理或签名不能验证都要失败。
- 明确显示「本机持有证明通过。但没有服务器申请、没有人工审核，设备仍未配对，无法上传。」；不会自动批准，也没有配对成功通知。
- 此次候选申请和签名只在当前网页内存中保留，不进入原有 IndexedDB、JSON 备份、Netlify Database 或日志。刷新后模拟申请丢弃，而原有 P-256 测试私钥仍在。

## 格式一致性

配对签名的 UTF-8 字节格式与 PR #14 `pairingProofMessage` 相同，顺序必须为：

```text
personal-state-observer:manual-pairing-proof:v1
siteId
ownerId
requestId
nonce
deviceId
fingerprint
```

以换行符连接；指纹 SHA-256 输入严格为 `JSON.stringify({kty:'EC',crv:'P-256',x,y})`。签名算法 ECDSA P-256 / SHA-256。两条分支的独立测试以固定字段顺序防止格式漂移。私钥无法通过 WebCrypto 导出并不能阻止具有同源任意脚本执行权的攻击者**调用签名**，未来真实上线必须额外审查 CSP、依赖和撤销。

## 自动化验收与未放行项目

`tests/synthetic-pairing-contract-tests.ts`：验证固定字节、指纹与纯 Web Crypto 签名不能跨 nonce 或 deviceId 重放。

`tests/isolated-lab.browser.mjs`：Chromium 基于已保存、已刷新 P-256 CryptoKey 在独立虚构站生成申请，确认全指纹与原指纹前 16 位一致，执行签名证明，确认没有 Netlify Function / API / POST 请求、没有每日记录变更，刷新后模拟申请消失而原密钥仍能重新签名。

`.github/workflows/verify-synthetic-pairing-rehearsal.yml`：独立 CI 只运行虚构本机浏览器与合同检查；**不连接**用户 Netlify Database。

**仍不具备**：实际 Netlify 身份绑定的 pending API、可信管理员审核通道、服务器公钥登记、手机正式发布、电脑只读云端快照、撤销界面、真实记录上传/下载。PR #14 所需真实审核和签名设备验证仍是以后独立的开发门槛。

## 用户与部署边界

- 不修改正式 GitHub Pages `main` 或 iPhone 已记录的历史。
- 无访问真实个人 JSON 的入口，不改变已有 Netlify Private 登录诊断或独立测试站业务数据。
- 这是一条新的**草稿 PR**。未得到明确授权前，不合并到 Netlify 自动发布分支，网页上暂时看不到演练按钮。
- 即使批准部署，仍只用虚构样本，并用原先已保存的测试私钥；不要清空 Safari 网站数据。

**结论**：完成了真机密钥与配对协议之间的本地格式验证准备，但真实云端配对仍是 NO-GO。
