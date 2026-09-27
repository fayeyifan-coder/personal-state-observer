import { useEffect, useMemo, useState } from 'react'
import { QuestionCard } from '../components/QuestionCard'
import { createDailyRecord } from '../app/createDailyRecord'
import { getDay, saveDay } from '../db/records'
import { getField, getNextQuestion, getPreviousQuestion, isVisible } from '../logic/questionEngine'
import type { DailyRecord } from '../types'

function today() { return new Date().toISOString().slice(0, 10) }

export function RecordPage() {
  const [record, setRecord] = useState<DailyRecord>(() => createDailyRecord(today()))
  const [questionId, setQuestionId] = useState<string | null>(null)

  useEffect(() => { 
    void getDay(today()).then(existing => { 
      if (existing) {
        setRecord(existing)
        // 从数据库读取时，如果已有进度，自动恢复到上次答题位置
        if (existing.lastQuestionId) {
          setQuestionId(existing.lastQuestionId)
        }
      } 
    }) 
  }, [])

  const question = useMemo(() => getNextQuestion(record.answers, questionId), [record.answers, questionId])

  // 【修复核心】：彻底删除了导致无限闪烁死循环的 rogue useEffect

  async function persist(next: DailyRecord) { setRecord(next); await saveDay(next) }

  async function answer(value: unknown) {
    if (!question) return
    const answers = { ...record.answers, [getField(question.id)]: value }
    const next = { ...record, answers, lastQuestionId: question.id, updatedAt: new Date().toISOString() }
    await persist(next)
    setQuestionId(question.id)
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