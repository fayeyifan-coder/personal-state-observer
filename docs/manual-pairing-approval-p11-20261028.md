# P11 · 手机公钥待审核配对与撤销设计（2026-10-28）

## 目标和当前阶段

用户已经在真实 iPhone Safari 的 **独立虚构测试站**验收 P-256 不可导出私钥的跨刷新保存和签名。此 PR 把服务端下一阶段的「申请 → 证明密钥持有 → 人工核准 → 独占发布 → 撤销」做成**默认不对外开放的协议与 PostgreSQL 事务原型**。

**并未**在 Netlify 部署配对接口；**未**触碰 `cheerful-licorice-f4602a` 的已创建空数据库；**未**改变 GitHub Pages 正式 `main` 的 IndexedDB 或上传真实记录。此 PR 依赖尚未合并的 PR #9，而不是 Netlify 自动部署的虚构测试分支。

## 权限结构

- **验证 Netlify 登录 ≠ 设备配对。** `context.user` 确认用户属于 Private 项目，不能区分同一账户下的 iPhone 和电脑。两端都能请求登记，但**仅凭登录不能成为发布设备**。任何请求者都只能得到 pending 状态。
- **设备私钥持有证明**：候选提交 P-256 **公钥**和随机 UUID（绝不提交私钥）；服务器生成 5 分钟有效的 requestId/nonce。手机使用本机不可导出私钥对固定领域字符串、Netlify site/user 身份、requestId、nonce、deviceId、完整公钥 SHA-256 指纹签名。后台用存储的候选公钥验证。
- **候选与权限完全分离**：通过签名只能把请求标记为 `proved`，**不会**插入有发布权限的 `sync_publisher_devices`。浏览器没有可调用的 `approve`、`revoke` 路由。
- **独立人工确认**：可信管理员必须在**不同于公开网站的受保护操作通道**对比手机屏幕与审核界面的完整公钥指纹、确认申请账号与设备，再显式调用 `approveByOperator`。不能用手机/电脑同一个 Netlify 登录来自动核准自己，更不能传 `approved:true` 的 HTTP body 获得权限。**目前这个操作通道还未实现**，因此不能真正配对。
- **唯一发布设备**：PG 按 Netlify subject 锁定 `sync_heads` 行，在事务内校验审批、时效、已证明持有、指纹一致及是否存在其他已授权设备；数据库索引额外保证每账户最多一台有效发布设备。
- **设备撤销与换机**：另一条可信管理员通道撤销公钥后，未完成的挑战不能再用，仍保留审计行。只有撤销旧设备，才能登记新设备；不能静默轮换私钥。
- **数据与费用**：测试数据仅为合成随机密钥；CI 使用 GitHub Actions 一次性 PostgreSQL，不访问 Netlify Database 或消耗其数据库计算额度。

## 工程实现

- `src/server/manualPairingProtocol.ts`：从受信任 Netlify 上下文解析身份；严格过滤 P-256 JWK（不接受私钥字段），校验曲线上公钥、计算完整指纹；签发候选申请并对一次性挑战的原始 ECDSA 签名验真，随后将请求标记为已证明持有。
- `src/server/postgresManualPairingStore.ts`：同一连接下 `BEGIN/COMMIT/ROLLBACK`；每账户行锁处理候选、人工核准和吊销；最多一个活跃 pending、每小时最多五次新申请；新设备不得抢占活跃设备。
- `docs/sql-drafts/20261028191000_pending_pairing.sql`：候选申请表的 SQL **非执行草案**，特意不放到 `netlify/database/migrations/` 目录。Netlify 正式/预览部署**不会**自动应用此 SQL。
- `tests/manual-pairing-protocol-tests.ts`：本地随机 P-256 密钥，测试匿名、过期会话、错误站点、伪造签名、跨账户验证、重复验证以及人工审核前无发布权。
- `tests/postgres-manual-pairing.integration.ts`：真实临时 PG 16 测试事务、指纹不符、待证明候选不能核准、并发批准只有一次、设备撤销、旧私钥不能证明新设备、新设备需要重走人工配对。
- `.github/workflows/verify-manual-pairing.yml`：全部使用虚构数据，与正式主站和 Netlify 云端隔离。

## 仍需单独审查的阻断

1. **用户实际控制的审核通道**：设计不依赖 Netlify 同站会话的独立操作授权（例如只在本地运行的受保护操作工具），并经过真实两台设备操作与误点/冒充测试。
2. **iPhone 新候选签名**：现已保存的测试私钥不会被删除，但 `src/services/syntheticDeviceKeyStore.ts` 还**没有**提供向服务器发送公钥或对申请 nonce 签名的线上接口。该步骤必须先在独立的虚构测试站实现并验证。
3. **Netlify Functions 与持久数据库上线**：身份适配器、server-only Operator 审核、真实 DB 连接、迁移审核、事务断网重试、只读电脑查询与撤销页面都尚未上线。用户对真实云端记录上传必须**另外明确授权**。
4. **身份隔离不等于恶意浏览器安全**：不可导出私钥保护密钥材料，但如果站点被恶意脚本控制，仍可能调用签名函数；必须完善 CSP、依赖锁定、XSS 保护和设备撤销。
5. **首次配对的冒充窗口**：未配对账户中的候选请求可能来自同一账户的其他浏览器。独立人工核准时必须检查完整指纹与真实 iPhone 屏幕，避免电脑抢先登记。仅靠同一 Netlify 登录不足以提供设备来源证明。
6. **未授权自动部署**：PR 仍为草稿，base 是 PR #9 的开发分支，不能擅自合并 `main` 或虚构测试站自动部署分支。

## Netlify 相关技术参考

- Private 已验证访问者标识： https://docs.netlify.com/build/functions/api/
- PostgreSQL 单连接事务： https://docs.netlify.com/build/data-and-storage/netlify-database/api/
- 自动执行迁移目录须谨慎： https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/

**结论**：此阶段可在 GitHub 中验证“有证明 ≠ 有授权、人工确认、唯一发布设备和撤销”的协议安全；在经过线上配对审查之前，所有真实设备都仍是未配对，云端同步 NO-GO。
