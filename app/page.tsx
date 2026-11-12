"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  History,
  Landmark,
  ListRestart,
  Loader2,
  LockKeyhole,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";

type Role = "MAKER" | "APPROVER";
type Tab = "overview" | "documents" | "verification" | "approval" | "tracking" | "exception" | "audit" | "demo";
type Tone = "neutral" | "good" | "warn" | "danger" | "info";
type Audit = {
  id: number;
  action: string;
  actorId: string;
  actorRole: string;
  previousState: string;
  nextState: string;
  source: string;
  result: string;
  evidenceRef: string | null;
  detail: string;
  createdAt: string;
};
type PaymentContext = {
  synthetic: true;
  session: string;
  scenario: string;
  payment: {
    id: string;
    payer: string;
    beneficiary: string;
    amount: number;
    currency: string;
    state: string;
    documentStatus: string;
    approvalStatus: string;
    exceptionStatus: string;
    bankStatus: string;
    currentOwner: string;
    updatedAt: string;
  };
  documents: Array<{ id: string; type: string; reference: string; rawContent: string; parsed: Record<string, string | number> | null }>;
  mismatches: Array<{ field: string; invoice: string; erp: string; severity: string; evidence: string }>;
  verification: null | { verifierId: string; method: string; evidenceRef: string; confirmedAccount: string; revision: number; createdAt: string };
  approvals: Array<{ approverId: string; decision: string; previousStatus: string; createdAt: string }>;
  events: Array<{ eventId: string; eventType: string; source: string; detail: string; createdAt: string }>;
  exception: null | { status: string; reason: string; evidenceSummary: string | null; proposal: string | null; reviewStatus: string; resolution: string | null };
  aiRecommendation: null | {
    summary: string;
    findings: string[];
    evidenceRefs: string[];
    suggestedAction: string;
    uncertainty: string;
    provider: string;
    simulation: true;
  };
  audits: Audit[];
};

const users = {
  MAKER: { id: "samuel-maker", role: "MAKER", name: "Samuel", initials: "ST", label: "Maker" },
  APPROVER: { id: "ajith-approver", role: "APPROVER", name: "Ajith", initials: "AK", label: "Approver" },
} as const;

const nav: Array<{ id: Tab; label: string; eyebrow: string; icon: typeof CircleDot }> = [
  { id: "overview", label: "付款总览", eyebrow: "01", icon: CircleDot },
  { id: "documents", label: "文件核对", eyebrow: "02", icon: FileCheck2 },
  { id: "verification", label: "人工核实", eyebrow: "03", icon: ClipboardCheck },
  { id: "approval", label: "审批", eyebrow: "04", icon: UserCheck },
  { id: "tracking", label: "付款追踪", eyebrow: "05", icon: Clock3 },
  { id: "exception", label: "异常处理", eyebrow: "06", icon: ShieldCheck },
  { id: "audit", label: "审计记录", eyebrow: "07", icon: History },
  { id: "demo", label: "演示控制台", eyebrow: "SIM", icon: ListRestart },
];

const statusLabel: Record<string, string> = {
  DRAFT: "草稿",
  NOT_CHECKED: "未核对",
  MATCHED: "核对一致",
  MISMATCH: "发现不一致",
  VERIFIED: "已核实",
  INVALIDATED: "核实已失效",
  NOT_SUBMITTED: "未提交",
  PENDING: "待审批",
  APPROVED: "已批准",
  RETURNED: "已退回",
  REJECTED: "已拒绝",
  NOT_SENT: "未提交银行",
  SUBMITTED: "已提交",
  PROCESSING: "处理中",
  DELAYED: "延迟",
  COMPLETED: "已完成",
  FAILED: "失败",
  NONE: "无异常",
  OPEN: "待处理",
  IN_REVIEW: "调查中",
  FOLLOW_UP_CONFIRMED: "跟进已确认",
  RESOLVED: "已解决",
};
const show = (value: string) => statusLabel[value] ?? value.replaceAll("_", " ");
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
const toneFor = (value: string): Tone =>
  ["COMPLETED", "APPROVED", "VERIFIED", "MATCHED", "RESOLVED"].includes(value)
    ? "good"
    : ["MISMATCH", "DELAYED", "OPEN", "IN_REVIEW", "FOLLOW_UP_CONFIRMED"].includes(value)
      ? "warn"
      : ["REJECTED", "FAILED", "INVALIDATED"].includes(value)
        ? "danger"
        : "info";

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`badge ${tone}`}><span className="status-dot" />{children}</span>;
}
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}
function SectionTitle({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return <div className="section-title"><div className="kicker">{kicker}</div><h1>{title}</h1><p>{description}</p></div>;
}
function ActionButton({
  action,
  label,
  onRun,
  busy,
  disabled,
  kind = "primary",
  testId,
}: {
  action: string;
  label: string;
  onRun: (action: string, payload?: Record<string, unknown>) => void;
  busy: string | null;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "danger";
  testId?: string;
}) {
  return (
    <button data-testid={testId} className={`button ${kind}`} disabled={Boolean(disabled) || busy !== null} onClick={() => onRun(action)}>
      {busy === action ? <Loader2 size={16} className="spin" /> : null}
      {label}
      {busy !== action && kind === "primary" ? <ArrowRight size={15} /> : null}
    </button>
  );
}
function AuditTrail({ audits, limit }: { audits: Audit[]; limit?: number }) {
  const items = typeof limit === "number" ? audits.slice(0, limit) : audits;
  return (
    <Card>
      <div className="card-heading">
        <div><span className="overline">Append-only activity log</span><h2>审计时间线</h2></div>
        <Badge tone="info"><History size={13} /> {audits.length} 条记录</Badge>
      </div>
      <div className="audit-list">
        {items.map((entry) => (
          <div className="audit-row" key={entry.id}>
            <div className={`audit-icon ${entry.result === "REJECTED" ? "rejected" : ""}`}>{entry.result === "REJECTED" ? <AlertTriangle size={14} /> : <Check size={14} />}</div>
            <div>
              <div className="audit-title"><strong>{entry.action}</strong><span>{new Date(entry.createdAt).toLocaleString("zh-CN")}</span></div>
              <p>{entry.detail}</p>
              <small>{entry.actorId} · {entry.actorRole} · {entry.previousState} → {entry.nextState} · {entry.source}{entry.evidenceRef ? ` · ${entry.evidenceRef}` : ""}</small>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Home() {
  const [role, setRole] = useState<Role>("MAKER");
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<PaymentContext | null>(null);
  const [session] = useState(() => {
    if (typeof window === "undefined") return "public-default";
    const key = "crossborder-flow-demo-session";
    const existing = window.localStorage.getItem(key);
    const next = existing ?? crypto.randomUUID();
    if (!existing) window.localStorage.setItem(key, next);
    return next;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "danger"; text: string } | null>(null);
  const [verification, setVerification] = useState({ method: "", evidenceRef: "", confirmedAccount: "" });
  const [followUp, setFollowUp] = useState({ action: "", evidenceRef: "" });

  const load = useCallback(async (activeSession: string) => {
    const response = await fetch("/api/workflow", { cache: "no-store", headers: { "x-demo-session": activeSession } });
    const value = await response.json() as PaymentContext & { error?: string };
    if (!response.ok) throw new Error(value.error ?? "无法载入付款工作台。");
    setData(value);
  }, []);

  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(session).catch((error) => setMessage({ tone: "danger", text: error instanceof Error ? error.message : "载入失败。" }));
  }, [load, session]);

  const run = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!session) return;
    setBusy(action);
    setMessage(null);
    try {
      const actor = action === "RESET_SCENARIO"
        ? { id: "demo-admin", role: "DEMO_ADMIN" }
        : users[role];
      const response = await fetch("/api/workflow", {
        method: "POST",
        headers: { "content-type": "application/json", "x-demo-session": session },
        body: JSON.stringify({ action, actor: { id: actor.id, role: actor.role }, ...payload }),
      });
      const result = await response.json() as { error?: string; message: string; context: PaymentContext };
      if (!response.ok) throw new Error(result.error ?? "操作被可信业务层拒绝。");
      setData(result.context);
      setMessage({ tone: "good", text: result.message });
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "操作失败。" });
    } finally {
      setBusy(null);
    }
  }, [role, session]);

  const stage = useMemo(() => {
    if (!data) return 0;
    const state = data.payment.state;
    if (state === "COMPLETED") return 7;
    if (["DELAYED", "FAILED"].includes(state)) return 6;
    if (["SUBMITTED", "PROCESSING"].includes(state)) return 5;
    if (state === "APPROVED") return 4;
    if (state === "PENDING_APPROVAL") return 3;
    if (["VERIFIED", "VERIFICATION_REQUIRED"].includes(state)) return 2;
    return 1;
  }, [data]);

  if (!data) return <main className="loading"><Loader2 className="spin" /><strong>正在打开付款工作台…</strong></main>;
  const actor = users[role];
  const canRecordVerification = role === "MAKER" && ["MISMATCH", "INVALIDATED"].includes(data.payment.documentStatus);
  const canSubmitApproval = role === "MAKER" && ["VERIFIED"].includes(data.payment.documentStatus) && ["NOT_SUBMITTED", "RETURNED"].includes(data.payment.approvalStatus);
  const canApprove = role === "APPROVER" && data.payment.approvalStatus === "PENDING";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><div className="brandmark"><Landmark size={18} /></div><div><strong>CrossBorder Flow</strong><span>AI</span><small>跨境付款操作工作台</small></div></div>
        <div className="top-actions">
          <Badge tone="good"><LockKeyhole size={13} /> 仅使用合成数据</Badge>
          <div className="role-switch" aria-label="模拟角色切换">
            {(["MAKER", "APPROVER"] as Role[]).map((item) => <button data-testid={`role-${item.toLowerCase()}`} key={item} className={role === item ? "active" : ""} onClick={() => setRole(item)}>{users[item].name} · {users[item].label}</button>)}
          </div>
          <div className="avatar">{actor.initials}</div><div className="user-meta"><strong>{actor.name}</strong><span>{actor.label} · 模拟身份</span></div>
        </div>
      </header>

      <aside className="sidebar">
        <div className="workspace-label">Payment operations</div>
        <nav>{nav.map((item) => { const Icon = item.icon; return <button data-testid={`nav-${item.id}`} key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><span className="nav-icon"><Icon size={17} /></span><span><small>{item.eyebrow}</small>{item.label}</span><ChevronRight size={14} className="chevron" /></button>; })}</nav>
        <div className="safety-note"><ShieldCheck size={18} /><strong>人工控制已启用</strong><p>模拟 AI 不会审批、修改收款账号或伪造银行完成状态。</p></div>
      </aside>

      <main className="content">
        <div className="context-bar">
          <div><span>PAYMENT ID</span><strong>{data.payment.id}</strong></div>
          <div><span>CORRIDOR</span><strong>Singapore → Malaysia</strong></div>
          <div><span>VALUE</span><strong>{money(data.payment.amount, data.payment.currency)}</strong></div>
          <div><span>CURRENT OWNER</span><strong>{data.payment.currentOwner}</strong></div>
          <Badge tone={toneFor(data.payment.state)}>{show(data.payment.state)}</Badge>
        </div>
        {message ? <div role="status" data-testid="toast" className={`toast ${message.tone}`}>{message.tone === "good" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}{message.text}</div> : null}

        {tab === "overview" && <>
          <SectionTitle kicker="01 · One shared payment context" title="付款总览" description="文件证据、人工核实、审批、银行事件与异常任务都附着在同一笔 PAY-2026-0482 上。" />
          <div className="metric-grid">
            <Card><span className="overline">付款金额</span><div className="metric">{money(data.payment.amount, data.payment.currency)}</div><p>{data.payment.payer} → {data.payment.beneficiary}</p></Card>
            <Card><span className="overline">文件核对</span><div className="metric small">{show(data.payment.documentStatus)}</div><p>发票与 ERP 证据保持独立</p></Card>
            <Card><span className="overline">审批 / 银行</span><div className="metric small">{show(data.payment.approvalStatus)} · {show(data.payment.bankStatus)}</div><p>审批不等于银行付款完成</p></Card>
          </div>
          <Card>
            <div className="card-heading"><div><span className="overline">End-to-end control path</span><h2>连续工作流状态</h2></div><Badge tone="info">场景：{data.scenario}</Badge></div>
            <div className="timeline">{[["01", "草稿"], ["02", "文件核对"], ["03", "待审批"], ["04", "已批准"], ["05", "银行处理中"], ["06", "异常跟进"], ["07", "完成"]].map(([number, label], index) => <div key={number} className={index + 1 <= stage ? "done" : index + 1 === stage + 1 ? "current" : ""}><span>{index + 1 < stage || stage === 7 ? <Check size={14} /> : number}</span><strong>{label}</strong><small>{index + 1 <= stage ? "已记录" : "待处理"}</small></div>)}</div>
          </Card>
          <div className="split">
            <Card><span className="overline">下一步行动</span><h2>{data.payment.state === "DRAFT" ? "核对发票与 ERP" : data.payment.state === "VERIFICATION_REQUIRED" ? "记录独立人工核实" : data.payment.state === "PENDING_APPROVAL" ? "由 Ajith 审批" : data.payment.state === "APPROVED" ? "提交模拟银行" : data.payment.state === "DELAYED" ? "调查并确认跟进" : "查看完整审计证据"}</h2><p>所有权限、顺序和证据要求都由服务端状态机强制执行。</p></Card>
            <Card className="dark-card"><Sparkles size={21} /><span className="overline">模拟 AI · 仅辅助</span><h2>自动整理上下文，人类保留决策权。</h2><p>账户比较使用确定性程序规则；AI 不批准付款，也不会修改任何收款信息。</p></Card>
          </div>
          <AuditTrail audits={data.audits} limit={5} />
        </>}

        {tab === "documents" && <>
          <SectionTitle kicker="02 · Document collection & verification" title="文件核对" description="解析模拟发票和 ERP 记录，逐字段比较供应商、币种、金额和收款账号，并展示双方证据。" />
          <div className="document-grid">
            {data.documents.map((document) => <Card key={document.id} className="document-card"><div className="doc-head"><div className="doc-icon">{document.type === "INVOICE" ? <FileText /> : <Building2 />}</div><div><span className="overline">{document.type}</span><h2>{document.reference}</h2></div><Badge tone={document.parsed ? "good" : "neutral"}>{document.parsed ? "已解析" : "待解析"}</Badge></div>{document.parsed ? <div className="field-list">{Object.entries(document.parsed).map(([key, value]) => <div key={key}><span>{key.replaceAll("_", " ")}</span><strong>{String(value)}</strong></div>)}</div> : <pre>{document.rawContent}</pre>}<small className="provenance">来源：{document.type === "INVOICE" ? "模拟文件 fixture" : "Mock ERP API"} · Synthetic data</small></Card>)}
          </div>
          <Card>
            <div className="card-heading"><div><span className="overline">Deterministic rule engine</span><h2>跨来源比较结果</h2></div><Badge tone={toneFor(data.payment.documentStatus)}>{show(data.payment.documentStatus)}</Badge></div>
            {data.mismatches.length ? <div className="mismatch-table"><div className="mismatch-header"><span>字段</span><span>发票</span><span>ERP</span><span>判断</span></div>{data.mismatches.map((item) => <div key={item.field}><strong>{item.field.replaceAll("_", " ")}</strong><code>{item.invoice}</code><code>{item.erp}</code><Badge tone="warn">不一致</Badge><p>{item.evidence}</p></div>)}</div> : <div className="empty"><Search /><h3>{data.payment.documentStatus === "MATCHED" ? "所有关键字段核对一致" : "尚未生成比较证据"}</h3><p>运行后端解析器与规则引擎，结果会持久化并进入审计记录。</p></div>}
            <div className="notice warn"><AlertTriangle size={18} /><div><strong>收款账号绝不会被静默覆盖</strong><p>若发现 8821 与 8812 不一致，服务端会阻断审批，直到提交有效人工核实证据。</p></div></div>
            <div className="button-row"><ActionButton testId="parse-documents" action="PARSE_DOCUMENTS" label="解析并核对记录" onRun={run} busy={busy} disabled={!["NOT_CHECKED", "INVALIDATED"].includes(data.payment.documentStatus) || role !== "MAKER"} /></div>
          </Card>
        </>}

        {tab === "verification" && <>
          <SectionTitle kicker="03 · Human verification" title="人工核实" description="仅点击“已核实”不够。Samuel 必须记录独立渠道、证据引用和确认账号，服务端才会接受。" />
          <div className="split">
            <Card>
              <div className="card-heading"><div><span className="overline">Mismatch evidence</span><h2>待核实冲突</h2></div><Badge tone={data.mismatches.length ? "warn" : "good"}>{data.mismatches.length ? "HIGH" : "无冲突"}</Badge></div>
              <div className="account-compare"><div><span>发票 INV-MY-2048</span><strong>••••8821</strong></div><div><span>ERP SUP-MY-018</span><strong>••••{data.scenario === "normal" ? "8821" : "8812"}</strong></div></div>
              <p>原始字段会一直保留。核实决定只会新增记录，不会改写发票或 ERP 数据。</p>
            </Card>
            <Card>
              <span className="overline">Required evidence</span><h2>Samuel 的独立核实记录</h2>
              <div className="form-grid">
                <label>核实方法<input data-testid="verification-method" value={verification.method} onChange={(event) => setVerification({ ...verification, method: event.target.value })} placeholder="例如：供应商已登记电话回拨" /></label>
                <label>证据引用<input data-testid="verification-evidence" value={verification.evidenceRef} onChange={(event) => setVerification({ ...verification, evidenceRef: event.target.value })} placeholder="例如：CALL-2026-0482" /></label>
                <label>独立确认账号<input data-testid="verification-account" value={verification.confirmedAccount} onChange={(event) => setVerification({ ...verification, confirmedAccount: event.target.value })} placeholder="至少填写末四位" /></label>
              </div>
              <div className="button-row"><button data-testid="record-verification" className="button primary" disabled={!canRecordVerification || busy !== null} onClick={() => run("RECORD_VERIFICATION", { verification })}>{busy === "RECORD_VERIFICATION" ? <Loader2 size={16} className="spin" /> : null}保存核实记录 <ArrowRight size={15} /></button></div>
            </Card>
          </div>
          {data.verification ? <Card><div className="card-heading"><div><span className="overline">Recorded decision</span><h2>核实证据已持久化</h2></div><Badge tone="good">有效 · revision {data.verification.revision}</Badge></div><div className="field-list"><div><span>核实人</span><strong>{data.verification.verifierId}</strong></div><div><span>方法</span><strong>{data.verification.method}</strong></div><div><span>证据</span><strong>{data.verification.evidenceRef}</strong></div><div><span>确认账号</span><strong>••••{data.verification.confirmedAccount.slice(-4)}</strong></div></div><div className="button-row"><ActionButton testId="submit-approval" action="SUBMIT_APPROVAL" label="提交 Ajith 审批" onRun={run} busy={busy} disabled={!canSubmitApproval} /></div></Card> : null}
        </>}

        {tab === "approval" && <>
          <SectionTitle kicker="04 · Human approval" title="独立审批" description="Ajith 可以批准、退回或拒绝。服务端验证角色、Maker/Approver 分离和核实有效性。" />
          <div className="split">
            <Card><span className="overline">Payment instruction</span><h2>{data.payment.id}</h2><div className="field-list"><div><span>Maker</span><strong>Samuel</strong></div><div><span>受益人</span><strong>{data.payment.beneficiary}</strong></div><div><span>金额</span><strong>{money(data.payment.amount, data.payment.currency)}</strong></div><div><span>核实证据</span><strong>{data.verification?.evidenceRef ?? "匹配场景无需冲突核实"}</strong></div></div></Card>
            <Card><div className="card-heading"><div><span className="overline">Approver decision</span><h2>Ajith 的决策</h2></div><Badge tone={toneFor(data.payment.approvalStatus)}>{show(data.payment.approvalStatus)}</Badge></div><p>批准只会产生审批记录；不会自动把付款标记为银行已完成。</p><div className="button-row"><ActionButton testId="approve-payment" action="APPROVE" label="批准付款" onRun={run} busy={busy} disabled={!canApprove} /><ActionButton action="RETURN" label="退回补充" onRun={run} busy={busy} disabled={!canApprove} kind="secondary" /><ActionButton testId="reject-payment" action="REJECT" label="拒绝付款" onRun={run} busy={busy} disabled={!canApprove} kind="danger" /></div></Card>
          </div>
          {role !== "APPROVER" ? <div className="notice warn"><UserCheck size={18} /><div><strong>请切换到 Ajith · Approver</strong><p>Samuel 无法批准自己制作的付款；直接调用 API 也会被服务端拒绝并记录。</p></div></div> : null}
          <AuditTrail audits={data.audits.filter((entry) => entry.action.includes("APPROV"))} />
        </>}

        {tab === "tracking" && <>
          <SectionTitle kicker="05 · Payment tracking" title="付款追踪" description="模拟银行事件带有唯一 event ID、可信来源和顺序校验。重复事件幂等忽略，乱序事件会被拒绝并记录。" />
          <div className="split">
            <Card><div className="card-heading"><div><span className="overline">Mock Bank API</span><h2>银行状态</h2></div><Badge tone={toneFor(data.payment.bankStatus)}>{show(data.payment.bankStatus)}</Badge></div><div className="field-list"><div><span>付款</span><strong>{data.payment.id}</strong></div><div><span>接口</span><strong>MOCK_BANK_API</strong></div><div><span>数据</span><strong>仅合成事件</strong></div></div><div className="button-row"><ActionButton testId="submit-bank" action="SUBMIT_BANK" label="提交模拟银行" onRun={run} busy={busy} disabled={data.payment.approvalStatus !== "APPROVED" || data.payment.bankStatus !== "NOT_SENT"} /><ActionButton action="BANK_PROCESSING" label="注入 Processing" onRun={run} busy={busy} disabled={data.payment.bankStatus !== "SUBMITTED"} kind="secondary" /><ActionButton testId="bank-delayed" action="BANK_DELAYED" label="注入 EVT-5821 延迟" onRun={run} busy={busy} disabled={!["SUBMITTED", "PROCESSING"].includes(data.payment.bankStatus)} kind="secondary" /><ActionButton testId="bank-completed" action="BANK_COMPLETED" label="注入 EVT-5822 完成" onRun={run} busy={busy} disabled={!["SUBMITTED", "PROCESSING", "DELAYED"].includes(data.payment.bankStatus)} /></div></Card>
            <Card><span className="overline">状态含义</span>{data.payment.bankStatus === "DELAYED" ? <div className="signal warn"><AlertTriangle /><div><strong>银行审核延迟</strong><p>异常任务已创建；人工确认跟进不会直接把付款标记完成。</p></div></div> : data.payment.bankStatus === "COMPLETED" ? <div className="signal good"><CheckCircle2 /><div><strong>模拟银行确认完成</strong><p>付款仅因合法 EVT-5822 更新为 Completed。</p></div></div> : <div className="empty compact"><Clock3 /><h3>等待下一条合法事件</h3><p>每个事件都会经过来源、顺序和重复检查。</p></div>}</Card>
          </div>
          <Card><div className="card-heading"><div><span className="overline">Transaction event stream</span><h2>交易历史</h2></div><Badge>{data.events.length} 条事件</Badge></div><div className="event-table"><div><span>事件</span><span>来源</span><span>说明</span><span>时间</span></div>{data.events.map((event) => <div key={event.eventId}><strong>{event.eventType}</strong><span>{event.source}<br />{event.eventId}</span><p>{event.detail}</p><time>{new Date(event.createdAt).toLocaleString("zh-CN")}</time></div>)}</div></Card>
        </>}

        {tab === "exception" && <>
          <SectionTitle kicker="06 · Exception resolution" title="异常处理" description="模拟 AI 只读取已有上下文并提出建议。授权人员确认跟进后，付款仍等待独立银行完成事件。" />
          {!data.exception ? <Card><div className="empty"><ShieldCheck /><h2>当前没有开放异常</h2><p>可在审批中拒绝付款，或在付款追踪中注入 EVT-5821。</p></div></Card> : <>
            <div className="split">
              <Card><div className="card-heading"><div><span className="overline">Exception case</span><h2>{data.exception.reason}</h2></div><Badge tone={toneFor(data.exception.status)}>{show(data.exception.status)}</Badge></div><div className="field-list"><div><span>付款</span><strong>{data.payment.id}</strong></div><div><span>关联证据</span><strong>发票 · ERP · 核实 · 审批 · 银行事件</strong></div><div><span>银行状态</span><strong>{show(data.payment.bankStatus)}</strong></div></div></Card>
              <Card className="assist-card"><div className="assist-icon"><Sparkles /></div><span className="overline">模拟 AI · {data.aiRecommendation?.provider ?? "尚未运行"}</span><h2>{data.aiRecommendation?.summary ?? data.exception.evidenceSummary ?? "等待调查"}</h2><p>{data.aiRecommendation?.suggestedAction ?? "运行调查以生成基于当前上下文的确定性建议。"}</p><small>simulation=true · 不审批、不执行、不改账号</small></Card>
            </div>
            {data.aiRecommendation ? <Card><span className="overline">Evidence-grounded findings</span><h2>发现与引用</h2><ul className="check-list">{data.aiRecommendation.findings.map((finding) => <li key={finding}><Check />{finding}</li>)}</ul><div className="evidence-chips">{data.aiRecommendation.evidenceRefs.map((reference) => <code key={reference}>{reference}</code>)}</div><div className="notice warn"><AlertTriangle size={18} /><div><strong>不确定性</strong><p>{data.aiRecommendation.uncertainty}</p></div></div></Card> : null}
            <Card><div className="card-heading"><div><span className="overline">Human-controlled follow-up</span><h2>人工跟进</h2></div><Badge tone="info">不会改变银行状态</Badge></div><div className="button-row"><ActionButton testId="investigate-exception" action="INVESTIGATE" label="生成模拟 AI 建议" onRun={run} busy={busy} disabled={Boolean(data.aiRecommendation) || data.payment.exceptionStatus === "RESOLVED"} /></div><div className="form-grid inline"><label>跟进动作<input data-testid="followup-action" value={followUp.action} onChange={(event) => setFollowUp({ ...followUp, action: event.target.value })} placeholder="例如：已用登记电话联系供应商" /></label><label>证据引用<input data-testid="followup-evidence" value={followUp.evidenceRef} onChange={(event) => setFollowUp({ ...followUp, evidenceRef: event.target.value })} placeholder="例如：FOLLOWUP-0482" /></label></div><div className="button-row"><button data-testid="confirm-followup" className="button secondary" disabled={!data.aiRecommendation || data.payment.exceptionStatus === "FOLLOW_UP_CONFIRMED" || busy !== null} onClick={() => run("CONFIRM_FOLLOW_UP", { followUp })}>确认跟进但保持 Delayed</button></div></Card>
          </>}
        </>}

        {tab === "audit" && <><SectionTitle kicker="07 · Explainability & audit" title="审计记录" description="每次接受、拒绝或幂等忽略都会记录角色、来源、前后状态、结果和证据引用。" /><AuditTrail audits={data.audits} /></>}

        {tab === "demo" && <>
          <SectionTitle kicker="Simulated operations only" title="演示控制台" description="此区域与业务操作分离。重置只影响当前浏览器的演示会话，不会影响其他访客。" />
          <div className="notice warn"><AlertTriangle size={18} /><div><strong>模拟管理员工具</strong><p>这些按钮加载合成场景，不能代表真实银行操作、身份认证或生产权限。</p></div></div>
          <div className="scenario-grid">
            {[
              ["normal", "正常账户匹配", "发票与 ERP 都为 8821"],
              ["mismatch", "账户不一致", "发票 8821 / ERP 8812"],
              ["rejected", "审批拒绝", "Ajith 已拒绝，禁止提交银行"],
              ["delayed", "银行延迟", "已加载 EVT-5821 与开放异常"],
              ["completed", "银行完成", "由独立完成事件驱动的最终状态"],
            ].map(([scenario, title, description]) => <Card key={scenario}><span className="overline">{scenario}</span><h2>{title}</h2><p>{description}</p><button data-testid={`scenario-${scenario}`} className="button secondary" disabled={busy !== null} onClick={() => run("RESET_SCENARIO", { scenario })}><RefreshCcw size={15} />加载场景</button></Card>)}
          </div>
          <Card><div className="field-list"><div><span>当前浏览器会话</span><strong>{data.session}</strong></div><div><span>持久化</span><strong>Cloudflare D1 · session-isolated</strong></div><div><span>数据边界</span><strong>仅合成数据</strong></div></div></Card>
        </>}

        <footer><span>CrossBorder Flow AI · 独立作品集技术 PoC</span><span>不隶属于任何银行，也未连接真实银行或 ERP 生产系统</span></footer>
      </main>
    </div>
  );
}
