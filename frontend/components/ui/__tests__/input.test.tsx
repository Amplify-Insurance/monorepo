import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Input } from '../input'

describe('Input component', () => {
  it('passes props to the input element', () => {
    render(<Input type="password" placeholder="Secret" className="custom" disabled />)
    const el = screen.getByPlaceholderText('Secret')
    expect(el).toHaveAttribute('type', 'password')
    expect(el).toHaveClass('custom')
    expect(el).toBeDisabled()
  })
})
