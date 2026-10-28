# Personal Workspace ↔ Personal State Observer｜首次真实接入交接说明

2026-10-29 · **P2 来源端准备，不是 Personal Workspace 已经建立**

## 现状（必须如实显示）

- 状态观察器已是使用中的 GitHub Pages PWA，**手机 IndexedDB 是记录权威**。
- 工作台 `fayeyifan-coder/personal-workspace-hub` 尚未在当前 GitHub 连接中找到可访问的仓库；此前 P0 规划通过，但 P1 工程启动/位置尚未确认。**不得宣称个人观察室已接通**。
- 工作台 P1 只负责项目入口、焦点和最近打开；**P2 才引入来源/版本/生成时间的只读 JSON 快照**。本 PR 只完成 PSO 端的一次手动摘要出口，不擅自引入跨域 IndexedDB、在线同步服务器或付费服务。
- 已有 `DataPage` 的「导出 JSON 备份」是含原始记录和备注的**恢复文件**，不可直接导入工作台；更不能在工作台调用 `restoreBackup`，因为它会替换目标浏览器的数据。

## 当前 PR 交付

手机在「数据」页新增「个人工作台 · 只读摘要」，用户可以手动选择：
1. **日期区间**（默认最近 30 个自然日，可改成一年）；不是因为 14 天交接就裁掉历史。
2. **字段**（默认不勾选；可选择情绪、精力、行动启动、睡眠质量、睡眠时长区间）。
3. 点击「导出工作台只读摘要 JSON」。只触发本机文件下载，**不包含任何网络请求**。

JSON 格式沿用工作台 v0.2 规划的外壳：
```json
{
  "format": "personal-workspace-snapshot",
  "schemaVersion": 1,
  "sourceApp": "personal-state-observer",
  "generatedAt": "2026-10-29T00:00:00.000Z",
  "sourceVersion": "1.5",
  "data": {
    "interval": { "from": "2026-10-20", "through": "2026-10-28" },
    "metrics": ["mood", "energy", "sleepDurationBand"],
    "totalRecordDays": 1,
    "observedDaysByMetric": { "mood": 1, "energy": 1, "sleepDurationBand": 1 },
    "days": [{
      "date": "2026-10-28",
      "values": { "mood": 4, "energy": 3, "sleepDurationBand": "5-6h" }
    }]
  }
}
```
示例全为虚构值；不会上传任何用户实际数据到 GitHub/CI。

**安全设计**：按白名单提取仅用户选中的字段；不复制日记正文、问卷全量答案、用户名、记录 UUID、创建/编辑时间戳、期间标签、经期/痤疮、服药、性需求或设备重量等敏感项目。未回答保留 `null`，不能当作 0。旧 PSO `sleepDurationMin` 实际存的是 240/330/390/450/510/600 **类别码**，出口严格转成时长区间，不允许报告精确分钟数或伪造平均值。

**重要隐私提醒**：摘要 JSON **未加密**，虽然比原备份小，仍可推断个人健康状态。不得推送到 GitHub、公开 Netlify、网站资源或浏览器前端 API。应保存到自己控制的文件位置，优先私下本地传输；如果用云盘，用户必须明确接受云存储风险。需要加密传输时使用经评审的加密完整备份流程，不能把本摘要冒充加密文件。

## P1/P2 真正完成后如何接入

- P1：个人工作台首页添加「个人观察室」入口；目前来源状态为 **未连接**，点击可打开来源应用，但不能显示假数据。
- P2：工作台内「导入只读摘要」→ 用户选择 PSO 的 `personal-workspace-observer-*.json` → 本地 `parseWorkspaceSnapshot` 校验来源、v1 版本、字段白名单、逐日日期顺序、样本数、取值合法性 → 预览数据范围/字段/敏感性 → 用户确认保存到工作台**独立的只读快照副本**。禁止导入任何名为 `personal-state-observer-backup` 的完整备份。
- 生成可复算的图表、缺失率和区间分布；保留来源日期和生成时间，不当作实时记录。单次 7–14 天传递，存储的文件可覆盖“过去一年”的数据范围。
- AI 解释必须另一个独立按钮且显式审批外传；默认**不会向任何 API 发送**，ChatGPT Plus 订阅不能当成第三方 API 的密钥额度。

## 手机通知 / 数据交接 / 代码部署是三件事

1. **Bark/iPhone 快捷指令**：只向手机发起通知和打开 `https://fayeyifan-coder.github.io/personal-state-observer/`；**Bark 不会传输数据库**。
2. **数据交接**：手机导出只读摘要文件 → 用户手动交给电脑 → 将来在工作台 P2 中手动选择导入，默认两周一次（可每周）。
3. **GitHub git push**：只推送经过审查的应用**源码**，禁止上传包含真实健康信息的 JSON 文件。状态观察器正式网站只在经过批准的 main merge/部署后更新；工作台新仓库必须有独立 P1 放行决策。

## 可核验的验收边界

- 当前来源端 PR 无任何自动 push、网络上传、API 调用、跨来源写入或数据库迁移。
- Windows/Linux CI 运行合成白名单/脱敏/乱序/非法格式测试、现有分析与问卷测试以及生产构建。
- **未经新一轮发布批准不合并本 PR**；不会自动出现在手机正式站点。
