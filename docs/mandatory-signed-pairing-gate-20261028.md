# P18 · 移除无独立签名的设备授权/撤销入口

2026-10-28 · 仅隔离开发分支 · 无真实数据、无线上服务、无真实密钥

## 变更动机

以前 `createPostgresManualPairingStore()` 暴露 `approveByOperator(subject, requestId, fingerprint)` 和 `revokeByOperator(subject, deviceId)`；虽然从未作为 HTTP 路由公开，但它们不强制操作员签名验证。若将来有 Netlify Function 误调用这些方法，就可能绕开已建立的独立审批门禁。

本次把两个方法同时从 **TypeScript 的 `ManualPairingStore` 接口**以及 **运行时实际返回对象**移除。Pending Store 仅负责候选申请、读取和私钥持有证明；它不再有任何发布设备授权或撤销写入能力。

## 唯一约定的权限改变入口

设备发布权限的申请批准、撤销只能经 `createSignedOperatorPairingGate(...).apply()`，由预先独立固定的操作员 P-256 公钥核验带站点、账户、设备、申请、完整指纹、时效和 nonce 的签名；之后才进入 PostgreSQL 按账户加锁事务、原申请真实证明验证、审计 nonce 写入、权限变更和旧挑战作废。

此处“唯一”仅指**当前应用对外提供的 TypeScript 权限变更模块接口**，不等于数据库用户已经具备最小权限或防止所有未来恶意 SQL。部署前仍须限制数据库账号、逐一审计真实可达接口与运行环境。

## 回归测试更新

- `postgres-manual-pairing.integration.ts`：无签名方法在运行时确实不存在，候选未证明拒绝、跨账户/指纹不符拒绝、两条并发独立签名指令最多批准一次、签名撤销和换机重新证明。
- `postgres-trusted-pairing-evidence.integration.ts`：可信服务器签名凭证核对后，必须再经模拟操作员独立签名进入数据库授权/撤销。
- `postgres-operator-signed-gate.integration.ts`：未完成手机密钥证明时，即使有签名审批指令仍必须拒绝。
- `verify-sync-e2e.yml`：以上三组测试各用独立一次性 PostgreSQL 16，同时运行原有完整同步链路、S0 不部署检查、生产构建。CI 均使用随机虚构密钥。
- `sync-deployment-boundary-audit.mjs`：在 `src` 代码发现任意旧方法名称就失败，防止误把接口加回来。此脚本为静态辅助工具，不能代替人工审核整个调用图。

## NO-GO 不变

没有添加 Netlify Functions、在线配对 UI、自动数据库迁移、长期服务器私钥托管、可信公钥首次分发或真实 Windows 审批。没有修改正式 `main`、测试站部署分支或任何手机 IndexedDB 记录。线上仅虚构数据验证、数据库启用、真实记录加密同步均须后续独立授权。