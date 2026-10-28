# P18 S6｜同步历史分段读取：不能把“最近 100 条”当作全部

2026-10-28 · 独立开发 Draft · **真实手机记录 / Netlify / 正式 main 均未修改**

## 为什么需要这一轮

上一轮 S5 修正了 Netlify Functions 请求和响应体的 5 MiB 边界；但 PostgreSQL 的 `readHistory(subject)` 一直以 `LIMIT 100` 只返回最近 100 条。旧 API `GET /api/sync/history` 对调用方仅给出 `{history: [...]}`，没有指示“较早记录被截断”。

即使手机是唯一权威来源，电脑也不能由此误判自己已经看过全部云端版本。这不是单纯的 UI 问题；隐藏历史会让跨设备初次核验、故障恢复和长期审计不可靠。

## 新协议

`GET /api/sync/history`：默认最近 100 条，按 `revision DESC` 排序；返回：

```json
{
  "history": [
    {"snapshotId":"<UUID>","parentSnapshotId":null,"revision":205}
  ],
  "hasMore": true,
  "nextBeforeRevision": 106
}
```

`GET /api/sync/history?before=106`：只取严格小于 106 的版本。客户端在 `hasMore = true` 时，携带不透明于业务语义、却可明确比较的 `nextBeforeRevision` 继续读取。每页最多 100 条；Postgres 实际取 101 条以验证是否还有下一页。当 `hasMore = false` 时 `nextBeforeRevision = null`。不能把单次 100 条结果当作完整历史。

不同账户的查询均由**受信任登录会话的 `subject`** 限制；请求参数只有可验证的正安全整数，拒绝负数、超大整数、重复参数、额外参数和 SQL 注入样式参数。SQL 绑定 `subject`、revision cursor 和 `LIMIT`，不拼接用户提交的数值。

历史响应仍继承上一轮的 5 MiB 服务端限额；异常数据库返回过大 JSON 时明确返回 503 `history-exceeds-host-limit`。**不删除、不截断数据库实际保有的快照**。

## 不足与边界

1. `revision` 为 PostgreSQL 单账户递增版本号，不是时间戳或真实记录的内容；快照仍为加密信封。分页显示历史并不等同于“可以自动恢复”，电脑必须核验 AES-GCM 密文与内部快照链，再进行只读预览。
2. **并发分页**：手机在电脑分页时继续新增快照，不影响已固定 `before` 的旧版范围；但首次读取与最后一页不构成跨请求一致性数据库快照。正式客户端应记录首次远端 `head` 和 revision，完成分页后重新核对 head，变化时标记需要重新检查，不能无条件宣称“与当前最新同步一致”。
3. 本协议从原 `{history}` 增加 `hasMore` 和 `nextBeforeRevision`。旧读取测试仅检查 history 字段，保留兼容；尚无已部署的真实云端读取客户端，因此未进行生产数据迁移。
4. `readHistory` 的直接 repository 调用仍有单页默认限制。只有**HTTP 响应**会提供完整分页指示；新的调用者必须使用完整 API 或明确处理 cursor。
5. 这是**离线开发完成品**，没有新 Netlify Function、托管数据库、用户密钥、手机/PC UI、自动同步任务或在线账号读写。所有新 API 须经后续独立测试和明确授权才可部署。

## 自动测试

- `tests/sync-history-pagination.test.ts`：205 个虚构版本分成 100/100/5 三页，无重复漏条；另一个账户仅能看自己的 3 条；无效/重复 cursor 直接 400，不产生数据库读取；超大元数据 503。
- `tests/postgres-sync-history-pagination.integration.ts`：GitHub Actions 的真正 PostgreSQL 16 一次性数据库，插入 205 + 3 条完全虚构 JSON 元数据，并检查 `WHERE subject AND revision < before` 真实分页结果；异常请求不写库。
- `verify-sync-history-pagination.yml`：Linux + Windows 原协议/大小/构建回归，加一组隔离 PostgreSQL 真数据库测试。

## 当前放行决定

**S6 新代码经过 CI 后才可判定离线 PASS**；不改变 P18 的在线 NO-GO。Netlify 的实时账号余额、Free 计划与 Private 站点状态依然无法从 GitHub 推断。请勿把代码开发进展当作真实手机到 Windows 的自动同步已开启。
