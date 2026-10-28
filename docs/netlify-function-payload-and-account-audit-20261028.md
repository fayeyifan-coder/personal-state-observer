# P18 S5：Netlify Function 实际请求上限与账号只读核对

2026-10-28 · Draft · **无部署、无真实密钥、无真实个人记录、无数据库迁移**

## 本轮发现与实际修复

2026-10-28 官方 Netlify Functions 文档明确：默认普通同步 Function **缓冲请求和响应正文**均为 6 MB；二进制编码还可能降低实际有效上限。原 `src/server/guardedSyncService.ts` 设置 `MAX_SYNC_REQUEST_BYTES = 35 MiB + 4096`，与托管环境不兼容；手机端有效加密备份越大，越可能在 Netlify 平台入口直接被拒绝，无法按当前 API 处理。

已新增 `src/services/syncTransportLimits.ts` 并将**云端同步**限定在 5 MiB UTF-8 序列化 JSON，保留缓冲空间。客户端将来应在生成待上传加密请求后、**申请一次性发布挑战前**调用 `checkEncryptedPublishSize(expectedHead, snapshot)`，过大时提示“无法云端同步，请保存本地完整备份”，不得尝试截断、删除历史、拆分未验证的记录或更改手机原有数据。

服务端新规则：带有过大 `Content-Length` 的请求在认证和消耗手机一次性挑战前返回 413；没有长度标头或撒谎称较小的请求仍被后续流式读取限制拦截。读取超过 5 MiB 的旧云端快照返回不泄露内容的 503 `snapshot-exceeds-host-limit`，不会向函数输出超平台上限的巨大正文。认证模块 `src/server/privateProjectDeviceAuth.ts` 通过同一个导出常量同步收紧流式验签的大小限制。

注意：当发送无长度标头的超大请求时，真实设备签名认证可能先将其降级为只读并返回 403；拒绝授权而不是返回精确 413 不会放松上限。Netlify 自己也可能在函数开始执行前先拒绝超大正文。测试是服务端契约，不宣称现已观察到真实线上行为。

**本地完整 JSON 备份与原来的加密文件仍可使用原先更大的安全上限**。本变更只影响拟议云端密文同步；不能为了能上传而缩小、清空、覆盖或选择性丢弃用户历史数据。将来如需要大于 5 MiB 的真实云端同步，须单独设计经审查的分块/对象存储、完整签名和原子提交协议，而不是偷偷绕过限制。

参考：
- https://docs.netlify.com/build/functions/configuration/
- https://docs.netlify.com/build/functions/api/

## Netlify 账户真实余额：当前无法自动读取

GitHub 只含代码与 PR，并不代表当前 Netlify 账户的余额、付费计划、站点访问权限或部署配置。本轮没有 Netlify 已连接账户读取能力；**不得假定**账号有 300 credits 可用，也不能推断现有测试站是 Private。

最短的**只读人工核对**路径（不要改设置）：

1. 登录 Netlify，进入对应 Team dashboard → **Usage & billing → Credit balance**：记录当前计划是否为 *Credit-based Free*、剩余 credits，以及其他站点是否共用额度。信用额度是账号级别的，不是本项目独立预算。
2. Dashboard → **Usage & billing → Credit usage breakdown**：检查本月生产部署、Functions/Compute、数据库、带宽等是否存在已知异常；记录 **剩余**，不是默认月赠额度。
3. 进入准备作为纯虚构试验的**独立项目** → **Project configuration → General → Visitor access → Project visibility**，确认 **Production = Private、Previews = Private**。若当前项目是 Public/Legacy/password-only，暂不继续。
4. 核对该站是否与正式 iPhone GitHub Pages 项目完全隔离，且所有 GitHub 自动部署连接都未指向正式主分支或真实数据库；**不要**在本轮添加新 Functions、数据库、变量或认证凭据。
5. 如有数据库，确认其确为虚构空库。无关数据库或是否为空不确定时，均视为 NO-GO；**不要执行查询、清库或迁移**以证明这一点。

可以安全地向开发对话反馈以下**不含身份/凭据**的三个结果：**当前计划名称、剩余 credits、测试站 Production/Preview 是否均为 Private**。不需要发送 Netlify API token、邮箱、站点 UUID、截图中的私人访问链接、数据库地址或任何用户健康数据。

官方说明：
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/monitor-usage-for-credit-based-plans/
- https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/

## 放行判断与回滚

- 新测试仅核实密码学和服务端大小约束；本 PR 仍属于 **NO DEPLOY**。
- 账号余额/Private/隔离空库/密钥首次信任/冷启动/恢复/可停止运营必须逐条有证据，任何未知都不应解释为通过。
- 即使账号只读审核通过，也**不**自动授权实际线上虚构数据实验。另行在用户明确批准后才创建或变更 Netlify 测试资源。
- 正式主站、真实 iPhone/Windows 数据以及已有 IndexedDB 一律不动。手机继续为唯一权威写入端，云端只能是密文候选副本。
