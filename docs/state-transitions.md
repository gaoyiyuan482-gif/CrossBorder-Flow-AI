# 状态转换矩阵

付款执行、文件核实、审批、异常和银行状态分别保存，避免把“已跟进”误当成“已付款”。

| 当前状态 | 动作 | 角色/来源 | 必要条件 | 下一状态 | 拒绝原因示例 |
|---|---|---|---|---|---|
| Draft | Parse documents | Maker | 文件未核对 | VerificationRequired 或 PendingApproval | 文件已经解析 |
| VerificationRequired | Record verification | Maker | 方法、证据引用、确认账号完整 | Verified | 缺少证据或账号不足四位 |
| Verified | Submit approval | Maker | 核实 revision 未失效 | PendingApproval | 关键字段已变化 |
| PendingApproval | Approve | Approver | 不是原 Maker；证据有效 | Approved | Maker 自批、核实无效 |
| PendingApproval | Return | Approver | 独立审批人 | Returned | 非待审批状态 |
| PendingApproval | Reject | Approver | 独立审批人 | Rejected | 非待审批状态 |
| Approved | Submit bank | Mock Bank adapter | 审批为 Approved | Submitted | 审批拒绝或未完成 |
| Submitted | Processing | Mock Bank API | event ID 唯一、来源合法 | Processing | 事件乱序或来源无效 |
| Submitted/Processing | Delayed | Mock Bank API | `EVT-5821` 唯一 | Delayed + Open exception | 重复事件被幂等忽略 |
| Delayed | Investigate | Maker/Approver | 异常开放 | InReview | 没有开放异常 |
| Delayed | Confirm follow-up | Maker/Approver | 已调查；动作与证据完整 | 仍为 Delayed | 缺少人工证据 |
| Delayed | Completed event | Mock Bank API | 跟进已确认；event ID 唯一 | Completed + Resolved | 跟进未确认或事件乱序 |

关键字段修改会把 `VerificationDecision` 设为失效、清除旧审批并回到 `VerificationRequired`。拒绝和非法转换会写入 `audit_entries_v2`，不会静默失败。
