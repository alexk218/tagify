// Manager can replace this packaged extension before apply. This never enables app sharing.
const bridgeWindow = window as unknown as { __tagifyInstallerAnalyticsV1?: unknown };
bridgeWindow.__tagifyInstallerAnalyticsV1 ??= { schemaVersion: 2, enabled: false };
