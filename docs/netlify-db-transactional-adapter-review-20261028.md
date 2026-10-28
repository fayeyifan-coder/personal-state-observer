# Netlify Database 接入草案｜已完成的准备与剩余阻断（2026-10-28）

## 数据库准备状态

用户提供的 Netlify 项目数据库控制台截图显示：

- `Your database is ready!`；测试项目 `cheerful-licorice-f4602a` 已手动创建 Database。
- Auto-scale 为 **1 compute unit**，闲置 **5 分钟** 后休眠。
- 截图时 24h compute 为 `0.0 GB-hours`、存储 `0 bytes`、production 数据库分支数 `1/20`。
- 用户此前账单页显示 **Free**，本周期剩余 255/300 credits；该余额来源于之前的截图，不能视为本次实时余额或数据库专属费用。

### 这些信息不能证明什么

数据库显示 Ready 只意味着**空数据库就绪**；没有应用表、没有同步函数、没有账号/设备绑定、没有连接测试成功的证据。`production` 是 Netlify 测试项目的**数据库生产分支**，不等于用户 GitHub Pages 正式网站，也不等于真实个人记录上云。

## 此 PR 的实际内容

- `docs/sql-drafts/20261028151000_sync_schema.sql`：**不会被 Netlify 自动应用**的 PostgreSQL DDL 草案。创建加密快照、每个用户的最新版本指针、可撤销发布设备表。注意该文件**不在**官方自动应用目录 `netlify/database/migrations/`。
- `src/server/postgresSyncRepository.ts`：与 `@netlify/database` 的 `getDatabase().pool` 兼容的存储适配器合同。每次提交使用**同一连接与显式 `BEGIN` / `COMMIT`**，先锁定用户最新版本行，再校验服务器已登记的发布设备，比较基线版本，写入加密快照和更新最新指针；并发两个子版本应只成功一个。
- `tests/postgres-sync.integration.ts`：使用 GitHub Actions 中临时 PostgreSQL 16 执行真实事务测试，测试账号和加密文件完全虚构。测试脚本拒绝任何不是 `127.0.0.1/sync_fixture_test` 的数据库地址，**不可能拿其配置直接连到用户 Netlify**。
- `.github/workflows/verify-pg-sync-adapter.yml`：GitHub CI 独立 Postgres 服务、既有备份安全回归、构建与集成验收。

## 部署前必须解决的问题

1. **后端可用性**：确定 Netlify Functions 的身份来源。新版 Functions 可使用 `context.user` 验证具有 Netlify 项目访问权的账号；或者通过 `@netlify/identity` 的 `getUser()` 验证独立应用用户。这两者不是同一账户系统，不得使用客户端自报邮箱或设备 ID。
2. **发布设备的证明与登记**：目前数据库中设备表默认空，代码不会自动授予发布权限。需单独设计配对、设备凭据轮换与撤销（不能简单信任 `X-Device-Id`）；在此之前 API 无法完成任何真实发布。
3. **真实 Functions 入口与驱动依赖**：尚未创建对外路由，未安装 `@netlify/database` 或 `@netlify/identity` 到正常应用，更没有将 schema 安装到 Netlify 项目。必须先在隔离预览环境验收身份认证和实际 PG 事务。
4. **避免账户费用和生产误操作**：不要自动迁移数据库。Netlify 官方会在符合条件的部署中自动运行 `netlify/database/migrations/` 下的迁移，因此这个 PR 将 SQL 保存在 `docs/sql-drafts`，只有明确验收放行后才可迁入自动迁移目录。Netlify 项目可能按新部署自动创建预览数据库分支并消耗 credits，应观察余额。
5. **前端迁移**：正式 iPhone 数据保存在 GitHub Pages origin 的 IndexedDB；Netlify 的这个测试站只允许虚构数据，不可导入真实备份，也不可以成为未来真实站的直接替代。
6. **拒绝数据覆盖**：云端记录在电脑端只能作为候选，必须解密、预览差异、明确同意并二次检查本地状态，默认只读。

## 参考

- https://docs.netlify.com/build/data-and-storage/netlify-database/api/ （`getDatabase().pool.connect()` 是事务用法）
- https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/ （迁移目录和自动执行时机）
- https://docs.netlify.com/build/functions/api/ （私有项目登录的 `context.user`）
- https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/ （`getUser()`，供后续评估）

**发布结论：仅批准在 GitHub 的隔离临时 PostgreSQL 测试；不启用 Netlify 实际数据写入。**
