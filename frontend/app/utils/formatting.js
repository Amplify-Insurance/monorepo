// app/utils/format.js

// Format currency values with K, M, B suffixes
export const formatCurrency = (value, currency = "usd", displayCurrency = "usd") => {
  if (displayCurrency === "usd") {
    // Handle null or undefined values
    if (value === null || typeof value === 'undefined') {
      return "$0.00";
    }

    if (value >= 1e9) {
      return `$${(value / 1e9).toFixed(2)}B`; // Increased precision for larger numbers
    } else if (value >= 1e6) {
      return `$${(value / 1e6).toFixed(2)}M`; // Increased precision for larger numbers
    } else if (value >= 1e3) {
      return `$${(value / 1e3).toFixed(2)}K`;
    } else if (value < 1 && value > 0) {
      return `$${value.toFixed(4)}`; // Show more precision for small decimal values
    } else {
      return `$${value.toFixed(2)}`; // Default to 2 decimal places for numbers like $123.45
    }
  } else {
    // For native display, return the amount with the token symbol
    // Consider adding precision here as well
    return `${value.toFixed(4)} ${currency.toUpperCase()}`;
  }
};

// Format percentage values
export const formatPercentage = (value) => {
    if (value === null || typeof value === 'undefined') {
      return "0.00%";
    }
  return `${value.toFixed(2)}%`;
};