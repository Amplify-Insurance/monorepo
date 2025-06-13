"use client"

import { useState } from "react"
import { useAccount } from "wagmi"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import ProposalsTable from "../components/ProposalsTable"
import { HelpCircle } from "lucide-react"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet"
import StakeModal from "../components/StakeModal"
import BondModal from "../components/BondModal"

export default function StakingPage() {
  const { isConnected } = useAccount()
  const [stakeOpen, setStakeOpen] = useState(false)
  const [bondOpen, setBondOpen] = useState(false)
  const [stakeInfoOpen, setStakeInfoOpen] = useState(false)
  const [bondInfoOpen, setBondInfoOpen] = useState(false)


  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-2xl font-bold mb-6">Connect your wallet to participate in governance</h1>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Governance</h1>
        <p className="text-gray-600 dark:text-gray-300 mt-1">Stake tokens and deposit a bond to participate in governance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <div className="flex items-center">
            <h2 className="text-xl font-semibold">Stake Voting Token</h2>
            <Sheet open={stakeInfoOpen} onOpenChange={setStakeInfoOpen}>
              <SheetTrigger className="ml-2 text-gray-500 hover:text-gray-700">
                <HelpCircle className="w-4 h-4" />
              </SheetTrigger>
              <SheetContent side="right" className="w-1/3 sm:max-w-none text-black dark:text-white">
                <SheetHeader>
                  <SheetTitle>Stake Voting Token</SheetTitle>
                </SheetHeader>
                <div className="mt-4 text-sm">
                  Calling <code>stake(amount)</code> on the staking contract locks your governance tokens and mints voting power used by the <code>Committee</code> contract. You can withdraw later by invoking <code>unstake(amount)</code>.
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <button
            onClick={() => setStakeOpen(true)}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            Stake
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <div className="flex items-center">
            <h2 className="text-xl font-semibold">Deposit Bond</h2>
            <Sheet open={bondInfoOpen} onOpenChange={setBondInfoOpen}>
              <SheetTrigger className="ml-2 text-gray-500 hover:text-gray-700">
                <HelpCircle className="w-4 h-4" />
              </SheetTrigger>
              <SheetContent side="right" className="w-1/3 sm:max-w-none text-black dark:text-white">
                <SheetHeader>
                  <SheetTitle>Deposit Bond</SheetTitle>
                </SheetHeader>
                <div className="mt-4 text-sm">
                  Depositing a bond triggers <code>depositBond(poolId, amount)</code>. The bond is tied to the selected risk pool and remains locked as collateral until the protocol releases it (for example through <code>freezePool</code>). Bonds encourage honest participation in governance.
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <button
            onClick={() => setBondOpen(true)}
            className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded"
          >
            Deposit Bond
          </button>
        </div>
      </div>

      <StakeModal isOpen={stakeOpen} onClose={() => setStakeOpen(false)} />
      <BondModal isOpen={bondOpen} onClose={() => setBondOpen(false)} />


      <div className="mt-8">
        <ProposalsTable />
      </div>
    </div>
  )
}
