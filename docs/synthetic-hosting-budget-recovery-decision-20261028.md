# P18 S4：虚构同步站托管、预算与故障恢复放行决策

决策日期：2026-10-28 · **已选测试方案，不代表线上部署许可**

## 决议

**仅对虚构数据的下一阶段试验**，优先使用现有独立 Netlify Credit-based Free 项目的 **Private（Team Owner 可见）** 能力，加独立虚构 PostgreSQL 库、虚构操作员凭证、仅供测试的服务器签发密钥。保留当前 iPhone GitHub Pages 主站、真实浏览器 IndexedDB、本地导出备份、真实操作员密钥、正式主分支完全不变。

试验采用 **按需、单次同步**，不启用后台轮询、定时 Functions、自动变更 DB、自动部署。禁止把任何来自原手机的照片、健康记录、真实备份、访问令牌、正式口令或密钥用于试验。若账号并非 Credit-based Free 或既有私人站不是独立站，必须先重新审核，不得自动升级付费。

**真实记录长期开启同步仍 NO-GO。** 对长期服务器签发私钥，首选的**待验证设计候选**是独立托管的不可导出 P-256 签名服务（例如 AWS KMS asymmetric ECC_NIST_P256、SIGN_VERIFY），而不是把生产私钥直接放在普通 Netlify 环境变量。AWS KMS 的证据是能将私钥保留在 KMS 内，且可对外发布公钥；但与 Netlify 的服务间身份凭证、IAM 最小权限、KMS 审计、密钥轮换、可靠恢复以及 DER 签名转换兼容性都尚未实现，不能声称已经可用。

## 成本规划（是情景演示，不是账单预测）

Netlify 当前 Credit-based Free：$0、300 credits/账户/月，达到额度暂停，不能自动充值。生产部署每次 15 credits；数据库计算按 10 credits/compute-unit-hour 计费。Free 数据库最低 1 CU，5 分钟不活跃后休眠。Functions、其他站点、额外请求、带宽和超过最短休眠时间的活跃时段会继续产生使用量，**实际账户已用量未知**。

下表为 30 天、每次独立唤醒 5 分钟、1 CU、发生一次生产部署时的示意计算；不是上限，不能据此自动部署：

| 虚构触发频率 | 示例 DB 使用小时数 | DB 示例 credits | 加一次部署 | 是否放行 |
|---|---:|---:|---:|---|
| 每日 1 次按需会话 | 2.5 | 25 | 40 | 仍需人工核对账户剩余额度及明确授权 |
| 每日 2 次 | 5 | 50 | 65 | 同上 |
| 每日 10 次 | 25 | 250 | 265 | 不建议：剩余额度不足以覆盖其他消耗 |
| 每 15 分钟一次、全天轮询 | 非独立会话，可能长时间常醒 | 可能超过免费额度 | 不适用 | **禁止** |

另有 Netlify 定价文档将 Free 数据库的定期备份列为 **7 天**，数据库专项限制与备份文档则写 **3 天**。存在官方文档不一致：本项目按较短的 **3 天** 做保守风险评估，试验前需以实际 Netlify 控制台和合同条件核实，**不能把任何一个数字当作已验收事实**。

AWS KMS 的独立签发候选：官方定价为创建 KMS key 大约 **US$1/key/月**（另计签名、网络、运行时、监控等）；ECDSA SHA-256 不使用普通 20,000 次免费请求配额。它仍只是未来生产候选成本，不是现有部署账单，也不授权创建可计费资源。

官方依据（2026-10-28 查阅）：

- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
- https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/
- https://docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery/
- https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/
- https://docs.netlify.com/build/functions/environment-variables/
- https://docs.netlify.com/build/environment-variables/secrets-controller/
- https://aws.amazon.com/kms/pricing/
- https://docs.aws.amazon.com/kms/latest/developerguide/symmetric-asymmetric.html
- https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html

## 本轮新增可执行离线证据

- `tools/synthetic-hosting-gate.mjs` 和 `tests/synthetic-hosting-gate.test.mjs`：对 Netlify Free 唤醒成本做假设透明的情景演算。所有情况下输出 `safeToDeployFromThisEstimate=false`；离线计划也最多得到 `OFFLINE_PLAN_READY`，决不返回线上部署批准。源权限、正式密钥/真实记录、自动轮询、自动部署、在线连接或未经批准迁移都必须 fail closed。
- `tests/synthetic-cloud-rollback-drill.test.ts`：虚构密文快照可以解密校验，但云端恢复到旧版本不得覆盖手机现有链；首次 PC 读取的是待核实历史，不能自动恢复；错误口令或外层元数据篡改被拒绝。
- CI 只运行脱网单元/恢复演习以及现有静态无部署保护、Windows/Linux 构建；不访问 Netlify、AWS、现有手机、真实数据库。

## 单独申请虚构在线试验前必须具备的证据

1. **账户与费用**：确认 Netlify 当前账号具体计划、账户已用/剩余 credits、其他站点共用额度和是否有计费方式。确认测试独立站确实 Private/Team Owner-only。账户必须有可接受的余量；提议为首次试验预留至少 100 credits 的账户缓冲，并设置人工检查阈值：若试验新增用量达到 30 credits 或账户余量跌破 100 credits，则立即停止测试。由于 Netlify Free 没有按单站点预算隔离能力，30 credits 是人工停用阈值，不是平台强制保证。
2. **严格隔离**：空的虚构数据库（不能指向已有/真实库）、独立测试密钥及身份，站点 UUID 和操作员公钥事先独立核验，禁止重用生产 API token/密钥/账号数据。**不得从真实主站跨源读取 IndexedDB。**
3. **安全路由清单**：只允许最少的 Private 函数暴露授权挑战、已验证候选证明、签名回执、受签名门禁保护的审批与只读/密文上传。所有创建/撤销权限的路径都必须由独立操作员签名驱动；无自动配对、无 `approve=true` 自报授权。必须有明确的服务器启动 fail-closed 开关。
4. **密钥冷启动与轮换**：在两个独立冷启动/部署版本下，测试签发公钥指纹一致；故意删钥、换钥或换站点时拒绝签发。操作员对站点 UUID 与公钥 64 位指纹做独立信任固定，网站不能自我证明可信。
5. **故障及备份**：试验前生成只含虚构数据的离线备份并成功恢复；同时模拟网络断开、账户额度耗尽、云端历史回滚、错密钥、撤销后重试、两个客户端冲突。云端数据库恢复可能丢掉备份时间点之后的提交，必须要求手机重新核验远端 head，不能自动覆盖本地。
6. **退出机制**：记录独立站点、密钥身份、数据库和预期删除范围。仅在用户后续明确授权后，才能执行试验/停用/销毁。不得将本轮“可以规划”解释为创建资源或付款许可。

## 上线决策

| 阶段 | 本次结论 |
|---|---|
| 离线原型：S0–S3、签名审批、密文端到端 | 已由各自 GitHub CI 验证（具体 SHA 单独记录） |
| S4 成本/回滚/权限的离线预检 | 以本 PR 的新 CI 结果为准 |
| Netlify Free 上真实网络的**纯虚构**试验 | **NOT AUTHORIZED — 需单独批准** |
| Netlify Database 真实空库部署/迁移/生产密钥 | **NO-GO** |
| iPhone 真实记录自动同步到 Windows | **NO-GO** |

下一步只需做一个明确决策：确认用户实际 Netlify 账户状态，并在完整预检通过后由用户授权一次 **虚构数据试验**。正式个人数据的生产托管路线不应因试验便利而自动确定。
