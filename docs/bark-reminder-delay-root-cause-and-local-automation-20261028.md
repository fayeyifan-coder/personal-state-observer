# Bark 2026-10-28 定时误发/推迟：证据、修复与真正准时提醒的迁移

**真实故障已复现：GitHub Actions 并非实时定时器，调整 cron 分钟数不能根治。**

## 真实记录（全部为 GitHub 公共工作流开始时间，不含 Bark Key）

| 北京预期（旧 cron） | 实际 GitHub 执行（北京时间） | 偏差 |
| --- | --- | --- |
| 2026-10-27 08:17 | 2026-10-27 13:08:55 | +4h51m55s |
| 2026-10-27 22:17 | 2026-10-28 03:25:53 | +5h08m53s |
| 2026-10-28 08:17 | 2026-10-28 13:45:04 | +5h28m04s |

对应 Actions 运行：`40453651132`、`40569029539`、`40639791383`。这三次运行标为 success **仅说明 shell/curl 任务完成**，不等于按时，也不等于 iPhone APNs 已显示。旧 curl 未检查 HTTP 错误及 Bark JSON `code`，即使服务端返回业务失败也可能继续显示成功。

现有 `.github/workflows/daily-bark.yml` 里的旧 schedule 是 `17 0 * * *`、`17 14 * * *`（UTC），对应北京 08:17/22:17；并含 `|| [ $UTC_HOUR = 00/14 ]` 这种**按延迟执行时间错误归类早晚**的逻辑。

GitHub 官方说明：定时工作流在高负载下可能延迟，甚至丢失，无法提供准点到达承诺：
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

## 本次技术修复（不能保证准时）

1. 将远程 GitHub 备用 cron 改为 `7 0 * * *` / `7 14 * * *`，即北京时间 **08:07、22:07** 的**最佳努力**提醒；错开整点高峰，但并不保证 7 分准时，也不会比 iPhone 本地定时更准确。
2. `tools/bark-schedule-guard.mjs` 只认 GitHub 上报的两个精确 cron 值。用触发槽位计算滞后分钟数；超过 **25 分钟**的任务**跳过不发**。绝不把“晚来的早晨通知”变成晚间、把“过期晚间通知”变成第二天早晨。
3. 显示预定时间 UTC、实际延迟和跳过原因（不泄露 Bark Key），供今后客观核对。旧 cron 触发、未知事件也跳过。
4. API 发送使用请求体 POST，不将设备 Key 放入 URL；HTTP 状态非 200 或 Bark JSON `code` 非 200 将报错。**API 接受不代表设备真实收到**；要证明送达仍需 iPhone 上实际核验。发送步骤仅在定时窗口内或用户明确手动运行工作流时执行，单元/CI 不发送任何 Bark 请求。
5. 不读/不修改现有手机号、Bark Key、手机页面本地存储、历史健康记录。也不创建新收费服务。

**局限**：推迟超过 25 分钟时不会再补发旧通知，因此“几小时后才弹出”的问题被抑制，但“想要每天都准时收到”的需求仍**无法通过 GitHub Actions 满足**。过期时 GitHub Actions 可能显示正常结束，但策略步骤写有 `stale-scheduled-run`/Skip，绝不可记为送达。

## 推荐真正按北京时间 08:00／22:00 的做法：iPhone 本机自动化

只要日常记录就在 iPhone，**由 iPhone 自己按时间提醒最少依赖第三方**。官方 Apple Shortcuts 允许“每天指定时间”自动运行（需选择 *Run Immediately/立即运行*）。在普通日常提醒场景下，首推**本机「显示通知」**操作：不需要 Bark Device Key、GitHub、Netlify、网络或 APNs 服务器排队。

1. 打开 iPhone **快捷指令 → 自动化 → ＋ → 特定时间/Time of Day**，设置每天 08:00，选择 **立即运行**。
2. 增加「显示通知 / Show Notification」，填入「私人观察台｜早晨观察：记录昨晚睡眠和晨起状态」，保存。
3. 再建立一条每天 22:00 的自动化，显示「私人观察台｜晚间总结：记录今天的情绪、精力与身体情况」。
4. 测试时将其中一条临时改到几分钟后，以 iPhone 真正收到的时间为验收依据；通过后恢复 08:00 / 22:00。
5. **当手机本机的两条自动化连续实际收到通知后**，停用 GitHub 每日定时 Bark 工作流，以免同一时间段收到双份提示。本 PR 先不自动关掉旧触发，以避免换方案前彻底收不到提醒。

如坚持必须由 Bark 接收（而非快捷指令直接“显示通知”），可在快捷指令自动化中改用「获取 URL 内容 / Get Contents of URL」，POST `https://api.day.app/push`、JSON 包含设备 Key、标题和正文。密钥只存在你的手机本地快捷指令里，不应发给助手或提交仓库；此方式仍依赖网络+Bark/APNs，到达时间无法被我们保证。不要把含密钥的快捷指令公开分享。

官方 Apple 文档：
https://support.apple.com/en-gb/guide/shortcuts/-apd602971e63/ios

## 验收标准

- Windows/Linux CI `node --test tests/bark-schedule-guard.test.mjs`：实测 5h 延迟必须 skip；正常时段 send；绝不误将早晨改成晚间；跨 UTC 午夜仍匹配上一槽位；旧 cron / 无效 event fail closed。
- **不能用 CI 代替实机证明**：若仍选择 GitHub/Bark，下一次实际触发须查看策略输出的 scheduled UTC、delayMinutes、API 回执与 iPhone 本地显示时刻。
- 真正准时提醒完成判据以连续实际手机通知为准，而不是 GitHub Actions 绿色标记。
