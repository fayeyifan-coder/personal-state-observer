import { useEffect, useMemo, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { listDays } from '../db/records'
import type { DailyRecord } from '../types'
import { getLocalDateKey, parseDateKey } from '../utils/dateUtils'

type ViewMode = 'month' | 'year'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function monthBounds(key: string) {
  const [year, month] = key.split('-').map(Number)
  return {
    start: `${year}-${pad(month)}-01`,
    end: getLocalDateKey(new Date(year, month, 0)),
  }
}

function shiftMonth(key: string, delta: number) {
  const [year, month] = key.split('-').map(Number)
  return monthKey(new Date(year, month - 1 + delta, 1))
}

function formatMonth(key: string) {
  const [year, month] = key.split('-')
  return `${year} 年 ${Number(month)} 月`
}

function formatDay(dateKey: string) {
  const date = parseDateKey(dateKey)
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

function getNumber(record: DailyRecord | undefined, field: string) {
  const value = record?.answers[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function average(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value != null)
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null
}

function statusSymbol(status: DailyRecord['recordingStatus']) {
  if (status === 'recorded') return '●'
  if (status === 'opted_out') return '○'
  return '◐'
}

function statusLabel(status: DailyRecord['recordingStatus']) {
  if (status === 'recorded') return '已记录'
  if (status === 'opted_out') return '主动不记录'
  return '未完成'
}

function monthRecordsForYear(records: DailyRecord[], year: number, month: number) {
  return records.filter(record => {
    const [recordYear, recordMonth] = record.recordDate.split('-').map(Number)
    return recordYear === year && recordMonth === month
  })
}

export function TimelinePage() {
  const [mode, setMode] = useState<ViewMode>('month')
  const [month, setMonth] = useState(monthKey(parseDateKey(getLocalDateKey())))
  const [records, setRecords] = useState<DailyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const year = Number(month.slice(0, 4))

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError('')

    const load = async () => {
      try {
        const bounds = mode === 'month'
          ? monthBounds(month)
          : { start: `${year}-01-01`, end: `${year}-12-31` }
        const next = await listDays(bounds.start, bounds.end)
        if (mounted) setRecords(next)
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause.message : '时间线暂时无法加载。')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void load()
    return () => { mounted = false }
  }, [mode, month, year])

  const recordMap = useMemo(
    () => new Map(records.map(record => [record.recordDate, record])),
    [records],
  )

  const monthDays = useMemo(() => {
    const [targetYear, targetMonth] = month.split('-').map(Number)
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
    return Array.from({ length: daysInMonth }, (_, index) => `${month}-${pad(index + 1)}`)
  }, [month])

  const monthStats = useMemo(() => ({
    recorded: records.filter(record => record.recordingStatus === 'recorded').length,
    optedOut: records.filter(record => record.recordingStatus === 'opted_out').length,
    drafts: records.filter(record => record.recordingStatus === 'draft').length,
    mood: average(records.map(record => getNumber(record, 'mood'))),
    sleep: average(records.map(record => getNumber(record, 'sleepDurationMin'))),
  }), [records])

  const yearMonths = useMemo(
    () => Array.from({ length: 12 }, (_, index) => {
      const monthRecords = monthRecordsForYear(records, year, index + 1)
      const moods = monthRecords.map(record => getNumber(record, 'mood'))
      const sleeps = monthRecords.map(record => getNumber(record, 'sleepDurationMin'))
      return {
        month: index + 1,
        active: monthRecords.length,
        recorded: monthRecords.filter(record => record.recordingStatus === 'recorded').length,
        mood: average(moods),
        sleep: average(sleeps),
      }
    }),
    [records, year],
  )

  const leadingEmptyDays = mode === 'month'
    ? ((parseDateKey(monthDays[0]).getDay() + 6) % 7)
    : 0

  return (
    <div className="page shell timeline-page">
      <header className="archive-header">
        <div>
          <p className="eyebrow">私人观察台</p>
          <h1>时间线</h1>
        </div>
        <div className="view-switch" role="tablist" aria-label="时间线视图">
          <button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>月</button>
          <button className={mode === 'year' ? 'active' : ''} onClick={() => setMode('year')}>年</button>
        </div>
      </header>

      {loading ? (
        <section className="empty-state"><p>读取本机记录……</p></section>
      ) : error ? (
        <section className="empty-state"><h2>时间线暂时无法加载。</h2><p>{error}</p></section>
      ) : mode === 'month' ? (
        <>
          <section className="timeline-toolbar">
            <button className="icon-plain" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上个月">‹</button>
            <strong>{formatMonth(month)}</strong>
            <button className="icon-plain" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下个月">›</button>
          </section>

          <section className="timeline-stats">
            <div><strong>{monthStats.recorded}</strong><span>完成记录</span></div>
            <div><strong>{monthStats.optedOut}</strong><span>主动不记录</span></div>
            <div><strong>{monthStats.mood == null ? '—' : monthStats.mood.toFixed(1)}</strong><span>平均心情</span></div>
            <div><strong>{monthStats.sleep == null ? '—' : `${(monthStats.sleep / 60).toFixed(1)}h`}</strong><span>平均睡眠</span></div>
          </section>

          <section className="calendar-card" aria-label={formatMonth(month)}>
            <div className="calendar-weekdays">
              {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-grid">
              {Array.from({ length: leadingEmptyDays }).map((_, index) => (
                <span className="calendar-empty" key={`empty-${index}`} />
              ))}
              {monthDays.map(day => {
                const record = recordMap.get(day)
                const mood = getNumber(record, 'mood')
                const isToday = day === getLocalDateKey()
                return (
                  <div className={`calendar-day ${record ? 'has-record' : ''} ${isToday ? 'is-today' : ''}`} key={day}>
                    <span className="calendar-date">{Number(day.slice(-2))}</span>
                    <span className={record ? `calendar-mark status-${record.recordingStatus}` : 'calendar-mark'}>
                      {record ? statusSymbol(record.recordingStatus) : '·'}
                    </span>
                    <span className="calendar-mood">{mood == null ? ' ' : mood}</span>
                  </div>
                )
              })}
            </div>
            <div className="timeline-legend">
              <span><b>●</b> 已完成</span>
              <span><b>◐</b> 未完成</span>
              <span><b>○</b> 主动不记录</span>
            </div>
          </section>

          {records.length ? (
            <section className="timeline-list">
              <div className="section-heading"><span>这个月留下的日子</span><span>{records.length} 天</span></div>
              {[...records].sort((a, b) => b.recordDate.localeCompare(a.recordDate)).map(record => {
                const mood = getNumber(record, 'mood')
                const sleep = getNumber(record, 'sleepDurationMin')
                return (
                  <article className="timeline-entry" key={record.id}>
                    <div className="timeline-entry-date">
                      <span className={`entry-status status-${record.recordingStatus}`}>{statusSymbol(record.recordingStatus)}</span>
                      <strong>{formatDay(record.recordDate)}</strong>
                    </div>
                    <div className="timeline-entry-data">
                      <span>心情 {mood == null ? '—' : mood}</span>
                      <span>睡眠 {sleep == null ? '—' : `${(sleep / 60).toFixed(1)}h`}</span>
                      <span>{statusLabel(record.recordingStatus)}</span>
                    </div>
                  </article>
                )
              })}
            </section>
          ) : (
            <section className="timeline-empty">
              <span className="empty-mark">—</span>
              <h2>这里还没有留下记录。</h2>
              <p>开始记录后，这里会慢慢长出你的时间轴。</p>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="timeline-toolbar">
            <button className="icon-plain" onClick={() => setMonth(`${year - 1}-${month.slice(5)}`)} aria-label="上一年">‹</button>
            <strong>{year} 年</strong>
            <button className="icon-plain" onClick={() => setMonth(`${year + 1}-${month.slice(5)}`)} aria-label="下一年">›</button>
          </section>
          <section className="year-overview">
            {yearMonths.map(item => (
              <button className="year-month" key={item.month} onClick={() => { setMonth(`${year}-${pad(item.month)}`); setMode('month') }}>
                <div className="year-month-top"><strong>{item.month}月</strong><span>{item.active ? `${item.active} 条` : '—'}</span></div>
                <div className="year-line"><span style={{ width: `${Math.min(100, (item.active / 31) * 100)}%` }} /></div>
                <div className="year-month-meta">
                  <span>心情 {item.mood == null ? '—' : item.mood.toFixed(1)}</span>
                  <span>睡眠 {item.sleep == null ? '—' : `${(item.sleep / 60).toFixed(1)}h`}</span>
                  <span>完成 {item.recorded}</span>
                </div>
              </button>
            ))}
          </section>
        </>
      )}

      <BottomNav current="/timeline" />
    </div>
  )
}
