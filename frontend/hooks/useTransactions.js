"use client"
import { createContext, useContext, useEffect, useState } from "react"

const TxContext = createContext({ transactions: [], addTransaction: () => {} })
const STORAGE_KEY = "txHistory"

export function TransactionsProvider({ children }) {
  const [transactions, setTransactions] = useState([])

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        setTransactions(JSON.parse(stored))
      } catch {}
    }
  }, [])

  const addTransaction = (tx) => {
    setTransactions((prev) => {
      const updated = [tx, ...prev].slice(0, 20)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }

  return (
    <TxContext.Provider value={{ transactions, addTransaction }}>
      {children}
    </TxContext.Provider>
  )
}

export const useTransactions = () => useContext(TxContext)
