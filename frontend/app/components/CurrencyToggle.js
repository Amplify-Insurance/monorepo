"use client"

export default function CurrencyToggle({ displayCurrency, setDisplayCurrency }) {
  return (
    <div className="inline-flex rounded-md shadow-sm">
      <button
        type="button"
        className={`relative inline-flex items-center rounded-l-md px-3 py-2 text-sm font-medium ${
          displayCurrency === "native"
            ? "bg-blue-600 text-white"
            : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
        } ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:z-10`}
        onClick={() => setDisplayCurrency("native")}
      >
        Native
      </button>
      <button
        type="button"
        className={`relative -ml-px inline-flex items-center rounded-r-md px-3 py-2 text-sm font-medium ${
          displayCurrency === "usd"
            ? "bg-blue-600 text-white"
            : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
        } ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:z-10`}
        onClick={() => setDisplayCurrency("usd")}
      >
        USD
      </button>
    </div>
  )
}
