个人状态观察台 — 分析层 V1

替换：
src/logic/analysis.ts
src/pages/TimelinePage.tsx
package.json
新增：
tests/analysis-tests.ts

目的：把周期、季节、平均值、痤疮缺失规则等纯统计计算集中到 src/logic/analysis.ts，TimelinePage 直接使用同一套计算。

PowerShell：
npm.cmd run test:analysis
npm.cmd run test:contract
npm.cmd run test:logic
npm.cmd run build
