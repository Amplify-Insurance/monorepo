"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { BarChart2, Shield, Activity, Settings, FileText, AlertTriangle } from "lucide-react"

export default function Sidebar() {
  const pathname = usePathname()

  const navigation = [
    { name: "Markets", href: "/markets", icon: BarChart2 },
    { name: "My Coverage", href: "/dashboard", icon: Shield },
    { name: "Make a Claim", href: "/claims", icon: AlertTriangle },
    { name: "Analytics", href: "/analytics", icon: Activity },
    { name: "Settings", href: "/settings", icon: Settings },
  ]

  const socialLinks = [
    { name: "GitHub", href: "https://github.com", icon: "/images/social/github.svg" },
    { name: "Medium", href: "https://medium.com", icon: "/images/social/medium.svg" },
    { name: "Telegram", href: "https://telegram.org", icon: "/images/social/telegram.svg" },
    { name: "X", href: "https://twitter.com", icon: "/images/social/x.svg" },
  ]

  return (
    <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 pt-16">
      <div className="flex-1 flex flex-col min-h-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
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
