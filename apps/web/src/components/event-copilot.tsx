"use client";

import { ArrowRight, PaperPlaneTilt, ShieldCheck } from "@phosphor-icons/react";
import { FormEvent, useState } from "react";

import type { components } from "@/lib/api-schema";
import { answerEventQuestion, writebackPreviewSteps } from "@/lib/event-copilot";
import { formatFaultCandidate, localizeIndustrialCopy } from "@/lib/presentation";

type EventDetail = components["schemas"]["EventDetail"];

const quickQuestions = [
  "为什么不是传感器故障？",
  "如果先不处理会怎样？",
  "把检查顺序改成 10 分钟内能执行的",
];

export function EventCopilot({ event }: { event: EventDetail }) {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<{ question: string; answer: string } | null>(null);
  const [draft, setDraft] = useState(localizeIndustrialCopy(event.recommendation.actions[0] ?? "保持当前控制策略并提高监视频率"));
  const [previewed, setPreviewed] = useState(false);
  const topCandidate = event.candidates[0] ? formatFaultCandidate(event.candidates[0]).label : "候选尚未收敛";

  function ask(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed) return;
    setConversation({ question: trimmed, answer: answerEventQuestion(event, trimmed) });
    setQuestion("");
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

      <div className="copilot-quick-questions" aria-label="快捷追问">
        {quickQuestions.map((item) => <button type="button" key={item} onClick={() => ask(item)}>{item}</button>)}
      </div>

      {conversation ? <div className="copilot-conversation" aria-live="polite">
        <p className="operator-message"><strong>操作员</strong><span>{conversation.question}</span></p>
        <p className="assistant-message"><strong>序安</strong><span>{conversation.answer}</span></p>
      </div> : null}

      <form className="copilot-question-form" onSubmit={submitQuestion}>
        <label htmlFor="copilot-question">向序安追问</label>
        <div><input id="copilot-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：为什么不是传感器故障？" /><button type="submit" aria-label="发送问题" disabled={!question.trim()}><PaperPlaneTilt weight="fill" aria-hidden="true" /></button></div>
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

function BrainMessage() {
  return <span className="copilot-avatar" aria-hidden="true">安</span>;
}
