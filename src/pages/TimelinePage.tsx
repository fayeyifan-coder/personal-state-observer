// src/pages/TimelinePage.tsx
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { BottomNav } from '../components/BottomNav'
import { listDays, listDeviceData } from '../db/records'
import type { DailyRecord, DeviceDailyData } from '../types'
import { getLocalDateKey, parseDateKey } from '../utils/dateUtils'
import {
  average,
  buildComparableCycles,
  buildSeasonalObservation,
  compareCyclesByDay,
  getAcneObservation,
  getNumber,
  getPeriodStartDates,
  getSeason,
  getSeasonMonthsLabel,
  isPeriodStart,
  shiftDateKey,
  type Season,
} from '../logic/analysis'

type ViewMode = 'month' | 'year' | 'cycle'

const SEASON_ORDER: Season[] = ['春', '夏', '秋', '冬']

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

function moodLevelSafe(value: number | null) {
  if (value == null) return 'empty'
  return `level-${Math.max(1, Math.min(5, Math.round(value)))}`
}

function sleepHeight(value: number | null) {
  if (value == null) return 0
  return Math.max(8, Math.min(100, (value / 600) * 100))
}

function daysForMonth(month: string) {
  const [year, targetMonth] = month.split('-').map(Number)
  const total = new Date(year, targetMonth, 0).getDate()
  return Array.from({ length: total }, (_, index) => `${month}-${pad(index + 1)}`)
}

function acnePresent(record: DailyRecord | undefined) {
  return getAcneObservation(record) === 'present'
}

function deltaLabel(value: number | null, digits = 1, suffix = '') {
  if (value == null || !Number.isFinite(value)) return '—'
  const rounded = Number(value.toFixed(digits))
  if (rounded === 0) return `0${suffix}`
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}${suffix}`
}

function hasPhaseCompleted(record: DailyRecord | undefined, phase: 'morning' | 'evening') {
  if (!record) return false
  return phase === 'morning'
    ? Boolean(record.morningCompletedAt)
    : Boolean(record.eveningCompletedAt)
}

function phaseSymbol(record: DailyRecord | undefined, phase: 'morning' | 'evening') {
  if (!record) return '·'
  const status = phase === 'morning' ? record.morningStatus : record.eveningStatus
  if (status === 'opted_out') return '○'
  if (status === 'recorded' || hasPhaseCompleted(record, phase)) return '●'
  return '◐'
}

function phaseLabel(record: DailyRecord | undefined, phase: 'morning' | 'evening') {
  if (!record) return '未开始'
  const status = phase === 'morning' ? record.morningStatus : record.eveningStatus
  if (status === 'opted_out') return '主动不记录'
  if (status === 'recorded' || hasPhaseCompleted(record, phase)) return '已完成'
  return '未完成'
}

export function TimelinePage() {
  const [mode, setMode] = useState<ViewMode>('month')
  const [month, setMonth] = useState(monthKey(parseDateKey(getLocalDateKey())))
  const [selectedCycleStart, setSelectedCycleStart] = useState<string | null>(null)
  const [records, setRecords] = useState<DailyRecord[]>([])
  const [deviceData, setDeviceData] = useState<DeviceDailyData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const year = Number(month.slice(0, 4))

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError('')

    const load = async () => {
      try {
        let bounds: { start: string; end: string }

        if (mode === 'month' || mode === 'year') {
          bounds = mode === 'month'
            ? monthBounds(month)
            : { start: `${year}-01-01`, end: `${year}-12-31` }
        } else {
          const reference = monthBounds(month).end
          bounds = {
            start: shiftDateKey(reference, -420),
            end: reference,
          }
        }

        const [nextRecords, nextDeviceData] = await Promise.all([
          listDays(bounds.start, bounds.end),
          listDeviceData(bounds.start, bounds.end),
        ])

        if (mounted) {
          setRecords(nextRecords)
          setDeviceData(nextDeviceData)
        }
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

  const deviceMap = useMemo(
    () => new Map(deviceData.map(item => [item.recordDate, item])),
    [deviceData],
  )

  const monthDays = useMemo(() => daysForMonth(month), [month])
  const leadingEmptyDays = (parseDateKey(monthDays[0]).getDay() + 6) % 7

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
      acneDays: records.filter(acnePresent).length,
      periodStarts: records.filter(isPeriodStart).length,
      deviceDays: deviceData.length,
      morningDays: records.filter(record => hasPhaseCompleted(record, 'morning')).length,
      eveningDays: records.filter(record => hasPhaseCompleted(record, 'evening')).length,
    }
  }, [records, deviceData])

  const yearMonths = useMemo(
    () => Array.from({ length: 12 }, (_, index) => {
      const monthRecords = records.filter(record => Number(record.recordDate.slice(5, 7)) === index + 1)
      const moods = monthRecords.map(record => getNumber(record, 'mood'))
      const sleeps = monthRecords.map(record => getNumber(record, 'sleepDurationMin'))
      return {
        month: index + 1,
        active: monthRecords.length,
        recorded: monthRecords.filter(record => record.recordingStatus === 'recorded').length,
        mood: average(moods),
        sleep: average(sleeps),
        acneDays: monthRecords.filter(acnePresent).length,
        periodStarts: monthRecords.filter(isPeriodStart).length,
        deviceDays: monthRecords.filter(record => deviceMap.has(record.recordDate)).length,
        morningDays: monthRecords.filter(record => hasPhaseCompleted(record, 'morning')).length,
        eveningDays: monthRecords.filter(record => hasPhaseCompleted(record, 'evening')).length,
      }
    }),
    [records, deviceMap],
  )

  const yearMood = useMemo(() => average(records.map(record => getNumber(record, 'mood'))), [records])
  const yearEnergy = useMemo(() => average(records.map(record => getNumber(record, 'energy'))), [records])
  const yearSleep = useMemo(() => average(records.map(record => getNumber(record, 'sleepDurationMin'))), [records])

  const seasonalStats = useMemo(() => {
    const deviceDates = new Set(deviceData.map(item => item.recordDate))
    return SEASON_ORDER.map(season =>
      buildSeasonalObservation(
        records,
        deviceDates,
        year,
        season,
        yearMood,
        yearEnergy,
        yearSleep,
      )
    )
  }, [records, deviceData, year, yearMood, yearEnergy, yearSleep])

  const monthEnd = monthBounds(month).end
  const todayKey = getLocalDateKey()
  const cycleReferenceDate = monthEnd > todayKey ? todayKey : monthEnd

  const cycleStarts = useMemo(
    () => getPeriodStartDates(records, cycleReferenceDate),
    [records, cycleReferenceDate],
  )

  useEffect(() => {
    const latest = cycleStarts[0] ?? null
    setSelectedCycleStart(current => (current && cycleStarts.includes(current) ? current : latest))
  }, [cycleStarts])

  const cycleStart = selectedCycleStart ?? cycleStarts[0] ?? null

  const comparableCycles = useMemo(
    () => buildComparableCycles(records, cycleReferenceDate),
    [records, cycleReferenceDate],
  )

  const selectedCycle = useMemo(
    () => comparableCycles.find(cycle => cycle.startDate === cycleStart) ?? null,
    [comparableCycles, cycleStart],
  )

  const cycleComplete = selectedCycle?.complete ?? false
  const selectedCycleEnd = selectedCycle?.endDate ?? null
  const cycleLength = selectedCycle?.length ?? 0
  const cycleDays = selectedCycle?.rows.map(row => row.day) ?? []
  const cycleRows = selectedCycle?.rows ?? []

  const cycleStats = useMemo(() => ({
    recordedDays: cycleRows.filter(row => row.record?.recordingStatus === 'recorded').length,
    mood: average(cycleRows.map(row => row.mood)),
    energy: average(cycleRows.map(row => row.energy)),
    sleep: average(cycleRows.map(row => row.sleep)),
    acneDays: cycleRows.filter(row => row.acne === 'present').length,
  }), [cycleRows])

  const cycleComparisonRows = useMemo(
    () => compareCyclesByDay(comparableCycles),
    [comparableCycles],
  )

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
          <button className={mode === 'cycle' ? 'active' : ''} onClick={() => setMode('cycle')}>周期</button>
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
            <div className="timeline-stat primary-stat"><span>完成记录</span><strong>{monthStats.recorded}</strong><small>／ {monthStats.active || monthDays.length} 天</small></div>
            <div className="timeline-stat"><span>平均心情</span><strong>{monthStats.mood == null ? '—' : monthStats.mood.toFixed(1)}</strong><small>{monthStats.moodDays ? `${monthStats.moodDays} 天有数据` : '暂无数值'}</small></div>
            <div className="timeline-stat"><span>平均睡眠</span><strong>{monthStats.sleep == null ? '—' : `${(monthStats.sleep / 60).toFixed(1)}h`}</strong><small>{monthStats.sleepDays ? `${monthStats.sleepDays} 天有数据` : '暂无数值'}</small></div>
            <div className="timeline-stat"><span>痤疮 / 经期</span><strong>{monthStats.acneDays}</strong><small>{monthStats.periodStarts ? `${monthStats.periodStarts} 次周期开始` : '暂无周期开始'}</small></div>
          </section>

          <section className="data-note" style={{ marginTop: 18, marginBottom: 6 }}>
            <strong>一天两次观察</strong>
            <p style={{ marginBottom: 0 }}>早晨 {monthStats.morningDays} 天完成 · 晚间 {monthStats.eveningDays} 天完成</p>
          </section>

          <section className="state-map">
            <div className="state-map-head">
              <div>
                <span className="section-kicker">月度轮廓</span>
                <h2>状态与周期线索</h2>
              </div>
              <span className="state-map-note">心情 · 精力 · 睡眠</span>
            </div>
            <div className="state-map-scroll">
              <div className="state-map-inner">
                <div className="state-day-axis">
                  {monthDays.map(day => <span key={day}>{Number(day.slice(-2)) % 5 === 0 || day === monthDays[0] ? Number(day.slice(-2)) : ''}</span>)}
                </div>
                <div className="state-row">
                  <span className="state-row-label">心情</span>
                  <div className="state-cells">
                    {monthDays.map(day => <span key={day} className={`mood-cell ${moodLevelSafe(getNumber(recordMap.get(day), 'mood'))}`} title={`${formatDay(day)} · 心情`} />)}
                  </div>
                </div>
                <div className="state-row">
                  <span className="state-row-label">精力</span>
                  <div className="state-cells">
                    {monthDays.map(day => <span key={day} className={`mood-cell ${moodLevelSafe(getNumber(recordMap.get(day), 'energy'))}`} title={`${formatDay(day)} · 精力`} />)}
                  </div>
                </div>
                <div className="state-row sleep-state-row">
                  <span className="state-row-label">睡眠</span>
                  <div className="state-cells sleep-cells">
                    {monthDays.map(day => <span key={day} className="sleep-cell"><i style={{ height: `${sleepHeight(getNumber(recordMap.get(day), 'sleepDurationMin'))}%` }} /></span>)}
                  </div>
                </div>
                <div className="state-row">
                  <span className="state-row-label">周期</span>
                  <div className="state-cells">
                    {monthDays.map(day => {
                      const record = recordMap.get(day)
                      return <span key={day} className="mood-cell" style={{ background: isPeriodStart(record) ? 'var(--olive)' : acnePresent(record) ? 'var(--paper-deep)' : 'transparent', border: isPeriodStart(record) ? 'none' : acnePresent(record) ? '1px solid var(--line-strong)' : '1px solid transparent' }} title={`${formatDay(day)} · ${isPeriodStart(record) ? '周期第 1 天标记' : acnePresent(record) ? '有痤疮' : '无周期 / 痤疮标记'}`} />
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className="state-map-legend">
              <span><b className="legend-dot level-1" />低</span>
              <span><b className="legend-dot level-3" />中</span>
              <span><b className="legend-dot level-5" />高</span>
              <span>■ 周期第 1 天</span>
              <span>□ 有痤疮</span>
              <span className="legend-empty">空白 = 没有数据</span>
            </div>
          </section>

          <section className="calendar-card refined-calendar" aria-label={formatMonth(month)}>
            <div className="section-heading calendar-heading"><span>月历</span><span>点进日期可分别补记早晨 / 晚间</span></div>
            <div className="calendar-weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
            <div className="calendar-grid">
              {Array.from({ length: leadingEmptyDays }).map((_, index) => <span className="calendar-empty" key={`empty-${index}`} />)}
              {monthDays.map(day => {
                const record = recordMap.get(day)
                const mood = getNumber(record, 'mood')
                const sleep = getNumber(record, 'sleepDurationMin')
                const isToday = day === getLocalDateKey()
                const device = deviceMap.get(day)
                return (
                  <div className={`calendar-day refined-day ${record ? 'has-record' : ''} ${isToday ? 'is-today' : ''}`} key={day} title={formatDay(day)}>
                    <a href={`#/record?date=${day}&phase=morning`} className="calendar-date">{Number(day.slice(-2))}</a>
                    <span className={record ? `calendar-mark status-${record.recordingStatus}` : 'calendar-mark'}>{record ? statusSymbol(record.recordingStatus) : '·'}</span>
                    <span className="calendar-mood">{mood == null ? ' ' : mood}</span>
                    {isPeriodStart(record) && <span style={{ fontSize: 8, color: 'var(--olive)' }}>经1</span>}
                    {acnePresent(record) && <span style={{ fontSize: 8, color: 'var(--muted)' }}>痘</span>}
                    {(sleep != null || device) && <span className="calendar-sleep-mini" style={{ '--sleep': `${Math.min(100, ((sleep ?? device?.sleepDurationMin ?? 0) / 600) * 100)}%` } as CSSProperties} />}
                  </div>
                )
              })}
            </div>
          </section>

          {records.length ? (
            <section className="timeline-list refined-list">
              <div className="section-heading"><span>逐日记录</span><span>{records.length} 天</span></div>
              {[...records].sort((a, b) => b.recordDate.localeCompare(a.recordDate)).map(record => {
                const mood = getNumber(record, 'mood')
                const energy = getNumber(record, 'energy')
                const sleep = getNumber(record, 'sleepDurationMin')
                const device = deviceMap.get(record.recordDate)
                return (
                  <article className="timeline-entry refined-entry" key={record.id}>
                    <div className="entry-date-block">
                      <span className={`entry-status status-${record.recordingStatus}`}>{statusSymbol(record.recordingStatus)}</span>
                      <strong>{formatDay(record.recordDate)}</strong>
                      <small>{statusLabel(record.recordingStatus)}{isPeriodStart(record) ? ' · 周期第 1 天' : ''}</small>
                    </div>
                    <div className="entry-metrics">
                      <span><b>{mood == null ? '—' : mood}</b>心情</span>
                      <span><b>{energy == null ? '—' : energy}</b>精力</span>
                      <span><b>{sleep == null ? '—' : `${(sleep / 60).toFixed(1)}h`}</b>睡眠</span>
                      <span><b>{acnePresent(record) ? '有' : '无'}</b>痤疮</span>
                      <span><b>{device ? '有' : '—'}</b>设备</span>
                      <span><b>{phaseSymbol(record, 'morning')}</b>早晨</span>
                      <span><b>{phaseSymbol(record, 'evening')}</b>晚间</span>
                    </div>
                    <div className="timeline-entry-links" style={{ display: 'flex', gap: 10, marginTop: 8, fontSize: 10 }}>
                      <span>{phaseLabel(record, 'morning')}</span>
                      <span>{phaseLabel(record, 'evening')}</span>
                      <a href={`#/record?date=${record.recordDate}&phase=morning&edit=1`}>早晨</a>
                      <a href={`#/record?date=${record.recordDate}&phase=evening&edit=1`}>晚上</a>
                    </div>
                  </article>
                )
              })}
            </section>
          ) : (
            <section className="timeline-empty"><span className="empty-mark">—</span><h2>这里还没有留下记录。</h2><p>开始记录后，这里会慢慢长出你的时间轴。</p></section>
          )}
        </>
      ) : mode === 'year' ? (
        <>
          <section className="timeline-toolbar">
            <button className="icon-plain" onClick={() => setMonth(`${year - 1}-${month.slice(5)}`)} aria-label="上一年">‹</button>
            <div><strong>{year} 年</strong><span className="toolbar-subtitle">把一年当成季节观察，而不是成绩单</span></div>
            <button className="icon-plain" onClick={() => setMonth(`${year + 1}-${month.slice(5)}`)} aria-label="下一年">›</button>
          </section>

          <section className="timeline-overview">
            <div className="timeline-stat primary-stat"><span>全年有记录</span><strong>{records.length}</strong><small>天</small></div>
            <div className="timeline-stat"><span>平均心情</span><strong>{average(records.map(record => getNumber(record, 'mood')))?.toFixed(1) ?? '—'}</strong><small>同年数据</small></div>
            <div className="timeline-stat"><span>平均睡眠</span><strong>{average(records.map(record => getNumber(record, 'sleepDurationMin'))) == null ? '—' : `${(average(records.map(record => getNumber(record, 'sleepDurationMin')))! / 60).toFixed(1)}h`}</strong><small>同年数据</small></div>
            <div className="timeline-stat"><span>周期开始</span><strong>{records.filter(isPeriodStart).length}</strong><small>明确标记</small></div>
          </section>

          <section className="state-map">
            <div className="state-map-head">
              <div><span className="section-kicker">季节观察</span><h2>这一年，状态如何随季节移动？</h2></div>
              <span className="state-map-note">与本人全年平均值对照</span>
            </div>

            <div className="year-overview" style={{ marginTop: 8 }}>
              {seasonalStats.map(item => (
                <div className="year-month" key={item.name} style={{ cursor: 'default' }}>
                  <div className="year-month-top">
                    <strong>{item.name}季</strong>
                    <span>{getSeasonMonthsLabel(item.name)} · {item.activeDays ? `${item.activeDays} 天有活动` : '暂无数据'}</span>
                  </div>
                  <div className="year-month-bar">
                    <span style={{ width: `${Math.min(100, (item.recordedDays / 92) * 100)}%` }} />
                  </div>
                  <div className="year-month-meta" style={{ flexWrap: 'wrap' }}>
                    <span>心情 <b>{item.mood.mean == null ? '—' : item.mood.mean.toFixed(1)}</b> <small>({deltaLabel(item.moodDelta)})</small></span>
                    <span>精力 <b>{item.energy.mean == null ? '—' : item.energy.mean.toFixed(1)}</b> <small>({deltaLabel(item.energyDelta)})</small></span>
                    <span>睡眠 <b>{item.sleep.mean == null ? '—' : `${(item.sleep.mean / 60).toFixed(1)}h`}</b> <small>({deltaLabel(item.sleepDelta == null ? null : item.sleepDelta / 60)}h)</small></span>
                    <span>痤疮 <b>{item.acneRate == null ? '—' : `${Math.round(item.acneRate * 100)}%`}</b></span>
                  </div>
                  <div style={{ marginTop: 10, color: 'var(--muted)', fontSize: 9, lineHeight: 1.7 }}>
                    心情 {item.mood.count} 天有数值 · 睡眠 {item.sleep.count} 天有数值 · 痤疮 {item.acneObserved} 天明确回答 · {item.deviceDays} 天有设备数据
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, paddingTop: 13, borderTop: '1px solid var(--line)' }}>
              <div className="section-heading"><span>怎么读</span><span>先看样本量，再看差值</span></div>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 10, lineHeight: 1.75 }}>冬季在这里按日历年归类为 1–2 月与 12 月，这些月份不一定属于同一个连续冬季。括号里的差值是“该季节 − 全年平均”，不是因果效应。痤疮只按明确回答的日子计算，没回答不会被当作“没有痤疮”。第一年每个季节只有一次，因此这里只记录值得继续观察的模式。</p>
            </div>
          </section>

          <section className="year-overview refined-year-overview">
            {yearMonths.map(item => (
              <button className={`year-month refined-year-month ${item.active ? 'has-data' : ''}`} key={item.month} onClick={() => { setMonth(`${year}-${pad(item.month)}`); setMode('month') }}>
                <div className="year-month-top"><strong>{item.month}月</strong><span>{item.active ? `${item.active} 天` : '没有记录'}</span></div>
                <div className="year-month-bar"><span style={{ width: `${Math.min(100, (item.active / 31) * 100)}%` }} /></div>
                <div className="year-month-meta">
                  <span>季节 <b>{getSeason(item.month)}</b></span>
                  <span>心情 <b>{item.mood == null ? '—' : item.mood.toFixed(1)}</b></span>
                  <span>睡眠 <b>{item.sleep == null ? '—' : `${(item.sleep / 60).toFixed(1)}h`}</b></span>
                  <span>早/晚 <b>{item.morningDays}/{item.eveningDays}</b></span>
                  <span>设备 <b>{item.deviceDays}</b></span>
                </div>
              </button>
            ))}
          </section>
        </>
      ) : (
        <>
          <section className="timeline-toolbar">
            <button className="icon-plain" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上一月">‹</button>
            <div><strong>{cycleStart ? `周期 ${cycleStart}` : '还没有周期'}</strong><span className="toolbar-subtitle">以明确标记“月经第 1 天”为周期起点</span></div>
            <button className="icon-plain" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下一月">›</button>
          </section>

          {!cycleStart ? (
            <section className="timeline-empty"><span className="empty-mark">○</span><h2>还没有足够的周期起点。</h2><p>在晚间总结中标记“今天是这次月经第 1 天”，之后这里才会开始对齐周期日。</p></section>
          ) : (
            <>
              <section style={{ marginBottom: 18 }}>
              <div className="section-heading"><span>选择周期</span><span>{cycleStarts.length} 个起点</span></div>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 3 }}>
                {cycleStarts.slice(0, 6).map(startDate => (
                  <button
                    key={startDate}
                    className={startDate === cycleStart ? 'primary' : 'quiet'}
                    style={{ minHeight: 42, flex: '0 0 auto', paddingInline: 14, fontSize: 11 }}
                    onClick={() => setSelectedCycleStart(startDate)}
                  >
                    {startDate.slice(5).replace('-', ' / ')}
                  </button>
                ))}
              </div>
            </section>

            <section className="timeline-overview">
                <div className="timeline-stat primary-stat"><span>当前周期长度</span><strong>{cycleComplete ? cycleLength : `${cycleLength}+`}</strong><small>天{cycleComplete ? ' · 已结束' : ' · 进行中'}</small></div>
                <div className="timeline-stat"><span>平均心情</span><strong>{cycleStats.mood == null ? '—' : cycleStats.mood.toFixed(1)}</strong><small>{cycleStats.recordedDays} 天完成记录</small></div>
                <div className="timeline-stat"><span>平均睡眠</span><strong>{cycleStats.sleep == null ? '—' : `${(cycleStats.sleep / 60).toFixed(1)}h`}</strong><small>按周期日对齐</small></div>
                <div className="timeline-stat"><span>痤疮天数</span><strong>{cycleStats.acneDays}</strong><small>标记为有痤疮</small></div>
              </section>

              <section className="state-map">
                <div className="state-map-head"><div><span className="section-kicker">周期轮廓</span><h2>同一个周期里，状态如何移动？</h2></div><span className="state-map-note">横轴 = 周期第 1 天、第 2 天……</span></div>
                <div className="state-map-scroll">
                  <div className="state-map-inner" style={{ minWidth: Math.max(560, cycleRows.length * 18 + 45) }}>
                    <div className="state-day-axis" style={{ gridTemplateColumns: `repeat(${Math.max(1, cycleRows.length)}, minmax(10px,1fr))` }}>
                      {cycleRows.map(row => <span key={row.day}>{row.day % 5 === 0 || row.day === 1 ? row.day : ''}</span>)}
                    </div>
                    {(['mood', 'energy'] as const).map(field => (
                      <div className="state-row" key={field}>
                        <span className="state-row-label">{field === 'mood' ? '心情' : '精力'}</span>
                        <div className="state-cells" style={{ gridTemplateColumns: `repeat(${Math.max(1, cycleRows.length)}, minmax(10px,1fr))` }}>
                          {cycleRows.map(row => <span key={row.day} className={`mood-cell ${moodLevelSafe(row[field])}`} title={`周期第 ${row.day} 天 · ${field === 'mood' ? '心情' : '精力'}`} />)}
                        </div>
                      </div>
                    ))}
                    <div className="state-row sleep-state-row">
                      <span className="state-row-label">睡眠</span>
                      <div className="state-cells sleep-cells" style={{ gridTemplateColumns: `repeat(${Math.max(1, cycleRows.length)}, minmax(10px,1fr))` }}>
                        {cycleRows.map(row => <span key={row.day} className="sleep-cell"><i style={{ height: `${sleepHeight(row.sleep)}%` }} /></span>)}
                      </div>
                    </div>
                    <div className="state-row">
                      <span className="state-row-label">痤疮</span>
                      <div className="state-cells" style={{ gridTemplateColumns: `repeat(${Math.max(1, cycleRows.length)}, minmax(10px,1fr))` }}>
                        {cycleRows.map(row => <span key={row.day} className="mood-cell" style={{ background: row.acne ? 'var(--olive)' : 'transparent', border: row.acne ? 'none' : '1px solid #ebe6dc' }} title={`周期第 ${row.day} 天 · ${row.acne ? '有痤疮' : '未标记痤疮'}`} />)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="state-map-legend"><span>第 1 天 = 月经开始标记</span><span>空白 = 没有数据</span><span className="legend-empty">仅观察模式，不推断排卵或激素水平</span></div>
              </section>

              <section className="state-map" style={{ marginTop: 22 }}>
                <div className="state-map-head">
                  <div><span className="section-kicker">多周期对照</span><h2>同一个周期日，在不同周期里是否相似？</h2></div>
                  <span className="state-map-note">当前数据范围内的周期</span>
                </div>
                <div className="state-map-scroll">
                  <div className="state-map-inner" style={{ minWidth: Math.max(560, cycleComparisonRows.length * 18 + 45) }}>
                    <div className="state-day-axis" style={{ gridTemplateColumns: `repeat(${Math.max(1, cycleComparisonRows.length)}, minmax(10px,1fr))` }}>
                      {cycleComparisonRows.map(row => <span key={row.day}>{row.day % 5 === 0 || row.day === 1 ? row.day : ''}</span>)}
                    </div>
                    {(['mood', 'energy'] as const).map(field => (
                      <div className="state-row" key={field}>
                        <span className="state-row-label">{field === 'mood' ? '心情' : '精力'}</span>
                        <div className="state-cells" style={{ gridTemplateColumns: `repeat(${Math.max(1, cycleComparisonRows.length)}, minmax(10px,1fr))` }}>
                          {cycleComparisonRows.map(row => <span key={row.day} className={`mood-cell ${moodLevelSafe(row[field])}`} title={`周期第 ${row.day} 天 · ${field === 'mood' ? '平均心情' : '平均精力'} · ${row.observedCycles} 个周期`} />)}
                        </div>
                      </div>
                    ))}
                    <div className="state-row sleep-state-row">
                      <span className="state-row-label">睡眠</span>
                      <div className="state-cells sleep-cells" style={{ gridTemplateColumns: `repeat(${Math.max(1, cycleComparisonRows.length)}, minmax(10px,1fr))` }}>
                        {cycleComparisonRows.map(row => <span key={row.day} className="sleep-cell"><i style={{ height: `${sleepHeight(row.sleep)}%` }} /></span>)}
                      </div>
                    </div>
                    <div className="state-row">
                      <span className="state-row-label">痤疮率</span>
                      <div className="state-cells" style={{ gridTemplateColumns: `repeat(${Math.max(1, cycleComparisonRows.length)}, minmax(10px,1fr))` }}>
                        {cycleComparisonRows.map(row => (
                          <span key={row.day} className="mood-cell" style={{ background: row.acneRate == null ? 'transparent' : `rgba(104,112,92,${0.15 + row.acneRate * 0.7})`, border: row.acneRate == null ? '1px solid #ebe6dc' : 'none' }} title={`周期第 ${row.day} 天 · 痤疮出现率 ${row.acneRate == null ? '无数据' : `${Math.round(row.acneRate * 100)}%`} · ${row.acneObserved} 个周期有观察`} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="state-map-legend"><span>颜色越深 = 跨周期平均值越高</span><span>痤疮 = 有数据天中的出现比例</span><span className="legend-empty">缺失数据不会当作“没有痤疮”</span></div>
              </section>

              <section style={{ marginTop: 18, padding: '14px 2px', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
                <div className="section-heading"><span>数据说明</span><span>{comparableCycles.length} 个周期</span></div>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 10, lineHeight: 1.7 }}>这里比较的是你已经明确标记“月经第 1 天”的周期。周期天数只用于时间对齐，不代表激素水平；痤疮率只在有明确痤疮回答的日子中计算。样本很少时，只把它当作值得继续观察的模式。</p>
              </section>

              <section className="timeline-list refined-list">
                <div className="section-heading"><span>周期逐日表</span><span>{cycleRows.length} 个周期日</span></div>
                {cycleRows.map(row => (
                  <article className="timeline-entry refined-entry" key={row.day}>
                    <div className="entry-date-block">
                      <span className="entry-status" style={{ color: row.day === 1 ? 'var(--olive)' : 'var(--muted)' }}>{row.day === 1 ? '●' : '·'}</span>
                      <strong>第 {row.day} 天</strong>
                      <small>{formatDay(row.dateKey)}{row.record ? '' : ' · 无记录'}</small>
                    </div>
                    <div className="entry-metrics">
                      <span><b>{row.mood == null ? '—' : row.mood}</b>心情</span>
                      <span><b>{row.energy == null ? '—' : row.energy}</b>精力</span>
                      <span><b>{row.sleep == null ? '—' : `${(row.sleep / 60).toFixed(1)}h`}</b>睡眠</span>
                      <span><b>{row.acne ? '有' : row.record ? '无' : '—'}</b>痤疮</span>
                      <span><b>{phaseSymbol(row.record, 'morning')}</b>早晨</span>
                      <span><b>{phaseSymbol(row.record, 'evening')}</b>晚间</span>
                    </div>
                  </article>
                ))}
              </section>
            </>
          )}
        </>
      )}

      <BottomNav current="/timeline" />
    </div>
  )
}
