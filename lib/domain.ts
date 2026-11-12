export const PAYMENT_ID = "PAY-2026-0482";
export const MAKER_ID = "samuel-maker";
export const APPROVER_ID = "ajith-approver";

export type Role = "MAKER" | "APPROVER" | "SYSTEM" | "DEMO_ADMIN";
export type Actor = { id: string; role: Role };
export type ScenarioId = "mismatch" | "normal" | "rejected" | "delayed" | "completed";
export type PaymentState =
  | "DRAFT"
  | "VERIFICATION_REQUIRED"
  | "VERIFIED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "RETURNED"
  | "REJECTED"
  | "SUBMITTED"
  | "PROCESSING"
  | "DELAYED"
  | "COMPLETED"
  | "FAILED";
export type DocumentStatus = "NOT_CHECKED" | "MATCHED" | "MISMATCH" | "VERIFIED" | "INVALIDATED";
export type ApprovalStatus = "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "RETURNED" | "REJECTED";
export type ExceptionStatus = "NONE" | "OPEN" | "IN_REVIEW" | "FOLLOW_UP_CONFIRMED" | "RESOLVED";
export type BankStatus = "NOT_SENT" | "SUBMITTED" | "PROCESSING" | "DELAYED" | "COMPLETED" | "FAILED";

export type VerificationRecord = {
  method: string;
  evidenceRef: string;
  confirmedAccount: string;
  verifierId: string;
  revision: number;
} | null;

export type FollowUpRecord = {
  action: string;
  evidenceRef: string;
  confirmedBy: string;
} | null;

export type WorkflowState = {
  state: PaymentState;
  documentStatus: DocumentStatus;
  approvalStatus: ApprovalStatus;
  exceptionStatus: ExceptionStatus;
  bankStatus: BankStatus;
  scenario: ScenarioId;
  makerId: string | null;
  approverId: string | null;
  verification: VerificationRecord;
  followUp: FollowUpRecord;
  criticalRevision: number;
  investigated: boolean;
};

export type Action =
  | "PARSE_DOCUMENTS"
  | "RECORD_VERIFICATION"
  | "SUBMIT_APPROVAL"
  | "APPROVE"
  | "RETURN"
  | "REJECT"
  | "SUBMIT_BANK"
  | "BANK_PROCESSING"
  | "BANK_DELAYED"
  | "BANK_COMPLETED"
  | "BANK_FAILED"
  | "INVESTIGATE"
  | "CONFIRM_FOLLOW_UP"
  | "EDIT_CRITICAL_FIELD";

export type Command = {
  action: Action;
  actor: Actor;
  accountMatches?: boolean;
  verification?: { method: string; evidenceRef: string; confirmedAccount: string };
  followUp?: { action: string; evidenceRef: string };
};

export type Decision = {
  previous: WorkflowState;
  next: WorkflowState;
  event: string;
  message: string;
  exceptionReason?: string;
};

export const initialState = (scenario: ScenarioId = "mismatch"): WorkflowState => ({
  state: "DRAFT",
  documentStatus: "NOT_CHECKED",
  approvalStatus: "NOT_SUBMITTED",
  exceptionStatus: "NONE",
  bankStatus: "NOT_SENT",
  scenario,
  makerId: null,
  approverId: null,
  verification: null,
  followUp: null,
  criticalRevision: 1,
  investigated: false,
});

const expect: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const requireRole = (actor: Actor, ...roles: Role[]) => {
  expect(roles.includes(actor.role), `需要 ${roles.join(" 或 ")} 权限。`);
};

const requireText = (value: string | undefined, label: string): string => {
  expect(Boolean(value?.trim()), `${label}为必填项。`);
  return value!.trim();
};

export function decide(current: WorkflowState, command: Command): Decision {
  const { action, actor } = command;
  const next: WorkflowState = structuredClone(current);
  const done = (event: string, message: string, exceptionReason?: string): Decision => ({
    previous: current,
    next,
    event,
    message,
    exceptionReason,
  });

  switch (action) {
    case "PARSE_DOCUMENTS": {
      requireRole(actor, "MAKER");
      expect(current.documentStatus === "NOT_CHECKED" || current.documentStatus === "INVALIDATED", "文件已经完成核对。");
      expect(typeof command.accountMatches === "boolean", "缺少账户比较结果。");
      next.makerId = actor.id;
      if (command.accountMatches) {
        next.documentStatus = "MATCHED";
        next.approvalStatus = "PENDING";
        next.state = "PENDING_APPROVAL";
        return done("DOCUMENTS_MATCHED", "规则核对通过，已进入待人工审批；尚未提交银行。");
      }
      next.documentStatus = "MISMATCH";
      next.state = "VERIFICATION_REQUIRED";
      return done("DOCUMENT_MISMATCH_DETECTED", "发现收款账户不一致，审批已被阻断。", "发票账户 8821 与 ERP 账户 8812 不一致");
    }

    case "RECORD_VERIFICATION": {
      requireRole(actor, "MAKER");
      expect(current.documentStatus === "MISMATCH" || current.documentStatus === "INVALIDATED", "当前没有需要人工核实的账户冲突。");
      const verification = command.verification;
      expect(verification, "缺少人工核实记录。");
      const method = requireText(verification.method, "核实方法");
      const evidenceRef = requireText(verification.evidenceRef, "证据引用");
      const confirmedAccount = requireText(verification.confirmedAccount, "独立确认账号").replace(/\D/g, "");
      expect(confirmedAccount.length >= 4, "独立确认账号至少需要末四位。");
      next.verification = { method, evidenceRef, confirmedAccount, verifierId: actor.id, revision: current.criticalRevision };
      next.documentStatus = "VERIFIED";
      next.state = "VERIFIED";
      next.makerId = actor.id;
      return done("HUMAN_VERIFICATION_RECORDED", "已记录独立核实证据；原始发票与 ERP 字段均未被覆盖。");
    }

    case "SUBMIT_APPROVAL": {
      requireRole(actor, "MAKER");
      expect(current.documentStatus === "MATCHED" || current.documentStatus === "VERIFIED", "必须先完成有效文件核对或人工核实。");
      if (current.documentStatus === "VERIFIED") {
        expect(current.verification?.revision === current.criticalRevision, "关键字段已变化，旧核实记录已失效。");
      }
      expect(current.approvalStatus === "NOT_SUBMITTED" || current.approvalStatus === "RETURNED", "当前付款不能重复提交审批。");
      next.approvalStatus = "PENDING";
      next.state = "PENDING_APPROVAL";
      next.makerId = actor.id;
      return done("PAYMENT_SUBMITTED_FOR_APPROVAL", "付款已提交给 Ajith 进行独立审批。");
    }

    case "APPROVE": {
      requireRole(actor, "APPROVER");
      expect(current.approvalStatus === "PENDING", "只有待审批付款可以批准。");
      expect(current.makerId !== actor.id, "Maker 不能批准自己制作的付款。");
      expect(current.documentStatus === "MATCHED" || current.documentStatus === "VERIFIED", "可信业务层拒绝：文件核对未完成。");
      if (current.documentStatus === "VERIFIED") {
        expect(current.verification?.revision === current.criticalRevision, "可信业务层拒绝：人工核实无效或已过期。");
      }
      next.approvalStatus = "APPROVED";
      next.approverId = actor.id;
      next.state = "APPROVED";
      return done("APPROVAL_GRANTED", "Ajith 已批准付款；付款仍未提交银行。");
    }

    case "RETURN": {
      requireRole(actor, "APPROVER");
      expect(current.approvalStatus === "PENDING", "只有待审批付款可以退回。");
      expect(current.makerId !== actor.id, "Maker 不能以 Approver 身份退回自己的付款。");
      next.approvalStatus = "RETURNED";
      next.state = "RETURNED";
      return done("APPROVAL_RETURNED", "付款已退回 Maker 补充资料。");
    }

    case "REJECT": {
      requireRole(actor, "APPROVER");
      expect(current.approvalStatus === "PENDING", "只有待审批付款可以拒绝。");
      expect(current.makerId !== actor.id, "Maker 不能以 Approver 身份拒绝自己的付款。");
      next.approvalStatus = "REJECTED";
      next.exceptionStatus = "OPEN";
      next.state = "REJECTED";
      return done("APPROVAL_REJECTED", "Ajith 已拒绝付款，禁止提交银行。", "审批被拒绝");
    }

    case "SUBMIT_BANK": {
      requireRole(actor, "SYSTEM");
      expect(current.approvalStatus === "APPROVED", "只有已批准付款可以提交银行。");
      expect(current.bankStatus === "NOT_SENT", "付款已经提交银行或当前状态不允许提交。");
      next.bankStatus = "SUBMITTED";
      next.state = "SUBMITTED";
      return done("PAYMENT_SUBMITTED_TO_MOCK_BANK", "付款已提交模拟银行接口。");
    }

    case "BANK_PROCESSING": {
      requireRole(actor, "SYSTEM");
      expect(current.bankStatus === "SUBMITTED", "乱序银行事件：付款尚未提交。");
      next.bankStatus = "PROCESSING";
      next.state = "PROCESSING";
      return done("PAYMENT_PROCESSING", "模拟银行已受理付款。");
    }

    case "BANK_DELAYED": {
      requireRole(actor, "SYSTEM");
      expect(current.bankStatus === "SUBMITTED" || current.bankStatus === "PROCESSING", "乱序银行事件：当前状态不能进入延迟。");
      next.bankStatus = "DELAYED";
      next.exceptionStatus = "OPEN";
      next.state = "DELAYED";
      return done("PAYMENT_DELAYED", "收到模拟银行延迟事件，已创建关联异常案例。", "BANK_REVIEW_PENDING");
    }

    case "INVESTIGATE": {
      requireRole(actor, "MAKER", "APPROVER");
      expect(current.exceptionStatus === "OPEN" || current.exceptionStatus === "IN_REVIEW", "没有可调查的开放异常。");
      expect(!current.investigated, "异常调查已经完成。");
      next.investigated = true;
      next.exceptionStatus = "IN_REVIEW";
      return done("AI_RECOMMENDATION_PREPARED", "模拟 AI 已根据当前交易上下文生成可复现建议，未执行任何付款动作。");
    }

    case "CONFIRM_FOLLOW_UP": {
      requireRole(actor, "MAKER", "APPROVER");
      expect(current.bankStatus === "DELAYED", "只有延迟付款可以确认跟进。");
      expect(current.investigated, "请先完成异常调查。");
      const followUp = command.followUp;
      expect(followUp, "缺少人工跟进记录。");
      next.followUp = {
        action: requireText(followUp.action, "跟进动作"),
        evidenceRef: requireText(followUp.evidenceRef, "跟进证据"),
        confirmedBy: actor.id,
      };
      next.exceptionStatus = "FOLLOW_UP_CONFIRMED";
      next.state = "DELAYED";
      return done("FOLLOW_UP_CONFIRMED", "人工跟进已确认；付款仍为 Delayed，等待独立银行完成事件。");
    }

    case "BANK_COMPLETED": {
      requireRole(actor, "SYSTEM");
      expect(["SUBMITTED", "PROCESSING", "DELAYED"].includes(current.bankStatus), "乱序银行事件：当前状态不能完成付款。");
      if (current.bankStatus === "DELAYED") {
        expect(current.exceptionStatus === "FOLLOW_UP_CONFIRMED", "延迟付款必须先完成人工跟进，再接收完成事件。");
      }
      next.bankStatus = "COMPLETED";
      next.state = "COMPLETED";
      if (current.exceptionStatus !== "NONE") next.exceptionStatus = "RESOLVED";
      return done("PAYMENT_COMPLETED", "收到合法模拟银行完成事件，付款状态已更新为 Completed。");
    }

    case "BANK_FAILED": {
      requireRole(actor, "SYSTEM");
      expect(["SUBMITTED", "PROCESSING", "DELAYED"].includes(current.bankStatus), "乱序银行事件：当前状态不能标记失败。");
      next.bankStatus = "FAILED";
      next.state = "FAILED";
      next.exceptionStatus = "OPEN";
      return done("PAYMENT_FAILED", "模拟银行返回失败，已创建异常案例。", "MOCK_BANK_FAILED");
    }

    case "EDIT_CRITICAL_FIELD": {
      requireRole(actor, "MAKER");
      expect(!["SUBMITTED", "PROCESSING", "COMPLETED"].includes(current.state), "付款执行后不能直接修改关键字段。");
      next.criticalRevision += 1;
      next.verification = null;
      next.documentStatus = "INVALIDATED";
      next.approvalStatus = "NOT_SUBMITTED";
      next.approverId = null;
      next.state = "VERIFICATION_REQUIRED";
      return done("CRITICAL_FIELD_CHANGED", "关键字段已变化，旧核实与审批状态已失效。");
    }
  }
}

export function parseInvoice(raw: string) {
  const pick = (label: string) => raw.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"))?.[1]?.trim() ?? "";
  return {
    invoice_no: pick("Invoice"),
    supplier: pick("Supplier"),
    amount: Number(pick("Amount").replace(/,/g, "")),
    currency: pick("Currency"),
    beneficiary_account: pick("Beneficiary Account").replace(/\D/g, ""),
  };
}

export function parseErp(raw: string) {
  const value = JSON.parse(raw) as Record<string, unknown>;
  return {
    purchase_order: String(value.purchase_order ?? ""),
    supplier: String(value.supplier ?? ""),
    amount: Number(value.amount),
    currency: String(value.currency ?? ""),
    beneficiary_account: String(value.beneficiary_account ?? "").replace(/\D/g, ""),
  };
}

export function compareRecords(invoice: Record<string, string | number>, erp: Record<string, string | number>) {
  return ["supplier", "amount", "currency", "beneficiary_account"].flatMap((field) =>
    String(invoice[field]) === String(erp[field])
      ? []
      : [{
          field,
          invoice: String(invoice[field]),
          erp: String(erp[field]),
          severity: field === "beneficiary_account" ? "HIGH" : "MEDIUM",
          evidence: `发票中的${field.replaceAll("_", " ")}与 ERP 供应商主数据不一致。`,
        }],
  );
}

export function presetState(scenario: ScenarioId): WorkflowState {
  const state = initialState(scenario);
  if (scenario === "normal") return state;
  if (scenario === "mismatch") return state;
  state.documentStatus = "VERIFIED";
  state.verification = {
    method: "供应商已登记电话回拨",
    evidenceRef: "CALL-2026-0482",
    confirmedAccount: "8812",
    verifierId: MAKER_ID,
    revision: 1,
  };
  state.makerId = MAKER_ID;
  if (scenario === "rejected") {
    state.approvalStatus = "REJECTED";
    state.exceptionStatus = "OPEN";
    state.state = "REJECTED";
    return state;
  }
  state.approvalStatus = "APPROVED";
  state.approverId = APPROVER_ID;
  if (scenario === "delayed") {
    state.bankStatus = "DELAYED";
    state.exceptionStatus = "OPEN";
    state.state = "DELAYED";
    return state;
  }
  state.bankStatus = "COMPLETED";
  state.exceptionStatus = "RESOLVED";
  state.state = "COMPLETED";
  return state;
}
