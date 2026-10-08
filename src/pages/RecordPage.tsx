// src/pages/RecordPage.tsx

import { useEffect, useMemo, useState } from 'react'
import { QuestionCard } from '../components/QuestionCard'
import { createDailyRecord } from '../app/createDailyRecord'
import { getDay, saveDay } from '../db/records'
import {
  getField,
  getFirstQuestion,
  getVisibleQuestions,
  getNextQuestion,
  getPreviousQuestion,
  sanitizeAnswers,
} from '../logic/questionEngine'
import { getLocalDateKey } from '../utils/dateUtils'
import type { AnswerValue, DailyRecord, ObservationPhase, ObservationStatus } from '../types'

function today() {
  return getLocalDateKey()
}

function parseRoute() {
  const hash = window.location.hash
  const queryIndex = hash.indexOf('?')
  const params = queryIndex >= 0
    ? new URLSearchParams(hash.slice(queryIndex + 1))
    : new URLSearchParams()

  const date = params.get('date')
  const phase: ObservationPhase = params.get('phase') === 'evening' ? 'evening' : 'morning'
  const editing = params.get('edit') === '1'

  return {
    recordDate: /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date! : today(),
    phase,
    editing,
  }
}

function phaseLabel(phase: ObservationPhase) {
  return phase === 'morning' ? '早晨观察' : '晚间总结'
}

function phaseStatus(record: DailyRecord, phase: ObservationPhase): ObservationStatus {
  const stored = phase === 'morning' ? record.morningStatus : record.eveningStatus
  if (stored) return stored
  if (phase === 'morning') {
    if (record.morningCompletedAt) return 'recorded'
    if (record.morningStartedAt) return 'draft'
  } else {
    if (record.eveningCompletedAt) return 'recorded'
    if (record.eveningStartedAt) return 'draft'
  }
  return 'not_started'
}

function phaseStartedAt(record: DailyRecord, phase: ObservationPhase) {
  return phase === 'morning' ? record.morningStartedAt ?? null : record.eveningStartedAt ?? null
}

function phaseCompletedAt(record: DailyRecord, phase: ObservationPhase) {
  return phase === 'morning' ? record.morningCompletedAt ?? null : record.eveningCompletedAt ?? null
}

function phaseOptedOutAt(record: DailyRecord, phase: ObservationPhase) {
  return phase === 'morning' ? record.morningOptedOutAt ?? null : record.eveningOptedOutAt ?? null
}

function phaseLastQuestionId(record: DailyRecord, phase: ObservationPhase) {
  return phase === 'morning'
    ? record.morningLastQuestionId ?? null
    : record.eveningLastQuestionId ?? null
}

function withPhaseFields(
  record: DailyRecord,
  phase: ObservationPhase,
  values: {
    status?: ObservationStatus
    startedAt?: string | null
    completedAt?: string | null
    optedOutAt?: string | null
    lastQuestionId?: string | null
  },
): DailyRecord {
  if (phase === 'morning') {
    return {
      ...record,
      morningStatus: values.status !== undefined ? values.status : phaseStatus(record, phase),
      morningStartedAt: values.startedAt !== undefined ? values.startedAt : record.morningStartedAt ?? null,
      morningCompletedAt: values.completedAt !== undefined ? values.completedAt : record.morningCompletedAt ?? null,
      morningOptedOutAt: values.optedOutAt !== undefined ? values.optedOutAt : record.morningOptedOutAt ?? null,
      morningLastQuestionId: values.lastQuestionId !== undefined ? values.lastQuestionId : record.morningLastQuestionId ?? null,
    }
  }

  return {
    ...record,
    eveningStatus: values.status !== undefined ? values.status : phaseStatus(record, phase),
    eveningStartedAt: values.startedAt !== undefined ? values.startedAt : record.eveningStartedAt ?? null,
    eveningCompletedAt: values.completedAt !== undefined ? values.completedAt : record.eveningCompletedAt ?? null,
    eveningOptedOutAt: values.optedOutAt !== undefined ? values.optedOutAt : record.eveningOptedOutAt ?? null,
    eveningLastQuestionId: values.lastQuestionId !== undefined ? values.lastQuestionId : record.eveningLastQuestionId ?? null,
  }
}

function refreshOverallStatus(record: DailyRecord): DailyRecord {
  const morning = phaseStatus(record, 'morning')
  const evening = phaseStatus(record, 'evening')
  const statuses = [morning, evening]

  let recordingStatus: DailyRecord['recordingStatus'] = 'draft'
  if (statuses.every(status => status === 'opted_out')) recordingStatus = 'opted_out'
  else if (statuses.some(status => status === 'recorded')) recordingStatus = 'recorded'

  const latestCompleted = [record.morningCompletedAt, record.eveningCompletedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null

  return {
    ...record,
    recordingStatus,
    completedAt: latestCompleted,
    currentPhase: morning === 'recorded' && evening === 'recorded' ? null : record.currentPhase,
  }
}

export function RecordPage() {
  const route = useMemo(parseRoute, [])
  const [record, setRecord] = useState<DailyRecord>(() => createDailyRecord(route.recordDate))
  const [loading, setLoading] = useState(true)
  const [questionId, setQuestionId] = useState<string | null>(null)
  const [editing, setEditing] = useState(route.editing)

  useEffect(() => {
    let mounted = true

    void getDay(route.recordDate)
      .then(existing => {
        if (!mounted) return

        const nextRecord = existing ?? createDailyRecord(route.recordDate)
        setRecord(nextRecord)

        const status = phaseStatus(nextRecord, route.phase)
        setEditing(route.editing || (status !== 'recorded' && status !== 'opted_out'))

        const last = phaseLastQuestionId(nextRecord, route.phase)
        setQuestionId(last ?? getFirstQuestion(nextRecord.answers, route.phase)?.id ?? null)
        setLoading(false)
      })
      .catch(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [route.recordDate, route.phase, route.editing])

  const question = useMemo(() => {
    if (loading || !editing) return null

    const visible = getVisibleQuestions(record.answers, undefined, route.phase)
    return visible.find(item => item.id === questionId) ?? getFirstQuestion(record.answers, route.phase)
  }, [loading, editing, questionId, record.answers, route.phase])

  async function persist(next: DailyRecord) {
    const normalized = refreshOverallStatus(next)
    setRecord(normalized)
    await saveDay(normalized)
  }

  async function answer(value: AnswerValue) {
    if (!question) return

    const field = getField(question.id)
    const answers = sanitizeAnswers({
      ...record.answers,
      [field]: value,
    })

    const nextQuestion = getNextQuestion(answers, question.id, route.phase)
    const isLastQuestion = nextQuestion === null
    const now = new Date().toISOString()

    let next: DailyRecord = {
      ...record,
      answers,
      currentPhase: route.phase,
      lastQuestionId: question.id,
      startedAt: record.startedAt ?? now,
      updatedAt: now,
    }

    next = withPhaseFields(next, route.phase, {
      status: isLastQuestion ? 'recorded' : 'draft',
      startedAt: phaseStartedAt(next, route.phase) ?? now,
      completedAt: isLastQuestion ? now : phaseCompletedAt(next, route.phase),
      optedOutAt: isLastQuestion ? null : phaseOptedOutAt(next, route.phase),
      lastQuestionId: question.id,
    })

    await persist(next)

    if (isLastQuestion) {
      setEditing(false)
      return
    }

    setQuestionId(nextQuestion.id)
  }

  async function optOutPhase() {
    const now = new Date().toISOString()
    const next = withPhaseFields({
      ...record,
      currentPhase: route.phase,
      lastQuestionId: phaseLastQuestionId(record, route.phase),
      optedOutAt: record.optedOutAt,
      updatedAt: now,
    }, route.phase, {
      status: 'opted_out',
      startedAt: phaseStartedAt(record, route.phase),
      completedAt: null,
      optedOutAt: now,
    })

    await persist(next)
    setEditing(false)
    setQuestionId(null)
  }

  const previousQuestion = useMemo(() => {
    if (!question) return null
    return getPreviousQuestion(record.answers, question.id, route.phase)
  }, [record.answers, question, route.phase])

  const nextQuestion = useMemo(() => {
    if (!question) return null
    return getNextQuestion(record.answers, question.id, route.phase)
  }, [record.answers, question, route.phase])

  const status = phaseStatus(record, route.phase)
  const completed = status === 'recorded'
  const optedOut = status === 'opted_out'
  const otherPhase: ObservationPhase = route.phase === 'morning' ? 'evening' : 'morning'
  const returnHref = route.recordDate === today() ? '#/' : '#/timeline'

  if (loading) {
    return <div className="page shell" aria-busy="true"><section className="empty-state"><p>加载中...</p></section></div>
  }

  if (!editing && (completed || optedOut)) {
    return (
      <div className="page shell">
        <section className="empty-state">
          <p className="eyebrow">{route.recordDate} · {phaseLabel(route.phase)}</p>
          <h1>{completed ? `${phaseLabel(route.phase)}完成。` : `这次${phaseLabel(route.phase)}主动不记录。`}</h1>
          <p>{completed ? '这条观察已经保存。之后仍然可以回来修改。' : '主动不记录也会作为今天的一部分保留下来。之后仍然可以改为记录。'}</p>
          <div className="stack">
            {completed || optedOut ? (
              <button className="primary" onClick={() => {
                setEditing(true)
                setQuestionId(phaseLastQuestionId(record, route.phase) ?? getFirstQuestion(record.answers, route.phase)?.id ?? null)
              }}>{optedOut ? `改为记录${route.phase === 'morning' ? '早晨状态' : '今晚总结'}` : '修改这次记录'}</button>
            ) : null}
            <a className="quiet link-button" href={`#/record?date=${route.recordDate}&phase=${otherPhase}`}>记录{otherPhase === 'morning' ? '早晨' : '晚上'}</a>
            <a className="quiet link-button" href={returnHref}>返回</a>
          </div>
        </section>
      </div>
    )
  }

  if (!question) {
    return (
      <div className="page shell">
        <section className="empty-state">
          <h1>{phaseLabel(route.phase)}没有待记录的问题。</h1>
          <div className="stack"><a className="primary link-button" href={returnHref}>返回</a></div>
        </section>
      </div>
    )
  }

  const currentValue = (record.answers[getField(question.id)] ?? null) as AnswerValue
  const questionUnit = typeof question.unit === 'string' ? question.unit : undefined
  const questionMaxLength = typeof question.maxLength === 'number' ? question.maxLength : undefined

  return (
    <div className="record-shell">
      <header className="record-top">
        <a href={returnHref} aria-label="返回">×</a>
        <span>{phaseLabel(route.phase)}</span>
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
        onBack={previousQuestion ? () => setQuestionId(previousQuestion.id) : undefined}
        onSkip={() => setQuestionId(nextQuestion?.id ?? null)}
      />

      <div style={{ maxWidth: 680, margin: '18px auto 0' }}>
        <button
          className="quiet link-button"
          type="button"
          onClick={() => {
            if (window.confirm(`确定这次${phaseLabel(route.phase)}主动不记录吗？这会作为一个明确的“未记录”状态保存。`)) {
              void optOutPhase()
            }
          }}
        >
          这次不记录
        </button>
      </div>
    </div>
  )
}
