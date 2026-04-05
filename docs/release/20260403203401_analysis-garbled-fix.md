# 分析工作区乱码修复

- 时间：2026-04-03 20:34:01
- 对应计划：[20260403201254_analysis-garbled-fix.md](D:\weather\docs\plan\20260403201254_analysis-garbled-fix.md)
- 快照目录：`D:\weather\tmp-snapshot-20260403201255-analysis-garbled-fix`

## 问题原因

- `AnalysisWorkspace.tsx` 中混入了大量 `\uXXXX` 形式的“伪中文”文本。
- 这类写法在 JSX 文本节点和字符串属性里不会按预期作为中文稳定输出，导致分析工作区显示异常。
- 同时模型资料栏里还残留了坏字符样式的条目前缀，进一步放大了乱码观感。
- 原有编码校验只检查“是否是 UTF-8”和少数 mojibake 样本，没有拦住前端源码里的 `\uXXXX` 伪中文。

## 本次修复

- 重写分析工作区组件为稳定 UTF-8 中文文本：
  - [AnalysisWorkspace.tsx](D:\weather\zip\src\components\AnalysisWorkspace.tsx)
- 补强编码检查：
  - [check-encoding.mjs](D:\weather\tools\check-encoding.mjs)
  - 拦截前端源码中的原始 `\uXXXX` 占位写法
  - 保留对 UTF-8 非法编码和坏字符的检查
- 补强编码回归测试：
  - [encoding-guard.test.ts](D:\weather\tests\encoding-guard.test.ts)
  - 新增前端源码不允许 `\uXXXX` 伪中文的断言
  - 继续校验静态资源与接口 JSON 的 UTF-8 输出

## 验证结果

- `npm run check`：通过
- `npm run test`：通过
- `npm run build`：通过
- 构建产物已更新为：
  - `D:\weather\zip\dist\assets\index-DNn_Kpw-.js`

## 防再犯

- 前端源码层面：`zip/src` 下不再允许 `\uXXXX` 形式的伪中文文本进入提交结果。
- 工程校验层面：`npm run check` 已会在这类写法再次出现时直接失败。
- 测试层面：编码回归测试已覆盖前端源码、静态资源和接口 JSON。
