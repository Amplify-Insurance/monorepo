"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useParams } from "next/navigation"
import { ArrowLeft, ExternalLink } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import CoverageModal from "../../../components/CoverageModal"
import usePools from "../../../../hooks/usePools"
import useReserveConfig from "../../../../hooks/useReserveConfig"
import usePoolHistory from "../../../../hooks/usePoolHistory"
import PageLoader from "../../../components/PageLoader"
import {
  getProtocolName,
  getProtocolDescription,
  getProtocolLogo,
  getTokenLogo,
} from "../../../config/tokenNameMap"

// Helper formatting functions
const formatCurrency = (value, currency = "usd", displayCurrency = "usd") => {
  if (value === undefined || value === null) return "N/A"
  if (displayCurrency === "usd") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(value)
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency.toUpperCase()}`
}

const formatPercentage = (value, decimals = 2) => {
  if (value === undefined || value === null) return "N/A"
  return `${value.toFixed(decimals)}%`
}

const CHART_FONT = "11px Inter, sans-serif"
const AXIS_LABEL_FONT = "10px Inter, sans-serif"
const TOOLTIP_FONT = "10px Inter, sans-serif"

// Calculate rate from interest model
const calculateRate = (utilization, optimalUtilization, baseRate, slope1, slope2) => {
  utilization = Math.min(100, Math.max(0, utilization))
  let rate
  if (utilization <= optimalUtilization) {
    rate = baseRate + (utilization / Math.max(1, optimalUtilization)) * slope1
  } else {
    const excessUtil = utilization - optimalUtilization
    const rem = Math.max(1, 100 - optimalUtilization)
    rate = baseRate + slope1 + (excessUtil / rem) * slope2
  }
  return rate * 100
}

const generateInterestRateModelData = (optimalUtilization, baseRate, slope1, slope2, steps = 41) => {
  const data = []
  const stepSize = 100 / (steps - 1)
  for (let i = 0; i < steps; i++) {
    const u = Math.min(100, i * stepSize)
    data.push({
      utilization: u,
      rate: calculateRate(u, optimalUtilization, baseRate, slope1, slope2),
    })
  }
  return data
}

export default function PoolDetailsPage() {
  const params = useParams()
  const { protocol, token } = params
  const [isClient, setIsClient] = useState(false)
  const [premiumTimeframe, setPremiumTimeframe] = useState("1m")
  const [utilTimeframe, setUtilTimeframe] = useState("1m")
  const poolId = useMemo(() => {
    if (!protocol) return null
    if (!isNaN(Number(protocol))) return Number(protocol)
    const mapping = { aave: 0, compound: 1, moonwell: 2, morpho: 3, euler: 4 }
    return mapping[protocol] ?? null
  }, [protocol])
  const {
    premiumHistory,
    utilHistory,
  } = usePoolHistory(poolId)
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false)
  const [provideModalOpen, setProvideModalOpen] = useState(false)

  const premiumCanvasRef = useRef(null)
  const utilCanvasRef = useRef(null)
  const irCanvasRef = useRef(null)

  useEffect(() => {
    setIsClient(true)
  }, [])

  const { pools, loading: poolsLoading } = usePools()

  const pool = useMemo(
    () =>
      pools.find(
        (p) => Number(p.id) === poolId && p.protocolTokenToCover.toLowerCase() === token.toLowerCase(),
      ),
    [pools, poolId, token],
  )

  const { config: reserveConfig } = useReserveConfig(pool?.deployment)

  const market = useMemo(
    () =>
      poolId != null
        ? {
            id: poolId,
            name: getProtocolName(poolId),
            description: getProtocolDescription(poolId),
            logo: getProtocolLogo(poolId),
          }
        : null,
    [poolId],
  )

  // Derive numeric metrics from the raw pool info
  const processedPool = useMemo(() => {
    if (!pool) return null
    const decimals = Number(pool.protocolTokenDecimals ?? 18)
    const pledged = BigInt(pool.totalCapitalPledgedToPool || 0)
    const sold = BigInt(pool.totalCoverageSold || 0)
    const tvl = Number((pledged / (10n ** BigInt(decimals))).toString())
    const utilization = pledged > 0n ? Number((sold * 10000n) / pledged) / 100 : 0
    return {
      premium: Number(pool.premiumRateBps || 0) / 100,
      underwriterYield: Number(pool.underwriterYieldBps || 0) / 100,
      tvl,
      utilizationRate: utilization,
      rateModel: pool.rateModel,
    }
  }, [pool])

  const rateParams = useMemo(() => {
    if (!processedPool) {
      return { optimal: 80, base: 0, s1: 0.04, s2: 0.6 }
    }
    return {
      optimal: Number(processedPool.rateModel?.kink ?? 8000) / 100,
      base: Number(processedPool.rateModel?.base ?? 0) / 10000,
      s1: Number(processedPool.rateModel?.slope1 ?? 0) / 10000,
      s2: Number(processedPool.rateModel?.slope2 ?? 0) / 10000,
    }
  }, [processedPool])


  const interestRateData = useMemo(() => {
    if (!processedPool) return []
    return generateInterestRateModelData(
      rateParams.optimal,
      rateParams.base,
      rateParams.s1,
      rateParams.s2,
    )
  }, [processedPool, rateParams])

  // Drawing helpers
  const drawInterestRateChart = useCallback(
    (ctx) => {
      if (!ctx || !processedPool || !interestRateData.length) return
      const canvas = ctx.canvas
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
      const width = rect.width
      const height = rect.height
      const padding = { top: 20, right: 40, bottom: 35, left: 40 }
      const chartWidth = width - padding.left - padding.right
      const chartHeight = height - padding.top - padding.bottom
      const isDark = document.documentElement.classList.contains("dark")
      const bg = isDark ? "#11182b" : "#ffffff"
      const grid = isDark ? "rgba(100,116,139,0.2)" : "rgba(203,213,225,0.3)"
      const text = isDark ? "#cbd5e1" : "#6b7280"
      const axis = isDark ? "#475569" : "#e5e7eb"
      const rateColor = "#ec4899"
      const optimalColor = "#22c55e"
      const currentColor = "#3b82f6"

      ctx.fillStyle = bg
      ctx.fillRect(0, 0, width, height)
      ctx.lineWidth = 0.5
      ctx.strokeStyle = grid
      ctx.fillStyle = text
      ctx.font = AXIS_LABEL_FONT

      const maxRate = Math.max(...interestRateData.map((p) => p.rate)) * 1.1
      const numY = 5
      for (let i = 0; i <= numY; i++) {
        const r = (i / numY) * maxRate
        const y = padding.top + chartHeight - (i / numY) * chartHeight
        ctx.beginPath()
        ctx.moveTo(padding.left - 4, y)
        ctx.lineTo(padding.left + chartWidth, y)
        ctx.stroke()
        ctx.textAlign = "right"
        ctx.fillText(`${r.toFixed(1)}%`, padding.left - 8, y + 3)
      }
      ctx.beginPath()
      ctx.strokeStyle = axis
      ctx.lineWidth = 1
      ctx.moveTo(padding.left, padding.top)
      ctx.lineTo(padding.left, padding.top + chartHeight)
      ctx.stroke()
      ctx.save()
      ctx.translate(padding.left - 45, padding.top + chartHeight / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = "center"
      ctx.font = CHART_FONT
      ctx.fillText("Premium Rate", 0, 0)
      ctx.restore()

      const numX = 5
      for (let i = 0; i <= numX; i++) {
        const u = (i / numX) * 100
        const x = padding.left + (i / numX) * chartWidth
        ctx.beginPath()
        ctx.strokeStyle = grid
        ctx.moveTo(x, padding.top)
        ctx.lineTo(x, padding.top + chartHeight + 4)
        ctx.stroke()
        ctx.textAlign = "center"
        ctx.fillText(`${u.toFixed(0)}%`, x, padding.top + chartHeight + 15)
      }
      ctx.beginPath()
      ctx.strokeStyle = axis
      ctx.moveTo(padding.left, padding.top + chartHeight)
      ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight)
      ctx.stroke()
      ctx.textAlign = "center"
      ctx.font = CHART_FONT
      ctx.fillText("Utilization Rate", padding.left + chartWidth / 2, padding.top + chartHeight + 28)

      const map = (u, r) => {
        const x = padding.left + (u / 100) * chartWidth
        const y = padding.top + chartHeight - (r / maxRate) * chartHeight
        return { x, y }
      }

      ctx.beginPath()
      ctx.lineWidth = 2
      ctx.strokeStyle = rateColor
      interestRateData.forEach((p, i) => {
        const { x, y } = map(p.utilization, p.rate)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      const optimal = rateParams.optimal
      const { x: optX } = map(optimal, 0)
      ctx.beginPath()
      ctx.lineWidth = 1
      ctx.strokeStyle = optimalColor
      ctx.setLineDash([4,4])
      ctx.moveTo(optX, padding.top)
      ctx.lineTo(optX, padding.top + chartHeight)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = optimalColor
      ctx.textAlign = "center"
      ctx.font = AXIS_LABEL_FONT
      ctx.fillText(`Optimal ${optimal}%`, optX, padding.top - 5)

      const currentUtil = processedPool.utilizationRate
      const base = rateParams.base
      const s1 = rateParams.s1
      const s2 = rateParams.s2
      const currentRate = calculateRate(currentUtil, optimal, base, s1, s2)
      const { x: curX, y: curY } = map(currentUtil, currentRate)
      ctx.beginPath()
      ctx.lineWidth = 1
      ctx.strokeStyle = currentColor
      ctx.setLineDash([4,4])
      ctx.moveTo(curX, padding.top)
      ctx.lineTo(curX, padding.top + chartHeight)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = currentColor
      ctx.textAlign = "center"
      ctx.font = AXIS_LABEL_FONT
      ctx.fillText(`Current ${currentUtil.toFixed(1)}%`, curX, padding.top - 5)
      ctx.beginPath()
      ctx.fillStyle = currentColor
      ctx.strokeStyle = bg
      ctx.lineWidth = 2
      ctx.arc(curX, curY, 4, 0, Math.PI*2)
      ctx.fill()
      ctx.stroke()
    }, [processedPool, interestRateData, rateParams])

  const drawHistoryChart = useCallback((ctx, dataPoints, colorRgb) => {
    if (!ctx || !dataPoints.length) return
    const canvas = ctx.canvas
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    const width = rect.width
    const height = rect.height
    const padding = { top: 20, right: 10, bottom: 20, left: 35 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom
    const isDark = document.documentElement.classList.contains("dark")
    const bg = isDark ? "#1f2937" : "#f9fafb"
    const grid = isDark ? "rgba(55,65,81,0.5)" : "rgba(229,231,235,0.7)"
    const text = isDark ? "#9ca3af" : "#6b7280"
    const axis = isDark ? "#4b5563" : "#d1d5db"
    const lineColor = `rgb(${colorRgb})`
    const fillColor = `rgba(${colorRgb},0.1)`

    ctx.fillStyle = bg
    ctx.fillRect(0,0,width,height)

    const values = dataPoints.map(p => p.value)
    const avg = values.reduce((s,v)=>s+v,0)/values.length
    let min = Math.min(...values)
    let max = Math.max(...values)
    const range = max-min
    if (range < 0.1) { min -= 0.1; max += 0.1 } else { min -= range*0.05; max += range*0.05 }
    min = Math.max(0,min)
    const valueRange = Math.max(0.1, max-min)

    const mapVal = val => padding.top + chartHeight - ((val-min)/valueRange)*chartHeight
    const mapIdx = idx => padding.left + (idx/Math.max(1,dataPoints.length-1))*chartWidth

    ctx.lineWidth = 0.5
    ctx.strokeStyle = grid
    ctx.fillStyle = text
    ctx.font = AXIS_LABEL_FONT
    const numY = 4
    for (let i=0;i<=numY;i++) {
      const val = min + (i/numY)*valueRange
      const y = mapVal(val)
      ctx.beginPath()
      ctx.moveTo(padding.left-4,y)
      ctx.lineTo(padding.left+chartWidth,y)
      ctx.stroke()
      ctx.textAlign = "right"
      ctx.fillText(`${val.toFixed(1)}%`, padding.left-8, y+3)
    }
    ctx.beginPath()
    ctx.strokeStyle = axis
    ctx.lineWidth = 1
    ctx.moveTo(padding.left, padding.top)
    ctx.lineTo(padding.left, padding.top+chartHeight)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(padding.left, padding.top+chartHeight)
    ctx.lineTo(padding.left+chartWidth, padding.top+chartHeight)
    ctx.stroke()

    const avgY = mapVal(avg)
    ctx.beginPath()
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1
    ctx.setLineDash([3,3])
    ctx.moveTo(padding.left, avgY)
    ctx.lineTo(padding.left+chartWidth, avgY)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.beginPath()
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1.5
    dataPoints.forEach((p,i)=>{
      const x = mapIdx(i)
      const y = mapVal(p.value)
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y)
    })
    ctx.stroke()
    ctx.lineTo(mapIdx(dataPoints.length-1), mapVal(min))
    ctx.lineTo(mapIdx(0), mapVal(min))
    ctx.closePath()
    ctx.fillStyle = fillColor
    ctx.fill()
  }, [])

  useEffect(() => {
    if (!isClient) return
    const irCtx = irCanvasRef.current?.getContext("2d")
    irCtx && requestAnimationFrame(() => drawInterestRateChart(irCtx))
    const pCtx = premiumCanvasRef.current?.getContext("2d")
    pCtx && requestAnimationFrame(() => drawHistoryChart(pCtx, premiumHistory, "59,130,246"))
    const uCtx = utilCanvasRef.current?.getContext("2d")
    uCtx && requestAnimationFrame(() => drawHistoryChart(uCtx, utilHistory, "16,185,129"))
  }, [isClient, interestRateData, premiumHistory, utilHistory, drawInterestRateChart, drawHistoryChart])

  if (!isClient || poolsLoading) return <PageLoader />
  if (!market || !pool) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-4">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">Pool Not Found</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">The requested pool ({protocol}/{token}) could not be found.</p>
        <Link href="/markets" className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"><ArrowLeft className="mr-2 h-4 w-4"/> Back to Markets</Link>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-7xl p-4 md:p-6 lg:p-8 font-sans">
      <div className="mb-6">
        <Link href="/markets" className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors">
          <ArrowLeft className="mr-1.5 h-4 w-4"/> Back to Markets
        </Link>
      </div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div className="flex items-center">
          <div className="flex-shrink-0 h-10 w-10 md:h-12 md:w-12 mr-3 md:mr-4">
            <Image src={getTokenLogo(token)} alt={`${token} logo`} width={48} height={48} className="rounded-full bg-gray-200 dark:bg-gray-700" onError={(e)=>{e.currentTarget.src='/images/tokens/default.png';e.currentTarget.onerror=null}}/>
          </div>
          <div>
            <h1 className="text-xl md:text-3xl font-bold text-gray-900 dark:text-white flex items-center flex-wrap gap-x-2">
              <span className="inline-flex items-center">
                <Image src={market.logo} alt={`${market.name} logo`} width={24} height={24} className="rounded-full mr-2" onError={(e)=>{e.currentTarget.style.display='none'}}/>
                {market.name}
              </span>
              <span>{token} Pool</span>
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm md:text-base">{market.description}</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
        {[{label:'Premium',value:formatPercentage(processedPool?.premium ?? 0,1),colorClass:'text-gray-900 dark:text-white'},{label:'Underwriter Yield',value:formatPercentage(processedPool?.underwriterYield ?? 0,1),colorClass:'text-green-600 dark:text-green-400'},{label:'Pool TVL',value:formatCurrency(processedPool?.tvl),colorClass:'text-gray-900 dark:text-white'},{label:'Utilization',value:formatPercentage(processedPool?.utilizationRate ?? 0),colorClass:'text-blue-600 dark:text-blue-400'}].map(m=>(
          <div key={m.label} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 sm:p-4 transition-shadow hover:shadow-md">
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1">{m.label}</div>
            <div className={`text-base sm:text-xl font-semibold ${m.colorClass}`}>{m.value}</div>
          </div>
        ))}
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 md:p-6 mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
          <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white">Premium Rate Model</h2>
          <a href="#" target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-xs sm:text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors">Interest Rate Strategy <ExternalLink className="ml-1 h-3.5 w-3.5"/></a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 text-center sm:text-left">
          <div><div className="text-xs text-gray-500 dark:text-gray-400">Current Utilization</div><div className="text-lg font-medium text-blue-600 dark:text-blue-400">{formatPercentage(processedPool?.utilizationRate ?? 0)}</div></div>
          <div><div className="text-xs text-gray-500 dark:text-gray-400">Current Premium</div><div className="text-lg font-medium text-pink-600 dark:text-pink-400">{formatPercentage(calculateRate(processedPool?.utilizationRate ?? 0,rateParams.optimal,rateParams.base,rateParams.s1,rateParams.s2))}</div></div>
          <div><div className="text-xs text-gray-500 dark:text-gray-400">Optimal Utilization</div><div className="text-lg font-medium text-gray-700 dark:text-gray-300">{formatPercentage(rateParams.optimal)}</div></div>
          <div><div className="text-xs text-gray-500 dark:text-gray-400">Rate at Optimal</div><div className="text-lg font-medium text-gray-700 dark:text-gray-300">{formatPercentage(calculateRate(rateParams.optimal,rateParams.optimal,rateParams.base,rateParams.s1,rateParams.s2))}</div></div>
        </div>
        <div className="h-64 md:h-72 w-full rounded-md overflow-hidden"><canvas ref={irCanvasRef} className="w-full h-full block"/></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 md:p-6 flex flex-col">
          <h2 className="text-lg md:text-xl font-semibold mb-4 text-gray-900 dark:text-white">Premium History</h2>
          <div className="h-48 bg-gray-50 dark:bg-gray-900/50 rounded-md mb-4 flex-grow relative overflow-hidden"><canvas ref={premiumCanvasRef} className="w-full h-full absolute top-0 left-0"/></div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 md:p-6 flex flex-col">
          <h2 className="text-lg md:text-xl font-semibold mb-4 text-gray-900 dark:text-white">Utilization History</h2>
          <div className="h-48 bg-gray-50 dark:bg-gray-900/50 rounded-md mb-4 flex-grow relative overflow-hidden"><canvas ref={utilCanvasRef} className="w-full h-full absolute top-0 left-0"/></div>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 md:p-6 mb-8">
        <h2 className="text-lg md:text-xl font-semibold mb-4 text-gray-900 dark:text-white">Reserve Configuration</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            {label:'Cover Cooldown', value: reserveConfig ? `${reserveConfig.coverCooldownPeriod / 86400}d` : 'N/A'},
            {label:'Claim Fee', value: reserveConfig ? formatPercentage(reserveConfig.claimFeeBps / 100) : 'N/A'},
            {label:'Notice Period', value: reserveConfig ? `${reserveConfig.underwriterNoticePeriod / 86400}d` : 'N/A'},
          ].map(item=>(
            <div key={item.label}><div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1">{item.label}</div><div className="text-base sm:text-lg font-medium text-gray-800 dark:text-gray-200">{item.value}</div></div>
          ))}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 md:gap-4 mb-8">
        <button className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors duration-150 ease-in-out text-sm sm:text-base flex items-center justify-center shadow-sm hover:shadow" onClick={()=>setPurchaseModalOpen(true)}>Purchase Coverage</button>
        <button className="flex-1 py-2.5 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors duration-150 ease-in-out text-sm sm:text-base flex items-center justify-center shadow-sm hover:shadow" onClick={()=>setProvideModalOpen(true)}>Provide Coverage</button>
      </div>
      <CoverageModal isOpen={purchaseModalOpen} onClose={()=>setPurchaseModalOpen(false)} type="purchase" protocol={market.name} token={token} premium={processedPool?.premium} yield={processedPool?.underwriterYield} deployment={pool?.deployment}/>
      <CoverageModal isOpen={provideModalOpen} onClose={()=>setProvideModalOpen(false)} type="provide" protocol={market.name} token={token} premium={processedPool?.premium} yield={processedPool?.underwriterYield} deployment={pool?.deployment}/>
    </div>
  )
}
