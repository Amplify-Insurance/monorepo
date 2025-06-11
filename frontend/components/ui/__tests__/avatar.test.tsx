import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Avatar, AvatarImage, AvatarFallback } from '../avatar'

describe('Avatar component', () => {
  it('shows fallback text', () => {
    render(
      <Avatar>
        <AvatarImage alt="pic" src="pic.png" />
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
    )
    const fallback = screen.getByText('AB')
    expect(fallback).toBeInTheDocument()
    expect(fallback).toHaveClass('bg-muted')
  })
})
