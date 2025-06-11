import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Slider } from '../slider'

describe('Slider component', () => {
  it('renders markers when provided', () => {
    const { container } = render(
      <Slider markers={[10, 50, 90]} min={0} max={100} />
    )
    const markers = container.querySelectorAll('div[style*="left"]')
    expect(markers.length).toBe(3)
  })
})
