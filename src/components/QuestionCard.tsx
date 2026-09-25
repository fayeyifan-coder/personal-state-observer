import { useState } from 'react'

type Option = { value: string | number; label: string; icon?: string; description?: string }

type Props = {
  title: string
  helper?: string
  type: 'choice' | 'multiChoice' | 'text'
  options?: Option[]
  value: unknown
  onSubmit: (value: unknown) => void
  onBack?: () => void
  onSkip: () => void
}

export function QuestionCard({ title, helper, type, options = [], value, onSubmit, onBack, onSkip }: Props) {
  const [selected, setSelected] = useState<unknown>(value)
  const [text, setText] = useState(typeof value === 'string' ? value : '')

  function select(value: unknown) {
    if (type === 'multiChoice') {
      const current = Array.isArray(selected) ? selected : []
      const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value]
      setSelected(next)
      return
    }
    setSelected(value)
    onSubmit(value)
  }

  return <main className="record-card">
    <div className="question-head"><span>{helper}</span></div>
    <h1>{title}</h1>
    {type === 'text' ? <textarea value={text} onChange={e => setText(e.target.value)} maxLength={500} /> : <div className="choices">
      {options.map(option => {
        const isSelected = Array.isArray(selected) ? selected.includes(option.value) : selected === option.value
        return <button key={String(option.value)} className={`choice ${isSelected ? 'selected' : ''}`} onClick={() => select(option.value)}>
          {option.icon && <span className="choice-icon">{option.icon}</span>}<span>{option.label}</span>
        </button>
      })}
    </div>}
    <div className="record-actions">
      {onBack && <button className="quiet" onClick={onBack}>返回</button>}
      <button className="quiet" onClick={onSkip}>暂不记录</button>
      {type === 'multiChoice' || type === 'text' ? <button className="primary" onClick={() => onSubmit(type === 'text' ? text : selected)}>下一项</button> : null}
    </div>
  </main>
}
