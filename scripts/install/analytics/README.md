# Installer analytics

Mac manager events and GitHub asset counters answer different questions. Download counts include repeat downloads and automation; installation IDs are pseudonymous device-local records, not people. Manager opens measure manager use, not Tagify activity inside Spotify. Windows contributes download counters only until its native tracking is implemented.

## Mac behavior and privacy

`InstallerAnalytics.swift` sends only explicit events automatically for a new installation. Existing saved opt-outs remain disabled. The manager has no analytics disclosure dialog or sharing controls. It creates a random installation UUID and a per-process session UUID. It does not use the recovery key, Spotify account, machine serial number, music, tags, file paths, logs, or raw errors. Versions, chip architecture, setup presence, operation names, stages, standardized failure reasons, result and duration are the property allowlist. Event values have conservative character/size limits. No person profiles, automatic capture, recordings or location enrichment are requested.

| Event | Meaning |
|---|---|
| `installer_opened` | Once per process after setup inspection when reporting is enabled; first-observed flag persists across launches |
| `installer_operation_started` | A new install/update/repair/recovery/update-setting/manager-download attempt |
| `installer_stage_reached` | A distinct stage of the current attempt |
| `installer_operation_finished` | Verified success, failure or cancellation; duration and recovery requirement |
| `installer_help_opened` | External Spicetify update help selected |

The private `~/Library/Application Support/Tagify/Installer/analytics.json` stores the sharing choice, identity and at most 200 queued events. Atomic writes and a nonblocking account lock coordinate processes. Queued events expire after seven days. Sends use a utility queue, one batch at a time, five-second timeouts, no redirects, and capped exponential retries while the app is open. UUIDs and original timestamps survive retries. A success acknowledgement removes the batch; malformed/quota-limited responses do not. HTTP acknowledgement is not a substitute for querying ingestion during acceptance testing.

Opt-out cancels pending requests/retries and clears local identity and queued events. It cannot retract data already transmitted. Re-enabling creates a new identity. Sharing-choice save errors are visible and retain the previous saved choice; corrupt state fails closed. Preview and native test builds do not send real analytics. There is no background heartbeat or attempt to infer activity while the manager is closed.

## Project setup

Use the shared **Tagify** PostHog project (US, project `659103`). Installer events use the `installer_` prefix and a separate dashboard; app analytics has independent saved sharing choices and identity; the current Tagify Settings UI has no analytics control. A version-two seven-day setup offer can link a new unset app account to its recent installation; older offers are not linked automatically. See [product analytics](../../../docs/PRODUCT_ANALYTICS.md) for the combined dashboard and linking coverage. Keep synthetic acceptance events out of production; the read-only SQL fixtures below do not ingest events. Choose the account region explicitly and use its corresponding origins:

| Region | Ingestion | Project API/dashboard |
|---|---|---|
| US | `https://us.i.posthog.com` | `https://us.posthog.com` |
| EU | `https://eu.i.posthog.com` | `https://eu.posthog.com` |

1. Configure project IP-address discard and disable unnecessary enrichment. The client requests no GeoIP and supplies a null IP, but verify the project's actual stored events and provider settings before distribution. Never promise that the network provider cannot see a connection's source address.
2. Keep usage within the chosen free allowance; review billing limits before enabling paid usage. Do not enable session replay, autocapture, person profiles or account identification for this installer.
3. Put the public `phc_` token and ingestion host in `posthog-config.json`, or use `TAGIFY_POSTHOG_TOKEN` and `TAGIFY_POSTHOG_HOST` during build. Build with `TAGIFY_REQUIRE_ANALYTICS=1` for release validation. Public ingestion keys are inherently extractable and do not authenticate the sender; allowlisted events/metrics are observational, not trusted accounting.
4. Set the private repository's Actions secret `TAGIFY_POSTHOG_TOKEN` and variable `TAGIFY_POSTHOG_HOST`. Personal/OAuth administrative credentials never belong in the app, configuration JSON, workflow, or committed files.
5. Provision the dashboard through the connected account, or run `dashboard.mjs --apply` with `POSTHOG_APP_HOST`, `POSTHOG_PROJECT_ID` and `POSTHOG_PERSONAL_API_KEY` supplied securely through the environment. The script validates every query before changing dashboards. Its description/tag markers make reruns update the managed dashboard and insights; unrelated insights remain untouched. Without `--apply`, it only exports a definition to `/tmp/tagify-installer-dashboard.json`.
6. Run the download workflow manually once, inspect its snapshot and query the ingested events. Then verify all dashboard tiles against known test events, including no events, failure, cancellation, missing finish, retry, returning installations and download gaps. Local mocks do not validate PostHog's live query dialect or event ingestion.

## Daily download reporting

`.github/workflows/installer-download-report.yml` runs daily at 13:23 UTC and supports manual dispatch. It uses one Linux job, Node 22, no dependency installation and read-only GitHub contents/actions permissions. It snapshots every public release page from `alexk218/tagify-installer`, including stable and prerelease channels. It recognizes the exact DMG, ZIP, PKG and EXE filenames used by the release workflow, excluding drafts, checksums and unrelated files. Unsupported or invalid data fails visibly instead of reporting zero.

`installer_download_snapshot` contains public release/asset IDs, platform/format, cumulative download count, observation date/time and release channel. An asset/date has a deterministic UUID, so replaying the **same saved artifact** is safe. A second collection on the same UTC date is not an additional daily measurement. To retry delivery, manually dispatch with `replay_run_id` set to the original workflow run ID; this retrieves its exact saved snapshot instead of collecting again. First observations are baselines. Differences start with the second observation; gaps represent the whole interval and counter decreases are unknown. Newly replaced assets receive new IDs and a new baseline; historical daily downloads cannot be reconstructed before monitoring began. Totals sum all formats and are not unique-download or conversion figures.

The workflow always saves a snapshot and a job-summary table, even before PostHog is configured. Saved artifacts expire after 90 days. When configured, failed delivery fails the job and retains the artifact for replay. A failed collection produces no partial report. GitHub can delay scheduled jobs; use the freshness tile to spot missing observations. Configure workflow-failure notifications through the account's existing GitHub notification preferences if needed; no email/Slack messages are sent by this workflow.

```sh
TAGIFY_DOWNLOAD_SNAPSHOT=/tmp/installer-download-snapshot.json node packages/tagify-secret/scripts/install/analytics/download-report.mjs --dry-run
# With the ingestion variables supplied securely:
TAGIFY_DOWNLOAD_SNAPSHOT=/tmp/replayed-snapshot.json node packages/tagify-secret/scripts/install/analytics/download-report.mjs --replay /tmp/installer-download-snapshot.json
node --test packages/tagify-secret/scripts/install/analytics/analytics.test.mjs
```

## Dashboard interpretation

The dashboard includes cumulative downloads, download changes, first observed opens, verified fresh setups, operation outcomes, failure reasons, duration p50/p95, daily/7-day/30-day manager activity, returning installations, repeated repairs, version combinations and reporting freshness. Unknown outcomes stay unknown. Success rate uses observed operation starts as the denominator. Consent, queue limits, offline usage and changed local identities affect coverage. A missing finish can mean a crash, lost event or interrupted session; it is not automatically an installation failure. Repeated repairs are a reliability signal, not a positive engagement metric. No download-to-install identity matching is attempted.

The main query window is 30 days. Download totals query retained historical observations; keep this retention limitation in mind when assets disappear from GitHub. These are descriptive operational metrics, not an exact census of users.

## Current activation status

Verified October 11, 2026:

- Project `659103` is named **Tagify**, timezone UTC, with project-level IP-address discard enabled. Its public ingestion token is bundled through `posthog-config.json`; no administrative credential is committed.
- [Installer dashboard](https://us.posthog.com/project/659103/dashboard/2198229): all 12 saved insights executed successfully against PostHog. SQL tables preserve detailed outcomes and daily line charts show manager activity. First baseline covers 15 assets: 15 Mac downloads and 1,386 Windows downloads. Daily differences begin after the next observation.
- The GitHub reporter has its ingestion secret/host configured. The initial configured run exposed the provider's current `{ "status": "Ok" }` acknowledgement; both senders now accept it as well as the older numeric acknowledgement, while retaining events for malformed, quota-limited or failed responses. Stored download events were verified to have no IP addresses or full person profiles.
- `dashboard-fixtures.mjs` derives read-only queries from the actual dashboard definitions. All eight fixtures were executed in PostHog: duplicate events, missing/orphan finishes, success/failure/cancellation, repeated repairs, median/p95 durations, returning installations, latest versions, retained deleted-asset totals, new baselines, counter resets and observation gaps. Export with `node packages/tagify-secret/scripts/install/analytics/dashboard-fixtures.mjs`; execute each exported `query` through the connected PostHog SQL tool and compare with `expected`. They never send synthetic production events.
- Dashboard counts and durations aggregate by asset, installation or operation, so duplicate delivery does not inflate these metrics while provider deduplication completes.
- [Mac Manager 1.0.6](https://github.com/alexk218/tagify-installer/releases/tag/v1.0.6) is published, signed and notarized. The downloaded public app was verified end to end: opting in sent a real manager-open event, reopening retained the installation identity with a new session, and opting out erased local identity/queued data and stopped subsequent capture. Two genuine verification opens were received without IP addresses or person profiles. These owner verification events are not customer adoption. See [release verification](../macos/RELEASE_1.0.6.md).
- Windows analytics implementation is being verified in the private `alexk218/tagify-installer-dev` repository for 1.0.7; public Windows remains 1.0.5 without native tracking. Tests use isolated identities and fake transports. Manager activity measures manager use, not Tagify activity inside Spotify.

The live dashboard and this setup guide document the analytics boundary; no application architecture change is needed for this installer-only activation.

Mac Manager 1.0.8 was published October 11, 2026 with automatic reporting and signed in-place updates. The signed release app sent two real verification opens without an opt-in step; a saved opt-out prevented a third after relaunch. These owner verification opens are not customer adoption. See [1.0.8 release verification](../macos/RELEASE_1.0.8.md).
