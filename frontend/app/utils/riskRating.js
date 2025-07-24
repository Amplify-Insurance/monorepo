export const getRiskRatingText = (rating) => {
  if (rating === null || rating === undefined) return 'Unknown';
  switch (Number(rating)) {
    case 0:
      return 'Low';
    case 1:
      return 'Moderate';
    case 2:
      return 'Elevated';
    case 3:
      return 'Speculative';
    default:
      return 'Unknown';
  }
};

export const getRiskRatingColor = (rating) => {
  switch (Number(rating)) {
    case 0:
      return 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/20';
    case 1:
      return 'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/20';
    case 2:
      return 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/20';
    case 3:
    default:
      return 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/20';
  }
};
