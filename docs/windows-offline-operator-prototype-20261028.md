# Windows 离线操作员审批工具｜第一版原型（2026-10-28）

## 本阶段实际完成的边界

此前 PR #16 已有**服务端**独立操作员 P-256 签名验证和 PostgreSQL 防重放检查，但操作员还没有一把独立于 iPhone / Netlify 账户的签名私钥与工具。本 PR 仅实现 Windows 可运行的**完全离线**签名原型，**没有**云端权限或审批接口、没有服务器密钥登记、没有真实设备配对，**不部署**。

原型适用 Node.js 22+，使用系统的 Node Crypto / OpenSSL，不调用任何网络、Netlify SDK、数据库或第三方密码管理 API。用户的 iPhone 已存测试私钥**不是**这里的操作员私钥，绝不可把它复制到 Windows。

## 文件

- `tools/operator-offline-core.mjs`：加密 PKCS#8 P-256 操作员密钥、公开 JWK 清单和全 SHA-256 公钥指纹；严格匹配 `src/server/signedOperatorPairingGate.ts` 的 `operatorCommandBytes` 字节串，签名为 **ECDSA P-256 SHA-256、IEEE-P1363 原始 64 字节**、base64url。
- `tools/operator-offline.mjs`：Windows 交互式命令行，支持 `init`、`sign`、`verify`。拒绝口令命令行选项和非交互式密钥创建；口令在终端输入不回显。所有私钥与指令文件都必须指定**仓库外绝对路径**，不接受仓库内目录、已存在的目标文件或明文私钥。
- `tests/operator-offline-cli.test.mjs`：虚构随机密钥与伪造/篡改/跨账户/站点/指纹/操作类型/过期指令测试，调用 PR #16 的原始服务端验签方法，验证跨 Node Crypto 与 WebCrypto 一致；测试 CLI 在非 TTY 环境下拒绝创建私钥、不接受 `--passphrase`。
- `.github/workflows/verify-offline-operator-cli.yml`：`windows-latest` 和 `ubuntu-latest` 两系统执行加密签名互通与旧权限回归，不访问用户 Netlify Database。
- `.gitignore`：对常见的操作员密钥和签名文件名称提供额外防误提交措施。**.gitignore 并不能保护任意命名或已被追踪的秘密文件**。

## 正确的最终操作模型（现在尚未开放）

1. 先验证服务器待审批申请确实来自属于本人账户的 iPhone，并在 iPhone 屏幕上人工核对**完整 64 位 SHA-256 公钥指纹**。
2. 本地离线工具的 `sign` 要求操作者**重新手动输入**事先确认的账户 ID、完整手机公钥指纹和精确操作类型 `APPROVE`／`REVOKE`。它拒绝自报批准状态。
3. Windows 上单独生成 P-256 操作员私钥，只存加密 PKCS#8 PEM；操作员公钥（不是私钥）以后才能通过独立审核固定在后端。这个“固定公钥的可信上线过程”**目前未实现**。
4. 工具在 90 秒有效期内生成一次性 `nonce`，签署含操作、账户、设备、申请号、指纹、时间的域分隔命令，输出一个**未经执行**的 JSON 凭证。它不能注册、撤销或授权任何设备。
5. 将来仅可信后端验签、校验待审申请及数据库状态后，才能写入设备发布授权。候选文件若被伪造，纵有操作员签名，也必须由服务器再次核对待审公钥和持有证明；目前没有在线提交端。

## 安全边界

- 口令最低 16 字符，但这个长度限制**并不保证**口令抵抗离线穷举；加密 PKCS#8 的实际抗爆破强度依赖用户口令与 OpenSSL 的加密参数。强烈建议长、独立的随机口令、单独保管，不传入聊天、GitHub、Netlify 环境变量或同步网盘。
- 本机普通加密文件**并非** TPM/Windows Hello 硬件保护；被恶意软件控制的本机会暴露口令或签名能力。不要声称本工具是硬件安全密钥。
- 不要放在代码仓库、Git 目录、网络共享、公开云盘或日常 JSON 备份中。Windows 文件权限需要人工检查；POSIX 的 `mode:0o600` 在 Windows 上**不能替代 NTFS ACL 安全配置**。
- 只有最终真实的受信任审核工具才能防范误审批；用户单独在浏览器或别处复制的候选 JSON **不能被这个离线原型证明是服务器真实生成的**。应有可信审核界面和服务端会话绑定，否则有被诱导签署的风险。
- `sign` 和 `verify` 会在本地读取含设备 ID、Netlify 账号标识的 JSON；这些并非健康记录，但仍应妥善保护。不要在聊天里粘贴凭证和内部标识。
- 生成签名不会把审批结果同步回测试站。签名有效不等于真正完成审批，签名过期后无法重用。
- **当前 CI 只在 Windows runner 运行无交互测试**；Windows PowerShell 的口令隐藏和真实交互按键流程，必须在受控隔离机器上完成手工验收，不能擅自假设真机通过。

## 使用说明（未来经人工批准后，先只用虚构账户和站点）

在 PowerShell 的项目根目录查看说明（完全无副作用）：

```powershell
node tools/operator-offline.mjs --help
```

经过后续人工审查时，可使用独立的**虚构** `siteId` 和仓库外目录试验（这些命令现在不需要执行）：

```powershell
# 将这些占位符替换为专门创建的虚构测试数据，勿使用生产凭据
node tools/operator-offline.mjs init --dir "C:\\OfflineOperatorFixture" --site-id "TEST_SITE_UUID"
node tools/operator-offline.mjs sign --dir "C:\\OfflineOperatorFixture" --request "C:\\Fixture\\candidate.json" --out "C:\\Fixture\\operator-signed-command.json"
node tools/operator-offline.mjs verify --dir "C:\\OfflineOperatorFixture" --signed "C:\\Fixture\\operator-signed-command.json"
```

私钥只有生成它的本机离线操作者掌握，未来服务器端只接收经审核的**公钥**。**无需现在点击 Netlify Make public、操作数据库、上传历史记录或在手机上重新生成密钥。**

## 阻断项（不能把这一轮当作完成同步）

独立审核信息来源与操作者身份、真实 Windows 交互式 TTY 兼容性、审批密钥安全备份/丢失与吊销、服务器公钥固定/轮换、受控 online Function 路由、客户端设备公钥待审申请、过期和重试体验、手机撤销与换机、个人数据的端到端加密同步，均需要独立审查和授权。

**NO-GO**：PR 保持草稿，base PR #16 的开发分支，不能合并 Netlify 测试自动发布分支或正式 `main`。
