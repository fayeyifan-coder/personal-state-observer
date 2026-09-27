import { useEffect, useMemo, useState } from 'react'
import { QuestionCard } from '../components/QuestionCard'
import { createDailyRecord } from '../app/createDailyRecord'
import { getDay, saveDay } from '../db/records'
import { getField, getNextQuestion, getPreviousQuestion } from '../logic/questionEngine'
import type { DailyRecord } from '../types'

function today() { return new Date().toISOString().slice(0, 10) }

export function RecordPage() {
  const [record, setRecord] = useState<DailyRecord>(() => createDailyRecord(today()))
  const [loading, setLoading] = useState<boolean>(true) // 引入加载状态锁，防止异步闪烁
  const [questionId, setQuestionId] = useState<string | null>(null)

  useEffect(() => { 
    let isMounted = true;
    void getDay(today()).then(existing => { 
      if (!isMounted) return;
      if (existing) {
        setRecord(existing)
        if (existing.lastQuestionId) {
          setQuestionId(existing.lastQuestionId)
        }
      }
      setLoading(false) // 读取完毕，释放加载锁
    }).catch(() => {
      if (isMounted) setLoading(false)
    })
    return () => { isMounted = false; }
  }, [])

  const question = useMemo(() => {
    if (loading) return null; // 加载未完成时不计算题目
    return getNextQuestion(record.answers, questionId);
  }, [loading, record.answers, questionId])

  async function persist(next: DailyRecord) { 
    setRecord(next); 
    await saveDay(next); 
  }

  async function answer(value: unknown) {
    if (!question) return
    const answers = { ...record.answers, [getField(question.id)]: value }
    const next = { ...record, answers, lastQuestionId: question.id, updatedAt: new Date().toISOString() }
    await persist(next)
    setQuestionId(question.id)
  }

  // 加载中显示平稳的占位，避免画面突变
  if (loading) {
    return (
      <div className="page shell">
        <section className="empty-state">
          <p>加载中...</p>
        </section>
      </div>
    )
  }

  if (!question) return (
    <div className="page shell">
      <section className="empty-state">
        <h1>今日记录完成。</h1>
        <a className="primary link-button" href="#/">回到今天</a>
      </section>
    </div>
  )

  return (
    <div className="record-shell">
      <header className="record-top">
        <a href="#/">×</a>
        <span>{question.phase}</span>
        <span>私人观察台</span>
      </header>
      <QuestionCard 
        title={String(question.text ?? '')} 
        helper={question.helper ? String(question.helper) : undefined} 
        type={(question.type as 'choice'|'multiChoice'|'text') ?? 'choice'} 
        options={question.options as any} 
        value={record.answers[getField(question.id)] ?? null} 
        onSubmit={answer} 
        onBack={getPreviousQuestion(record.answers, question.id) ? () => setQuestionId(getPreviousQuestion(record.answers, question.id)?.id ?? null) : undefined} 
        onSkip={() => setQuestionId(getNextQuestion(record.answers, question.id)?.id ?? null)} 
      />
    </div>
  )
}