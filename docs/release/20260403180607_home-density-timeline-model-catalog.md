# 首页密度重配、轨道收敛与模型资料侧栏

- 发布时间：2026-04-03 18:06:07
- 对应计划：[20260403165459_home-density-timeline-model-catalog.md](D:\weather\docs\plan\20260403165459_home-density-timeline-model-catalog.md)
- 快照：`D:\weather\tmp-snapshot-20260403165459_home-density-timeline-model-catalog.zip`

## 本次交付

- 首页重心改为“当前判断 + 放大的多模型快速分析 + 压缩后的 24 小时轨道”。
- 24 小时轨道改为温区带主视觉，常驻信息收敛为时间、温度、降水，体感、风向、风速进入选中态检查区。
- 地点侧轨保留窄轨默认态，展开时支持遮罩压暗与 `Esc` / 点击遮罩关闭。
- 分析工作区保持 `models / image` 双 tab，并在 `models` 页加入右侧 sticky 模型资料栏。
- 模型资料采用前端静态 `ModelCatalogEntry` 与动态模型数据 join，不新增接口。
- 官方原图链路接入 stale-while-revalidate，优先返回最近一次成功缓存并后台刷新。

## 主要改动

### 前端

- 主页与分析工作区整合：
  - `D:\weather\zip\src\App.tsx`
  - `D:\weather\zip\src\components\CommandHeader.tsx`
  - `D:\weather\zip\src\components\LocationRail.tsx`
- 首页决策区与轨道重做：
  - `D:\weather\zip\src\components\WeatherOverview.tsx`
  - `D:\weather\zip\src\components\InsightCard.tsx`
- 分析工作区联动与模型资料栏：
  - `D:\weather\zip\src\components\AnalysisWorkspace.tsx`
  - `D:\weather\zip\src\model-catalog.ts`
- 中文稳定性修正：
  - 修复首页头部、地点侧轨、24 小时轨道、多模型快速分析、模型资料侧栏的可见乱码
  - 当前模型资料表覆盖：
    - `AIFS025`
    - `IFS025`
    - `IFSHRES`
    - `ICON`
    - `GFS05`
    - `GEM15`
    - `MSM`
    - `UMGLOBAL10`
    - `MFGLOBAL`
    - `NEMSGLOBAL`
    - `NEMSGLOBAL_E`
    - `NEMSAS02`

### 后端

- 缓存层加入 stale-while-revalidate：
  - `D:\weather\src\lib\cache.ts`
  - `D:\weather\src\config.ts`
  - `D:\weather\src\providers\meteoblue\service.ts`
- 多模型派生层增加前置校验与 warnings：
  - `D:\weather\src\providers\meteoblue\multimodel-distribution.ts`

### 测试

- 修复缓存 SWR 单测时序问题：
  - `D:\weather\tests\cache.test.ts`
- 补齐后端相关回归：
  - `D:\weather\tests\meteoblue-service.test.ts`
  - `D:\weather\tests\multimodel-distribution.test.ts`

## 验证结果

- `npm run test`：通过
- `npm run check`：通过
- `npm run build`：通过
- 编码巡检：`zip/src`、`src`、`tests` 中本轮相关文件未发现残留乱码关键字

## 已知边界

- `npm run test` 目前会一并跑到旧快照目录里的历史测试文件，因此输出会比主工程本身更长；本次全部通过，但后续建议把快照目录排除出 Vitest 扫描范围。
- 模型资料栏是“静态官方资料 + 动态排序结果”的组合说明，不代表系统对单模型做了自动准确率评分。
- 原图页已优先“先看见缓存图，再后台刷新”，但最终刷新速度仍受上游抓取链路影响。
