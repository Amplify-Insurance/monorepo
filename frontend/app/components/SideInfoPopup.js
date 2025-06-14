"use client"

import { useState, useEffect } from "react"
import { X, Info, Shield, TrendingUp, AlertTriangle } from "lucide-react"

export default function SideInfoPopup({ isOpen, onClose, title, children, type = "info" }) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!isVisible) return null

  const getTypeStyles = () => {
    switch (type) {
      case "warning":
        return {
          bg: "bg-amber-50 dark:bg-amber-900/20",
          border: "border-amber-200 dark:border-amber-800",
          icon: AlertTriangle,
          iconColor: "text-amber-600 dark:text-amber-400",
          titleColor: "text-amber-900 dark:text-amber-100",
        }
      case "success":
        return {
          bg: "bg-green-50 dark:bg-green-900/20",
          border: "border-green-200 dark:border-green-800",
          icon: Shield,
          iconColor: "text-green-600 dark:text-green-400",
          titleColor: "text-green-900 dark:text-green-100",
        }
      case "growth":
        return {
          bg: "bg-blue-50 dark:bg-blue-900/20",
          border: "border-blue-200 dark:border-blue-800",
          icon: TrendingUp,
          iconColor: "text-blue-600 dark:text-blue-400",
          titleColor: "text-blue-900 dark:text-blue-100",
        }
      default:
        return {
          bg: "bg-gray-50 dark:bg-gray-800/50",
          border: "border-gray-200 dark:border-gray-700",
          icon: Info,
          iconColor: "text-gray-600 dark:text-gray-400",
          titleColor: "text-gray-900 dark:text-gray-100",
        }
    }
  }

  const styles = getTypeStyles()
  const IconComponent = styles.icon

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Popup */}
      <div
        className={`fixed right-4 top-1/2 -translate-y-1/2 w-80 max-w-[calc(100vw-2rem)] z-50 transition-all duration-300 ease-out ${
          isOpen ? "opacity-100 translate-x-0 scale-100" : "opacity-0 translate-x-4 scale-95"
        }`}
      >
        <div className={`${styles.bg} ${styles.border} border rounded-2xl shadow-2xl backdrop-blur-sm`}>
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center space-x-3">
              <div className={`w-8 h-8 rounded-lg ${styles.bg} flex items-center justify-center`}>
                <IconComponent className={`w-4 h-4 ${styles.iconColor}`} />
              </div>
              <h3 className={`font-semibold text-lg ${styles.titleColor}`}>{title}</h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 max-h-96 overflow-y-auto">
            <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{children}</div>
          </div>

          {/* Footer gradient */}
          <div className="h-2 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 rounded-b-2xl" />
        </div>
      </div>
    </>
  )
}
