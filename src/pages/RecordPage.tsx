// src/pages/RecordPage.tsx

import { useEffect, useMemo, useState } from 'react'
import { QuestionCard } from '../components/QuestionCard'
import { createDailyRecord } from '../app/createDailyRecord'
import { getDay, saveDay } from '../db/records'
import {
  getField,
  getNextQuestion,
  getPreviousQuestion
} from '../logic/questionEngine'
import { getLocalDateKey } from '../utils/dateUtils'
import type { AnswerValue, DailyRecord } from '../types'

function today() {
  return getLocalDateKey()
}

export function RecordPage() {
  const [record, setRecord] = useState<DailyRecord>(() =>
    createDailyRecord(today())
  )

  const [loading, setLoading] = useState<boolean>(true)
  const [questionId, setQuestionId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    void getDay(today())
      .then(existing => {
        if (!isMounted) return

        if (existing) {
          setRecord(existing)

          if (existing.lastQuestionId) {
            setQuestionId(existing.lastQuestionId)
          }
        }

        setLoading(false)
      })
      .catch(() => {
        if (isMounted) {
          setLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  const question = useMemo(() => {
    if (loading) return null

    return getNextQuestion(
      record.answers,
      questionId
    )
  }, [loading, record.answers, questionId])

  async function persist(next: DailyRecord) {
    setRecord(next)
    await saveDay(next)
  }

  async function answer(value: AnswerValue) {
    if (!question) return

    const field = getField(question.id)

    const answers = {
      ...record.answers,
      [field]: value
    }

    const nextQuestion = getNextQuestion(
      answers,
      question.id
    )

    const isLastQuestion = nextQuestion === null
    const now = new Date().toISOString()

    const next: DailyRecord = {
      ...record,
      answers,
      lastQuestionId: question.id,
      recordingStatus: isLastQuestion
        ? 'recorded'
        : record.recordingStatus,
      completedAt: isLastQuestion
        ? now
        : record.completedAt,
      updatedAt: now
    }

    await persist(next)
    setQuestionId(question.id)
  }

  const previousQuestion = useMemo(() => {
    if (!question) return null

    return getPreviousQuestion(
      record.answers,
      question.id
    )
  }, [record.answers, question])

  const nextQuestion = useMemo(() => {
    if (!question) return null

    return getNextQuestion(
      record.answers,
      question.id
    )
  }, [record.answers, question])

  if (loading) {
    return (
      <div
        className="page shell"
        aria-busy="true"
      >
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

          <a
            className="primary link-button"
            href="#/"
          >
            回到今天
          </a>
        </section>
      </div>
    )
  }

  const currentValue =
    (record.answers[getField(question.id)] ??
      null) as AnswerValue

  const questionUnit =
    typeof question.unit === 'string'
      ? question.unit
      : undefined

  const questionMaxLength =
    typeof question.maxLength === 'number'
      ? question.maxLength
      : undefined

  return (
    <div className="record-shell">
      <header className="record-top">
        <a
          href="#/"
          aria-label="返回今天"
        >
          ×
        </a>

        <span>{question.phase}</span>

        <span>私人观察台</span>
      </header>

      <QuestionCard
        key={question.id}
        title={question.text}
        helper={question.helper}
        type={question.type}
        options={question.options}
        value={currentValue}
        unit={questionUnit}
        maxLength={questionMaxLength}
        onSubmit={answer}
        onBack={
          previousQuestion
            ? () => setQuestionId(previousQuestion.id)
            : undefined
        }
        onSkip={() =>
          setQuestionId(
            nextQuestion?.id ?? null
          )
        }
      />
    </div>
  )
}