// src/pages/TodayPage.tsx

import { useEffect, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { getDay } from '../db/records'
import { getLocalDateKey } from '../utils/dateUtils'
import type { DailyRecord, ObservationPhase, ObservationStatus } from '../types'

function phaseStatus(record: DailyRecord | undefined, phase: ObservationPhase): ObservationStatus {
  if (!record) return 'not_started'
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

function phaseCompleted(record: DailyRecord | undefined, phase: ObservationPhase) {
  return phaseStatus(record, phase) === 'recorded'
}

function phaseStarted(record: DailyRecord | undefined, phase: ObservationPhase) {
  const status = phaseStatus(record, phase)
  return status === 'draft' || status === 'recorded' || status === 'opted_out'
}

function phaseText(record: DailyRecord | undefined, phase: ObservationPhase) {
  const status = phaseStatus(record, phase)
  if (status === 'recorded') return '已完成'
  if (status === 'draft') return '进行中'
  if (status === 'opted_out') return '主动不记录'
  return '尚未记录'
}

function phaseButtonText(record: DailyRecord | undefined, phase: ObservationPhase) {
  const status = phaseStatus(record, phase)
  if (status === 'recorded') return phase === 'morning' ? '修改早晨观察' : '修改今晚总结'
  if (status === 'draft') return phase === 'morning' ? '继续早晨观察' : '继续今晚总结'
  if (status === 'opted_out') return phase === 'morning' ? '改为记录早晨状态' : '改为记录今晚总结'
  return phase === 'morning' ? '记录早晨状态' : '记录今晚总结'
}

export function TodayPage() {
  const [record, setRecord] = useState<DailyRecord | undefined>(undefined)

  useEffect(() => {
    let mounted = true
    void getDay(getLocalDateKey()).then(next => {
      if (mounted) setRecord(next)
    }).catch(() => {
      if (mounted) setRecord(undefined)
    })
    return () => { mounted = false }
  }, [])

  const morningStatus = phaseStatus(record, 'morning')
  const eveningStatus = phaseStatus(record, 'evening')
  const morningDone = morningStatus === 'recorded'
  const eveningDone = eveningStatus === 'recorded'
  const morningStarted = morningStatus === 'draft'
  const eveningStarted = eveningStatus === 'draft'

  return (
    <div className="page shell">
      <header className="brand">私人观察台</header>

      <section className="hero">
        <p className="date">今天</p>
        <h1>一天两次，观察自己。</h1>
        <p>早晨记昨夜与晨起；晚上回看今天。两次观察仍然属于同一天。</p>

        <section
          aria-label="今日观察状态"
          style={{
            marginTop: 22,
            borderTop: '1px solid var(--line)',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '15px 2px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <strong style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>早晨观察</strong>
              <span style={{ display: 'block', marginTop: 4, color: 'var(--muted)', fontSize: 11 }}>昨夜睡眠 · 晨起状态</span>
            </div>
            <span style={{ alignSelf: 'center', color: morningDone ? 'var(--olive)' : 'var(--muted)', fontSize: 11 }}>
              {phaseText(record, 'morning')}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '15px 2px' }}>
            <div>
              <strong style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>晚间总结</strong>
              <span style={{ display: 'block', marginTop: 4, color: 'var(--muted)', fontSize: 11 }}>今天的情绪 · 身体 · 生活</span>
            </div>
            <span style={{ alignSelf: 'center', color: eveningDone ? 'var(--olive)' : 'var(--muted)', fontSize: 11 }}>
              {phaseText(record, 'evening')}
            </span>
          </div>
        </section>

        <div className="stack" style={{ marginTop: 20 }}>
          <a className="primary link-button" href="#/record?phase=morning">
            {phaseButtonText(record, 'morning')}
          </a>
          <a className="quiet link-button" href="#/record?phase=evening">
            {phaseButtonText(record, 'evening')}
          </a>
        </div>

        {!morningDone || !eveningDone ? (
          <p className="hero-note">
            {morningDone && !eveningDone
              ? '早晨已经留下来了。晚上回来，把今天补完整。'
              : !morningDone && eveningDone
                ? '今晚已经留下来了。早晨部分也可以之后补记。'
                : morningStarted || eveningStarted
                  ? '记录到哪里算哪里，之后可以继续，也可以回来修改。'
                  : '不用一次写完。缺席、补记和修改都会保留下来。'}
          </p>
        ) : (
          <p className="hero-note">今天的两次观察都已经留下。之后仍然可以回来修改。</p>
        )}
      </section>

      <BottomNav current="/" />
    </div>
  )
}
