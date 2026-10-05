// src/components/QuestionCard.tsx

import { useState } from 'react'
import type { AnswerValue, Option, QuestionType } from '../types'

type Props = {
  title: string
  helper?: string
  type: QuestionType
  options?: Option[]
  value: AnswerValue
  onSubmit: (value: AnswerValue) => void
  onBack?: () => void
  onSkip: () => void
  unit?: string
  maxLength?: number
}

export function QuestionCard({
  title,
  helper,
  type,
  options = [],
  value,
  onSubmit,
  onBack,
  onSkip,
  unit,
  maxLength = 500
}: Props) {
  const [selected, setSelected] = useState<AnswerValue>(value)
  const [text, setText] = useState(
    typeof value === 'string' ? value : ''
  )

  function select(nextValue: string | number) {
    if (type === 'multiChoice') {
      const current: Array<string | number> = Array.isArray(selected)
        ? selected
        : []

      const next: Array<string | number> = current.includes(nextValue)
        ? current.filter(item => item !== nextValue)
        : [...current, nextValue]

      setSelected(next)
      return
    }

    setSelected(nextValue)
    onSubmit(nextValue)
  }

  function submitCurrentValue() {
    if (type === 'text') {
      onSubmit(text)
      return
    }

    onSubmit(selected)
  }

  return (
    <main className="record-card">
      <div className="question-head">
        <span>{helper}</span>
      </div>

      <h1>{title}</h1>

      {type === 'text' ? (
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={maxLength}
        />
      ) : type === 'number' ? (
        <div className="number-input-wrap">
          <input
            type="number"
            inputMode="decimal"
            value={
              typeof selected === 'number'
                ? selected
                : ''
            }
            onChange={e => {
              const raw = e.target.value

              if (raw === '') {
                setSelected(null)
                return
              }

              const numericValue = Number(raw)

              setSelected(
                Number.isFinite(numericValue)
                  ? numericValue
                  : null
              )
            }}
            placeholder={
              unit
                ? `请输入数值（${unit}）`
                : '请输入数值'
            }
            aria-label={
              unit
                ? `请输入数值（${unit}）`
                : '请输入数值'
            }
          />

          {unit && (
            <span className="number-unit">
              {unit}
            </span>
          )}
        </div>
      ) : (
        <div className="choices">
          {options.map((option: Option) => {
            const isSelected =
              Array.isArray(selected)
                ? selected.includes(option.value)
                : selected === option.value

            return (
              <button
                key={String(option.value)}
                type="button"
                className={`choice ${
                  isSelected ? 'selected' : ''
                }`}
                onClick={() => select(option.value)}
              >
                {option.icon != null && (
                  <span className="choice-icon">
                    {option.icon}
                  </span>
                )}

                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="record-actions">
        {onBack && (
          <button
            type="button"
            className="quiet"
            onClick={onBack}
          >
            返回
          </button>
        )}

        <button
          type="button"
          className="quiet"
          onClick={onSkip}
        >
          暂不记录
        </button>

        {type === 'multiChoice' ||
        type === 'text' ||
        type === 'number' ? (
          <button
            type="button"
            className="primary"
            onClick={submitCurrentValue}
          >
            下一项
          </button>
        ) : null}
      </div>
    </main>
  )
}