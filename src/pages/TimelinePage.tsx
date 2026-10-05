import { useEffect, useMemo, useState, type CSSProperties } from 'react'
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

function moodLevel(value: number | null) {
  if (value == null) return 'empty'
  return `level-${Math.max(1, Math.min(5, Math.round(value)))}`
}

function sleepHeight(value: number | null) {
  if (value == null) return 0
  return Math.max(8, Math.min(100, (value / 600) * 100))
}

function monthRecordsForYear(records: DailyRecord[], year: number, month: number) {
  return records.filter(record => {
    const [recordYear, recordMonth] = record.recordDate.split('-').map(Number)
    return recordYear === year && recordMonth === month
  })
}

function daysForMonth(month: string) {
  const [year, targetMonth] = month.split('-').map(Number)
  const total = new Date(year, targetMonth, 0).getDate()
  return Array.from({ length: total }, (_, index) => `${month}-${pad(index + 1)}`)
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

  const monthDays = useMemo(() => daysForMonth(month), [month])

  const monthStats = useMemo(() => {
    const moods = records.map(record => getNumber(record, 'mood'))
    const sleeps = records.map(record => getNumber(record, 'sleepDurationMin'))
    const energies = records.map(record => getNumber(record, 'energy'))

    return {
      active: records.length,
      recorded: records.filter(record => record.recordingStatus === 'recorded').length,
      optedOut: records.filter(record => record.recordingStatus === 'opted_out').length,
      mood: average(moods),
      energy: average(energies),
      sleep: average(sleeps),
      moodDays: moods.filter(value => value != null).length,
      sleepDays: sleeps.filter(value => value != null).length,
    }
  }, [records])

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

  const leadingEmptyDays = (parseDateKey(monthDays[0]).getDay() + 6) % 7

  return (
    <div className="page shell timeline-page">
      <header className="archive-header timeline-header">
        <div>
          <p className="eyebrow">私人观察台 / 状态档案</p>
          <h1>时间线</h1>
        </div>
        <div className="view-switch" role="tablist" aria-label="时间线视图">
          <button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>月</button>
          <button className={mode === 'year' ? 'active' : ''} onClick={() => setMode('year')}>年</button>
        </div>
      </header>

      {loading ? (
        <section className="empty-state"><p>正在读取本机记录……</p></section>
      ) : error ? (
        <section className="empty-state"><h2>时间线暂时无法加载。</h2><p>{error}</p></section>
      ) : mode === 'month' ? (
        <>
          <section className="timeline-toolbar">
            <button className="icon-plain" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上个月">‹</button>
            <div>
              <strong>{formatMonth(month)}</strong>
              <span className="toolbar-subtitle">{monthStats.active ? `${monthStats.active} 天留下记录` : '还没有留下记录'}</span>
            </div>
            <button className="icon-plain" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下个月">›</button>
          </section>

          <section className="timeline-overview">
            <div className="timeline-stat primary-stat">
              <span>完成记录</span>
              <strong>{monthStats.recorded}</strong>
              <small>／ {monthStats.active || monthDays.length} 天</small>
            </div>
            <div className="timeline-stat">
              <span>平均心情</span>
              <strong>{monthStats.mood == null ? '—' : monthStats.mood.toFixed(1)}</strong>
              <small>{monthStats.moodDays ? `${monthStats.moodDays} 天有记录` : '暂无数值'}</small>
            </div>
            <div className="timeline-stat">
              <span>平均睡眠</span>
              <strong>{monthStats.sleep == null ? '—' : `${(monthStats.sleep / 60).toFixed(1)}h`}</strong>
              <small>{monthStats.sleepDays ? `${monthStats.sleepDays} 天有记录` : '暂无数值'}</small>
            </div>
            <div className="timeline-stat">
              <span>主动不记录</span>
              <strong>{monthStats.optedOut}</strong>
              <small>也属于观察结果</small>
            </div>
          </section>

          <section className="state-map">
            <div className="state-map-head">
              <div>
                <span className="section-kicker">月度轮廓</span>
                <h2>这个月，你留下了什么痕迹？</h2>
              </div>
              <span className="state-map-note">由上到下：心情 · 精力 · 睡眠</span>
            </div>

            <div className="state-map-scroll">
              <div className="state-map-inner">
                <div className="state-axis-spacer" />
                <div className="state-day-axis">
                  {monthDays.map(day => <span key={day}>{Number(day.slice(-2)) % 5 === 0 || day === monthDays[0] ? Number(day.slice(-2)) : ''}</span>)}
                </div>

                <div className="state-row">
                  <span className="state-row-label">心情</span>
                  <div className="state-cells">
                    {monthDays.map(day => {
                      const value = getNumber(recordMap.get(day), 'mood')
                      return <span key={day} className={`mood-cell ${moodLevel(value)}`} title={`${formatDay(day)} · 心情 ${value == null ? '未记录' : value}`} />
                    })}
                  </div>
                </div>

                <div className="state-row">
                  <span className="state-row-label">精力</span>
                  <div className="state-cells">
                    {monthDays.map(day => {
                      const value = getNumber(recordMap.get(day), 'energy')
                      return <span key={day} className={`mood-cell ${moodLevel(value)}`} title={`${formatDay(day)} · 精力 ${value == null ? '未记录' : value}`} />
                    })}
                  </div>
                </div>

                <div className="state-row sleep-state-row">
                  <span className="state-row-label">睡眠</span>
                  <div className="state-cells sleep-cells">
                    {monthDays.map(day => {
                      const value = getNumber(recordMap.get(day), 'sleepDurationMin')
                      return (
                        <span key={day} className="sleep-cell">
                          <i style={{ height: `${sleepHeight(value)}%` }} title={`${formatDay(day)} · 睡眠 ${value == null ? '未记录' : `${(value / 60).toFixed(1)} 小时`}`} />
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="state-map-legend">
              <span><b className="legend-dot level-1" />低</span>
              <span><b className="legend-dot level-3" />中</span>
              <span><b className="legend-dot level-5" />高</span>
              <span><i className="legend-bar" />睡眠越长越高</span>
              <span className="legend-empty">空白 = 没有数据</span>
            </div>
          </section>

          <section className="calendar-card refined-calendar" aria-label={formatMonth(month)}>
            <div className="section-heading calendar-heading">
              <span>月历</span>
              <span>{monthStats.active ? '有记录的日期会留下标记' : '从今天开始慢慢长出来'}</span>
            </div>
            <div className="calendar-weekdays">
              {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-grid">
              {Array.from({ length: leadingEmptyDays }).map((_, index) => <span className="calendar-empty" key={`empty-${index}`} />)}
              {monthDays.map(day => {
                const record = recordMap.get(day)
                const mood = getNumber(record, 'mood')
                const sleep = getNumber(record, 'sleepDurationMin')
                const isToday = day === getLocalDateKey()

                return (
                  <div
                    className={`calendar-day refined-day ${record ? 'has-record' : ''} ${isToday ? 'is-today' : ''}`}
                    key={day}
                    title={formatDay(day)}
                  >
                    <span className="calendar-date">{Number(day.slice(-2))}</span>
                    <span className={record ? `calendar-mark status-${record.recordingStatus}` : 'calendar-mark'}>{record ? statusSymbol(record.recordingStatus) : '·'}</span>
                    <span className="calendar-mood">{mood == null ? ' ' : mood}</span>
                    {sleep != null && <span className="calendar-sleep-mini" style={{ '--sleep': `${Math.min(100, (sleep / 600) * 100)}%` } as CSSProperties} />}
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
            <section className="timeline-list refined-list">
              <div className="section-heading"><span>逐日记录</span><span>{records.length} 天</span></div>
              {[...records].sort((a, b) => b.recordDate.localeCompare(a.recordDate)).map(record => {
                const mood = getNumber(record, 'mood')
                const energy = getNumber(record, 'energy')
                const sleep = getNumber(record, 'sleepDurationMin')
                return (
                  <article className="timeline-entry refined-entry" key={record.id}>
                    <div className="entry-date-block">
                      <span className={`entry-status status-${record.recordingStatus}`}>{statusSymbol(record.recordingStatus)}</span>
                      <strong>{formatDay(record.recordDate)}</strong>
                      <small>{statusLabel(record.recordingStatus)}</small>
                    </div>
                    <div className="entry-metrics">
                      <span><b>{mood == null ? '—' : mood}</b>心情</span>
                      <span><b>{energy == null ? '—' : energy}</b>精力</span>
                      <span><b>{sleep == null ? '—' : `${(sleep / 60).toFixed(1)}h`}</b>睡眠</span>
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
            <div>
              <strong>{year} 年</strong>
              <span className="toolbar-subtitle">这一年慢慢积累下来的痕迹</span>
            </div>
            <button className="icon-plain" onClick={() => setMonth(`${year + 1}-${month.slice(5)}`)} aria-label="下一年">›</button>
          </section>

          <section className="year-overview refined-year-overview">
            {yearMonths.map(item => (
              <button
                className={`year-month refined-year-month ${item.active ? 'has-data' : ''}`}
                key={item.month}
                onClick={() => { setMonth(`${year}-${pad(item.month)}`); setMode('month') }}
              >
                <div className="year-month-top">
                  <strong>{item.month}月</strong>
                  <span>{item.active ? `${item.active} 天` : '没有记录'}</span>
                </div>
                <div className="year-month-bar">
                  <span style={{ width: `${Math.min(100, (item.active / 31) * 100)}%` }} />
                </div>
                <div className="year-month-meta">
                  <span>心情 <b>{item.mood == null ? '—' : item.mood.toFixed(1)}</b></span>
                  <span>睡眠 <b>{item.sleep == null ? '—' : `${(item.sleep / 60).toFixed(1)}h`}</b></span>
                  <span>完成 <b>{item.recorded}</b></span>
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
