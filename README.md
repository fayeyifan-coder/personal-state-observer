# 个人状态观察器

正式工程化迁移起点：React + TypeScript + Vite + Dexie + PWA。

## 产品状态
V1.4 已完成真实使用验收，产品问题树暂时冻结。当前 V1.5 的目标不是增加功能，而是把经过验证的原型迁移成可维护的正式工程结构。

## 结构
- `src/data/questions.ts`：问题配置（从 V1.4 验证版迁移）
- `src/logic/`：条件判断、问题流程、失效答案清理
- `src/db/`：IndexedDB / Dexie 数据层
- `src/pages/`：今天、记录、时间轴、数据
- `src/components/`：可复用 UI
- `reference-v1.4-prototype/`：已经人工验收过的原型，只作为行为参考，不在此处继续堆代码

## 本地开发
需要 Node.js 环境后运行：

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 当前限制
本运行环境无法访问 npm registry，因此本次只完成工程目录、依赖声明与源码迁移，未在容器内安装依赖并执行 Vite production build。V1.4 原型行为作为迁移基准保留。
