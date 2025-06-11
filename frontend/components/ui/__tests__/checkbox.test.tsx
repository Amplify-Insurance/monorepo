import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Checkbox } from '../checkbox'

describe('Checkbox component', () => {
  it('toggles checked state when clicked', () => {
    render(<Checkbox />)
    const cb = screen.getByRole('checkbox')
    expect(cb).not.toBeChecked()
    fireEvent.click(cb)
    expect(cb).toBeChecked()
  })
})
