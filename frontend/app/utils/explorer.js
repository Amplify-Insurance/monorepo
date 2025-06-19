import React from 'react'
import { config } from '../config'
import { toast } from '@/hooks/use-toast'

export const getTxExplorerUrl = (hash) => {
  const base = config?.chains?.[0]?.blockExplorers?.default?.url || 'https://basescan.org'
  return `${base}/tx/${hash}`
}

export const notifyTx = (hash) => {
  toast({
    title: 'Transaction Submitted',
    description: (
      <a href={getTxExplorerUrl(hash)} target="_blank" rel="noopener noreferrer" className="underline">
        View on block explorer
      </a>
    ),
  })
}
