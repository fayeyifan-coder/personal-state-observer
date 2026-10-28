# WebKit 模拟离线读取本地文件：验收阻断（2026-10-28）

## 现象

在 PR #3 的隔离 CI（Linux Playwright WebKit）中，浏览器已打开 `/personal-state-observer/#/data`，并存在完整的本地 IndexedDB 虚构记录。

- 在线 WebKit 的备份预览测试能够继续推进；Chromium 全套验收始终通过。
- `context.setOffline(true)` 后选择虚构 JSON 文件，`File.text()` 报 `The I/O read operation failed.`。
- 应用添加标准 `FileReader.readAsText` 回退后仍返回 `本地备份读取失败，请检查文件是否可用。`。
- 将 Playwright 注入的虚拟文件替换成页面内部 `new File([...])` + `DataTransfer` 的原生文件，问题仍然存在。
- 无写入或恢复动作发生；数据库记录保留不变。

## 证据

- 初次失败：https://github.com/fayeyifan-coder/personal-state-observer/actions/runs/40633167091
- FileReader 回退后：https://github.com/fayeyifan-coder/personal-state-observer/actions/runs/40633558189
- 浏览器原生 File 仍失败：https://github.com/fayeyifan-coder/personal-state-observer/actions/runs/40633727663

## 结论（不能越界推断）

**尚未证明真实 iPhone Safari 或已安装 PWA 会发生同样问题**，也未证明这个问题仅是 Playwright/Linux WebKit 的离线模拟缺陷。当前应视为兼容性未完成验证，而不是宣布 WebKit 通过。

不允许为了让 CI 变绿而静默跳过该离线场景，或将 Chromium 通过当作全部手机通过。

## 后续核验

1. 在独立 HTTPS origin 与真实 iPhone Safari / 已安装 PWA 中使用**虚构数据**验证在线及离线文件选择、`File.text`、`FileReader`、密文导出与解密预览，且不触碰正式手机 IndexedDB。
2. 在相同 WebKit Linux 环境最小化复现（不加载 Dexie、React 或 PWA），区分浏览器 API / Playwright context offline 与应用实现。
3. 只有在得到明确结果后决定是否对 WebKit 离线场景使用更保守的错误引导或平台兼容替代读取方式；并保留失败时“不修改任何数据”的保护。
4. PR #3 保持草稿，**不得合并或部署**。生产 `main` 与手机现有记录不变。
