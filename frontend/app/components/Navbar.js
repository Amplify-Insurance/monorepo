

"use client"

import { useState } from "react"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAccount, useEnsName, useDisconnect } from "wagmi"
import { Menu, X, ChevronDown } from "lucide-react"
import ThemeToggle from "./ThemeToggle"
// Import mock hooks instead

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const pathname = usePathname()
  const { address, isConnected } = useAccount()
  const { data: ensName } = useEnsName({ address })
  const { disconnect } = useDisconnect()

  const formatAddress = (addr) => {
    if (!addr) return ""
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const navigation = [
    { name: "Markets", href: "/markets" },
    { name: "Dashboard", href: "/dashboard" },
    { name: "Staking", href: "/staking" },
  ]

  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between">
          <div className="flex">
            <div className="flex flex-shrink-0 items-center">
              <Link href="/" className="flex items-center text-xl font-bold text-blue-600 dark:text-blue-400">
                <img src="/layercover-logo.svg" alt="LayerCover logo" className="h-8 w-8 mr-2" />
                <span>LayerCover</span>
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`inline-flex items-center px-1 pt-1 text-sm font-medium ${
                    pathname === item.href
                      ? "border-b-2 border-blue-500 text-gray-900 dark:text-white"
                      : "border-b-2 border-transparent text-gray-500 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
          <div className="hidden sm:ml-6 sm:flex sm:items-center sm:space-x-4">
            <ThemeToggle />

            {isConnected ? (
              <div className="relative">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full bg-gray-100 dark:bg-gray-700 p-1 px-3 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                >
                  <span>{ensName || formatAddress(address)}</span>
                  <ChevronDown className="h-4 w-4" />
                </button>

                {profileMenuOpen && (
                  <div className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white dark:bg-gray-800 py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                    <Link
                      href="/dashboard"
                      className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => setProfileMenuOpen(false)}
                    >
                      Dashboard
                    </Link>
                    <button
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => {
                        disconnect()
                        setProfileMenuOpen(false)
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <ConnectButton />
            )}
          </div>

          <div className="flex items-center sm:hidden">
            <ThemeToggle />
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-2 ml-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-500 dark:hover:text-gray-300"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <span className="sr-only">Open main menu</span>
              {mobileMenuOpen ? (
                <X className="block h-6 w-6" aria-hidden="true" />
              ) : (
                <Menu className="block h-6 w-6" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="sm:hidden absolute top-16 inset-x-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-lg">
          <div className="space-y-1 pb-3 pt-2">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`block py-2 pl-3 pr-4 text-base font-medium ${
                  pathname === item.href
                    ? "bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 text-blue-700 dark:text-blue-400"
                    : "border-l-4 border-transparent text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-800 dark:hover:text-gray-200"
                }`}
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.name}
              </Link>
            ))}
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 pb-3 pt-4">
            {isConnected ? (
              <div className="space-y-1">
                <div className="flex items-center px-4">
                  <div className="ml-3">
                    <div className="text-base font-medium text-gray-800 dark:text-gray-200">
                      {ensName || formatAddress(address)}
                    </div>
                  </div>
                </div>
                <Link
                  href="/dashboard"
                  className="block px-4 py-2 text-base font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <button
                  className="block w-full text-left px-4 py-2 text-base font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200"
                  onClick={() => {
                    disconnect()
                    setMobileMenuOpen(false)
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="px-4">
                <ConnectButton />
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
