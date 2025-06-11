import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from '../button'

it('applies variant classes', () => {
  render(<Button variant="destructive">Delete</Button>)
  const btn = screen.getByRole('button', { name: 'Delete' })
  expect(btn).toHaveClass('bg-destructive')
})
