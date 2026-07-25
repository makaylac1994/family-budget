import React from 'react';
import { COLORS, CATEGORY_COLORS } from './constants';

export const CategoryColorContext = React.createContext({});

export function categoryColor(cat, overrides) {
  return (overrides && overrides[cat]) || CATEGORY_COLORS[cat] || COLORS.violet;
}

export function useCategoryColor(cat) {
  const overrides = React.useContext(CategoryColorContext);
  return categoryColor(cat, overrides);
}
