# Testing & Evaluation

## 执行记录

- 执行时间：2026-11-12（Asia/Singapore）
- 本地环境：macOS arm64，Node.js 22，Chromium 158（Playwright）
- 数据库：临时隔离的本地 Cloudflare D1
- 数据：仅使用仓库内合成 fixtures

| 测试层级 | 命令 | 实际结果 |
|---|---|---|
| Unit | `npm run test:unit` | 12/12 通过 |
| Integration | `npm run test:integration` | 6/6 通过 |
| Playwright E2E | `npm run test:e2e` | 1/1 综合浏览器流程通过 |
| TypeScript | `npm run typecheck` | 通过 |
| ESLint | `npm run lint` | 通过 |
| Production build | `npm run build` | 通过 |

E2E 综合流程实际覆盖：账户不一致、人工核实、刷新后恢复、Ajith 审批、银行延迟、模拟 AI 调查、人工跟进保持 Delayed、独立银行完成事件、正常匹配、审批拒绝和直接 API 绕过核实。

## 六条强制验收

| ID | 场景 | 结果 | 自动化证据 |
|---|---|---|---|
| T01 | 正常账户匹配进入待审批，不直接付款 | PASS | `tests/unit/domain.test.ts` + E2E |
| T02 | 8821 / 8812 不匹配，阻断并显示证据 | PASS | Unit + E2E |
| T03 | 未核实直接审批，后端拒绝 | PASS | Unit + E2E API request |
| T04 | Ajith 拒绝后不能提交银行 | PASS | Unit + E2E |
| T05 | EVT-5821 创建关联异常并保留上下文 | PASS | Unit + E2E |
| T06 | 合法 EVT-5822 才能完成并保留审计 | PASS | Unit + E2E |

## 补充负向测试

已运行并通过：Samuel 自批、缺少核实字段、关键字段修改使核实失效、重复事件幂等、乱序事件、无效角色、ERP 缺失字段、AI provider 失败、持久化恢复、场景隔离、伪造银行完成、无效 payload（Zod）。

## 发现并修复的真实缺陷

第一次 Playwright 运行发现演示重置对 `payments` 表错误使用 `payment_id` 列；主表实际主键名为 `id`。修复后完整 E2E 通过。macOS 沙箱需要 Chromium 单进程启动参数；CI 在 Ubuntu 使用标准 Playwright 启动方式。

## 限制

- 没有进行真实用户研究、效率提升或准确率统计，因此不报告这些数字。
- 文档 fixture 是确定性文本解析，不代表生产 OCR 表现。
- 模拟角色不是生产身份认证。
- Mock ERP、Mock Bank 和模拟 AI 均不连接外部生产系统。
