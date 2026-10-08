# 私人观察台：数据字典与分析口径 V1

## 1. 核心原则

- 一天只有一条 `DailyRecord`，包含 `morning` 与 `evening` 两个观察阶段。
- “没有数据”“未完成”“主动不记录”“明确回答为否”必须保持可区分。
- 主观观察与设备测量不互相覆盖。
- 周期分析只把明确标记 `periodStart = yes` 的日期作为周期起点；系统不从症状反推排卵，也不把周期日等同于激素水平。
- 第一年的季节差异属于个人观察中的模式，不是稳定的季节效应结论。

## 2. 阶段级字段

| 字段 | 含义 |
|---|---|
| `morningStatus` | 早晨阶段状态：未开始 / 草稿 / 已完成 / 主动不记录 |
| `morningStartedAt` | 开始早晨观察的时间 |
| `morningCompletedAt` | 完成早晨观察的时间 |
| `morningOptedOutAt` | 主动跳过早晨观察的时间 |
| `morningLastQuestionId` | 早晨阶段最后一道处理的问题 |
| `eveningStatus` | 晚间阶段状态 |
| `eveningStartedAt` | 开始晚间总结的时间 |
| `eveningCompletedAt` | 完成晚间总结的时间 |
| `eveningOptedOutAt` | 主动跳过晚间总结的时间 |
| `eveningLastQuestionId` | 晚间阶段最后一道处理的问题 |

## 3. 早晨观察字段

| 字段 | 数据类型 | 观察口径 | 分析备注 |
|---|---|---|---|
| `sleepQuality` | 1–5 | 对昨夜睡眠总体质量的主观评分 | 高分更好 |
| `sleepDurationMin` | 分钟（区间代表值） | 昨夜大约睡眠时长 | **近似值，不应解读为精确分钟数** |
| `sleepProblem` | 多选 | 昨夜影响睡眠的因素 | 分类变量，不做平均 |
| `sleepOnsetReason` | 多选 | 入睡困难的主要原因 | 只有对应条件满足时有意义 |
| `wakeFatigue` | 1–5 | 醒来时疲倦程度 | **高分更差**，不要与 mood/energy 直接同向合并 |
| `dreamMemory` | 0–3 | 梦境记忆清晰程度 | 不等于“是否做梦” |
| `dreamFatigue` | 0–2 | 梦境造成疲劳感 | 仅在相应梦境条件下解释 |
| `bedtimeUrinationDelay` | 0–3 | 睡前尿意造成入睡延迟程度 | 分类/有序变量 |
| `nightHungerEvent` | 0–3 | 夜间饥饿对睡眠的影响 | 事件变量 |
| `nightHungerIntake` | 0–2 | 因饥饿是否进食及程度 | 条件变量 |
| `nightHungerRelief` | 0–3 | 进食后饥饿缓解程度 | 条件变量 |
| `bedtimeTemperatureFeeling` | -2–2 | 昨夜睡前冷热体感 | 0 为刚刚好，负数冷，正数热 |
| `morningAppetite` | 0–4 | 晨起食欲 | 相对稳定记录即可 |
| `previousEveningFullness` | 0–4 | 前一晚进食后的饱胀感 | 当前为条件问题 |
| `basalTemperatureC` | 数值 | 晨起体温 | 后续周期分析的重要基础变量；不要自行解释为激素测量 |
| `weightKg` | 数值 | 晨起体重 | 与设备体重应分开保存 |

## 4. 晚间观察字段

| 字段 | 数据类型 | 观察口径 | 分析备注 |
|---|---|---|---|
| `mood` | 1–5 | 今天总体心情 | 高分更好 |
| `energy` | 1–5 | 今天总体精神/身体活力 | 高分更好 |
| `drive` | 1–5 | 今天开始行动的难易程度 | 高分更容易启动 |
| `napDurationMin` | 分钟（区间代表值） | 今天午休大约多久 | 近似值 |
| `napQuality` | 0–4 | 午休质量 | 仅在午休存在时解释 |
| `bedtimeHunger` | 0–4 | 睡前饥饿程度 | 晚间时点 |
| `physicalDiscomfort` | 0–4 | 今天总体身体舒适度 | **高分更差** |
| `discomfortArea` | 多选 | 身体不适部位 | 分类变量 |
| `libido` | 0–4 | 相对平时的亲密需求变化 | **不是绝对 libido 水平** |
| `acnePresence` | `present` / `absent` | 今天是否明确观察到痤疮 | 缺答必须保持 missing |
| `acneSeverity` | `mild` / `moderate` / `severe` | 已有痤疮时的总体严重程度 | 不应与缺答混为“无痤疮” |
| `acneCyst` | `present` / `none` | 是否有囊肿型痘痘 | 与 severity 独立保存 |
| `acneLocations` | 多选 | 痤疮部位 | 分类变量 |
| `cycleGateway` | 分类 | 是否有明显生理变化 | 不是周期日 |
| `bleedingLevel` | 分类 | 出血量 | 仅在 bleeding 条件下有效 |
| `periodStart` | `yes` / `no` / `unsure` | 今天是否明确为这次月经第 1 天 | **只有 `yes` 可作为周期起点** |
| `dischargeAmount` | 1–3 | 分泌物量 | 仅在对应条件下有效 |
| `dischargeCharacter` | 多选 | 分泌物性状/颜色 | 分类变量 |
| `proteinIntakeG` | 数值 | 当天蛋白质摄入量估计 | 若是估算值，未来可增加估算置信度 |
| `bowelMovementCount` | 0–4+ | 当天排便次数 | `4` 表示 4 次或更多 |
| `bowelForm` | Bristol 1–7 | 当天主要排便形态 | **有序分类，不做简单平均** |
| `todayFlag` | 多选 | 当天明显状态标签 | 描述性变量 |
| `contextEvents` | 多选 | 当天背景事件/生活条件 | 用于解释混杂因素 |
| `note` | 文本 | 自由补充 | 主要用于质性回看，不直接数值化 |

## 5. 设备数据

设备数据单独存储在 `DeviceDailyData`：

- `sleepDurationMin`
- `steps`
- `heartRateAvg`
- `weightKg`
- `source`（`manual` / `huawei-health`）

设备数据不覆盖主观睡眠、主观体重等 DailyRecord 字段。以后接入华为健康时，应只替换 `source`，不改变分析层的数据结构。

## 6. 缺失值规则

### `missing`
没有回答、没有记录、没有产生该项数据。不能自动解释成“没有”。

例如：没有填写 `acnePresence`，不能计入“无痤疮”。

### `absent / none / no`
用户明确回答“没有”。这是有效观察值。

例如：`acnePresence = absent` 应计入“明确无痤疮”。

### `opted_out`
用户明确选择本阶段不记录。这是阶段状态，不是任何一个具体变量的答案。

### 条件问题被隐藏
条件不满足时被 `sanitizeAnswers` 清成 `null`。分析时应把它视为“不适用/无该条件”，不能当成用户漏答。

## 7. 周期分析规则

1. 周期起点仅来自 `periodStart = yes`。
2. 两个起点之间的日期差用于计算周期长度。
3. `periodStart = unsure` 不可作为起点。
4. 不从出血、分泌物、痤疮、情绪或睡眠自动推断周期阶段。
5. 周期日用于时间对齐，不等于激素浓度，不等于排卵发生。
6. 同一周期日跨周期比较时，必须同时显示样本周期数。

## 8. 季节分析规则

- 春：3–5 月
- 夏：6–8 月
- 秋：9–11 月
- 冬：12 月、1–2 月
- 季节统计必须同时显示有效观察天数。
- “全年平均”只使用有对应数值的日期。
- 痤疮发生率的分母只包括明确回答 `present` 或 `absent` 的日期。
- 第一年的季节比较仅视为探索性描述，不作为稳定结论。

## 9. 目前已知的数据技术债

### 睡眠时长是区间代表值
`<5h / 5–6h / 6–7h / 7–8h / 8–9h / >9h` 当前用代表分钟数存储。后续如果你发现睡眠时长分析成为核心，可以升级为“区间字段 + 可选精确分钟数”，避免给 `>9h` 这类开放区间制造虚假的精度。

### 有序量表不应无条件合成一个总分
mood、energy、drive 等可以做描述性均值；`wakeFatigue`、`physicalDiscomfort` 的方向相反，不能直接与它们相加平均。

### 第一年的季节效应不可独立于生活背景解释
季节与住处、作息、活动量、压力、户外时间等可能同时变化，因此 `contextEvents` 和后续设备数据很重要。
