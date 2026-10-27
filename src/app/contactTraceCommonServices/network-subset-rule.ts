/** Shared value matching for display filters and scoped analytical inputs. */
export function networkSubsetValueMatches(rawValue: any, operator = 'contains', expectedValue: any): boolean {
  const normalize = (value: any) => value == null ? '' : String(value).trim();
  const expected = normalize(expectedValue).toLowerCase();
  const values = (Array.isArray(rawValue) ? rawValue : [rawValue]).map(normalize);
  const lowerValues = values.map(value => value.toLowerCase());
  switch (operator) {
    case 'equals': return lowerValues.some(value => value === expected);
    case 'notEquals': return lowerValues.every(value => value !== expected);
    case 'startsWith': return lowerValues.some(value => value.startsWith(expected));
    case 'endsWith': return lowerValues.some(value => value.endsWith(expected));
    case 'in': {
      const choices = expected.split(',').map(value => value.trim()).filter(Boolean);
      return lowerValues.some(value => choices.includes(value));
    }
    case 'lt': case 'lte': case 'gt': case 'gte': {
      const limit = Number(expected);
      if (!Number.isFinite(limit)) return false;
      return values.some(value => {
        if (!value || !Number.isFinite(Number(value))) return false;
        const number = Number(value);
        if (operator === 'lt') return number < limit;
        if (operator === 'lte') return number <= limit;
        if (operator === 'gt') return number > limit;
        return number >= limit;
      });
    }
    default: return lowerValues.some(value => value.includes(expected));
  }
}

export function isActiveNetworkSubsetRule(rule?: { enabled?: boolean; field?: string; value?: any }): boolean {
  const field = String(rule?.field ?? '').trim();
  return !!rule?.enabled && !!field && field !== 'None' && String(rule.value ?? '').trim() !== '';
}
