# P8｜Netlify Private 账户认证 + 手机独立签名（2026-10-28）

## 前提与已验证的平台能力

Netlify 官方 Functions API（2026-10）确认：站点保持 **Private / team-login protection**，并且 Function 是 **2026-10-05 或之后部署**时，Netlify 提供可信赖的 `context.user`：包含用户 ID、邮箱（可缺省）及访问到期时间，客户端不能通过 HTTP Header 伪造它。该值**不是** Netlify Identity 用户，也不在本地 Netlify CLI 中提供。

Netlify 官方：
- https://docs.netlify.com/build/functions/api/
- https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/
- https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/

**结论**：可对 **Private 测试站上的 Netlify Owner** 先使用 `context.user`，不必为测试另建 Identity 用户系统。但同一个 Netlify Owner 可以同时登录手机和电脑，`context.user` 不具备物理设备证明能力。后续若正式站点对外分享，需要重新审查身份方案；不能在公开网站假装 `context.user` 始终存在。

## 本 PR 的已编码内容（没有线上发布）

1. `src/server/privateProjectDeviceAuth.ts`：由未来 Netlify Function 在服务端使用真实 `context.user`、`context.site.id` 构造 `subject`，要求指定的站点 ID 与 HTTPS origin 匹配，并拒绝已过期会话；完全不信任请求头自报用户。
2. 对已登录账号开放**自身的只读权限**。对 `POST /api/sync/snapshots` 则要求服务端数据库存在仍有效的**唯一登记手机**，核对 **P-256 ECDSA（SHA-256）签名**：签名串绑定站点 ID、Netlify 用户 ID、HTTP 方法、完整目标 URL、一次性挑战和整个 HTTP 密文请求体的 SHA-256。
3. `POST /api/sync/device-challenge` 的合同只允许 Private Owner 在同源 HTTPS 站点申请已登记设备的一次性挑战；不存在、已撤销、超量、跨站请求都失败。挑战有效期最长 90 秒。
4. `src/server/postgresPublisherProofStore.ts` 草案：在真实 PostgreSQL 事务里锁定发布设备行，限制每台设备最多 3 个未使用挑战，通过 `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING` **原子消耗挑战**；签名无法重放，撤销设备后先前发出的挑战也不能再用。
5. `docs/sql-drafts/20261028163500_device_proof_schema.sql`：**不自动执行**的 P-256 公钥和挑战存储 DDL，限制每账户最多一台有效发布设备；保留吊销历史。
6. `tests/private-project-device-auth-tests.ts` 使用虚构密钥在 Node Web Crypto 中做完整签名与验签，覆盖伪造用户头、过期登录、错站点、未注册手机、伪签名、篡改请求体、过期/复用挑战、撤销及与现有服务端权限合同的连接。
7. `tests/postgres-device-proof.integration.ts` 在 GitHub Actions **一次性 PostgreSQL 16** 中测试挑战原子消费、配额和设备撤销，不连接 Netlify 的数据库；测试程序拒绝非本地的数据库地址。

## 暂不实现的内容及上线阻断

- **没有真实 Netlify Functions 路由**，没有将当前应用的 `netlify.toml` 指向新函数，更没有调用 Netlify Database 或改动你的 `cheerful-licorice-f4602a` 项目。
- **没有手机密钥永久存储**。未来需要通过 WebCrypto 生成非导出 P-256 私钥，安全保存到仅手机 origin 的 IndexedDB，检查 Safari 清理网站数据与安装 PWA 的存储失效情况。清除缓存或换手机后必须通过核准的重新配对，不应把公钥视为密码。
- **没有自动配对/提升权限的接口**。目前数据库表只允许通过**独立、用户明确批准**的流程登记手机公钥。绝不能登录即注册、提交 `deviceId` 即注册、把二维码截图公开，或把私钥上传服务器。
- **没有真实设备撤销页面**。暂时只有数据库模型与测试。遗失手机后，必须有另一个可信途径撤销旧密钥并配对新手机；若丢失唯一备份密码也无法还原密文。
- **没有使用真实手机个人数据、计费操作或生产部署**。后续即使启用空数据库，登录测试仍需独立 HTTPS origin + 虚构备份；首次 Netlify 登录需要真实 Safari 验收。
- P-256 公钥用于验证“谁发送了这个请求”，**不用于加密记录**；记录本身仍由独立的 AES-256-GCM 备份密码加密。两种密钥不可混用。
- Netlify 私有站点仍不是可直接存储真实个人状态的完整产品：PR #1–#8 仍处草稿；GitHub Pages 旧 IndexedDB 不能跨站共享；真实数据迁移需要另立流程。

## 将来最小可用真机验收

先在独立虚构测试站启用**只读的身份诊断**，显示“已经登录（仅本账号）”，但**不返回用户 ID、邮箱或秘钥**；确认 iPhone 与电脑都能只读。再在开发隔离环境登记虚构手机公钥，检查电脑 POST 403、手机正确签名可完成一次请求、再发同签名失败、吊销后失败；只有这样才考虑在线 Netlify Functions 接入。所有 POST 保持默认关闭直到这些测试完成。

**阶段结论：安全认证和设备签名合同可开发验收；上线 NO-GO，禁止把它作为云端同步已启动的证据。**
