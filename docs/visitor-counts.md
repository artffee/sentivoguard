# Proposed visitor counts — 14 November 2026

Prepared for review; not deployed or enabled in Vercel.

Provider: Vercel Web Analytics, pageviews only. No custom events, identify, groups, session replay or advertising. Enable the existing project only after approval; redeploy afterward so the endpoint is available. Use the current plan; no paid upgrade authorized.

Allowed public paths: /, /landing, /blog, /blog/real-time-disk-scanner, /blog/launching-sentivoguard-21, /blog-real-time-disk-scanner, /blog-launching-sentivoguard-21

Only canonical production hostnames load the collector after explicit opt-in. GPC, DNT, withdrawal, expired consent, unknown paths and preview hosts block collection. `?analytics=off` keeps the current tab untracked for QA. Consent lasts 180 days; dashboard retention depends on the existing Vercel plan. Site/branch differences and exact activation steps are in the parent review.

Validation: Node VM tests execute the production integration and the currently inspected Vercel collector against a synthetic fetch stub. No live analytics event is sent. Confirm one labeled QA visit and provider receipt after approved deployment, then keep QA separate from unclassified traffic.

The review branch `review/visitor-counts-2026-11-14` is explicitly excluded from automatic Vercel deployments. This rule does not enable tracking or change the production branch.
