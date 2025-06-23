// app/utils/format.js

// Format currency values with K, M, B suffixes
export const formatCurrency = (value, currency = "usd", displayCurrency = "usd") => {
  if (displayCurrency === "usd") {
    if (value === null || typeof value === "undefined") {
      return "$0.00";
    }

    const fmt = (val, digits = 2) =>
      Number(val).toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

    if (value >= 1e9) {
      return `$${fmt(value / 1e9)}B`;
    } else if (value >= 1e6) {
      return `$${fmt(value / 1e6)}M`;
    } else if (value >= 1e3) {
      return `$${fmt(value / 1e3)}K`;
    } else if (value < 1 && value > 0) {
      return `$${fmt(value, 4)}`;
    } else {
      return `$${fmt(value)}`;
    }
  } else {
    return `${Number(value).toLocaleString(undefined, {
      maximumFractionDigits: 4,
    })} ${currency.toUpperCase()}`;
  }
};

// Format percentage values
export const formatPercentage = (value) => {
    if (value === null || typeof value === 'undefined') {
      return "0.00%";
    }
  return `${value.toFixed(2)}%`;
};