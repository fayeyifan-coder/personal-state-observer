import { useEffect, useMemo, useState } from 'react'
import { QuestionCard } from '../components/QuestionCard'
import { createDailyRecord } from '../app/createDailyRecord'
import { getDay, saveDay } from '../db/records'
import { getField, getNextQuestion, getPreviousQuestion } from '../logic/questionEngine'
import { getLocalDateKey } from '../utils/dateUtils'
import type { DailyRecord } from '../types'

function today() {
  return getLocalDateKey()
}

export function RecordPage() {
  const [record, setRecord] = useState<DailyRecord>(() => createDailyRecord(today()))
  const [loading, setLoading] = useState<boolean>(true)
  const [questionId, setQuestionId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    void getDay(today()).then(existing => {
      if (!isMounted) return

      if (existing) {
        setRecord(existing)
        if (existing.lastQuestionId) {
          setQuestionId(existing.lastQuestionId)
        }
      }

      setLoading(false)
    }).catch(() => {
      if (isMounted) setLoading(false)
    })

    return () => {
      isMounted = false
    }
  }, [])

  const question = useMemo(() => {
    if (loading) return null
    return getNextQuestion(record.answers, questionId)
  }, [loading, record.answers, questionId])

  async function persist(next: DailyRecord) {
    setRecord(next)
    await saveDay(next)
  }

  async function answer(value: unknown) {
    if (!question) return

    const answers = {
      ...record.answers,
      [getField(question.id)]: value
    }

    const next = {
      ...record,
      answers,
      lastQuestionId: question.id,
      updatedAt: new Date().toISOString()
    }

    await persist(next)
    setQuestionId(question.id)
  }

  if (loading) {
    return (
      <div className="page shell" aria-busy="true">
        <section className="empty-state">
          <p>加载中...</p>
        </section>
      </div>
    )
  }

  if (!question) {
    return (
      <div className="page shell">
        <section className="empty-state">
          <h1>今日记录完成。</h1>
          <a className="primary link-button" href="#/">回到今天</a>
        </section>
      </div>
    )
  }

  return (
    <div className="record-shell">
      <header className="record-top">
        <a href="#/" aria-label="返回今天">×</a>
        <span>{question.phase}</span>
        <span>私人观察台</span>
      </header>
      <QuestionCard
        key={question.id}
        title={String(question.text ?? '')}
        helper={question.helper ? String(question.helper) : undefined}
        type={(question.type as 'choice'|'multiChoice'|'text') ?? 'choice'}
        options={question.options as any}
        value={record.answers[getField(question.id)] ?? null}
        onSubmit={answer}
        onBack={
          getPreviousQuestion(record.answers, question.id)
            ? () => setQuestionId(getPreviousQuestion(record.answers, question.id)?.id ?? null)
            : undefined
        }
        onSkip={() => setQuestionId(getNextQuestion(record.answers, question.id)?.id ?? null)}
      />
    </div>
  )
}
