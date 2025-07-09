"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { BarChart2, Shield, Activity, FileText, AlertTriangle, Coins } from "lucide-react"

export default function Sidebar() {
  const pathname = usePathname()

  const navigation = [
    { name: "Markets", href: "/markets", icon: BarChart2 },
    { name: "Dashboard", href: "/dashboard", icon: Shield },
    { name: "Backstop Pool", href: "/catpool", icon: Coins },
    { name: "Make a Claim", href: "/claims", icon: AlertTriangle },
    { name: "Analytics", href: "/analytics", icon: Activity },
    { name: "Staking", href: "/staking", icon: Coins },
  ]

  const socialLinks = [
    { name: "GitHub", href: "https://github.com", icon: "/images/social/github.png" },
    { name: "Medium", href: "https://medium.com", icon: "/images/social/medium.png" },
    { name: "Telegram", href: "https://telegram.org", icon: "/images/social/telegram.png" },
    { name: "X", href: "https://twitter.com", icon: "/images/social/x.png" },
  ]

  return (
    <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 pt-16">
      <div className="flex-1 flex flex-col min-h-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-4 pt-5 pb-2">
          <Link href="/" className="flex items-center space-x-3">
            <div className="relative">
              <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-800 rounded-lg flex items-center justify-center shadow-lg">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-gray-800"></div>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                Layer<span className="text-slate-600 dark:text-slate-400">Cover</span>
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">Insurance Protocol</p>
            </div>
          </Link>
        </div>
        <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
          <nav className="mt-5 flex-1 px-2 space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md ${
                    isActive
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  <item.icon
                    className={`mr-3 flex-shrink-0 h-5 w-5 ${
                      isActive
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-300"
                    }`}
                    aria-hidden="true"
                  />
                  {item.name}
                </Link>
              )
            })}
          </nav>

          {/* Documentation link moved to bottom, before social links */}
          <footer className="mt-auto">
            <Link
              href="/docs"
              className="group flex items-center px-2 py-2 text-sm font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white mx-2 mb-2"
            >
              <FileText
                className="mr-3 flex-shrink-0 h-5 w-5 text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-300"
                aria-hidden="true"
              />
              Documentation
            </Link>

            {/* Social Links */}
            <div className="px-4 py-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex justify-around">
                {socialLinks.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
                    aria-label={link.name}
                  >
                    <Image src={link.icon || "/placeholder.svg"} alt={link.name} width={24} height={24} />
                  </a>
                ))}
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
