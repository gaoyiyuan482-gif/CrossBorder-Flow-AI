import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicMockAIProvider, FailingAIProvider } from "../../lib/ai-provider.ts";
import { decide, initialState, type Command, type WorkflowState } from "../../lib/domain.ts";

const maker = { id: "samuel-maker", role: "MAKER" } as const;
const approver = { id: "ajith-approver", role: "APPROVER" } as const;
const bank = { id: "mock-bank-adapter", role: "SYSTEM" } as const;

class MemoryWorkflow {
  state: WorkflowState;
  events = new Set<string>();
  audits: Array<{ action: string; result: "ACCEPTED" | "REJECTED" | "IGNORED"; previous: string; next: string }> = [];
  constructor(snapshot?: string) {
    this.state = snapshot ? JSON.parse(snapshot) : initialState("mismatch");
  }
  run(command: Command, eventId?: string) {
    const previous = this.state.state;
    if (eventId && this.events.has(eventId)) {
      this.audits.push({ action: command.action, result: "IGNORED", previous, next: previous });
      return;
    }
    try {
      const decision = decide(this.state, command);
      this.state = decision.next;
      if (eventId) this.events.add(eventId);
      this.audits.push({ action: decision.event, result: "ACCEPTED", previous, next: decision.next.state });
    } catch (error) {
      this.audits.push({ action: command.action, result: "REJECTED", previous, next: previous });
      throw error;
    }
  }
  snapshot() { return JSON.stringify(this.state); }
}

function approved(store: MemoryWorkflow) {
  store.run({ action: "PARSE_DOCUMENTS", actor: maker, accountMatches: false });
  store.run({ action: "RECORD_VERIFICATION", actor: maker, verification: { method: "登记电话回拨", evidenceRef: "CALL-0482", confirmedAccount: "8812" } });
  store.run({ action: "SUBMIT_APPROVAL", actor: maker });
  store.run({ action: "APPROVE", actor: approver });
}

test("刷新后从持久化快照恢复同一工作流状态", () => {
  const first = new MemoryWorkflow();
  approved(first);
  const refreshed = new MemoryWorkflow(first.snapshot());
  assert.equal(refreshed.state.state, "APPROVED");
  assert.equal(refreshed.state.verification?.evidenceRef, "CALL-0482");
});

test("重复银行事件幂等处理且留下 IGNORED 审计", () => {
  const store = new MemoryWorkflow();
  approved(store);
  store.run({ action: "SUBMIT_BANK", actor: bank }, "EVT-5800");
  store.run({ action: "BANK_PROCESSING", actor: bank }, "EVT-5801");
  store.run({ action: "BANK_DELAYED", actor: bank }, "EVT-5821");
  store.run({ action: "BANK_DELAYED", actor: bank }, "EVT-5821");
  assert.equal(store.state.bankStatus, "DELAYED");
  assert.equal(store.audits.at(-1)?.result, "IGNORED");
});

test("非法转换失败并留下 REJECTED 审计", () => {
  const store = new MemoryWorkflow();
  assert.throws(() => store.run({ action: "APPROVE", actor: approver }), /只有待审批/);
  assert.equal(store.audits.at(-1)?.result, "REJECTED");
});

test("异常上下文生成可复现模拟 AI 建议", async () => {
  const store = new MemoryWorkflow();
  approved(store);
  store.run({ action: "SUBMIT_BANK", actor: bank });
  store.run({ action: "BANK_DELAYED", actor: bank });
  store.run({ action: "INVESTIGATE", actor: maker });
  const provider = new DeterministicMockAIProvider();
  const first = await provider.recommend(store.state);
  const second = await provider.recommend(store.state);
  assert.deepEqual(first, second);
  assert.equal(first.simulation, true);
  assert.ok(first.evidenceRefs.includes("BANK:EVT-5821"));
});

test("AI 服务失败不改变付款状态或绕过规则", async () => {
  const state = initialState("mismatch");
  await assert.rejects(() => new FailingAIProvider().recommend(state), /不可用/);
  assert.equal(state.state, "DRAFT");
  assert.throws(() => decide(state, { action: "APPROVE", actor: approver }), /只有待审批/);
});

test("重置场景实例互相隔离", () => {
  const sessionA = new MemoryWorkflow();
  const sessionB = new MemoryWorkflow();
  approved(sessionA);
  assert.equal(sessionA.state.state, "APPROVED");
  assert.equal(sessionB.state.state, "DRAFT");
});
