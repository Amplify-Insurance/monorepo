import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Badge } from '../badge'

describe('Badge component', () => {
  it('applies outline variant classes', () => {
    render(<Badge variant="outline">Beta</Badge>)
    const el = screen.getByText('Beta')
    expect(el).toHaveClass('text-foreground')
  })
})
