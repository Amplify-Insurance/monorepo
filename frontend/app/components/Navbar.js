"use client"
import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"
import { ConnectButton } from "@rainbow-me/rainbowkit"

import ThemeToggle from "./ThemeToggle"
import CurrencyToggle from "./CurrencyToggle"
import MobileNav from "./MobileNav"
import NetworkSelector from "./NetworkSelector"

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  const navigation = [
    // { name: "Markets", href: "/markets" },
    // { name: "Dashboard", href: "/dashboard" },
    // { name: "Staking", href: "/staking" },
    // { name: "Backstop Pool", href: "/catpool" },
    // { name: "Analytics", href: "/analytics" },
    // { name: "Claims", href: "/claims" },
  ]

  return (
    <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center md:hidden">
            <Link href="/" className="flex-shrink-0 flex items-center">
              <img
                src="/layercover-logo-light.svg"
                alt="LayerCover logo"
                className="h-10 w-auto mr-2 block dark:hidden"
              />
              <img
                src="/layercover-logo-dark.svg"
                alt="LayerCover logo"
                className="h-10 w-auto mr-2 hidden dark:block"
              />
              <span className="sr-only">LayerCover</span>
              <p className="text-xs text-gray-500 dark:text-gray-400">Insurance Protocol</p>
            </Link>
          </div>

          {/* Desktop Navigation with Logo */}
          <div className="hidden md:flex items-center space-x-8">
            <Link href="/" className="flex items-center space-x-3">
              <img
                src="/layercover-logo-light.svg"
                alt="LayerCover logo"
                className="h-10 w-auto block dark:hidden"
              />
              <img
                src="/layercover-logo-dark.svg"
                alt="LayerCover logo"
                className="h-10 w-auto hidden dark:block"
              />
              <span className="sr-only">LayerCover</span>
              <p className="text-xs text-gray-500 dark:text-gray-400 ml-2">Insurance Protocol</p>
            </Link>
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  pathname === item.href
                    ? "text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700"
                    : "text-gray-600 dark:text-gray-300 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                }`}
              >
                {item.name}
              </Link>
            ))}
          </div>

          {/* Desktop Controls */}
          <div className="hidden md:flex items-center space-x-4">
            {/* <CurrencyToggle /> */}
            {/* <Link
              href="/transactions"
              className="px-3 py-2 rounded-md text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
            >
              Transactions
            </Link> */}
            {/* <NetworkSelector /> */}
            <ThemeToggle />
            <ConnectButton />
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center space-x-2">
            <NetworkSelector />
            <ThemeToggle />
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-500"
            >
              <span className="sr-only">Open main menu</span>
              {isOpen ? <X className="block h-6 w-6" /> : <Menu className="block h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <MobileNav isOpen={isOpen} navigation={navigation} pathname={pathname} onClose={() => setIsOpen(false)} />
    </nav>
  )
}
