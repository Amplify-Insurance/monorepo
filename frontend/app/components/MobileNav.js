"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { X, BarChart2, Shield, Activity, FileText, AlertTriangle, Coins } from "lucide-react"

export default function MobileNav({ isOpen, onClose }) {
  const pathname = usePathname()

  // Prevent scrolling when menu is open
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "auto"
    return () => {
      document.body.style.overflow = "auto"
    }
  }, [isOpen])

  if (!isOpen) return null

  const navigation = [
    { name: "Markets", href: "/markets", icon: BarChart2 },
    { name: "Dashboard", href: "/dashboard", icon: Shield },
    { name: "Transactions", href: "/transactions", icon: FileText },
    { name: "Backstop Pool", href: "/catpool", icon: Coins },
    { name: "Make a Claim", href: "/claims", icon: AlertTriangle },
    { name: "Analytics", href: "/analytics", icon: Activity },
    { name: "Staking", href: "/staking", icon: Coins },
    { name: "Documentation", href: "/docs", icon: FileText },
  ]

  return (
    <div className="md:hidden">
      <div
        className="fixed inset-0 z-50 bg-gray-900/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="fixed inset-y-0 right-0 w-full max-w-xs bg-white dark:bg-gray-800 shadow-xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="flex items-center text-xl font-bold text-blue-600 dark:text-blue-400">
              <img
                src="/layercover-logo-light.png"
                alt="LayerCover logo"
                className="h-8 w-8 mr-2 block dark:hidden"
              />
              <img
                src="/layercover-logo-dark.png"
                alt="LayerCover logo"
                className="h-8 w-8 mr-2 hidden dark:block"
              />
              LayerCover
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              aria-label="Close navigation menu"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-4">
            <ul className="space-y-2">
              {navigation.map((item) => {
                const isActive = pathname === item.href

                return (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center px-4 py-3 rounded-lg ${
                        isActive
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      }`}
                    >
                      <item.icon
                        className={`h-5 w-5 mr-3 ${
                          isActive
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-gray-500 dark:text-gray-400"
                        }`}
                      />
                      <span className="font-medium">{item.name}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center">© 2024 LayerCover</div>
          </div>
        </div>
      </div>
    </div>
  )
}
