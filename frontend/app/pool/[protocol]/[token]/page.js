"use client"

// Import React hooks, Next.js components, icons
import { useState, useEffect, useMemo, useRef, useCallback } from "react" // Added useRef, useCallback
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, ExternalLink } from "lucide-react"
import Link from "next/link"
import Image from "next/image"

// Add these imports at the top of the file
import CoverageModal from "../../../components/CoverageModal"

// --- Mock Data & Helpers (Assume generateHistoricalData, markets, formatting functions are here as before) ---
const markets = [
  // ... (your existing markets data) ...
  {
    id: "aave",
    name: "Aave",
    description: "Decentralized lending protocol",
    tvl: 5200000000,
    pools: [
      {
        token: "ETH",
        premium: 2.5,
        underwriterYield: 4.2,
        tvl: 1200000000,
        price: 3500,
        utilizationRate: 34.81,
        reserveFactor: 15,
        liquidationThreshold: 73.0,
        liquidationPenalty: 9.0,
        maxLTV: 68.0,
        optimalUtilization: 80, // Added for model flexibility
        baseRate: 0,
        slope1: 0.04,
        slope2: 0.6,
      },
      {
        token: "USDC",
        premium: 1.8,
        underwriterYield: 3.5,
        tvl: 980000000,
        price: 1,
        utilizationRate: 42.15,
        reserveFactor: 10,
        liquidationThreshold: 80.0,
        liquidationPenalty: 5.0,
        maxLTV: 75.0,
        optimalUtilization: 85,
        baseRate: 0.005,
        slope1: 0.03,
        slope2: 0.55,
      },
      {
        token: "BTC",
        premium: 2.2,
        underwriterYield: 3.8,
        tvl: 850000000,
        price: 62000,
        utilizationRate: 38.42,
        reserveFactor: 15,
        liquidationThreshold: 70.0,
        liquidationPenalty: 10.0,
        maxLTV: 65.0,
        optimalUtilization: 80,
        baseRate: 0,
        slope1: 0.04,
        slope2: 0.6,
      },
      {
        token: "AVAX",
        premium: 2.6,
        underwriterYield: 4.4,
        tvl: 450000000,
        price: 21.52,
        utilizationRate: 34.81,
        reserveFactor: 20,
        liquidationThreshold: 65.0,
        liquidationPenalty: 12.0,
        maxLTV: 60.0,
        optimalUtilization: 75,
        baseRate: 0.01,
        slope1: 0.05,
        slope2: 0.7,
      },
    ],
  },
  {
    id: "compound",
    name: "Compound",
    description: "Algorithmic money market protocol",
    tvl: 3800000000,
    pools: [
      {
        token: "ETH",
        premium: 2.3,
        underwriterYield: 3.9,
        tvl: 950000000,
        price: 3500,
        utilizationRate: 32.67,
        reserveFactor: 15,
        liquidationThreshold: 75.0,
        liquidationPenalty: 8.0,
        maxLTV: 70.0,
        optimalUtilization: 80,
        baseRate: 0,
        slope1: 0.04,
        slope2: 0.6,
      },
      {
        token: "USDC",
        premium: 1.5,
        underwriterYield: 3.2,
        tvl: 1100000000,
        price: 1,
        utilizationRate: 45.23,
        reserveFactor: 10,
        liquidationThreshold: 82.0,
        liquidationPenalty: 5.0,
        maxLTV: 77.0,
        optimalUtilization: 85,
        baseRate: 0.005,
        slope1: 0.03,
        slope2: 0.55,
      },
      {
        token: "AVAX",
        premium: 2.4,
        underwriterYield: 4.1,
        tvl: 320000000,
        price: 21.52,
        utilizationRate: 36.45,
        reserveFactor: 20,
        liquidationThreshold: 67.0,
        liquidationPenalty: 11.0,
        maxLTV: 62.0,
        optimalUtilization: 75,
        baseRate: 0.01,
        slope1: 0.05,
        slope2: 0.7,
      },
    ],
  },
  // ... other markets ...
]

const generateHistoricalData = (days = 30, baseValue, volatility = 0.1) => {
  const data = []
  let currentValue = baseValue
  const today = new Date() // Get today's date once

  for (let i = days; i >= 0; i--) {
    const date = new Date(today) // Start from today for each iteration
    date.setDate(today.getDate() - i) // Go back `i` days

    let change = 0
    // Add random variation only for past days
    if (i > 0) {
      change = (Math.random() - 0.5) * 2 * volatility * baseValue // Use a slightly wider random range if desired
      currentValue = Math.max(0.1, currentValue + change)
    } else {
      // Ensure today's value is the base value
      currentValue = baseValue
    }

    data.push({
      date: date.toISOString().split("T")[0], // Keep ISO date for potential processing
      value: Number.parseFloat(currentValue.toFixed(2)), // Store as number for calculations
    })
  }
  return data
}

// Calculate rate based on model parameters
const calculateRate = (utilization, optimalUtilization, baseRate, slope1, slope2) => {
  let rate
  utilization = Math.min(100, Math.max(0, utilization)) // Clamp utilization

  if (utilization <= optimalUtilization) {
    rate = baseRate + (utilization / Math.max(1, optimalUtilization)) * slope1 // Avoid div by zero if optimal is 0
  } else {
    const excessUtilization = utilization - optimalUtilization
    const remainingUtilization = Math.max(1, 100 - optimalUtilization) // Avoid div by zero if optimal is 100
    rate = baseRate + slope1 + (excessUtilization / remainingUtilization) * slope2
  }
  return rate * 100 // Return as percentage
}

// Generate interest rate model data points
const generateInterestRateModelData = (optimalUtilization, baseRate, slope1, slope2, steps = 41) => {
  // Increased steps
  const data = []
  const stepSize = 100 / (steps - 1)
  let addedOptimal = false

  for (let i = 0; i < steps; i++) {
    let utilization = i * stepSize
    utilization = Math.min(100, utilization) // Ensure 100 is max

    // Ensure the optimal point is included exactly
    if (!addedOptimal && utilization > optimalUtilization) {
      data.push({
        utilization: optimalUtilization,
        rate: calculateRate(optimalUtilization, optimalUtilization, baseRate, slope1, slope2),
      })
      addedOptimal = true
    }
    if (Math.abs(utilization - optimalUtilization) < 0.01) {
      addedOptimal = true
    }

    data.push({
      utilization,
      rate: calculateRate(utilization, optimalUtilization, baseRate, slope1, slope2),
    })
  }
  // Ensure 100% point is last if needed
  if (data[data.length - 1].utilization < 99.99) {
    // Check float precision
    data.push({
      utilization: 100,
      rate: calculateRate(100, optimalUtilization, baseRate, slope1, slope2),
    })
  }

  return data.sort((a, b) => a.utilization - b.utilization) // Sort to be safe
}

const formatCurrency = (value, currency = "usd", displayCurrency = "usd") => {
  if (value === undefined || value === null) return "N/A"
  if (displayCurrency === "usd") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(value)
  } else {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency.toUpperCase()}`
  }
}

const formatPercentage = (value, decimals = 2) => {
  if (value === undefined || value === null) return "N/A"
  return `${value.toFixed(decimals)}%` // Generally better not to assume APY
}

// Date Range Calculation
const getDateRange = (timeframe) => {
  const endDate = new Date()
  const startDate = new Date()
  let days = 30

  switch (timeframe) {
    case "3m":
      startDate.setMonth(startDate.getMonth() - 3)
      days = 90
      break
    case "1y":
      startDate.setFullYear(startDate.getFullYear() - 1)
      days = 365
      break
    case "1m":
    default:
      startDate.setMonth(startDate.getMonth() - 1)
      days = 30
      break
  }
  const options = { month: "short", day: "numeric", year: "numeric" }
  return {
    rangeString: `${startDate.toLocaleDateString("en-US", options)} - ${endDate.toLocaleDateString("en-US", options)}`,
    days,
  }
}

// Font for charts
const CHART_FONT = "11px Inter, sans-serif"
const AXIS_LABEL_FONT = "10px Inter, sans-serif"
const TOOLTIP_FONT = "10px Inter, sans-serif"

// --- Main Component ---
export default function PoolDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const { protocol, token } = params
  const [displayCurrency, setDisplayCurrency] = useState("usd")
  const [premiumTimeframe, setPremiumTimeframe] = useState("1m")
  const [yieldTimeframe, setYieldTimeframe] = useState("1m")
  const [isClient, setIsClient] = useState(false)

  // Inside the PoolDetailsPage component, add these state variables
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false)
  const [provideModalOpen, setProvideModalOpen] = useState(false)

  // Refs for canvas elements
  const premiumCanvasRef = useRef(null)
  const yieldCanvasRef = useRef(null)
  const interestRateCanvasRef = useRef(null)

  // State for hover interactions on history charts
  const [premiumHoverInfo, setPremiumHoverInfo] = useState(null) // { x: number, dataPoint: object } | null
  const [yieldHoverInfo, setYieldHoverInfo] = useState(null) // { x: number, dataPoint: object } | null

  // Find market and pool (memoized)
  const market = useMemo(() => markets.find((m) => m.id === protocol), [protocol])
  const pool = useMemo(() => market?.pools.find((p) => p.token === token), [market, token])

  // Generate data (memoized)
  const { data: premiumHistoryData, rangeString: premiumDateRange } = useMemo(() => {
    const { rangeString, days } = getDateRange(premiumTimeframe)
    const data = generateHistoricalData(days, pool?.premium || 2.5, 0.1) // Reduced volatility slightly
    return { data, rangeString }
  }, [pool?.premium, premiumTimeframe])

  const { data: yieldHistoryData, rangeString: yieldDateRange } = useMemo(() => {
    const { rangeString, days } = getDateRange(yieldTimeframe)
    const data = generateHistoricalData(days, pool?.underwriterYield || 4.0, 0.08) // Reduced volatility slightly
    return { data, rangeString }
  }, [pool?.underwriterYield, yieldTimeframe])

  const interestRateModelData = useMemo(() => {
    if (!pool) return []
    return generateInterestRateModelData(
      pool.optimalUtilization ?? 80,
      pool.baseRate ?? 0,
      pool.slope1 ?? 0.04,
      pool.slope2 ?? 0.6,
    )
  }, [pool])

  // Set client flag on mount
  useEffect(() => {
    setIsClient(true)
  }, [])

  // --- CANVAS DRAWING FUNCTIONS ---

  // Improved Interest Rate Model Draw Function
  const drawInterestRateChart = useCallback(
    (ctx) => {
      if (!ctx || !pool || !interestRateModelData || interestRateModelData.length === 0) return

      const canvas = ctx.canvas
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()

      // Set canvas size considering device pixel ratio for sharpness
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr) // Scale context to draw correctly

      const width = rect.width
      const height = rect.height
      const padding = { top: 20, right: 40, bottom: 35, left: 40 } // Increased padding
      const chartWidth = width - padding.left - padding.right
      const chartHeight = height - padding.top - padding.bottom

      // Theme detection
      const isDarkMode = document.documentElement.classList.contains("dark")
      const bgColor = isDarkMode ? "#11182b" : "#f9fafb" // Dark blue-gray or light gray
      const gridColor = isDarkMode ? "rgba(100, 116, 139, 0.2)" : "rgba(203, 213, 225, 0.5)" // Slate colors
      const textColor = isDarkMode ? "#cbd5e1" : "#4b5563" // Slate colors
      const axisColor = isDarkMode ? "#475569" : "#cbd5e1"
      const rateColor = "#ec4899" // Pink-500
      const optimalColor = "#22c55e" // Green-500
      const currentColor = "#3b82f6" // Blue-500

      // Clear canvas & Set background
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, width, height)

      // --- Axes and Grid ---
      ctx.lineWidth = 0.5
      ctx.strokeStyle = gridColor
      ctx.fillStyle = textColor
      ctx.font = AXIS_LABEL_FONT

      // Y-Axis (Rate)
      const maxRate = Math.max(...interestRateModelData.map((p) => p.rate)) * 1.1 // Add some top padding
      const minRate = 0 // Assuming rate doesn't go below 0
      const rateRange = maxRate - minRate

      const numYLabels = 5
      for (let i = 0; i <= numYLabels; i++) {
        const rateVal = minRate + (i / numYLabels) * rateRange
        const y = padding.top + chartHeight - (i / numYLabels) * chartHeight
        // Grid line
        ctx.beginPath()
        ctx.moveTo(padding.left - 4, y)
        ctx.lineTo(padding.left + chartWidth, y)
        ctx.stroke()
        // Label
        ctx.textAlign = "right"
        ctx.fillText(`${rateVal.toFixed(1)}%`, padding.left - 8, y + 3)
      }
      // Y-Axis Line
      ctx.beginPath()
      ctx.strokeStyle = axisColor
      ctx.lineWidth = 1
      ctx.moveTo(padding.left, padding.top)
      ctx.lineTo(padding.left, padding.top + chartHeight)
      ctx.stroke()
      // Y-Axis Title
      ctx.save()
      ctx.translate(padding.left - 30, padding.top + chartHeight / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = "center"
      ctx.font = CHART_FONT
      ctx.fillText("Premium Rate", 0, 0)
      ctx.restore()

      // X-Axis (Utilization)
      const numXLabels = 5
      for (let i = 0; i <= numXLabels; i++) {
        const utilVal = (i / numXLabels) * 100
        const x = padding.left + (i / numXLabels) * chartWidth
        // Grid line (vertical)
        ctx.beginPath()
        ctx.strokeStyle = gridColor
        ctx.lineWidth = 0.5
        ctx.moveTo(x, padding.top)
        ctx.lineTo(x, padding.top + chartHeight + 4)
        ctx.stroke()
        // Label
        ctx.textAlign = "center"
        ctx.fillText(`${utilVal.toFixed(0)}%`, x, padding.top + chartHeight + 15)
      }
      // X-Axis Line
      ctx.beginPath()
      ctx.strokeStyle = axisColor
      ctx.lineWidth = 1
      ctx.moveTo(padding.left, padding.top + chartHeight)
      ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight)
      ctx.stroke()
      // X-Axis Title
      ctx.textAlign = "center"
      ctx.font = CHART_FONT
      ctx.fillText("Utilization Rate", padding.left + chartWidth / 2, padding.top + chartHeight + 28)

      // Helper to map data point to canvas coordinates
      const mapToCanvas = (utilization, rate) => {
        const x = padding.left + (utilization / 100) * chartWidth
        const y = padding.top + chartHeight - ((rate - minRate) / rateRange) * chartHeight
        return { x, y }
      }

      // --- Draw Lines ---

      // Interest Rate Curve
      ctx.beginPath()
      ctx.lineWidth = 2
      ctx.strokeStyle = rateColor
      interestRateModelData.forEach((point, index) => {
        const { x, y } = mapToCanvas(point.utilization, point.rate)
        if (index === 0) {
          ctx.moveTo(x, y)
        } else {
          // Simple line for now, could use quadraticCurveTo for smoothing
          ctx.lineTo(x, y)
        }
      })
      ctx.stroke()

      // Optimal Utilization Line
      const optimalUtil = pool.optimalUtilization ?? 80
      const { x: optimalX } = mapToCanvas(optimalUtil, 0) // Get X for optimal util
      ctx.beginPath()
      ctx.lineWidth = 1
      ctx.strokeStyle = optimalColor
      ctx.setLineDash([4, 4])
      ctx.moveTo(optimalX, padding.top)
      ctx.lineTo(optimalX, padding.top + chartHeight)
      ctx.stroke()
      ctx.setLineDash([]) // Reset dash
      // Optimal Label
      ctx.fillStyle = optimalColor
      ctx.textAlign = "center"
      ctx.font = AXIS_LABEL_FONT
      ctx.fillText(`Optimal ${optimalUtil}%`, optimalX, padding.top - 5)

      // Current Utilization Line & Dot
      const currentUtil = pool.utilizationRate
      const currentRateValue = calculateRate(
        currentUtil,
        optimalUtil,
        pool.baseRate ?? 0,
        pool.slope1 ?? 0.04,
        pool.slope2 ?? 0.6,
      )
      const { x: currentX, y: currentY } = mapToCanvas(currentUtil, currentRateValue)

      ctx.beginPath()
      ctx.lineWidth = 1
      ctx.strokeStyle = currentColor
      ctx.setLineDash([4, 4])
      ctx.moveTo(currentX, padding.top)
      ctx.lineTo(currentX, padding.top + chartHeight)
      ctx.stroke()
      ctx.setLineDash([]) // Reset dash
      // Current Label
      ctx.fillStyle = currentColor
      ctx.textAlign = "center"
      ctx.font = AXIS_LABEL_FONT
      ctx.fillText(`Current ${currentUtil.toFixed(1)}%`, currentX, padding.top - 5)

      // Dot on the curve for current rate
      ctx.beginPath()
      ctx.fillStyle = currentColor
      ctx.strokeStyle = bgColor // Outline color same as background
      ctx.lineWidth = 2
      ctx.arc(currentX, currentY, 4, 0, Math.PI * 2) // Draw circle
      ctx.fill()
      ctx.stroke()
    },
    [pool, interestRateModelData],
  ) // Dependencies

  // History Chart Drawing Function (Combined for Premium/Yield)
  const drawHistoryChart = useCallback((ctx, dataPoints, colorRgb, avgLabel, hoverInfo) => {
    if (!ctx || !dataPoints || dataPoints.length === 0) return

    const canvas = ctx.canvas
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()

    // Set canvas size for sharpness
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const width = rect.width
    const height = rect.height
    const padding = { top: 20, right: 10, bottom: 20, left: 35 } // Adjust padding
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    const isDarkMode = document.documentElement.classList.contains("dark")
    const bgColor = isDarkMode ? "#1f2937" : "#f9fafb"
    const gridColor = isDarkMode ? "rgba(55, 65, 81, 0.5)" : "rgba(229, 231, 235, 0.7)" // Gray-700 / Gray-200
    const textColor = isDarkMode ? "#9ca3af" : "#6b7280" // Gray-400 / Gray-500
    const axisColor = isDarkMode ? "#4b5563" : "#d1d5db" // Gray-600 / Gray-300
    const lineColor = `rgb(${colorRgb})`
    const fillColor = `rgba(${colorRgb}, 0.1)` // Lighter fill

    // Clear canvas & Set background
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, width, height)

    // --- Data Calculation ---
    const values = dataPoints.map((p) => p.value)
    const avgValue = values.reduce((sum, val) => sum + val, 0) / values.length
    let minValue = Math.min(...values)
    let maxValue = Math.max(...values)
    const range = maxValue - minValue

    // Add padding, handle small range
    const paddingFactor = 0.05 // 5% padding
    if (range < 0.1) {
      minValue -= 0.1
      maxValue += 0.1
    } else {
      minValue -= range * paddingFactor
      maxValue += range * paddingFactor
    }
    minValue = Math.max(0, minValue) // Don't go below 0
    const valueRange = Math.max(0.1, maxValue - minValue) // Avoid div by zero

    // Helper to map data point to canvas coordinates
    const mapValueToY = (value) => padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight
    const mapIndexToX = (index) => padding.left + (index / Math.max(1, dataPoints.length - 1)) * chartWidth

    // --- Draw Grid & Axes ---
    ctx.lineWidth = 0.5
    ctx.strokeStyle = gridColor
    ctx.fillStyle = textColor
    ctx.font = AXIS_LABEL_FONT

    // Horizontal grid lines & Y-axis labels
    const numYLabels = 4
    for (let i = 0; i <= numYLabels; i++) {
      const val = minValue + (i / numYLabels) * valueRange
      const y = mapValueToY(val)
      ctx.beginPath()
      ctx.moveTo(padding.left - 4, y)
      ctx.lineTo(padding.left + chartWidth, y)
      ctx.stroke()
      ctx.textAlign = "right"
      ctx.fillText(`${val.toFixed(1)}%`, padding.left - 8, y + 3)
    }
    // Y-Axis Line
    ctx.beginPath()
    ctx.strokeStyle = axisColor
    ctx.lineWidth = 1
    ctx.moveTo(padding.left, padding.top)
    ctx.lineTo(padding.left, padding.top + chartHeight)
    ctx.stroke()

    // X-Axis (simplified - no date labels here, shown below chart)
    ctx.beginPath()
    ctx.strokeStyle = axisColor
    ctx.lineWidth = 1
    ctx.moveTo(padding.left, padding.top + chartHeight)
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight)
    ctx.stroke()

    // --- Draw Average Line ---
    const avgY = mapValueToY(avgValue)
    ctx.beginPath()
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3]) // Dashed line
    ctx.moveTo(padding.left, avgY)
    ctx.lineTo(padding.left + chartWidth, avgY)
    ctx.stroke()
    ctx.setLineDash([]) // Reset dash
    // Avg Label on Line
    ctx.fillStyle = isDarkMode ? "#e5e7eb" : "#374151" // Light/Dark text
    ctx.font = TOOLTIP_FONT // Smaller font
    ctx.textAlign = "right"
    ctx.fillText(`${avgLabel}: ${avgValue.toFixed(2)}%`, padding.left + chartWidth - 5, avgY - 5) // Position above line

    // --- Draw Data Line ---
    ctx.beginPath()
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1.5 // Slightly thicker data line
    dataPoints.forEach((point, index) => {
      const x = mapIndexToX(index)
      const y = mapValueToY(point.value)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // --- Fill Area Under Line ---
    ctx.lineTo(mapIndexToX(dataPoints.length - 1), mapValueToY(minValue)) // Go to bottom right
    ctx.lineTo(mapIndexToX(0), mapValueToY(minValue)) // Go to bottom left
    ctx.closePath()
    ctx.fillStyle = fillColor
    ctx.fill()

    // --- Draw Hover Cursor & Tooltip ---
    if (hoverInfo && hoverInfo.dataPoint) {
      const { x: hoverCanvasX, dataPoint } = hoverInfo // Use X from state

      // Vertical Line
      ctx.beginPath()
      ctx.strokeStyle = isDarkMode ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)"
      ctx.lineWidth = 1
      ctx.moveTo(hoverCanvasX, padding.top)
      ctx.lineTo(hoverCanvasX, padding.top + chartHeight)
      ctx.stroke()

      // Dot on the line
      const hoverY = mapValueToY(dataPoint.value)
      ctx.beginPath()
      ctx.fillStyle = lineColor
      ctx.strokeStyle = bgColor
      ctx.lineWidth = 2
      ctx.arc(hoverCanvasX, hoverY, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Tooltip
      const tooltipWidth = 100
      const tooltipHeight = 40
      let tooltipX = hoverCanvasX + 10
      const tooltipY = padding.top + 5 // Position near top

      // Adjust tooltip position if it goes off-screen
      if (tooltipX + tooltipWidth > width - padding.right) {
        tooltipX = hoverCanvasX - tooltipWidth - 10
      }
      if (tooltipX < padding.left) {
        tooltipX = padding.left + 5 // Fallback if too close left
      }

      ctx.fillStyle = isDarkMode ? "rgba(30, 41, 59, 0.9)" : "rgba(255, 255, 255, 0.9)" // Semi-transparent bg
      ctx.strokeStyle = isDarkMode ? "#475569" : "#e2e8f0" // Border
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.rect(tooltipX, tooltipY, tooltipWidth, tooltipHeight)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = isDarkMode ? "#f1f5f9" : "#1e293b" // Text color
      ctx.font = TOOLTIP_FONT
      ctx.textAlign = "left"
      const formattedDate = new Date(dataPoint.date + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) // Add time for correct parsing
      ctx.fillText(formattedDate, tooltipX + 5, tooltipY + 15)
      ctx.fillText(`Value: ${dataPoint.value.toFixed(2)}%`, tooltipX + 5, tooltipY + 30)
    }
  }, []) // Empty dependency array, relies on passed arguments

  // Mouse move handler for history charts
  const handleCanvasMouseMove = useCallback(
    (event, chartType) => {
      const canvas = event.currentTarget
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top // Could use Y later if needed

      const dataPoints = chartType === "premium" ? premiumHistoryData : yieldHistoryData
      if (!dataPoints || dataPoints.length === 0) return

      const dpr = window.devicePixelRatio || 1
      const canvasX = x * dpr // Mouse X relative to scaled canvas

      const width = rect.width
      const padding = { left: 35, right: 10 } // Match drawing padding
      const chartWidth = (width - padding.left - padding.right) * dpr

      // Calculate the approximate index based on mouse position
      const relativeX = canvasX - padding.left * dpr
      const indexRatio = Math.max(0, Math.min(1, relativeX / chartWidth))
      let index = Math.round(indexRatio * (dataPoints.length - 1))

      // Ensure index is within bounds
      index = Math.max(0, Math.min(dataPoints.length - 1, index))

      const dataPoint = dataPoints[index]
      // Map canvas X back to the unscaled coordinate for drawing consistency
      const drawX = padding.left + (index / Math.max(1, dataPoints.length - 1)) * (width - padding.left - padding.right)

      if (dataPoint) {
        const hoverData = { x: drawX, dataPoint } // Store unscaled X for drawing
        if (chartType === "premium") setPremiumHoverInfo(hoverData)
        else setYieldHoverInfo(hoverData)
      } else {
        if (chartType === "premium") setPremiumHoverInfo(null)
        else setYieldHoverInfo(null)
      }
    },
    [premiumHistoryData, yieldHistoryData],
  ) // Dependencies needed

  // Mouse leave handler
  const handleCanvasMouseLeave = useCallback((chartType) => {
    if (chartType === "premium") setPremiumHoverInfo(null)
    else setYieldHoverInfo(null)
  }, [])

  // Effect to Draw ALL Charts
  useEffect(() => {
    if (!isClient) return // Ensure client side

    // Interest Rate Chart
    const irCtx = interestRateCanvasRef.current?.getContext("2d")
    if (irCtx) {
      requestAnimationFrame(() => drawInterestRateChart(irCtx))
    }

    // Premium History Chart
    const premiumCtx = premiumCanvasRef.current?.getContext("2d")
    if (premiumCtx) {
      requestAnimationFrame(() =>
        drawHistoryChart(premiumCtx, premiumHistoryData, "59, 130, 246", "Avg Premium", premiumHoverInfo),
      )
    }

    // Yield History Chart
    const yieldCtx = yieldCanvasRef.current?.getContext("2d")
    if (yieldCtx) {
      requestAnimationFrame(() =>
        drawHistoryChart(yieldCtx, yieldHistoryData, "16, 185, 129", "Avg Yield", yieldHoverInfo),
      )
    }
    // Redraw when data, timeframe (implicitly via data), or hover info changes
  }, [
    isClient,
    interestRateModelData,
    premiumHistoryData,
    yieldHistoryData,
    premiumHoverInfo,
    yieldHoverInfo,
    drawInterestRateChart,
    drawHistoryChart,
  ])

  // --- Render Logic ---
  if (!isClient) {
    return (
      <div className="container mx-auto max-w-7xl p-4">
        <p>Loading pool details...</p>
      </div>
    )
  }

  if (!market || !pool) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-4">
        {/* ... (Not found component - same as before) ... */}
        <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">Pool Not Found</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          The requested pool ({protocol}/{token}) could not be found.
        </p>
        <Link
          href="/markets"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Markets
        </Link>
      </div>
    )
  }

  // --- JSX Structure ---
  return (
    <div className="container mx-auto max-w-7xl p-4 md:p-6 lg:p-8 font-sans">
      {/* ... (Back Link and Header - same as before) ... */}
      {/* Back Link */}
      <div className="mb-6">
        <Link
          href="/markets"
          className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Markets
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div className="flex items-center">
          <div className="flex-shrink-0 h-10 w-10 md:h-12 md:w-12 mr-3 md:mr-4">
            <Image
              src={`/images/tokens/${token?.toLowerCase()}.png`}
              alt={`${token} logo`}
              width={48}
              height={48}
              className="rounded-full bg-gray-200 dark:bg-gray-700"
              onError={(e) => {
                e.currentTarget.src = "/images/tokens/default.png"
                e.currentTarget.onerror = null
              }}
            />
          </div>
          <div>
            <h1 className="text-xl md:text-3xl font-bold text-gray-900 dark:text-white flex items-center flex-wrap gap-x-2">
              <span className="inline-flex items-center">
                <Image
                  src={`/images/protocols/${protocol}.png`}
                  alt={`${market.name} logo`}
                  width={24}
                  height={24}
                  className="rounded-full mr-2"
                  onError={(e) => {
                    e.currentTarget.style.display = "none"
                  }}
                />
                {market.name}
              </span>
              <span>{token} Pool</span>
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm md:text-base">{market.description}</p>
          </div>
        </div>
      </div>

      {/* Key metrics - Simplified formatting call */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
        {[
          { label: "Premium", value: formatPercentage(pool.premium, 1), colorClass: "text-gray-900 dark:text-white" },
          {
            label: "Underwriter Yield",
            value: formatPercentage(pool.underwriterYield, 1),
            colorClass: "text-green-600 dark:text-green-400",
          },
          { label: "Pool TVL", value: formatCurrency(pool.tvl), colorClass: "text-gray-900 dark:text-white" },
          {
            label: "Utilization",
            value: formatPercentage(pool.utilizationRate),
            colorClass: "text-blue-600 dark:text-blue-400",
          },
        ].map((metric) => (
          <div
            key={metric.label}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 sm:p-4 transition-shadow hover:shadow-md"
          >
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1">{metric.label}</div>
            <div className={`text-base sm:text-xl font-semibold ${metric.colorClass}`}>{metric.value}</div>
          </div>
        ))}
      </div>

      {/* --- Interest rate model - IMPROVED CANVAS --- */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 md:p-6 mb-8">
        {/* ... (Header and stats grid - same as before) ... */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
          <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white">Premium Rate Model</h2>
          <a
            href="#"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-xs sm:text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
          >
            Interest Rate Strategy <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 text-center sm:text-left">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Current Utilization</div>
            <div className="text-lg font-medium text-blue-600 dark:text-blue-400">
              {formatPercentage(pool.utilizationRate)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Current Premium</div>
            <div className="text-lg font-medium text-pink-600 dark:text-pink-400">
              {formatPercentage(
                calculateRate(
                  pool.utilizationRate,
                  pool.optimalUtilization ?? 80,
                  pool.baseRate ?? 0,
                  pool.slope1 ?? 0.04,
                  pool.slope2 ?? 0.6,
                ),
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Optimal Utilization</div>
            <div className="text-lg font-medium text-gray-700 dark:text-gray-300">
              {formatPercentage(pool.optimalUtilization ?? 80)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Rate at Optimal</div>
            <div className="text-lg font-medium text-gray-700 dark:text-gray-300">
              {formatPercentage(
                calculateRate(
                  pool.optimalUtilization ?? 80,
                  pool.optimalUtilization ?? 80,
                  pool.baseRate ?? 0,
                  pool.slope1 ?? 0.04,
                  pool.slope2 ?? 0.6,
                ),
              )}
            </div>
          </div>
        </div>

        {/* Interest Rate Model Canvas */}
        <div className="h-64 md:h-72 w-full rounded-md overflow-hidden">
          {" "}
          {/* Added overflow hidden */}
          <canvas ref={interestRateCanvasRef} className="w-full h-full block" /> {/* Added block display */}
        </div>
      </div>

      {/* --- Historical charts - CANVAS WITH HOVER & AVG LINE --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mb-8">
        {/* Premium history */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 md:p-6 flex flex-col">
          <h2 className="text-lg md:text-xl font-semibold mb-4 text-gray-900 dark:text-white">Premium History</h2>
          {/* Premium history chart container */}
          <div className="h-48 bg-gray-50 dark:bg-gray-900/50 rounded-md mb-4 flex-grow relative overflow-hidden cursor-crosshair">
            {" "}
            {/* Added cursor style */}
            <canvas
              ref={premiumCanvasRef}
              className="w-full h-full absolute top-0 left-0" // Use absolute positioning to overlay easily
              onMouseMove={(e) => handleCanvasMouseMove(e, "premium")}
              onMouseLeave={() => handleCanvasMouseLeave("premium")}
            />
          </div>
          {/* Detached Buttons & Date Range */}
          <div className="flex justify-center space-x-2">
            {/* ... Buttons (same as before) ... */}
            {[
              { label: "1M", value: "1m" },
              { label: "3M", value: "3m" },
              { label: "1Y", value: "1y" },
            ].map((btn) => (
              <button
                key={btn.value}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${premiumTimeframe === btn.value ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
                onClick={() => setPremiumTimeframe(btn.value)}
              >
                {btn.label}
              </button>
            ))}
          </div>
          <div className="text-center text-xs text-gray-500 dark:text-gray-400 mt-2">{premiumDateRange}</div>
        </div>

        {/* Yield history */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 md:p-6 flex flex-col">
          <h2 className="text-lg md:text-xl font-semibold mb-4 text-gray-900 dark:text-white">
            Underwriter Yield History
          </h2>
          {/* Yield history chart container */}
          <div className="h-48 bg-gray-50 dark:bg-gray-900/50 rounded-md mb-4 flex-grow relative overflow-hidden cursor-crosshair">
            {" "}
            {/* Added cursor style */}
            <canvas
              ref={yieldCanvasRef}
              className="w-full h-full absolute top-0 left-0"
              onMouseMove={(e) => handleCanvasMouseMove(e, "yield")}
              onMouseLeave={() => handleCanvasMouseLeave("yield")}
            />
          </div>
          {/* Detached Buttons & Date Range */}
          <div className="flex justify-center space-x-2">
            {/* ... Buttons (same as before) ... */}
            {[
              { label: "1M", value: "1m" },
              { label: "3M", value: "3m" },
              { label: "1Y", value: "1y" },
            ].map((btn) => (
              <button
                key={btn.value}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${yieldTimeframe === btn.value ? "bg-green-600 text-white shadow-sm" : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
                onClick={() => setYieldTimeframe(btn.value)}
              >
                {btn.label}
              </button>
            ))}
          </div>
          <div className="text-center text-xs text-gray-500 dark:text-gray-400 mt-2">{yieldDateRange}</div>
        </div>
      </div>

      {/* ... (Reserve configuration and Action buttons - same as before) ... */}
      {/* Reserve configuration */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 md:p-6 mb-8">
        <h2 className="text-lg md:text-xl font-semibold mb-4 text-gray-900 dark:text-white">Reserve Configuration</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Reserve Factor", value: formatPercentage(pool.reserveFactor) },
            { label: "Max LTV", value: formatPercentage(pool.maxLTV) },
            { label: "Liq. Threshold", value: formatPercentage(pool.liquidationThreshold) },
            { label: "Liq. Penalty", value: formatPercentage(pool.liquidationPenalty) },
          ].map((item) => (
            <div key={item.label}>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1">{item.label}</div>
              <div className="text-base sm:text-lg font-medium text-gray-800 dark:text-gray-200">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3 md:gap-4 mb-8">
        <button
          className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors duration-150 ease-in-out text-sm sm:text-base flex items-center justify-center shadow-sm hover:shadow"
          onClick={() => setPurchaseModalOpen(true)}
        >
          Purchase Coverage
        </button>
        <button
          className="flex-1 py-2.5 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors duration-150 ease-in-out text-sm sm:text-base flex items-center justify-center shadow-sm hover:shadow"
          onClick={() => setProvideModalOpen(true)}
        >
          Provide Coverage
        </button>
      </div>

      {/* Coverage Modals */}
      <CoverageModal
        isOpen={purchaseModalOpen}
        onClose={() => setPurchaseModalOpen(false)}
        type="purchase"
        protocol={market.name}
        token={token}
        premium={pool.premium}
        yield={pool.underwriterYield}
      />

      <CoverageModal
        isOpen={provideModalOpen}
        onClose={() => setProvideModalOpen(false)}
        type="provide"
        protocol={market.name}
        token={token}
        premium={pool.premium}
        yield={pool.underwriterYield}
      />
    </div>
  )
}
