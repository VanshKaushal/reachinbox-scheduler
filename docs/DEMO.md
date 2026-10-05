# Five-minute demo guide

The final submission should show **real Google login and a real Slack message**. A local preview video without those account setups is useful supporting evidence, but does not fulfill both mandatory live integration requirements.

## Suggested recording (4 minutes 30 seconds)

The [recorded local technical preview](recordings/technical-preview.webm) shows the actual browser acceptance scenario, including real Ethereal delivery. It uses explicitly labelled local demo access. Process termination/restart is controlled by the acceptance test; its source and validation report explain those actions. This recording is under five minutes and is supporting evidence for the account-owned final recording.

| Time      | Show                                                                                | What to explain                                                                         |
| --------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0:00–0:25 | Real Google login and the profile header                                            | This is the actual account flow, with Redis-backed sessions                             |
| 0:25–0:50 | Sender accounts; create a fresh Ethereal sender                                     | Distinct SMTP identities, encrypted credentials, shared hourly usage                    |
| 0:50–1:30 | Compose: subject/body, `examples/leads.csv`, detected count, future time            | Times convert to UTC; campaign save and queueing are durable                            |
| 1:30–2:10 | Scheduled table and BullMQ delayed jobs                                             | Stop API/worker before the scheduled time, then restart                                 |
| 2:10–2:40 | Sent table and View in Ethereal                                                     | Same recipients resume; successful delivery attempts remain one each                    |
| 2:40–3:05 | Search a subject or phrase                                                          | Actual Elasticsearch indexing and tenant filtering                                      |
| 3:05–4:05 | Connect Slack through OAuth; schedule 2 recipients from a fresh sender with limit 1 | Show the actual Slack message, one sent row, one deferred row, and notification history |
| 4:05–4:30 | README architecture and tests                                                       | Atomic Redis quota, SQL outbox, no cron, honest SMTP ambiguity policy                   |

Keep the frame on the product and relevant terminal, not secrets. Use a fresh sender for the rate-limit demonstration so prior sends do not consume its allowance. If the next UTC hour is imminent, record earlier in the window so the deferred status is easy to see.

## Restart commands

To regenerate the captioned 1440×1020 local technical preview, prepare the isolated browser database as described in the README, then run `npm run record:demo`. The recording identifies each actual test action and distinguishes demo access from real OAuth consent. The included recording is 65 seconds long.

In separate terminals:

```sh
npm run dev -w @reachinbox/api
npm run worker:dev -w @reachinbox/api
npm run dev -w @reachinbox/web
```

Schedule emails 30–60 seconds ahead, stop API and worker with Ctrl+C, and restart them. Keep the infrastructure containers running. The browser may display a temporary connection error during the pause; after recovery, jobs continue from the persistent queue/SQL state.

## Reviewer access

The assignment requests a private GitHub repository and access for **Mitrajit** and **Yadav036**. Confirm the repository remains private and that those collaborator invitations exist. Add the demo recording (under five minutes) as a repository file or a private-access video link in the submission.
