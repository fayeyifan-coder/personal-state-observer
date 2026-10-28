# P18｜Personal State Observer 配对链整合与 Netlify Free 上线前审查

日期：2026-10-28。**本报告不授权部署或迁移，不授权创建真实私钥、配对、撤销或健康记录上传。**

## 1. 审查到的仓库事实

- 正式 GitHub Pages `main@95ea6a0` 是真实 iPhone Safari 健康记录来源；不能覆盖或清理。
- 自动发布的独立 Netlify 虚构测试站来自 `test/isolated-phone-lab-20261028@caa62ea`；手机已通过测试密钥持久化与离线模拟配对真机验收。
- 后端代码位于草稿栈：PR #14 服务端 pending/证明/原始 operator store；PR #16 独立 P-256 操作员签名+PostgreSQL 一次性 nonce；PR #17 Windows 离线审批工具；PR #18 已签服务器证据与可信公钥固定；PR #19 Windows 14 项本机离线安全自检 PASS；PR #20 三方只读换钥连续性审核。PR #9 的设备发布权限与 CAS 协议是独立草稿依赖，不能因为本阶段集成成功就声称已部署同步。
- **明确发现**：原 `createPostgresManualPairingStore` 暴露了 `approveByOperator/revokeByOperator` 底层方法，旧测试直接调用它们；而 PR #16 的签名门禁是另一个入口。没有统一 Composition Root 之前，未来 Netlify handler 容易接错低层方法，绕过独立审批凭据。
- 现有 Netlify 自动部署分支不包含上述服务端原型，也没有线上配对、数据库迁移或正式服务器密钥。

## 2. 本轮交付代码：统一受控服务端入口

`src/server/isolatedPairingGateway.ts` 将所有服务端部件在同一处**仅在服务器**构造：

1. **request**：受信任 Netlify site/user 上下文提交候选公钥，生成短期申请，不能直接批准。
2. **prove**：原 iPhone P-256 非导出测试私钥签署服务端挑战、验证公钥持有，不能直接批准。
3. **evidence**：只对已证明的数据库申请或活跃设备签发短期、带真实数据库指纹的可信证据；非导出服务器签发密钥仅通过服务器配置注入。
4. **applySignedOperatorAction**：唯一公开的权限变更方法，要求预先固定的独立操作员公钥验证签名；原子事务锁、nonce 防重放、公钥持有证明、唯一活跃手机、吊销剩余挑战在底层严格执行。
5. 不导出底层 store 以供路由直接 `approveByOperator` 或 `revokeByOperator`。关闭开关、缺少任意一把必要公钥/私钥时整个入口均拒绝。**这不是一个新 Netlify HTTP 路由**，不会对现有虚构测试站产生任何行为变化。

`tests/postgres-integrated-pairing-gateway.integration.ts` 在一次性 PostgreSQL 16 使用**随机虚构手机、操作员、服务器私钥**运行端到端：原始申请不能得到签发证据或发布授权；错误手机证明/伪造操作员签名被拒绝；真手机证明后能够得到已签服务器证据；有效独立操作员签名才可以原子批准；相同签名并发重复只能成功一次；撤销后不再能签发撤销凭证。

## 3. Netlify Free 现行能力与限制

截至 2026-10-28，官方文档：

- 2026 年 credit-based Free 是 **300 credits/月，硬性用量上限且不自动付费充值**。但是**数据库活跃时就有数据库计算/带宽成本**；每次正式部署也会消耗 credits。没有查看用户 Netlify 账单、实时计量和具体业务访问量，**无法保证实验在 300 credits 内**。
- Free 包含 Netlify Database、Functions、Blobs；Functions 的运行时环境变量可以用于保管服务端配置；数据库可通过 Functions 查询。**环境变量与 Netlify Blobs 都不是 HSM、硬件 KMS 或可保证无法提取私钥的密钥保护方案**，且如果把密文和解密口令同时放入同一函数环境，实际上是同一个可信执行域，不能称作独立双重密钥保管。
- Free Netlify Database 定期备份保留约 **3 天**，不能作为正式历史记录唯一备份。数据库存储计费信息在官方部分页面仍使用“2026 年 7 月 1 日开始不早于”的旧表述；**本日 2026-10-28 实际存储收费、是否有额外单位价格，须以当前仪表盘和最新账单为准**。
- 非导出 `CryptoKey` 仅表示当前执行环境无法通过 WebCrypto 导出该实例；Netlify Functions 冷启动之间**不保证持久的进程内 CryptoKey**。正式方案必须明确可审查的签发私钥持久化与轮换方案（如专门安全服务/KMS，或清晰限定威胁模型的私密环境变量托管），并做关闭权限与恢复演练。
- Netlify Secrets Controller 的具体可用性/环境变量部署上下文隔离、密钥访问控制与生产/Deploy Preview 影响必须**按该项目实测**，不能仅按文档“已支持”推断当前站点配置安全。
- 推荐预算门槛：先读取 Netlify 项目实际用量和站点发布分支；冻结任何生产上传，然后让 **仅虚构环境** 的每日验证、函数响应时间/数据库计算消耗有可回滚记录；在用户单独批准实验额度与部署范围之前，不变更现有 Netlify Database。

官方来源（2026-10-28 审查时访问）：
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
- https://docs.netlify.com/build/functions/environment-variables/
- https://docs.netlify.com/build/environment-variables/secrets-controller/
- https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/
- https://docs.netlify.com/build/functions/configuration/

## 4. 上线门槛与优先顺序

### Blocker A · 统一权限绕行验证（此轮只完成组合入口，不是最终密封）

未来必须有强制持续检查：所有 Netlify Functions 的设备批准／撤销调用仅可依赖 `createIsolatedPairingGateway().applySignedOperatorAction`；不能把旧 `createPostgresManualPairingStore` 或低层 `approveByOperator/revokeByOperator` 导入 Function 或普通 RPC。旧测试仍可调用底层以证明数据库行为，但不能暴露真实路由。需要将此规则纳入仓库级静态扫描/审查，防止之后新路由绕行。独立测试必须复核真实 `context.user` 是 Netlify 函数提供的可信上下文，不能接受 request JSON 自称 owner。

### Blocker B · 服务器证据密钥的长期持有与独立首次信任

正式 `issuer.json` 还不存在。密钥必须在部署/重启后能稳定恢复、不能存前端/仓库，也不能依赖进程冷启动时随机生成；首次指纹要经**独立可信渠道**由本人核对，不能用同一个页面自报的指纹自我证明。密钥丢失、撤销和轮换应有可实施的审计/版本/防回滚流程。目前 PR #20 是**纯只读证明**，不是实际轮换。

### Blocker C · 真正线上虚构数据闭环

明确单独审核审批者身份、公钥与操作员权限绑定；只有本人批准以后才可将独立测试站接入受控 HTTP 申请、手机证明、可信证据、Windows 批准/拒绝、撤销、失机后重新配对流程。只用新建的虚构设备/数据库记录，验收任何失败默认拒绝、只允许唯一活跃发布设备、电脑只读。

### Blocker D · 真实记录同步二次授权

完成独立备份、数据恢复、端到端加密密钥保管与数据库收费评估；必须由用户另外明确批准后才会从正式 iPhone 真实来源接入。**没有任何默认自动开启。**

## 5. 阶段结论

**本轮只允许：服务端统一受控逻辑与隔离 PostgreSQL 验收。不可上线。** 不合并生产 `main` 或 Netlify 虚构自动发布分支。不迁移 SQL、不使用真实 Netlify 环境变量、不生成真正操作员私钥、不修改 iPhone IndexedDB，不进行健康历史记录上传。

下一步应先补 A 的静态审计门禁，再选择一条明确成本/密钥风险的 Netlify Free 测试配置，只有用户单独放行之后才考虑真实部署。
