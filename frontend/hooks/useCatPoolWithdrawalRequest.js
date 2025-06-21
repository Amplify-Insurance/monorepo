import { useEffect, useState } from 'react'

const STORAGE_PREFIX = 'catpool-withdrawal-'
const NOTICE_PERIOD = 30 * 24 * 60 * 60 // 30 days in seconds

export default function useCatPoolWithdrawalRequest(address) {
  const [request, setRequest] = useState(null)

  useEffect(() => {
    if (!address) return
    const data = localStorage.getItem(STORAGE_PREFIX + address.toLowerCase())
    if (data) setRequest(JSON.parse(data))
  }, [address])

  const createRequest = (shares) => {
    if (!address) return
    const req = { timestamp: Math.floor(Date.now() / 1000), shares }
    localStorage.setItem(
      STORAGE_PREFIX + address.toLowerCase(),
      JSON.stringify(req),
    )
    setRequest(req)
  }

  const clearRequest = () => {
    if (!address) return
    localStorage.removeItem(STORAGE_PREFIX + address.toLowerCase())
    setRequest(null)
  }

  return { request, createRequest, clearRequest, NOTICE_PERIOD }
}
