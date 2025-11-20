import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n.js'
import QuestionCard from '../QuestionCard.jsx'

function renderWithI18n(ui) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

describe('QuestionCard a11y and interactions', () => {
  const baseProps = {
    type: 'single',
    questionKey: 'quiz:l1.q1.question',
    hintKey: 'quiz:l1.q1.hint',
    options: [
      { id: 'a', textKey: 'quiz:l1.q1.a', correct: true, feedbackKey: 'quiz:l1.q1.a.fb' },
      { id: 'b', textKey: 'quiz:l1.q1.b', correct: false, feedbackKey: 'quiz:l1.q1.b.fb' },
    ],
    selectedOptionId: undefined,
    onAnswer: () => {},
    showFeedback: false,
    disabled: false,
  }

  it('renders question and options', () => {
    renderWithI18n(<QuestionCard {...baseProps} />)
    expect(screen.getByRole('heading', { level: 0, name: /./i })).toBeTruthy()
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
  })

  it('toggles hint visibility and sets aria-expanded', () => {
    renderWithI18n(<QuestionCard {...baseProps} />)
    const btn = screen.getByRole('button', { name: /hinweis|hint/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('calls onAnswer when selecting an option', () => {
    const onAnswer = vi.fn()
    renderWithI18n(<QuestionCard {...baseProps} onAnswer={onAnswer} />)
    const radios = screen.getAllByRole('radio')
    fireEvent.click(radios[0])
    expect(onAnswer).toHaveBeenCalled()
  })

  it('announces feedback in a live region when showFeedback is true', () => {
    const { rerender } = renderWithI18n(
      <QuestionCard {...baseProps} selectedOptionId={'a'} showFeedback={false} />
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    rerender(
      <I18nextProvider i18n={i18n}>
        <QuestionCard {...baseProps} selectedOptionId={'a'} showFeedback={true} />
      </I18nextProvider>
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
