# P16 · Windows 安全预检与服务器公钥首次信任手册（2026-10-28）

## 为什么先做这一项

P11–P15 已在隔离环境通过手机密钥持有证明、PostgreSQL 事务、操作员签名、服务端签发证据与 Windows/Linux 虚构签名测试。但在首次真实配对之前，有两个不同的问题：

1. **软件自检**：Windows 是否能使用 Node Crypto/WebCrypto 验证签名格式、拒绝篡改和过期凭证？可以用完全虚构、只在内存中的密钥做非破坏性检查。
2. **首次信任**：Windows 怎么知道服务器首次交付的公钥确实是正确的？**单纯从同一个 Netlify 页面下载 `issuer.json`、再抄该页面显示的指纹，不是独立验证。** 这必须有人从单独核实的可信渠道取得指纹。软件只能校验一致性，不能凭空创造可信来源。

此 PR **只**交付第 1 项自动化自检和第 2 项只读检查工具/阻断流程。未生成任何真实密钥、未连接数据库、未部署 Netlify Function、未修改真实个人记录。

## 已交付工具

- `tools/operator-offline-selftest.mjs`：不接收任何账户、备份或密钥文件；使用**随机虚构账户、服务器及操作员密钥**，在进程内依次检查签名跨 Node Crypto/WebCrypto 互通、错公钥、篡改证据、过期、没有证据不签名、操作员私钥口令错误、旧版未绑定信任私钥不能签发。没有网络调用、不会读写个人数据和凭据文件，不生成任何可正式使用的密钥。
- `tools/operator-offline-preflight.mjs`：只读外部路径上的**公开** `operator-public.json`；要求操作者另行输入已经通过可信渠道取得的完整服务器公钥 SHA-256 指纹。验证公钥清单 `v2` 中的签名绑定、站点、指纹一致，拒绝旧 `v1`、伪造替换或缺少完整指纹。不打开加密私钥 PEM，不修改公钥文件，也不与服务器通信。
- `tests/operator-offline-preflight.test.mjs`：Windows + Linux runner 检查无输入自检、外部临时公开清单、错指纹、替换签发公钥、旧清单拒绝、拒绝秘密参数。
- `.github/workflows/verify-offline-trust-preflight.yml`：跨平台执行新工具与 P15 证据签发/离线签名回归，正常 App 构建无改动；GitHub runner 内临时虚构密钥不会进入正式站点。

## Windows 本机人工验收流程（**仅虚构数据**）

本轮不需要建立任何真实操作员密钥，也不需要将 iPhone 的测试密钥上传 Windows：

```powershell
# 在包含 tools 文件夹的 personal-state-observer 开发分支根目录
node --version
node tools/operator-offline-selftest.mjs
```

预期输出：`PASS：14 项离线虚构安全自检。`、明确“未联网、未授权任何设备”。如程序退出失败、Node 无法启动或出现任何密码输入框，**停止操作并记录报错**；自检本身不需要输入密码。

此脚本应在真实 Windows PowerShell、Windows Terminal 或命令提示符中手工验证一次。GitHub `windows-latest` 只证明 Windows CI runner 上 Node 能运行，**不等于已在用户本机验证**。

## 将来才需要的首次信任操作

真实服务器签发公钥和最终操作员密钥均**尚未创建**；因此现在**没有**可以安全提供给用户的真实 `issuer.json`、不能从网页自行挑一个指纹视作已核实，也**不应该**执行下面的真实核验命令。

待可信服务器签发密钥方案、单独审核及公钥发布来源完成后，操作者才可先从可信独立渠道获取完整 64 位指纹，再执行：

```powershell
node tools/operator-offline-preflight.mjs --manifest "C:\\独立安全目录\\operator-public.json" --trusted-issuer-fingerprint "独立渠道核实的64位小写指纹"
```

此命令只读，不需要也不应提供 `operator-encrypted-private.pem`，更不应上传密钥、口令、个人健康 JSON 或截图含敏感信息。

## 安全阻断与明确事实

- **独立渠道定义**：不能“同一个被验证对象自证正确”。未来可信渠道可以是预先已验证的管理/部署记录（须验证身份与完整性）、线下手工交接的指纹或者可信授权仪式；单纯 HTTPS 或 Netlify 登录成功只证明访问通道，并不能凭空保证首次签发公钥没有被错误配置或替换。
- **指纹 ≠ 操作员身份**：预检只确认公开清单内容和提供的独立指纹一致，不证明实际操作者本人有审批权，更不会自动绑定服务器端操作员公钥。
- **密码安全与 Windows ACL**：Windows 本地还要人工检查文件夹 NTFS 权限、终端密码不回显、病毒防护与可信备份方案；脚本不读取/修改私钥，不能替代这些检查。
- **密钥轮换/丢失**：服务器证据签发私钥丢失或被怀疑泄露，必须立即停止新审批、撤销相应服务器端信任，通过新的独立可信渠道重新核对新公钥。**不能通过自动接受新 `issuer.json` 来静默轮换**。旧操作员清单当前固定绑定的是旧服务器公钥，不能直接替换字段完成轮换。
- **上线 NO-GO**：独立首次可信公钥交接、服务器私钥长期安全托管（“不可导出 CryptoKey”本身不等于可跨 Netlify Function 冷启动持久存在）、Netlify 身份适配/安全 Function、正式管理员公钥注册/撤销路径、真实 Windows 本机交互和隔离线上闭环尚未完成。

## 这次不会改变什么

正式 GitHub Pages `main`、Netlify 自动发布的虚构测试分支、用户 iPhone 中已保存的测试私钥、所有实际历史记录，以及 Netlify Database 均原样保留。草稿 PR 的 base 是 PR #18 开发分支，不触发真实云端同步。

**判定：离线预检准备到位 ≠ 已安全建立首次服务器信任 ≠ 已完成手机配对。**
