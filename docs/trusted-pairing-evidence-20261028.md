# P15｜可信服务器配对证据：防止 Windows 审批工具签署伪造申请（2026-10-28）

## 要解决的问题

PR #14 的 PostgreSQL 待配对申请通过了真实临时数据库的“手机持有证明”，PR #16 的独立审批签名门禁通过了防重放验收，PR #17 的 Windows 离线审批工具也通过自动化测试，但旧版工具仍可读取电脑上**任意 JSON 候选申请**并签署短期指令。用户可能无法判断该 JSON 是否真由服务器在验证手机密钥后生成。

这个 PR 是独立开发分支，父分支为 PR #17；**不部署 Netlify**、不迁移用户数据库、不合并正式 `main`、不修改 iPhone 既有测试私钥或手机真实记录。

## 增加的证据链

1. 可信服务器在收到 Netlify Private 已验证的站点与账户上下文后，只能依据数据库里真实存在的申请、已经验证的私钥持有时间及未过期状态，签发 `approve-publisher` 证据。撤销设备时只允许对数据库中当前未撤销且有合法 P-256 公钥的设备签发 `revoke-publisher` 证据。**浏览器不得自行指定服务器要签署的公钥指纹、账户或持有证明时间。**
2. 服务端使用一把单独配置的**不可导出 P-256 服务器证据私钥**对固定顺序的 UTF-8 证据内容签名，最多 90 秒有效期，且首次配对凭证不能超过待申请本身的时效。服务器私钥和操作员审批私钥彼此独立。
3. Windows 只接受带 `schema`、原始证据字段和签名的完整凭证，使用之前由操作者独立核验并**固定信任**的服务器公钥进行离线验签。
4. Windows 生成新的审批密钥时，必须指定仓库外的 `issuer.json`，并人工输入独立核实的完整服务器证据签发指纹。通过后，工具创建 **v2 操作员公钥清单**并用自身不可导出到外部的审批私钥签署“服务器证据指纹绑定”；以后篡改该绑定或在清单里改换服务器公钥都会被拒绝。
5. Windows `sign` 命令不再接受 `--request 候选.json`，只接受 `--receipt 服务器签名凭证.json`。在尝试解锁审批私钥前，先校验证据签名、固定站点、有效期、账号、设备、指纹和操作类型。之后仍要求手工输入已独立核对的完整**手机公钥指纹、账户 ID、APPROVE/REVOKE**。
6. 旧 `pso-offline-operator-v1` 清单仍可用于离线校验过往签名，但**不能再签发新的审批指令**。工具不会自动信任凭证附带的任意公钥。
7. 一次性操作员 `nonce` 与审批命令有效期依旧由 PR #16 的服务器原型验证、数据库审计表拦截重复执行。**成功签出 JSON 不代表服务器已经批准或撤销设备**。

## 实现文件

- `src/server/verifiedPairingEvidenceIssuer.ts`：只读检索已证明的 pending 或有效发布设备，验证站点与身份上下文，使用注入的受信任私钥签署有时限的证据，没有任何 Netlify API/HTTP 路由。
- `tools/trusted-pairing-evidence.mjs`：仅本地 Node Crypto 验证证据签名和时效，不访问网络。
- `tools/operator-offline-core.mjs`：v2 服务器签发公钥绑定、新指令必须匹配已签证据、旧 v1 禁止继续签发。
- `tools/operator-offline.mjs`：初始公钥核对、证据文件读取和拒绝任意原始 JSON。
- `tests/verified-pairing-evidence.test.ts`：服务端只读数据查询、错误上下文/失效申请拒绝、客户端与服务端待签字节逐项一致、错公钥/过期/篡改拒绝。
- `tests/operator-offline-cli.test.mjs`、`tests/operator-offline-tty-smoke.py`、`tests/pairing-evidence-fixture.mjs`：虚构短期服务器签名与操作员签名，Linux 终端完整交互，Windows/Ubuntu Node Crypto 与 WebCrypto 验签。
- `.github/workflows/verify-trusted-pairing-evidence.yml`：两系统自动化验收，所有密钥都在临时 runner 内存中随机生成；`npm run build` 验证正式网站无回归。

## 仍未完成，严禁误称已经配对

- **首次信任的分发与核对**：独立渠道获取真正服务器证据公钥的流程、撤销/轮换服务器证据签发私钥流程、操作员密钥保管与 Windows NTFS ACL 尚未实现。只从候选文件本身复制签发公钥指纹是**不安全的**。
- **服务器部署与数据库**：没有线上 Function 路由、没有通过线上数据库进行真实凭证签发、没有把任何 SQL 从 `docs/sql-drafts` 放到 Netlify 迁移目录、没有个人记录上传。
- **本机与多人审查**：Windows PowerShell 真实密码输入、管理员公钥从独立电脑安全固定到服务器端，仍需真机/人工验收。GitHub Windows runner 的非交互化测试与 Linux PTY 不是用户 Windows 电脑的真实操作。
- **权限门禁**：旧版低层 `approveByOperator` 仍存在于 PR #14，未来上线必须代码审查确保对外没有绕过 PR #16 独立审批签名门禁的函数。
- **撤销和时效**：服务端审批必须在接受实际签名凭证时重新核对实时 PostgreSQL 状态；已签的证据不提供永久授权。
- **安全凭证**：`receipt.json` 和 `operator-signed-command.json` 包含账户/设备元数据，不能公开粘贴到聊天或 GitHub。绝对不要上传操作员私钥 PEM 或口令。

**上线判断：开发实验 PASS 也仅允许进入下一步安全审查；正式个人记录与 Netlify Database 继续 NO-GO。**
