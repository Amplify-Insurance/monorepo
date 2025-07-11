// app/layout.jsx
import { Inter } from "next/font/google"
import "../app/globals.css"
import { Providers } from "./providers" // Import the JS component

import Navbar from "./components/Navbar"
import Sidebar from "./components/Sidebar"
import { Toaster } from "../components/ui/toaster"
import { TransactionsProvider } from "../hooks/useTransactions"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "LayerCover",
  description: "Insurance coverage for DeFi protocols",
}

// No type annotation needed for children in JS
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Add Chart.js */}
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
      </head>
      <body className={inter.className}>
        <Providers>
          <TransactionsProvider>
            <Toaster />
            <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
              <Navbar />
              <div className="flex flex-1">
                <Sidebar />
                <main className="flex-1 p-4 md:p-6 lg:p-8 pt-20 md:ml-64">{children}</main>
              </div>
            </div>
          </TransactionsProvider>
        </Providers>
      </body>
    </html>
  )
}
