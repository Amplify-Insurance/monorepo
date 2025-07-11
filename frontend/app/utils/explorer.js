import React from 'react'
import { config } from '../config'
import { toast } from '@/hooks/use-toast'

// Helper used by tx notifications
export const getTxExplorerUrl = (hash) => {
  const base = config?.chains?.[0]?.blockExplorers?.default?.url || 'https://basescan.org'
  return `${base}/tx/${hash}`
}

export const notifyTx = async (tx, name, addTx) => {
  const url = getTxExplorerUrl(tx.hash)
  const { update, dismiss } = toast({
    title: `${name} Submitted`,
    description: (
      <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
        View on block explorer
      </a>
    ),
  })
  addTx && addTx({ hash: tx.hash, name, status: 'submitted', timestamp: Date.now() })
  try {
    await tx.wait()
    update({
      title: `${name} Confirmed`,
      description: (
        <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
          View on block explorer
        </a>
      ),
    })
    addTx && addTx({ hash: tx.hash, name, status: 'confirmed', timestamp: Date.now() })
  } catch (err) {
    update({
      variant: 'destructive',
      title: `${name} Failed`,
      description: err.message,
    })
  }
  setTimeout(() => dismiss(), 10000)
}


