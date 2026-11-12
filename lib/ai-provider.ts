import type { WorkflowState } from "./domain";

export type AIRecommendation = {
  summary: string;
  findings: string[];
  evidenceRefs: string[];
  suggestedAction: string;
  uncertainty: string;
  provider: string;
  simulation: true;
};

export interface AIProvider {
  recommend(state: WorkflowState): Promise<AIRecommendation>;
}

export class DeterministicMockAIProvider implements AIProvider {
  async recommend(state: WorkflowState): Promise<AIRecommendation> {
    return {
      summary: `付款已完成文件核对与人工审批，当前银行状态为 ${state.bankStatus}。`,
      findings: [
        "发票与 ERP 的收款账户曾出现不一致",
        "Samuel 已提交独立核实证据",
        "Ajith 的审批记录存在且与 Maker 分离",
        "EVT-5821 表示银行审核延迟，不代表付款失败或完成",
      ],
      evidenceRefs: ["INV-MY-2048.pdf#payment-instructions", "ERP:SUP-MY-018", "AUDIT:APPROVAL_GRANTED", "BANK:EVT-5821"],
      suggestedAction: "保留原始账号证据，使用已登记渠道联系供应商，确认延迟原因后等待新的银行状态事件。",
      uncertainty: "模拟 AI 无法验证真实银行或供应商状态；建议必须由授权人员确认。",
      provider: "deterministic-mock-v1",
      simulation: true,
    };
  }
}

export class FailingAIProvider implements AIProvider {
  async recommend(state: WorkflowState): Promise<AIRecommendation> {
    void state;
    throw new Error("模拟 AI 服务不可用；核心规则与人工审批仍然有效。");
  }
}
