# WebDecoy for n8n

Read AI and bot detection events and actor evidence from WebDecoy, then route useful findings into your existing workflows.

**Unreleased:** this package requires the new WebDecoy Automation Read API. Source is available for review; npm publication and n8n verification will follow backend deployment. It is not currently discoverable in n8n's Add step panel.

## What it does

- **Detection → Get Many:** fetch recent site events, filter by score/category/actor and paginate up to your chosen limit.
- **Actor → Get Evidence:** fetch up to 20 recent detections for one actor on the same site.
- Keep ingestion and automation credentials separate. This integration reads evidence; it does not change protection rules or block visitors.

## Credentials

Requires a WebDecoy account and a reporting site. In WebDecoy's **API Keys** page:

1. Create a dedicated key named `n8n alerts`.
2. Select **Read Site Evidence (n8n / Automations)** (`automation:read`) and the target property. Clear unrelated permissions.
3. Choose an expiry, create the key and copy it once.
4. In n8n, create a **WebDecoy API** credential and paste the key. The connection test checks that the key can read its bound site.

The key stays in n8n credentials. Do not paste it into workflow parameters or exported JSON. Default ingestion keys, dashboard JWTs, expired keys and revoked keys cannot be used for these reads. Use a separate credential for each site.

## Installation after release

For self-hosted n8n, install `n8n-nodes-webdecoy` through **Settings → Community nodes**, following [n8n's community-node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/). Availability on n8n Cloud requires n8n verification, which has not yet been submitted or granted.

## Example: a bot activity digest in Slack

Import [`examples/bot-activity-slack.json`](examples/bot-activity-slack.json), select your WebDecoy and Slack credentials, and choose a Slack channel. Test it manually, then enable the schedule.

Every 15 minutes the workflow fetches up to 100 detections scoring at least 70 from a fixed previous 15-minute window. A Code node groups them into one count and a link to review evidence; Slack receives one digest if there are matches. No per-event content is interpolated into Slack markup. The workflow is inactive on import and contains no credentials.

The example is a periodic digest, not an exactly-once alert queue. Window boundaries, delayed ingestion and the 100-event cap can cause omissions or repetition. At high volumes, narrow filters, shorten the interval or build a durable cursor/deduplication workflow around the API. Do not interpret a detection count as the number of blocked requests.

## Data and coverage

- Detection results are ordered newest first. The node holds `since` and `until` fixed across cursor pages. With Return All off it returns at most the configured limit (1–1,000); Return All retrieves the whole matching window. Cursor requests are paced one second apart to respect the API rate limit.
- Without explicit dates, the window is the previous 24 hours. Maximum window: 31 days. Test events are excluded unless enabled.
- Actor evidence is site-specific and capped at 20 recent events; `has_more` signals additional evidence. It does not expose organization-wide actor aggregates.
- API responses omit raw bodies, stored cookies, authorization headers, raw fingerprints and URL query strings. Captured user-agent/path strings remain untrusted data.
- Coverage depends on installed reporting integrations. A browser tag cannot observe a crawler that never runs JavaScript. Recorded evidence is not a complete census of every visitor.
- API errors stop the node by default. n8n's **Continue on Fail** returns an error item for the affected input, without forwarding partial results from earlier pages of that input.

## Development

```sh
npm ci
npm run lint
npm test
```

The programmatic node holds one time window across dependent cursor requests, enforces the total limit and avoids forwarding partial results after a page failure.

Created with the official `@n8n/node-cli`. The distributed node has no runtime dependencies, filesystem access or environment-variable access. Development tests run the compiled node against a local HTTP fixture; backend integration tests separately exercise actual authorization and database queries. They do not measure bot-detection accuracy or claim production alert delivery.

Publishing uses GitHub Actions with npm provenance. Configure the repository's npm trusted publisher for `publish.yml` before the first release. Do not publish until the Automation Read API is deployed and a real credential smoke test passes.

[WebDecoy](https://webdecoy.com) · [Documentation](https://docs.webdecoy.com) · [Issues](https://github.com/WebDecoy/n8n-nodes-webdecoy/issues)

MIT © WebDecoy
