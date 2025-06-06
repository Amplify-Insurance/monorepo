// Format currency values with K, M, B suffixes
export const formatCurrency = (value, currency = "usd", displayCurrency = "usd") => {
  if (displayCurrency === "usd") {
    // Format with K, M, B suffixes
    if (value >= 1e9) {
      return `$${(value / 1e9).toFixed(1)}B`
    } else if (value >= 1e6) {
      return `$${(value / 1e6).toFixed(1)}M`
    } else if (value >= 1e3) {
      return `$${(value / 1e3).toFixed(1)}K`
    } else {
      return `$${value.toFixed(0)}`
    }
  } else {
    // For native display, return the amount with the token symbol
    return `${value} ${currency.toUpperCase()}`
  }
}

// Format percentage values
export const formatPercentage = (value) => {
  return `${value.toFixed(2)}`
}
