import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DeterministicMockAIProvider, FailingAIProvider } from "../../../lib/ai-provider";
import {
  APPROVER_ID,
  PAYMENT_ID,
  compareRecords,
  decide,
  initialState,
  parseErp,
  parseInvoice,
  presetState,
  type Action,
  type Actor,
  type ScenarioId,
  type WorkflowState,
} from "../../../lib/domain";
import { completedBankEvent, delayedBankEvent, erpFixture, invoiceText, paymentFixture } from "../../../lib/fixtures";

const actorSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(["MAKER", "APPROVER", "SYSTEM", "DEMO_ADMIN"]),
});
const bodySchema = z.object({
  action: z.enum([
    "PARSE_DOCUMENTS",
    "RECORD_VERIFICATION",
    "SUBMIT_APPROVAL",
    "APPROVE",
    "RETURN",
    "REJECT",
    "SUBMIT_BANK",
    "BANK_PROCESSING",
    "BANK_DELAYED",
    "BANK_COMPLETED",
    "BANK_FAILED",
    "INVESTIGATE",
    "CONFIRM_FOLLOW_UP",
    "EDIT_CRITICAL_FIELD",
    "RESET_SCENARIO",
  ]),
  actor: actorSchema,
  eventId: z.string().min(3).max(100).optional(),
  eventSource: z.string().max(80).optional(),
  scenario: z.enum(["mismatch", "normal", "rejected", "delayed", "completed"]).optional(),
  verification: z.object({
    method: z.string().max(200),
    evidenceRef: z.string().max(200),
    confirmedAccount: z.string().max(40),
  }).optional(),
  followUp: z.object({
    action: z.string().max(300),
    evidenceRef: z.string().max(200),
  }).optional(),
  simulateAiFailure: z.boolean().optional(),
}).strict();

const now = () => new Date().toISOString();
const db = () => {
  if (!env.DB) throw new Error("D1 持久化绑定 DB 不可用。");
  return env.DB;
};
const sessionId = (request: Request) => {
  const raw = request.headers.get("x-demo-session") ?? "public-default";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "public-default";
};
const storageId = (request: Request) => `${PAYMENT_ID}::${sessionId(request)}`;
const documentId = (paymentId: string, kind: string) => `${paymentId}::${kind}`;

async function deleteSession(paymentId: string) {
  const tables = [
    "audit_entries_v2",
    "ai_recommendations",
    "approval_decisions",
    "verification_decisions",
    "audit_logs",
    "exceptions",
    "bank_events",
    "mismatches",
    "documents",
    "workflow_snapshots",
  ];
  await db().batch([
    ...tables.map((table) => db().prepare(`DELETE FROM ${table} WHERE payment_id = ?`).bind(paymentId)),
    db().prepare("DELETE FROM payments WHERE id = ?").bind(paymentId),
  ]);
}

async function insertAudit(
  paymentId: string,
  input: {
    action: string;
    actor: Actor;
    previousState: string;
    nextState: string;
    source: string;
    result: "ACCEPTED" | "REJECTED" | "IGNORED";
    evidenceRef?: string;
    detail: string;
  },
) {
  const stamp = now();
  await db().batch([
    db().prepare("INSERT INTO audit_entries_v2 (payment_id,action,actor_id,actor_role,previous_state,next_state,source,result,evidence_ref,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(paymentId, input.action, input.actor.id, input.actor.role, input.previousState, input.nextState, input.source, input.result, input.evidenceRef ?? null, input.detail, stamp),
    db().prepare("INSERT INTO audit_logs (payment_id,action,actor_id,actor_role,detail,created_at) VALUES (?,?,?,?,?,?)")
      .bind(paymentId, input.action, input.actor.id, input.actor.role, input.detail, stamp),
  ]);
}

async function seed(paymentId: string, scenario: ScenarioId = "mismatch") {
  const found = await db().prepare("SELECT payment_id FROM workflow_snapshots WHERE payment_id = ?").bind(paymentId).first();
  if (found) return;
  const stamp = now();
  const state = ["rejected", "delayed", "completed"].includes(scenario) ? presetState(scenario) : initialState(scenario);
  const erp = JSON.stringify(erpFixture(scenario), null, 2);
  const parsed = state.documentStatus !== "NOT_CHECKED";
  const invParsed = parseInvoice(invoiceText);
  const erpParsed = parseErp(erp);
  const mismatches = parsed ? compareRecords(invParsed, erpParsed) : [];
  const statements = [
    db().prepare("INSERT INTO payments (id,amount,currency,source_currency,supplier,state,document_status,approval_status,exception_status,bank_status,maker_id,correction_proposer_id,investigated,correction_drafted,correction_reviewed,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(paymentId, paymentFixture.amount, paymentFixture.currency, "SGD", paymentFixture.beneficiary, state.state, state.documentStatus, state.approvalStatus, state.exceptionStatus, state.bankStatus, state.makerId, null, state.investigated ? 1 : 0, 0, 0, stamp),
    db().prepare("INSERT INTO workflow_snapshots (payment_id,state_json,scenario,updated_at) VALUES (?,?,?,?)")
      .bind(paymentId, JSON.stringify(state), scenario, stamp),
    db().prepare("INSERT INTO documents (id,payment_id,type,reference,raw_content,parsed_json) VALUES (?,?,?,?,?,?)")
      .bind(documentId(paymentId, "invoice"), paymentId, "INVOICE", paymentFixture.invoice, invoiceText, parsed ? JSON.stringify(invParsed) : null),
    db().prepare("INSERT INTO documents (id,payment_id,type,reference,raw_content,parsed_json) VALUES (?,?,?,?,?,?)")
      .bind(documentId(paymentId, "erp"), paymentId, "ERP", paymentFixture.purchaseOrder, erp, parsed ? JSON.stringify(erpParsed) : null),
  ];
  for (const mismatch of mismatches) {
    statements.push(
      db().prepare("INSERT INTO mismatches (payment_id,field,invoice_value,erp_value,severity,evidence) VALUES (?,?,?,?,?,?)")
        .bind(paymentId, mismatch.field, mismatch.invoice, mismatch.erp, mismatch.severity, mismatch.evidence),
    );
  }
  if (state.verification) {
    statements.push(
      db().prepare("INSERT INTO verification_decisions (payment_id,verifier_id,method,evidence_ref,confirmed_account,revision,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(paymentId, state.verification.verifierId, state.verification.method, state.verification.evidenceRef, state.verification.confirmedAccount, state.verification.revision, stamp),
    );
  }
  if (state.approvalStatus === "REJECTED" || state.approvalStatus === "APPROVED") {
    statements.push(
      db().prepare("INSERT INTO approval_decisions (payment_id,approver_id,decision,previous_status,created_at) VALUES (?,?,?,?,?)")
        .bind(paymentId, APPROVER_ID, state.approvalStatus, "PENDING", stamp),
    );
  }
  if (state.exceptionStatus !== "NONE") {
    statements.push(
      db().prepare("INSERT INTO exceptions (payment_id,status,reason,evidence_summary,proposal,review_status,resolution) VALUES (?,?,?,?,?,?,?)")
        .bind(paymentId, state.exceptionStatus, state.state === "REJECTED" ? "审批被拒绝" : "BANK_REVIEW_PENDING", null, null, "PENDING", state.exceptionStatus === "RESOLVED" ? "由模拟银行完成事件关闭" : null),
    );
  }
  if (state.bankStatus === "DELAYED" || state.bankStatus === "COMPLETED") {
    statements.push(
      db().prepare("INSERT INTO bank_events (payment_id,event_key,event_type,source,detail,created_at) VALUES (?,?,?,?,?,?)")
        .bind(paymentId, `${paymentId}:${delayedBankEvent.event_id}`, delayedBankEvent.event_type, delayedBankEvent.source, delayedBankEvent.reason, stamp),
    );
  }
  if (state.bankStatus === "COMPLETED") {
    statements.push(
      db().prepare("INSERT INTO bank_events (payment_id,event_key,event_type,source,detail,created_at) VALUES (?,?,?,?,?,?)")
        .bind(paymentId, `${paymentId}:${completedBankEvent.event_id}`, completedBankEvent.event_type, completedBankEvent.source, "模拟银行确认完成", stamp),
    );
  }
  await db().batch(statements);
  await insertAudit(paymentId, {
    action: "SCENARIO_LOADED",
    actor: { id: "demo-admin", role: "DEMO_ADMIN" },
    previousState: "NONE",
    nextState: state.state,
    source: "DEMO_CONSOLE",
    result: "ACCEPTED",
    evidenceRef: `SCENARIO:${scenario}`,
    detail: `已加载 ${scenario} 合成演示场景。`,
  });
}

async function reset(paymentId: string, scenario: ScenarioId) {
  await deleteSession(paymentId);
  await seed(paymentId, scenario);
}

async function readState(paymentId: string) {
  const row = await db().prepare("SELECT state_json FROM workflow_snapshots WHERE payment_id = ?").bind(paymentId).first<{ state_json: string }>();
  if (!row) throw new Error("付款工作流状态不存在。");
  return JSON.parse(row.state_json) as WorkflowState;
}

async function context(paymentId: string) {
  await seed(paymentId);
  const [payment, snapshot, docs, mismatches, events, exceptionCase, verification, approvals, ai, audits] = await Promise.all([
    db().prepare("SELECT * FROM payments WHERE id = ?").bind(paymentId).first<Record<string, unknown>>(),
    db().prepare("SELECT state_json,scenario FROM workflow_snapshots WHERE payment_id = ?").bind(paymentId).first<Record<string, unknown>>(),
    db().prepare("SELECT * FROM documents WHERE payment_id = ? ORDER BY type").bind(paymentId).all<Record<string, unknown>>(),
    db().prepare("SELECT * FROM mismatches WHERE payment_id = ? ORDER BY id").bind(paymentId).all<Record<string, unknown>>(),
    db().prepare("SELECT * FROM bank_events WHERE payment_id = ? ORDER BY id DESC").bind(paymentId).all<Record<string, unknown>>(),
    db().prepare("SELECT * FROM exceptions WHERE payment_id = ? ORDER BY id DESC LIMIT 1").bind(paymentId).first<Record<string, unknown>>(),
    db().prepare("SELECT * FROM verification_decisions WHERE payment_id = ? ORDER BY id DESC LIMIT 1").bind(paymentId).first<Record<string, unknown>>(),
    db().prepare("SELECT * FROM approval_decisions WHERE payment_id = ? ORDER BY id DESC").bind(paymentId).all<Record<string, unknown>>(),
    db().prepare("SELECT * FROM ai_recommendations WHERE payment_id = ? ORDER BY id DESC LIMIT 1").bind(paymentId).first<Record<string, unknown>>(),
    db().prepare("SELECT * FROM audit_entries_v2 WHERE payment_id = ? ORDER BY id DESC").bind(paymentId).all<Record<string, unknown>>(),
  ]);
  if (!payment || !snapshot) throw new Error("付款初始化失败。");
  const state = JSON.parse(String(snapshot.state_json)) as WorkflowState;
  return {
    synthetic: true,
    session: paymentId.split("::")[1],
    payment: {
      id: PAYMENT_ID,
      payer: paymentFixture.payer,
      beneficiary: paymentFixture.beneficiary,
      amount: payment.amount,
      currency: payment.currency,
      state: state.state,
      documentStatus: state.documentStatus,
      approvalStatus: state.approvalStatus,
      exceptionStatus: state.exceptionStatus,
      bankStatus: state.bankStatus,
      currentOwner: state.approvalStatus === "PENDING" ? "Ajith · Approver" : state.state === "DELAYED" ? "Samuel · Maker" : "Samuel · Maker",
      updatedAt: payment.updated_at,
    },
    workflow: state,
    scenario: snapshot.scenario,
    documents: docs.results.map((item) => ({
      id: item.id,
      type: item.type,
      reference: item.reference,
      rawContent: item.raw_content,
      parsed: item.parsed_json ? JSON.parse(String(item.parsed_json)) : null,
    })),
    mismatches: mismatches.results.map((item) => ({
      field: item.field,
      invoice: item.invoice_value,
      erp: item.erp_value,
      severity: item.severity,
      evidence: item.evidence,
    })),
    verification: verification ? {
      verifierId: verification.verifier_id,
      method: verification.method,
      evidenceRef: verification.evidence_ref,
      confirmedAccount: verification.confirmed_account,
      revision: verification.revision,
      createdAt: verification.created_at,
    } : null,
    approvals: approvals.results.map((item) => ({
      approverId: item.approver_id,
      decision: item.decision,
      previousStatus: item.previous_status,
      createdAt: item.created_at,
    })),
    events: events.results.map((item) => ({
      eventId: String(item.event_key).split(":").at(-1),
      eventType: item.event_type,
      source: item.source,
      detail: item.detail,
      createdAt: item.created_at,
    })),
    exception: exceptionCase ? {
      status: exceptionCase.status,
      reason: exceptionCase.reason,
      evidenceSummary: exceptionCase.evidence_summary,
      proposal: exceptionCase.proposal,
      reviewStatus: exceptionCase.review_status,
      resolution: exceptionCase.resolution,
    } : null,
    aiRecommendation: ai ? JSON.parse(String(ai.recommendation_json)) : null,
    audits: audits.results.map((item) => ({
      id: item.id,
      action: item.action,
      actorId: item.actor_id,
      actorRole: item.actor_role,
      previousState: item.previous_state,
      nextState: item.next_state,
      source: item.source,
      result: item.result,
      evidenceRef: item.evidence_ref,
      detail: item.detail,
      createdAt: item.created_at,
    })),
  };
}

export async function GET(request: Request) {
  try {
    const paymentId = storageId(request);
    await seed(paymentId);
    return NextResponse.json(await context(paymentId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "加载失败。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const paymentId = storageId(request);
  let attemptedAction = "INVALID_PAYLOAD";
  let attemptedActor: Actor = { id: "unknown", role: "SYSTEM" };
  try {
    await seed(paymentId);
    const raw = await request.json();
    const body = bodySchema.parse(raw);
    attemptedAction = body.action;
    attemptedActor = body.actor;

    if (body.action === "RESET_SCENARIO") {
      const scenario = body.scenario ?? "mismatch";
      await reset(paymentId, scenario);
      return NextResponse.json({ message: `已重置并加载「${scenario}」场景。`, context: await context(paymentId) });
    }

    const current = await readState(paymentId);
    const bankAction = ["SUBMIT_BANK", "BANK_PROCESSING", "BANK_DELAYED", "BANK_COMPLETED", "BANK_FAILED"].includes(body.action);
    const actor: Actor = bankAction ? { id: "mock-bank-adapter", role: "SYSTEM" } : body.actor;
    let accountMatches: boolean | undefined;
    let invoiceParsed: ReturnType<typeof parseInvoice> | undefined;
    let erpParsed: ReturnType<typeof parseErp> | undefined;
    let mismatches: ReturnType<typeof compareRecords> = [];

    if (body.action === "PARSE_DOCUMENTS") {
      invoiceParsed = parseInvoice(invoiceText);
      erpParsed = parseErp(JSON.stringify(erpFixture(current.scenario)));
      mismatches = compareRecords(invoiceParsed, erpParsed);
      accountMatches = mismatches.length === 0;
    }

    const eventId = body.eventId ?? (
      body.action === "BANK_DELAYED" ? delayedBankEvent.event_id
        : body.action === "BANK_COMPLETED" ? completedBankEvent.event_id
          : `EVT-${body.action}-0482`
    );
    if (bankAction) {
      if (body.eventSource && body.eventSource !== "MOCK_BANK_API") throw new Error("银行事件来源无效。");
      const eventKey = `${paymentId}:${eventId}`;
      const existing = await db().prepare("SELECT id FROM bank_events WHERE event_key = ?").bind(eventKey).first();
      if (existing) {
        await insertAudit(paymentId, {
          action: body.action,
          actor,
          previousState: current.state,
          nextState: current.state,
          source: "MOCK_BANK_API",
          result: "IGNORED",
          evidenceRef: eventId,
          detail: "重复银行事件已幂等忽略。",
        });
        return NextResponse.json({ message: "重复银行事件已安全忽略。", duplicate: true, context: await context(paymentId) });
      }
    }

    const decision = decide(current, {
      action: body.action as Action,
      actor,
      accountMatches,
      verification: body.verification,
      followUp: body.followUp,
    });
    const stamp = now();
    const statements = [
      db().prepare("UPDATE workflow_snapshots SET state_json=?,scenario=?,updated_at=? WHERE payment_id=?")
        .bind(JSON.stringify(decision.next), decision.next.scenario, stamp, paymentId),
      db().prepare("UPDATE payments SET state=?,document_status=?,approval_status=?,exception_status=?,bank_status=?,maker_id=?,investigated=?,updated_at=? WHERE id=?")
        .bind(decision.next.state, decision.next.documentStatus, decision.next.approvalStatus, decision.next.exceptionStatus, decision.next.bankStatus, decision.next.makerId, decision.next.investigated ? 1 : 0, stamp, paymentId),
    ];

    if (body.action === "PARSE_DOCUMENTS" && invoiceParsed && erpParsed) {
      statements.push(
        db().prepare("UPDATE documents SET parsed_json=? WHERE id=?").bind(JSON.stringify(invoiceParsed), documentId(paymentId, "invoice")),
        db().prepare("UPDATE documents SET parsed_json=? WHERE id=?").bind(JSON.stringify(erpParsed), documentId(paymentId, "erp")),
        db().prepare("DELETE FROM mismatches WHERE payment_id=?").bind(paymentId),
      );
      for (const mismatch of mismatches) {
        statements.push(
          db().prepare("INSERT INTO mismatches (payment_id,field,invoice_value,erp_value,severity,evidence) VALUES (?,?,?,?,?,?)")
            .bind(paymentId, mismatch.field, mismatch.invoice, mismatch.erp, mismatch.severity, mismatch.evidence),
        );
      }
    }
    if (body.action === "RECORD_VERIFICATION" && decision.next.verification) {
      const verification = decision.next.verification;
      statements.push(
        db().prepare("INSERT INTO verification_decisions (payment_id,verifier_id,method,evidence_ref,confirmed_account,revision,created_at) VALUES (?,?,?,?,?,?,?)")
          .bind(paymentId, verification.verifierId, verification.method, verification.evidenceRef, verification.confirmedAccount, verification.revision, stamp),
      );
    }
    if (["APPROVE", "RETURN", "REJECT"].includes(body.action)) {
      statements.push(
        db().prepare("INSERT INTO approval_decisions (payment_id,approver_id,decision,previous_status,created_at) VALUES (?,?,?,?,?)")
          .bind(paymentId, actor.id, body.action, current.approvalStatus, stamp),
      );
    }
    if (decision.exceptionReason) {
      statements.push(
        db().prepare("INSERT INTO exceptions (payment_id,status,reason,evidence_summary,proposal,review_status,resolution) VALUES (?,?,?,NULL,NULL,'PENDING',NULL)")
          .bind(paymentId, "OPEN", decision.exceptionReason),
      );
    }
    if (body.action === "INVESTIGATE") {
      const provider = body.simulateAiFailure ? new FailingAIProvider() : new DeterministicMockAIProvider();
      try {
        const recommendation = await provider.recommend(decision.next);
        statements.push(
          db().prepare("INSERT INTO ai_recommendations (payment_id,provider,simulation,recommendation_json,created_at) VALUES (?,?,?,?,?)")
            .bind(paymentId, recommendation.provider, 1, JSON.stringify(recommendation), stamp),
          db().prepare("UPDATE exceptions SET status='IN_REVIEW',evidence_summary=?,proposal=? WHERE payment_id=? AND status!='RESOLVED'")
            .bind(recommendation.summary, recommendation.suggestedAction, paymentId),
        );
      } catch {
        statements.push(
          db().prepare("UPDATE exceptions SET status='IN_REVIEW',evidence_summary=?,proposal=NULL WHERE payment_id=? AND status!='RESOLVED'")
            .bind("模拟 AI 暂不可用。规则校验、审批限制和人工处理保持有效。", paymentId),
        );
      }
    }
    if (body.action === "CONFIRM_FOLLOW_UP") {
      statements.push(
        db().prepare("UPDATE exceptions SET status='FOLLOW_UP_CONFIRMED',review_status='CONFIRMED',resolution=? WHERE payment_id=? AND status!='RESOLVED'")
          .bind("人工已确认跟进，仍等待银行完成事件。", paymentId),
      );
    }
    if (body.action === "BANK_COMPLETED") {
      statements.push(
        db().prepare("UPDATE exceptions SET status='RESOLVED',resolution=? WHERE payment_id=? AND status!='RESOLVED'")
          .bind("由 EVT-5822 模拟银行完成事件关闭。", paymentId),
      );
    }
    if (bankAction) {
      statements.push(
        db().prepare("INSERT INTO bank_events (payment_id,event_key,event_type,source,detail,created_at) VALUES (?,?,?,?,?,?)")
          .bind(paymentId, `${paymentId}:${eventId}`, decision.event, "MOCK_BANK_API", decision.message, stamp),
      );
    }

    await db().batch(statements);
    await insertAudit(paymentId, {
      action: decision.event,
      actor,
      previousState: decision.previous.state,
      nextState: decision.next.state,
      source: bankAction ? "MOCK_BANK_API" : body.action === "INVESTIGATE" ? "MOCK_AI_PROVIDER" : "WORKFLOW_API",
      result: "ACCEPTED",
      evidenceRef: bankAction ? eventId : body.verification?.evidenceRef ?? body.followUp?.evidenceRef,
      detail: decision.message,
    });
    return NextResponse.json({ message: decision.message, context: await context(paymentId) });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? `请求数据无效：${error.issues.map((issue) => issue.message).join("；")}`
      : error instanceof Error ? error.message : "操作失败。";
    try {
      const current = await readState(paymentId);
      await insertAudit(paymentId, {
        action: attemptedAction,
        actor: attemptedActor,
        previousState: current.state,
        nextState: current.state,
        source: "WORKFLOW_API",
        result: "REJECTED",
        detail: message,
      });
    } catch {
      // Invalid payloads can fail before a session is available; the client still receives a safe error.
    }
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 409 });
  }
}
