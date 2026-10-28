# P5｜加密单向同步服务端权限原型审查（2026-10-28）

## 当前交付

**仅有未部署的服务端核心协议**：`src/server/guardedSyncService.ts` 导出 `createGuardedSyncHandler`，所需认证器和存储库由未来 Netlify Function 显式注入。接口默认关闭，只有应用代码明确传入 `enabled: true` 才会受理请求。本 PR **不包含 Netlify Function 入口、数据库连接、线上 API 路由、云端存储或浏览器同步按钮**。

与 PR #5 的 `src/services/syncEnvelope.ts` 配套：服务端可拒绝明文或额外字段，只接受加密格式、随机 UUID 和加密版本链。实际 AES-GCM 密文认证必须由有密码的客户端在预览前完成；服务端不能解密，也不能声称能验证密码正确。

### API 合同（尚未部署）

| 方法 | 路径 | 权限 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/sync/head` | 登录已验证 | 本用户快照 head + 服务端修订号 |
| GET | `/api/sync/history` | 登录已验证 | 本用户随机版本链及修订号（无明文日期） |
| GET | `/api/sync/snapshots/:id` | 登录已验证 | 仅本用户有权读取的加密快照 |
| POST | `/api/sync/snapshots` | 服务端确认唯一发布设备 | 尝试写入加密快照，前置 head 不符则 409 |

所有响应 `no-store`，不设置跨域共享响应头。写入只接受严格的 HTTPS origin、JSON Content-Type 与限定大小的请求体；错误响应不包含内部凭据、用户标识和密文。

**重要：认证、设备授权、事务存储是接口依赖而非已实现的 Netlify 产品集成。** 真实服务端必须在 Netlify Functions 内使用 Identity 的服务器方法验证当前用户，并通过单独的设备绑定/撤销机制验证发布设备。浏览器提供的设备 ID、邮箱、`X-Device-Id` 等请求头**不能**被当作设备凭据。

## 开发验收

`tests/guarded-sync-service-tests.ts` 使用**仅存在于测试进程内的虚构账户与密文**：

- 匿名读取拒绝、服务默认关闭、错误时不泄露服务器内部凭据；
- 跨站 POST、缺失 Origin、明文额外字段、非法密文格式拒绝；
- 电脑只读权限不能发布、伪装/未注册设备不能发布；
- 用户 B 无法读取用户 A 的快照，但可以拥有自己的独立版本链；
- 相同请求幂等重试返回已提交，改写现有 ID 拒绝；
- 并发发布两个共享父版本的快照只能成功一个；另一请求收到 409；
- 版本历史包含服务端递增修订号，而不是使用不可靠的手机时钟。

这里的原子比较与写入在**单 Node 测试进程**内同步完成，只能验证协议语义，**不能证明分布式 Netlify 实际环境具备事务保证**。生产适配器必须由 Postgres 事务验证 publisher 绑定、head 与 revision，完成不可变快照写入索引，并考虑 Blob 已写入但索引未提交的中断恢复。

## 2026 年 Netlify 平台确认

- Netlify Identity 已在 2026 年 2 月撤回弃用决定。最新支持 `@netlify/identity` 的 `getUser()` 服务端验证（v2 Functions），请勿用过时的 Identity Widget 或仅基于“项目 Private”判断应用用户权限。
- Netlify Blobs 适合存密文，但不能直接依赖对一个 Blob 进行非事务式读改写保证并发 CAS。
- Netlify Database 是托管 PostgreSQL，信用额套餐可用；**启用数据库可能产生计算与流量费用**，须经用户知情后才能创建/启用。
- 当前 Netlify **Private 虚构数据测试站**不是用户私有真实健康信息的云端存储设施。严禁在该站点实验真实备份。

## 下一阶段的发布前门槛

1. 由用户明确选择是否允许启用 Netlify Database（可能计费），创建**与虚构测试站分离**的预生产项目、认证配置与存储权限。
2. 独立实现真实 Netlify Functions 适配器，服务端验证身份 + 可撤销唯一手机发布凭据；服务器不得从 HTTP 请求体自行信任 userId/deviceId。除非已配置认证和事务存储，否则接口持续 503 fail-closed。
3. 用两个真实测试设备、虚构数据核对身份隔离、401/403/409、并发条件更新、重试、网络中断和不可变快照，保留至少一条可人工恢复的历史版本。
4. 再处理正式网站目前在 GitHub Pages origin 下的 IndexedDB 数据迁移。浏览器 origin 不同无法自动共享数据；不能把现有 Netlify 虚构测试站升级为真实站，也不能让手机自动上传。
5. 最终由用户验收与明确授权后，才能合并和启用真实云同步。原 `main`、正式手机数据及用户已导出的 JSON 文件必须保留。

**本 PR 建议仅作为开发试验草稿，不批准生产发布。**
