# P18 S0/S1：虚构手机—电脑加密同步的代码级连通验收（2026-10-28）

状态：**仅合成、离线、草稿**；没有部署、没有真实数据、没有真实密钥、没有 Netlify Database 迁移。本阶段不合并正式 GitHub Pages main，也不合并独立测试站部署分支。

## 代码级入口图

1. Netlify Private 可信调用上下文 `site.id`、`user.id` 和过期时间（**在本测试中由固定虚构上下文模拟，而非验证真实 Netlify 平台行为**）。
2. `createPendingPairingWorkflow.request`：仅生成候选及五分钟 nonce；`prove` 校验候选手机 P-256 私钥持有证据。证明成功不自动授权。
3. `createVerifiedPairingEvidenceIssuer.issue`：服务器从受信任账户及数据库已证明候选签署短时效 receipt。测试使用随机生成、仅在本次 CI 内存存在的签发密钥与固定的测试信任根。
4. `requestFromVerifiedEvidence` 验证 receipt 签发公钥后，人工签署的 `operatorCommandBytes` 由 `createSignedOperatorPairingGate.apply` 验证、事务审计、授权或吊销。**这里的“人工”是 CI 通过虚构操作员密钥模拟的，不能冒称真实人工核准**。
5. `createPrivateChallengeHandler` 先确认唯一已授权发布设备，再给一次性发布挑战。客户端签署精确 HTTP 请求正文的 SHA-256 摘要。
6. `createPrivateProjectAuthenticator` 依赖可信身份、真实已登记公钥、签名、原始来源、一次性挑战核对，并返回只读或发布权限。
7. `createGuardedSyncHandler` → `createPostgresSyncRepository`：手机提交 AES-256-GCM 密文信封；PG 以账户行锁、设备授权与 CAS 避免两个快照覆盖。电脑拥有相同账户只读身份，不具备发布签名。
8. `createSignedOperatorPairingGate.apply` 撤销后作废旧手机挑战；读取远端密文的只读授权不受影响。

本分支没有 Netlify Function 路由或任何监听端口，以上都是直接调用服务器契约的集成测试。测试使用真正的 PostgreSQL 16 *临时服务*，不使用假的 DB Map。

## 自动化验证范围

- [ ] 无配对、未证明、错手机签名不得发布；无独立操作员签名不得批准。
- [ ] 已证明候选必须有经已固定证据公钥核验的短期 receipt，然后经操作员签名和 DB 事务批准。
- [ ] 唯一手机可以上传密文；同账号普通电脑只读，无法借登录获得写入权限。
- [ ] 加密快照原样存取、密钥口令不入库；第二账户无法读第一账户历史。
- [ ] 同一个签名与发布挑战不可重放；相同已提交快照独立有效签名重试幂等。
- [ ] 两次不同快照争夺相同 head 时恰好一次提交，另一次 409。
- [ ] 撤销后旧挑战与新发布申请均拒绝，电脑仍可读取已有快照。
- [ ] 只读静态门禁阻止出现 Netlify Function、自动数据库迁移、从客户端引入服务端模块以及代码中调用旧版未签名批准方法。

以上 checkbox 只能在对应当前 commit 的 GitHub Actions 绿色通过后标记为 PASS。它们**不是线上环境的运行保证**。

## 当前明确限制及后续阻断

- **未知的正式服务器签发密钥托管/冷启动恢复/独立首次信任**：CI 随机密钥仅证明算法可行，不能变成部署身份。Netlify Free 资源与安全可行性仍要独立确认。
- 原 `ManualPairingStore.approveByOperator` 与 `revokeByOperator` 底层方法仍存在；S0 静态扫描可以发现普通源文件中的显式调用，**不能取代人工审查整个可达依赖图和任何动态调用**。在上线分支前应重构为不可公开导入的 DB 内部权限边界，确保所有真实权限变更走已验证的签名门禁。
- 这些服务端契约没有 `netlify/functions` API，也没有真实前端网络请求、Windows 实际操作员签名的人机确认或 iPhone Safari 完整线上配对。模拟用户上下文的单测不是 Netlify Private 真机验证。
- `main` 的 iPhone IndexedDB 记录属于另一个 origin。此测试不会读取、导出、迁移、恢复或覆盖手机记录。
- 正式上线前需单独做 XSS/CSP、浏览器真实持钥验签、信任根公钥独立交付、密钥泄露/轮换、设备失机恢复、登录会话、限流/日志隐私、费用预算、备份恢复、断网和浏览器兼容性检查。
- 任何纯虚构环境线上部署、真实密钥建立、Netlify SQL 迁移、真实记录同步，都需要各自单独获准。**本轮仍为 NO-GO**。
