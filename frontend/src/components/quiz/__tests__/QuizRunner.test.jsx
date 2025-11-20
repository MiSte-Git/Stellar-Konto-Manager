import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n.js'
import QuizRunner from '../QuizRunner.jsx'

const sampleQuiz = {
  meta: { estimatedMinutes: 1, passPercent: 0.8, threeStarPercent: 0.9 },
  questions: [
    {
      id: 'q1',
      type: 'single',
      questionKey: 'quiz:l1.q1.question',
      hintKey: 'quiz:l1.q1.hint',
      options: [
        { id: 'a', textKey: 'quiz:l1.q1.a', correct: true, feedbackKey: 'quiz:l1.q1.a.fb' },
        { id: 'b', textKey: 'quiz:l1.q1.b', correct: false, feedbackKey: 'quiz:l1.q1.b.fb' },
      ],
    },
  ],
}

describe('QuizRunner basic flow', () => {
  it('shows thresholds in header', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <QuizRunner lessonId={1} data={sampleQuiz} />
      </I18nextProvider>
    )
    expect(screen.getByText(/Bestehensgrenze|pass/i)).toBeInTheDocument()
    expect(screen.getByText(/3★|three/i)).toBeInTheDocument()
  })

  it('completes quiz and shows result summary', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <QuizRunner lessonId={1} data={sampleQuiz} />
      </I18nextProvider>
    )
    const option = screen.getByRole('radio', { name: /./i })
    fireEvent.click(option)
    const next = screen.getByRole('button', { name: /weiter|next|finish/i })
    fireEvent.click(next)
    expect(screen.getByText(/Dein Ergebnis|your/i)).toBeInTheDocument()
    expect(screen.getByText(/%/)).toBeInTheDocument()
  })
})
