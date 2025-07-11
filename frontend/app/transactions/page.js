"use client"
import { useTransactions } from "../../hooks/useTransactions"
import { getTxExplorerUrl } from "../utils/explorer"

export default function TransactionsPage() {
  const { transactions } = useTransactions() || { transactions: [] }

  return (
    <div className="container mx-auto max-w-7xl">
      <h1 className="text-3xl font-bold mb-6">Transaction History</h1>
      {transactions.length === 0 ? (
        <p>No transactions yet.</p>
      ) : (
        <ul className="space-y-3">
          {transactions.map((tx, idx) => (
            <li key={idx} className="flex items-center justify-between p-4 border rounded-lg bg-white dark:bg-gray-800">
              <div>
                <p className="font-medium">{tx.name}</p>
                <p className="text-xs text-gray-500">{new Date(tx.timestamp).toLocaleString()}</p>
              </div>
              <a href={getTxExplorerUrl(tx.hash)} target="_blank" rel="noopener noreferrer" className="underline text-blue-600">
                View
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
