function sortedList(value) {
  return Array.isArray(value) ? [...new Set(value.map(String))].sort() : [];
}

function comparableBaseline(value) {
  return {
    version: value?.version || "",
    required: sortedList(value?.required),
    expectedDirectories: sortedList(value?.expectedDirectories),
    legacy: sortedList(value?.legacy),
  };
}

export function startupBaselineMatchesExpected(actual, expected) {
  return JSON.stringify(comparableBaseline(actual)) === JSON.stringify(comparableBaseline(expected));
}
