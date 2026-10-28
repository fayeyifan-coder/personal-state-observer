# Netlify Free Database 零现金支出测试计划（2026-10-28）

## 使用者确认的边界

仅允许**信用额度制 Free 计划内的手动数据库试建**，**只使用虚构数据**。遇到需要添加信用卡/支付方式、升级套餐、开通自动充值或显示美元付款/订阅的界面，**立即停止**，不点击确认。不能为了完成验收自行升级或开通收费服务。

本阶段目标只是确定 Netlify Database 是否能在当前 Netlify 账户、现有**独立虚构测试站**中创建，并查看实际剩余 credits。**不能把创建数据库视为自动同步已经可用**。

- 测试 Netlify 项目：`cheerful-licorice-f4602a`，为之前用户截图确认的 Private、只允许虚构样本的测试站，测试站部署分支为 `test/isolated-phone-lab-20261028`。
- 真实数据仍在正式 GitHub Pages origin 对应的 iPhone IndexedDB；不能导入本测试站或其 DB。
- 对于未来的真实数据预生产/生产设施，**另建项目**，不将这座虚构测试站改成正式健康数据服务。

## 官方定价确认（2026-10-28）

- Netlify **信用额度制 Free** 是每月 300 credits，$0/月，**硬上限、无自动充值**。Netlify Database 包含在这个 Free 计划内。
- Database 活跃时消耗计算和网络 credits；另有部署、请求和流量消耗。请不要把“免费版包含 Database”理解成数据库永远零消耗。达到额度上限可能暂停站点。
- 若账户属于 2025-09-04 前创建的 Legacy 计划，Database 可能提示必须切换到信用额度制计划；**切换不可逆**。这时先停止，由用户核对和明确决定，不自动切换。
- 官方文档的数据库存储价格说明部分仍沿用“2026-07-01 起可能收费”的旧时间点，当前已是 2026-10-28，因此不可承诺存储永久免费。
- 与数据库相关的 credits 用量以 Netlify 控制台 **Usage & Billing** 实际记录为准。**不要为了试验开启 Agent Runners**，这可能额外消耗计算与 AI credits。

官方资料：
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- https://docs.netlify.com/build/data-and-storage/netlify-database/getting-started/
- https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/

## 用户在后台只需做的操作

1. 登录 https://app.netlify.com/ ，打开所用 Team 的 **Usage & Billing / Billing**，确认显示 **Free（Credit-based）**，不是 Personal/Pro 或 Legacy，查阅当月剩余 credits，且没有自动充值。
2. 进入测试站 `cheerful-licorice-f4602a`，选择 **Data & Storage → Database**。在数据库创建页面检查是否出现 **Create a database manually**。
3. 如确认仍是 Free、界面没有信用卡、美元付费或套餐升级要求，可以选择**手动创建数据库**（不选择 Agent Runners）。这会启用一个消耗免费 credits 的实例，不会自动迁移旧手机数据。
4. 创建后只记录后台是否显示 **Active / Ready**、**Database** 页面、剩余 credits。**不要复制或公开连接字符串**、`NETLIFY_DB_URL`、令牌或含密钥的截图；截图应裁掉密钥、连接信息及个人账户数据。
5. 完成后回到 **Usage & Billing** 观察实际扣减；如果发现付款要求或计划不是信用额度制 Free，停止并保留截图，不继续创建。

## 在未通过下面条件之前不得接入联网同步

- [ ] Free/剩余 credits 已经用用户的真实 Netlify 后台确认
- [ ] 手动创建结果已由用户确认，不包含卡片或收费要求
- [ ] 新数据库无个人健康信息、无正式备份
- [ ] 服务端 Identity 登录及账户隔离已实现并经真机虚构验收
- [ ] 手机唯一写入设备凭据经服务端登记/可撤销
- [ ] PostgreSQL 中基于事务的版本 CAS 实际通过并发与故障注入测试
- [ ] 新 Netlify 数据仅在独立 origin 上工作，旧 GitHub Pages 手机 IndexedDB 不受影响
- [ ] 云端上传真实数据之前获得用户**独立明确的授权**

## 工程状态

`feat/sync-service-guardrails-20261028`（PR #6）当前提供本地可测试的接口合同；默认关闭，没有 Netlify Function 路由、数据库连接或云端同步。**创建一座空数据库不会自动启用这个合同。** 本文件也不注册迁移、SQL、Functions、部署钩子或依赖，不会自动创建数据库，所有云端操作都需要用户在控制台手动确认。


## 用户已完成的试建结果（2026-10-28 截图）

- Netlify 项目 `cheerful-licorice-f4602a` 的 Database 显示 **Your database is ready!**。
- 截图配置：auto-scale 1 compute unit、闲置 5 分钟休眠、24h compute `0.0 GB-hours`、总存储 `0 bytes`、分支 `production`，共 `1/20`。
- 此前 Free 账户截图显示剩余 **255/300 credits**；余额不是数据库新建后实时度量，需要实际 Billing 页再核对。
- **仅能判定空数据库创建成功**，尚无同步表、查询测试、认证、云端写入或电脑读取功能；真实手机 IndexedDB 未改变。
- 后续 PostgreSQL schema 与事务适配器正在独立草稿 PR #8 中使用**临时 CI 数据库**验证，数据库草案放在 `docs/sql-drafts`、不自动执行。

**阶段结论：测试数据库创建 PASS；真实 Netlify 数据库读写验收 NOT STARTED。**
