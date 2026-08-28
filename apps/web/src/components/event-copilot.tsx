"use client";

import { ArrowRight, PaperPlaneTilt, ShieldCheck } from "@phosphor-icons/react";
import { FormEvent, useState } from "react";

import type { components } from "@/lib/api-schema";
import { EventAIClientError, askEventQuestion } from "@/lib/event-ai-client";
import { answerEventQuestion, writebackPreviewSteps } from "@/lib/event-copilot";
import { readSession, useAuthSession } from "@/lib/auth-store";
import { formatFaultCandidate, localizeIndustrialCopy } from "@/lib/presentation";

type EventDetail = components["schemas"]["EventDetail"];
type AIAnswer = components["schemas"]["AIAnswer"];

type Conversation = {
  question: string;
  answer: AIAnswer;
  local: boolean;
};

const quickQuestions = [
  "为什么不是传感器故障？",
  "如果先不处理会怎样？",
  "把检查顺序改成 10 分钟内能执行的",
];

export function EventCopilot({ event }: { event: EventDetail }) {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryQuestion, setRetryQuestion] = useState("");
  const [draft, setDraft] = useState(localizeIndustrialCopy(event.recommendation.actions[0] ?? "保持当前控制策略并提高监视频率"));
  const [previewed, setPreviewed] = useState(false);
  const session = useAuthSession();
  const activeSession = session ?? readSession();
  const topCandidate = event.candidates[0] ? formatFaultCandidate(event.candidates[0]).label : "候选尚未收敛";

  async function ask(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || loading) return;
    setQuestion("");
    setRetryQuestion(trimmed);
    setConversation(null);
    setError(null);
    setLoading(true);
    if (!activeSession) {
      setConversation({
        question: trimmed,
        answer: localTemplateAnswer(event, trimmed),
        local: true,
      });
      setLoading(false);
      return;
    }
    try {
      const answer = await askEventQuestion(event.id, trimmed);
      setConversation({ question: trimmed, answer, local: false });
    } catch (requestError) {
      setError(
        requestError instanceof EventAIClientError && requestError.status === 401
          ? "请先登录后使用在线 AI。"
          : "在线 AI 请求失败，请重试。",
      );
    } finally {
      setLoading(false);
    }
  }

  function submitQuestion(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    ask(question);
  }

  return (
    <section className="ai-panel event-copilot" aria-labelledby="event-copilot-title">
      <div className="ai-section-header">
        <div><span className="kicker">人机协同</span><h2 id="event-copilot-title">与序安协同研判</h2></div>
        <span className="copilot-live"><span aria-hidden="true" />事件证据已装载</span>
      </div>

      <div className="copilot-opening">
        <BrainMessage />
        <p><strong>序安</strong><span>我已锁定异常窗口。当前首要假设是“{topCandidate}”，你可以继续追问原因、风险或现场检查顺序。</span></p>
      </div>

      {!activeSession ? <p className="copilot-auth-notice" role="status">未登录：请先登录后使用在线 AI，当前为本地模板演示。</p> : null}

      <div className="copilot-quick-questions" aria-label="快捷追问">
        {quickQuestions.map((item) => <button type="button" key={item} onClick={() => void ask(item)} disabled={loading}>{item}</button>)}
      </div>

      {conversation ? <div className="copilot-conversation" aria-live="polite">
        <p className="operator-message"><strong>操作员</strong><span>{conversation.question}</span></p>
        <p className="assistant-message"><strong>序安</strong><span>{conversation.answer.answer}</span></p>
        <AnswerMetadata answer={conversation.answer} local={conversation.local} />
      </div> : null}

      {loading ? <p className="copilot-request-status" role="status">正在请求在线 AI…</p> : null}
      {error ? <div className="copilot-request-error" role="alert"><span>{error}</span><button type="button" onClick={() => void ask(retryQuestion)} disabled={loading || !retryQuestion}>重试</button></div> : null}

      <form className="copilot-question-form" onSubmit={submitQuestion}>
        <label htmlFor="copilot-question">向序安追问</label>
        <div><input id="copilot-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：为什么不是传感器故障？" disabled={loading} /><button type="submit" aria-label="发送问题" disabled={!question.trim() || loading}><PaperPlaneTilt weight="fill" aria-hidden="true" /></button></div>
      </form>

      <div className="writeback-preview">
        <div className="writeback-heading"><div><ShieldCheck aria-hidden="true" /><div><strong>受控写回预演</strong><span>查看生产版如何把建议安全送到 PLC/DCS</span></div></div><span className="demo-only-tag">仅预演</span></div>
        <label htmlFor="writeback-draft">拟议处置动作</label>
        <textarea id="writeback-draft" value={draft} onChange={(event) => { setDraft(event.target.value); setPreviewed(false); }} />
        <ol aria-label="生产版待执行流程">{writebackPreviewSteps.map((step, index) => <li key={step}><span className="pending-step-number" aria-hidden="true">{index + 1}</span>{step}</li>)}</ol>
        <button className="secondary-button" type="button" onClick={() => setPreviewed(true)} disabled={!draft.trim()}>预演写回 <ArrowRight aria-hidden="true" /></button>
        {previewed ? <div className="writeback-result" role="status"><ShieldCheck weight="fill" aria-hidden="true" /><p><strong>草案已生成，未校验、未发送</strong><span>当前 Demo 不连接 PLC/DCS，也没有执行权限、上下限或联锁校验。以上是生产版待执行流程示意。</span></p></div> : null}
      </div>
    </section>
  );
}

function localTemplateAnswer(event: EventDetail, question: string): AIAnswer {
  return {
    answer: answerEventQuestion(event, question),
    mode: "template",
    model: "local-template-v0.1",
    evidenceRefs: event.evidence.map((item) => item.variableId),
    latencyMs: 0,
    traceId: "local-template",
  };
}

function AnswerMetadata({ answer, local }: { answer: AIAnswer; local: boolean }) {
  const mode = local ? "本地模板" : answer.mode === "llm_enhanced" ? "在线 AI" : "模板降级";
  return <div className="copilot-answer-meta"><span>{mode}</span><span>模型：{answer.model}</span><span>证据：{answer.evidenceRefs.join("、") || "未返回"}</span><span>Trace：{answer.traceId}</span></div>;
}

function BrainMessage() {
  return <span className="copilot-avatar" aria-hidden="true">安</span>;
}
