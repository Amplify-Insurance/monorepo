"use client"

import { useState, useEffect } from "react"
import { useAccount } from "wagmi"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { HelpCircle, Vote, Shield, Users } from "lucide-react"
import ProposalsTable from "../components/ProposalsTable"
import useActiveProposals from "../../hooks/useActiveProposals"
import usePastProposals from "../../hooks/usePastProposals"
import useStakingInfo from "../../hooks/useStakingInfo"
import useUserBonds from "../../hooks/useUserBonds"
import Image from "next/image"
import Link from "next/link"
import { getTokenLogo, getProtocolLogo } from "../config/tokenNameMap"
import { formatCurrency } from "../utils/formatting"
import { ethers } from "ethers"
import { getCommittee } from "../../lib/committee"
import { formatPercentage } from "../utils/formatting"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet"
import StakeModal from "../components/StakeModal"
import UnstakeModal from "../components/UnstakeModal"
import BondModal from "../components/BondModal"
import UnstakeBondModal from "../components/UnstakeBondModal"
import { getTokenName } from "../../lib/erc20"
import { STAKING_TOKEN_ADDRESS } from "../config/deployments"

export default function StakingPage() {
  const { address, isConnected } = useAccount()
  const [stakeOpen, setStakeOpen] = useState(false)
  const [unstakeOpen, setUnstakeOpen] = useState(false)
  const [bondOpen, setBondOpen] = useState(false)
  const [unstakeBondOpen, setUnstakeBondOpen] = useState(false)
  const [stakeInfoOpen, setStakeInfoOpen] = useState(false)
  const [bondInfoOpen, setBondInfoOpen] = useState(false)
  const [maxFeePercent, setMaxFeePercent] = useState(0)
  const [tokenName, setTokenName] = useState("")
  const [tokenLogo, setTokenLogo] = useState("")

  const { info: stakingInfo } = useStakingInfo(address)
  const { bonds: userBonds = [] } = useUserBonds(address)

  const { proposals: activeProposals, loading: loadingActive } = useActiveProposals()
  const { proposals: pastProposals, loading: loadingPast } = usePastProposals()

  useEffect(() => {
    async function loadToken() {
      try {
        const name = await getTokenName(STAKING_TOKEN_ADDRESS)
        setTokenName(name)
        setTokenLogo(getTokenLogo(STAKING_TOKEN_ADDRESS))
      } catch (err) {
        console.error('Failed to load token name', err)
      }
    }
    loadToken()

    async function load() {
      try {
        const c = getCommittee()
        const bps = await c.maxProposerFeeBps()
        setMaxFeePercent(Number(bps.toString()) / 100)
      } catch (err) {
        console.error('Failed to load max proposer fee', err)
      }
    }
    load()
  }, [])
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 max-w-md w-full">
            <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <Vote className="w-8 h-8 text-purple-600 dark:text-purple-400" />
            </div>
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">Connect Your Wallet</h1>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Connect your wallet to participate in governance and help secure the protocol
            </p>
            <ConnectButton />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        {/* Header Section */}
        <div className="mb-8">
          <div className="flex items-center space-x-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Governance</h1>
              <p className="text-gray-600 dark:text-gray-300">
                {`Stake ${tokenName || 'tokens'} and deposit bonds to participate in protocol governance`}
              </p>
            </div>
          </div>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Stake Card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                  <Vote className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {`Stake ${tokenName || 'Voting Token'}`}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {`Lock ${tokenName || 'tokens'} to gain voting power`}
                  </p>
                </div>
              </div>
              <Sheet open={stakeInfoOpen} onOpenChange={setStakeInfoOpen}>
                <SheetTrigger className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                  <HelpCircle className="w-5 h-5" />
                </SheetTrigger>
                <SheetContent side="right" className="w-1/3 sm:max-w-none text-black dark:text-white">
                  <SheetHeader>
                    <SheetTitle>{`Stake ${tokenName || 'Voting Token'}`}</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4 text-sm space-y-3">
                    <p>
                      Calling <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">stake(amount)</code> on the
                      staking contract locks your governance tokens and mints voting power used by the Committee
                      contract.
                    </p>
                    <p>
                      You can withdraw later by invoking{" "}
                      <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">unstake(amount)</code>.
                    </p>
                    <p>Staked tokens give you the power to vote on protocol proposals and governance decisions.</p>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <p className="font-medium mb-1">Benefits</p>
                  <ul className="text-xs space-y-1">
                    <li>• Vote on protocol proposals</li>
                    <li>• Influence protocol direction</li>
                    <li>• Unstake anytime</li>
                  </ul>
                </div>
              </div>

              <button
                onClick={() => setStakeOpen(true)}
                className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                Stake Tokens
              </button>
              <button
                onClick={() => setUnstakeOpen(true)}
                className="w-full py-4 px-6 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                Unstake Tokens
              </button>
            </div>
          </div>

          {/* Bond Card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                  <Shield className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Deposit Bond</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Secure the protocol with collateral</p>
                </div>
              </div>
              <Sheet open={bondInfoOpen} onOpenChange={setBondInfoOpen}>
                <SheetTrigger className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                  <HelpCircle className="w-5 h-5" />
                </SheetTrigger>
                <SheetContent side="right" className="w-1/3 sm:max-w-none text-black dark:text-white">
                  <SheetHeader>
                    <SheetTitle>Deposit Bond</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4 text-sm space-y-3">
                    <p>
                      Depositing a bond triggers{" "}
                      <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">
                        createProposal(poolId, 1, amount)
                      </code>
                      . The bond is tied to the selected risk pool and remains locked as collateral.
                    </p>
                    <p>Bonds encourage honest participation in governance by putting your own assets at risk.</p>
                    <p className="text-red-600 dark:text-red-400 font-medium">
                      ⚠️ Bonds may be slashed if governance decisions are not supported by the community.
                    </p>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="text-sm text-green-800 dark:text-green-200">
                  <p className="font-medium mb-1">Bond Features</p>
                  <ul className="text-xs space-y-1">
                    <li>
                      • Earn up to {formatPercentage(maxFeePercent)} of Claim
                      Fees
                    </li>
                    <li>• Secure protocol operations</li>
                    <li>• Risk of slashing if dishonest</li>
                  </ul>
                </div>
              </div>

              <button
                onClick={() => setBondOpen(true)}
                className="w-full py-4 px-6 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                Deposit Bond
              </button>
              <button
                onClick={() => setUnstakeBondOpen(true)}
                className="w-full py-4 px-6 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                Withdraw Bond
              </button>
            </div>
          </div>
        </div>

        {/* Modals */}
        <StakeModal isOpen={stakeOpen} onClose={() => setStakeOpen(false)} />
        <UnstakeModal isOpen={unstakeOpen} onClose={() => setUnstakeOpen(false)} />
        <BondModal isOpen={bondOpen} onClose={() => setBondOpen(false)} />
        <UnstakeBondModal isOpen={unstakeBondOpen} onClose={() => setUnstakeBondOpen(false)} />

        {stakingInfo && BigInt(stakingInfo.staked || "0") > 0n && (
          <div className="mt-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                  {tokenLogo && (
                    <Image src={tokenLogo} alt={tokenName || 'Gov Token'} width={40} height={40} className="rounded-lg" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{`My Staked ${tokenName || 'Gov Tokens'}`}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Your governance participation</p>
                </div>
              </div>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-4 border-b border-gray-200 dark:border-gray-700">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Amount Staked</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{Number(ethers.utils.formatUnits(stakingInfo.staked || '0', 18)).toFixed(4)}</p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Voting Power</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                  {stakingInfo.totalStaked && BigInt(stakingInfo.totalStaked) > 0n
                    ? (Number((BigInt(stakingInfo.staked) * 10000n) / BigInt(stakingInfo.totalStaked)) / 100).toFixed(2)
                    : '0'}%
                </p>
              </div>
            </div>
          </div>
        )}

        {userBonds.length > 0 && (
          <div className="mt-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-600 dark:bg-blue-500 rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">My Bonds</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Your bonded positions</p>
                </div>
              </div>
            </div>
            <div className="p-6 overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-750">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Bond Details</th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {userBonds.map((bond) => (
                    <tr key={bond.id} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                            <Image src={getProtocolLogo(bond.poolId) || '/placeholder.svg'} alt={bond.protocol} width={40} height={40} className="rounded-full" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{bond.protocol}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Pool {bond.poolId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        {Number.parseFloat(bond.amount)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">{bond.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Proposals Section */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
          <div className="flex items-center space-x-3 mb-6">
            <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
              <Vote className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Active Proposals</h2>
            <button
              onClick={() => setBondOpen(true)}
              className="ml-auto py-1 px-3 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-md"
            >
              New Proposal
            </button>
          </div>
          <ProposalsTable proposals={activeProposals} loading={loadingActive} />
        </div>

        {/* Past Proposals Section */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
          <div className="flex items-center space-x-3 mb-6">
            <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
              <Vote className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Past Proposals</h2>
          </div>
          <ProposalsTable proposals={pastProposals} loading={loadingPast} />
        </div>
      </div>
    </div>
  )
}