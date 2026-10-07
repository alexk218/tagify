export function createBulkTagHistoryLocation(appName, trackUris) {
  return {
    pathname: `/${appName}`,
    search: "",
    state: { trackUris },
  };
}
