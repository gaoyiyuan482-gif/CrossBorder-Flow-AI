import test from "node:test";
import assert from "node:assert/strict";
import {
  compareRecords,
  decide,
  initialState,
  parseErp,
  parseInvoice,
  type WorkflowState,
} from "../../lib/domain.ts";

const maker = { id: "samuel-maker", role: "MAKER" } as const;
const approver = { id: "ajith-approver", role: "APPROVER" } as const;
const bank = { id: "mock-bank-adapter", role: "SYSTEM" } as const;
const validVerification = { method: "供应商已登记电话回拨", evidenceRef: "CALL-0482", confirmedAccount: "8812" };

function pendingMismatch() {
  let state = decide(initialState("mismatch"), { action: "PARSE_DOCUMENTS", actor: maker, accountMatches: false }).next;
  state = decide(state, { action: "RECORD_VERIFICATION", actor: maker, verification: validVerification }).next;
  return decide(state, { action: "SUBMIT_APPROVAL", actor: maker }).next;
}

function approvedMismatch() {
  return decide(pendingMismatch(), { action: "APPROVE", actor: approver }).next;
}

function submittedMismatch() {
  return decide(approvedMismatch(), { action: "SUBMIT_BANK", actor: bank }).next;
}

test("T01 正常账户匹配进入待人工审批，不能直接视为已付款", () => {
  const state = decide(initialState("normal"), { action: "PARSE_DOCUMENTS", actor: maker, accountMatches: true }).next;
  assert.equal(state.documentStatus, "MATCHED");
  assert.equal(state.approvalStatus, "PENDING");
  assert.equal(state.bankStatus, "NOT_SENT");
  assert.equal(state.state, "PENDING_APPROVAL");
});

test("T02 发票 8821 / ERP 8812 不匹配并保留双侧证据", () => {
  const invoice = parseInvoice("Invoice: INV-MY-2048\nSupplier: Peninsula Components Sdn Bhd\nAmount: 48,000\nCurrency: MYR\nBeneficiary Account: 8821");
  const erp = parseErp(JSON.stringify({ purchase_order: "PO-MY-8820", supplier: "Peninsula Components Sdn Bhd", amount: 48000, currency: "MYR", beneficiary_account: "8812" }));
  const mismatches = compareRecords(invoice, erp);
  assert.deepEqual(mismatches.map((item) => [item.field, item.invoice, item.erp, item.severity]), [["beneficiary_account", "8821", "8812", "HIGH"]]);
  const state = decide(initialState("mismatch"), { action: "PARSE_DOCUMENTS", actor: maker, accountMatches: false }).next;
  assert.equal(state.state, "VERIFICATION_REQUIRED");
  assert.equal(state.approvalStatus, "NOT_SUBMITTED");
});

test("T03 未完成有效人工核实时服务端状态机拒绝审批绕过", () => {
  const parsed = decide(initialState("mismatch"), { action: "PARSE_DOCUMENTS", actor: maker, accountMatches: false }).next;
  const forged = { ...parsed, approvalStatus: "PENDING", makerId: maker.id } as WorkflowState;
  assert.throws(() => decide(forged, { action: "APPROVE", actor: approver }), /文件核对未完成/);
});

test("T04 Ajith 拒绝后不允许提交银行", () => {
  const rejected = decide(pendingMismatch(), { action: "REJECT", actor: approver }).next;
  assert.equal(rejected.state, "REJECTED");
  assert.throws(() => decide(rejected, { action: "SUBMIT_BANK", actor: bank }), /只有已批准付款/);
});

test("T05 PAYMENT_DELAYED 创建异常且保留既有上下文", () => {
  const processing = decide(submittedMismatch(), { action: "BANK_PROCESSING", actor: bank }).next;
  const delayed = decide(processing, { action: "BANK_DELAYED", actor: bank }).next;
  assert.equal(delayed.bankStatus, "DELAYED");
  assert.equal(delayed.exceptionStatus, "OPEN");
  assert.equal(delayed.verification?.evidenceRef, "CALL-0482");
  assert.equal(delayed.approvalStatus, "APPROVED");
});

test("T06 PAYMENT_COMPLETED 只在合法状态和人工跟进后完成", () => {
  let state = decide(submittedMismatch(), { action: "BANK_DELAYED", actor: bank }).next;
  assert.throws(() => decide(state, { action: "BANK_COMPLETED", actor: bank }), /必须先完成人工跟进/);
  state = decide(state, { action: "INVESTIGATE", actor: maker }).next;
  state = decide(state, { action: "CONFIRM_FOLLOW_UP", actor: maker, followUp: { action: "已联系供应商", evidenceRef: "FOLLOWUP-0482" } }).next;
  assert.equal(state.state, "DELAYED");
  state = decide(state, { action: "BANK_COMPLETED", actor: bank }).next;
  assert.equal(state.state, "COMPLETED");
  assert.equal(state.exceptionStatus, "RESOLVED");
});

test("Samuel 不能自批", () => {
  assert.throws(() => decide(pendingMismatch(), { action: "APPROVE", actor: maker }), /需要 APPROVER 权限/);
  assert.throws(() => decide(pendingMismatch(), { action: "APPROVE", actor: { id: maker.id, role: "APPROVER" } }), /Maker 不能批准/);
});

test("缺少核实方法、证据或账号时拒绝", () => {
  const parsed = decide(initialState("mismatch"), { action: "PARSE_DOCUMENTS", actor: maker, accountMatches: false }).next;
  assert.throws(() => decide(parsed, { action: "RECORD_VERIFICATION", actor: maker, verification: { method: "", evidenceRef: "CALL", confirmedAccount: "8812" } }), /核实方法/);
  assert.throws(() => decide(parsed, { action: "RECORD_VERIFICATION", actor: maker, verification: { method: "回拨", evidenceRef: "", confirmedAccount: "8812" } }), /证据引用/);
  assert.throws(() => decide(parsed, { action: "RECORD_VERIFICATION", actor: maker, verification: { method: "回拨", evidenceRef: "CALL", confirmedAccount: "12" } }), /至少需要末四位/);
});

test("编辑关键字段使旧核实与审批失效", () => {
  const changed = decide(pendingMismatch(), { action: "EDIT_CRITICAL_FIELD", actor: maker }).next;
  assert.equal(changed.documentStatus, "INVALIDATED");
  assert.equal(changed.approvalStatus, "NOT_SUBMITTED");
  assert.equal(changed.verification, null);
});

test("乱序银行事件与伪造银行完成状态被拒绝", () => {
  assert.throws(() => decide(initialState(), { action: "BANK_COMPLETED", actor: bank }), /乱序银行事件/);
  assert.throws(() => decide(submittedMismatch(), { action: "BANK_COMPLETED", actor: maker }), /需要 SYSTEM 权限/);
});

test("无效角色无法记录核实或审批", () => {
  const parsed = decide(initialState(), { action: "PARSE_DOCUMENTS", actor: maker, accountMatches: false }).next;
  assert.throws(() => decide(parsed, { action: "RECORD_VERIFICATION", actor: approver, verification: validVerification }), /需要 MAKER 权限/);
});

test("ERP JSON 缺少记录时解析结果可被规则识别", () => {
  const invoice = parseInvoice("Invoice: INV-MY-2048\nSupplier: Peninsula Components Sdn Bhd\nAmount: 48,000\nCurrency: MYR\nBeneficiary Account: 8821");
  const missing = parseErp("{}");
  assert.ok(compareRecords(invoice, missing).length >= 4);
});
