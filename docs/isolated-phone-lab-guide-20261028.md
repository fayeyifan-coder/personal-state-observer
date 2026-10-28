# 独立手机验收站：部署与验证操作手册（2026-10-28）

## 目标、当前边界

**不能在 `fayeyifan-coder.github.io` 的新路径下测试！** 浏览器 IndexedDB 按 origin 隔离，路径不同并不能保护正式数据。该分支仅用于不同 HTTPS 域名上的**虚构样本验收**，不用于个人观察记录。

分支：`test/isolated-phone-lab-20261028`，基于尚未合并的 PR #3。正式 `main`、GitHub Pages 发布流程和手机存量数据库均不变。

测试构建：`npm run build:testlab`。通过 Vite `testlab` 模式读取 `.env.testlab` 中的 `VITE_ISOLATED_LAB=1`，构建根路径 `/` 的单页测试站。测试站仅显示 `IsolatedLab` 包裹的“数据”页面，不显示正式首页；IndexedDB 名固定为 `personal-state-observer-fixture-lab-v1`。如果该构建被意外发布到正式 `https://fayeyifan-coder.github.io`，页面会停用测试工具。

### 两个方向的备份拒绝规则

- 测试站只能读取本测试站导出、带 `testFixtureTag=PERSONAL_STATE_OBSERVER_SYNTHETIC_TEST_ONLY_V1` 标记的 JSON 或加密 JSON；未标记的真实备份会被拒绝。
- 同一分支若构建为正常应用，则拒绝测试标记的备份（避免误把虚构数据作为真实观察）。**正式线上 main 尚不包含该功能，不能将测试备份拿到旧版正式站点试导入。**
- “生成两天虚构记录”仅修改**测试站独立数据库**，绝不清理正式网站的任何存储。请勿输入真实记录，更不要用正式备份操作测试站。

## 独立域名部署：Netlify（取代 Vercel）

本分支已将 `vercel.json` 删除并改为 `netlify.toml`。构建命令固定为 `npm run build:testlab`，输出目录为 `dist`，Node 版本为 22。Netlify 提供独立 HTTPS 的 `*.netlify.app` 地址，与正式站点的 `fayeyifan-coder.github.io` 完全不同 origin。项目也设置了 `noindex,nofollow,noarchive`，但**禁止搜索引擎收录不等于身份验证**。

### 通过 Netlify GitHub 集成创建专用项目

1. 打开 https://app.netlify.com/start ，登录自己的 Netlify 账号，选择 **Import an existing project / GitHub**，仅授权访问 `fayeyifan-coder/personal-state-observer`。
2. 为验收建立新的、独立的 Netlify 项目；**必须将部署分支设为 `test/isolated-phone-lab-20261028`**，不要选 `main`。不要将已有正式网站的托管配置迁移进来。
3. 核对仓库根目录的 `netlify.toml`：Build command=`npm run build:testlab`，Publish directory=`dist`。如果网页配置与仓库冲突，以本测试构建为准；不得回退到普通 `npm run build`。
4. 访问保护：在 Netlify 的 **Project configuration > General > Visitor access > Project visibility** 中选择 **Private** 并覆盖 Production and previews。Free / Personal 方案的 Private 项目仅 Owner 可以访问；不需要购买 Pro 方案才能设置 Private。若界面无该配置，不应在未经确认时把测试站设为公开。
5. 初次部署后必须先确认是独立 HTTPS origin、出现“**独立测试站 · 仅限虚构数据**”横幅、点击“生成两天虚构记录”有效，才把真实手机带入测试。任何页面出现正式个人历史记录都代表隔离失败，应立刻停止。

**平台限制与授权：** 当前 GitHub 仓库仅有部署配置，本对话没有已连接的 Netlify 托管账户权限，因此尚无站点部署、域名或可分享的真实 URL。Netlify `netlify.app` 在中国大陆各子域名的可访问性不稳定，必须用用户的手机和所在网络实际打开验证；打不开就继续更换供应商，不能据此改变数据隔离规则。

**不要**将测试站放在 `https://fayeyifan-coder.github.io` 的任何子路径下。正式 `main` 和历史手机记录必须保持不变。

## 真机验收（仅虚构数据）

1. 手机打开**独立 HTTPS** 测试地址，检查“独立测试站”醒目横幅；绝不要在该地址录入真实健康资料。
2. 点击“生成两天虚构记录”；确认统计显示 2 天，并且历史记录均为 2026-10-26、2026-10-27。
3. 下载“新增测试文件”和“冲突测试文件”，分别导入。新增文件只允许人工确认恢复；冲突文件必须阻止覆盖。关闭预览不应改动记录。
4. 下载“加密 JSON 备份”，使用临时密码，仅在测试站执行解密预览、错误密码和正确密码流程。
5. **特别测试真实离线**：先加载网站，随后在系统设置开启飞行模式或关闭 Wi-Fi / 蜂窝网络，选择之前下载的虚构备份并预览。记录手机操作系统、浏览器版本、是否安装为 PWA、是否能够读取本地文件以及截图。不得在正式网站中做这一实验。
6. 测试完不要把测试备份导入任何正式网站；若要重置测试站，重新点击“生成两天虚构记录”即可。

## 开发验收门槛

- CI：`npm run build`、`npm run build:testlab`；Chromium 隔离浏览器核验两种构建不混淆、虚构记录只进入 `personal-state-observer-fixture-lab-v1`、无标记备份无法导入、加密快照仅预览和 320–390px 布局。
- WebKit 的 `context.setOffline(true)` 文件读取报错仍是 PR #3 的上线阻断项。另有最小探针用于区分浏览器 File API 行为与应用逻辑；该探针不会以放宽检查的方式让 PR #3 提前合并。
- **未完成真实手机与独立 HTTPS 验收之前：PR #1、#2、#3、测试分支都不得自动合并生产 main。**
