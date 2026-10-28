# 独立虚构测试站｜Netlify Private 登录只读诊断（2026-10-28）

## 目的

在现有 **Private、虚构数据专用** Netlify 项目
`cheerful-licorice-f4602a` 内，分别使用电脑浏览器与 iPhone Safari 访问，核实
Netlify Functions 的 `context.user` 是否能确认两台设备在 Netlify 账号中的登录会话。

**严格只读**：这不是云端同步、不是设备配对，也不是账户登录服务替代品。
整个实现没有 Netlify Database / Blobs / SQL / IndexedDB 导入路径；不会自动上传或恢复记录。

## 实现

- `netlify/functions/lab-login-status.mjs`：仅接受单一目标
  `GET /api/lab-login-status`，校验 HTTPS host 为
  `cheerful-licorice-f4602a.netlify.app` 和 Netlify 受信任 `context.site.name`。
  只有 `context.user.id` 存在、`expiresAt` 晚于现在时返回
  `{authenticated:true,status:"verified-private-login",permission:"read-only",cloudSync:"not-configured"}`。
  所有响应不缓存；未登录返回 401，误部署到别的网站返回 404。
  **不返回邮箱、用户 ID、site ID、token、密码或健康记录。**
- `src/components/LabLoginDiagnostic.tsx`：测试站黄色横幅内增加
  「检查 Netlify 登录（只读）」按钮，**只有人点击才发起同源 GET**。
  200 正确 JSON 显示已验证；401 说明未确认；404 或 HTML 回退说明接口未部署；
  网络/授权错误说明请求失败。不会调用 POST、IndexedDB 或备份操作。
- 函数仅在 Netlify 部署时可读取 `context.user`；本地 Vite
  模拟接口不能当作真实 Netlify 登录验收。
- `tests/lab-login-diagnostic-tests.ts` 用伪造 Netlify Context 检验错误域名、
  不可信请求头、过期会话、无用户、不可用/禁用请求、响应隐私。
- 修改隔离浏览器测试，截获 API 只使用虚构 JSON 返回，验证所有页面状态、
  首屏无自动 GET，以及虚构 IndexedDB 完全不变。

## 隔离与上线边界

本草稿分支以 **PR #4 的测试站分支**为基线，不是以生产 `main` 为基线；
它**没有**合入 PR #5–#9 的加密同步 API、数据库适配器、设备密钥代码，
也没有部署任何实际在线云端接口。

测试站的 Netlify 部署分支目前仍是
`test/isolated-phone-lab-20261028`。只有在用户审阅 PR、
明确批准将**本单项诊断**合入这个测试站分支后，现有 Netlify
测试项目才会通过 GitHub 自动部署显示按钮和 API。PR 仍为草稿时，
页面若没有「检查 Netlify 登录（只读）」按钮是**预期**，不应声称已上线。

不要切换 Netlify 的“Make public”，不要绑定收费计划，也不要导入真实个人备份。
Netlify Function 请求可能消耗 Free credits，建议每台设备**手动点击一次**验证，
不建立定时轮询。私有访问和账号认证不是写入设备证明；手机发布权限仍为未实现。

## 真机验收说明（部署该 PR 以后才进行）

1. 电脑访问 `https://cheerful-licorice-f4602a.netlify.app`，
   在黄色「独立测试站 · 仅限虚构数据」横幅中点
   **「检查 Netlify 登录（只读）」**。
2. 验证显示 `已验证 Netlify 私有站点登录。仅有只读身份确认；云端同步未开启。`。
3. 用 iPhone Safari 登录相同 Private 测试站，点击相同按钮；
   可在移动网络和正常 Wi-Fi 下测试（这一步要求联网）。
4. 两台设备各截取横幅诊断结果即可；**不需要**展示账户 ID、邮箱、
   数据库配置、证书、密钥或 Netlify 账单。
5. 若提示「只读诊断接口尚未部署」，说明页面/函数未正常发布或走了静态
   SPA 回退；若显示登录失败，检查 Private 会话；不能把这两种情况误判成
   “已登录”，也不能为了排障公开站点。
6. 整个验收前后，Netlify Database 保持未连接状态，正式 GitHub Pages
   的旧手机 IndexedDB 与 PR #1–#9 草稿不变。

## 参考

- https://docs.netlify.com/build/functions/api/ ：
  `context.user` 由 Netlify Private/team-login 验证，部署需在 2026-10-05 之后；
  本地 Netlify CLI 不提供该值。
- https://docs.netlify.com/build/functions/configuration/ ：
  Function `config.path` 自定义同源路由。
- https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/ ：
  Private 项目与公开访问边界。

**当前状态：代码待 CI 验证、Netlify 在线真机验收 NOT STARTED。**
