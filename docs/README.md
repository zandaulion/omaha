# Pocket Omaha documentation

This directory documents the behavior of the current Pocket Omaha codebase. Pocket Omaha is a long-term investing review tool with two clients: a self-hosted progressive web app (PWA) and a native Android app. Both use the same JavaScript analysis engine, but their storage, authentication, notification delivery, and AI purchase flows differ.

## Start here

| Reader | Document | What it covers |
|---|---|---|
| User | [User guide](19_USER_GUIDE.md) | Every screen, workflow, alert, backup, offline behavior, and Android widget |
| Maintainer | [Runtime and architecture](20_RUNTIME_AND_ARCHITECTURE.md) | End-to-end data flow, shared engine, caching, jobs, AI, and failure handling |
| User or auditor | [Data, privacy, and security](21_DATA_PRIVACY_AND_SECURITY.md) | Stored data, network transfers, permissions, authentication, and retention |
| API consumer | [HTTP and callable API reference](22_API_REFERENCE.md) | PWA REST routes, Firebase callables, authentication, inputs, and errors |
| Operator | [Configuration and operations](23_CONFIGURATION_AND_OPERATIONS.md) | Local setup, environment variables, deployment, administration, Android releases, and Firebase |
| Contributor | [Contributing and testing](24_CONTRIBUTING_AND_TESTING.md) | Repository layout, sources of truth, generated files, tests, and safe change patterns |
| Product reviewer | [PWA/Android feature matrix](25_FEATURE_MATRIX.md) | Shared behavior and intentional platform differences |
| Developer or auditor | [Data model and backup format](26_DATA_MODEL_AND_BACKUPS.md) | SQLite, Room, Firestore, cache ownership, schema, and merge rules |

The calculation details live in focused references:

- [Health scoring framework](02_HEALTH_SCORING_FRAMEWORK.md)
- [Financial charts and trends](06_FINANCIAL_CHARTS_AND_TRENDS.md)
- [DCF fair-value sandbox](08_DCF_FAIR_VALUE_SANDBOX.md)
- [Review workflow](18_REVIEW_WORKFLOW.md)
- [AI relay deployment](17_AI_RELAY_DEPLOYMENT.md)

## Document status

Documents 19–26 are the maintained description of the running product. They were checked against the PWA server, web client, shared engine, Android client, Room schema, workers, widget, and Firebase Functions.

Documents 01–18 preserve product decisions, design specifications, migration notes, audits, and the implementation history. They remain useful context, but some describe a planned state at the time they were written. When an older document conflicts with documents 19–26 or the code, the current code and the maintained documents take precedence.

| Documents | Status |
|---|---|
| 01, 03–05, 07, 09–16 | Design and implementation history; verify current behavior before relying on a detail |
| 02, 06, 08, 17, 18 | Focused references that still define current behavior |
| 19–26 | Current operating and user documentation |

## Documentation rules

Update the relevant maintained document in the same change whenever behavior, data handling, configuration, an endpoint, a permission, a scheduled job, or a user workflow changes. Do not document generated bundles as independent implementations: `core/` is the source for shared logic, and the bundled copies are build artifacts.

Examples and defaults in these files describe repository behavior, not investment advice or a promise that external providers will remain available. SEC EDGAR and Yahoo can change independently of this project.
