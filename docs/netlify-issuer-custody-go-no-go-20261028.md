# P18 下一阶段｜Netlify 托管决策与服务器证据签发密钥放行门槛

日期：2026-10-28 · 仅独立开发栈 · **真实记录和线上配对均 NO-GO**

## 这份决策解决什么

PR #23 证明在一次性 PostgreSQL 中，手机配对、独立签名审批、加密上传、电脑只读与撤销能端到端运行。PR #24 删除了可绕过签名门禁的旧 TypeScript/数据库存储 API。但服务器签发密钥的**长期持久化、私钥隔离、故障恢复、首次可信公钥交付**尚未经过真实托管验证。没有这些证据，就不能把虚构数据的离线通过宣称为可安全运行的个人健康同步。

## 官方平台事实与限制（2026-10-28 查阅）

| 项目 | 查到的能力 | 对本项目的影响 |
|---|---|---|
| Netlify Functions 环境变量 | 可通过 `process.env` 在运行时读取；配置文件中的环境变量不会直接提供给函数；变量变更需部署更新；按作用域细分要求 Pro+ | 存储凭据可行 ≠ 已具有独立密钥保管/强隔离。不要把生产操作员私钥放在函数或前端 |
| Netlify Secrets Controller | 标记为 Secret 的值在设置后不可由 UI/CLI/API 明文读取，且限制使用范围；自动的智能秘密检测仅 Personal+ | 对防误泄漏有帮助；**不能据此保证运行中的函数不会读取/泄露私钥**，且 Free 与作用域能力需再验收 |
| Private project | Credit-based Free 的 Private 项目仅 Team Owner 可查看 | 适合独立虚构测试站，但 private 登录 ≠ 唯一手机的签名身份 |
| Netlify Database | Free：每库 48 database CU/账期、5 分钟无活动休眠、3 天定期备份保留 | 即便用户只有少量记录，也须考虑唤醒、数据库额度、长线恢复和外部备份 |
| Credit-based Free credits | 每月 300 credits 硬上限，耗尽暂停所有站点 | 不能以云端“永不掉线”作为日常记录的前提，上传应离线排队、断网后重试且不得丢失本地数据 |
| Netlify Database 健康数据合规 | 平台默认并非 HIPAA eligible | 不能对涉及受监管健康信息的使用场景主张 HIPAA 合规；个人自记数据是否适用某项法规需另行判断 |

来源：

- https://docs.netlify.com/build/functions/environment-variables/
- https://docs.netlify.com/build/environment-variables/secrets-controller/
- https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/
- https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/
- https://docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/

## 方案比较与当前建议

| 方案 | 适用阶段 | 优点 | 主要不足 / 放行边界 |
|---|---|---|---|
| A. 本地加密备份 + 手动校验恢复 | 当前真实数据保底 | 无云端配对和服务器私钥托管，避免受云账单影响 | 不能实现全自动跨设备更新，电脑需人工读取备份 |
| B. Netlify Free + 严格隔离的虚构测试站 | **仅作为下一阶段合成数据演示候选** | 复用已验证的 Private 身份、Functions/PostgreSQL 方案；免费额度内小样本可观察 | 使用测试用临时信任根，不能冒充生产长期密钥。上线须单独批准，设置独立空库与明确停止条件 |
| C. 具备独立持久密钥管理、恢复与最小权限的数据/函数服务 | 真实记录自动同步的候选 | 能将身份、签名、密钥生命周期、恢复机制分开管理 | 需先调查具体厂商、长期可用性、付费/账单、密钥访问权限和退出迁移；现阶段**尚未选定** |
| D. 由电脑离线审批而云端无独立长期签发私钥的另一架构 | 后续架构优化备选 | 降低云端签名私钥托管依赖 | 将改变已验证的可信回执协议，不能在没有完整威胁模型和新测试的情况下擅自切换 |

**决策：** 保留当前原型路线，但将 B 严格限定为虚构数据。真实历史依然只依赖手机本地 IndexedDB 加受控完整备份；任何非零真实记录云端上传都保持 NO-GO。不能因为某个签名绑定测试通过，就宣称已实现实际的云端密钥持久化。

## 新增的最小运行前校验（没有密钥仓库）

`src/server/issuerKeyReadiness.ts` 新增 `verifyExternalIssuerKeyBinding()` 和 `createPinnedVerifiedPairingEvidenceIssuer()`，仅接收外部**既有** CryptoKey 和已核对的完整公钥 SHA-256 指纹；拒绝无指纹、错站点、错误公钥、可导出私钥、私钥公钥不一致以及旧密钥被无声更换。校验**发生于**创建可签发服务实例**之前**，与数据库无关；拒绝时不访问数据库。无自动生成、下载或更换真实密钥。

**局限：** 若攻击者控制了输入，同时更换公钥、私钥和“预期指纹”，数学验证仍会通过。因此“独立核对”不是代码中可自证的布尔值：首次信任必须由**与被核验服务分开的渠道**建立，随后离线操作员清单固定其完整公钥指纹。此代码没有创建后端 HTTP 入口，也没有修改旧原型的直接工厂；未来允许部署的入口必须强制从此类预检工厂构造，审查并阻止其他绕行路径。

## 虚构数据线上演练的明确前置门槛

1. 明确哪种运行时方案能让相同服务器签发身份**跨两次独立冷启动/重新部署**稳定加载，且故意删除/更改密钥时 fail closed；运行日志不能出现密钥或记录明文。
2. 操作员在不依赖同一个在线页面自报值的情况下，独立核对站点 UUID 与完整公钥 SHA-256 指纹；没有这一步就不能给真实手机授权。
3. 对数据库角色实行写入范围限制，审查所有可达 Functions 的权限更改路径；真实部署不可重开未签名审批 API。
4. 在单独获得批准后，准备**全空的虚构数据库**和测试站，一键停止/回滚方案及单独预算。确认真实 `context.user` 的 Netlify Private 部署行为，并在本机以失效身份、不同浏览器、错误设备等负例验收。
5. 为真实历史另立独立备份/恢复演练和不可篡改的用户确认流程；原 iPhone GitHub Pages origin 的 IndexedDB 不能被测试站跨源静默读取。

**最终结论：** 开发继续，但还不到启用真正跨设备自动上传的阶段。本分支仅提供可检查的密钥连续性预检 + 文档 + 合成 CI，部署、真实密钥、Netlify Database、正式 main 维持原样。
