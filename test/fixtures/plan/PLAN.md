# Plan: the API reference

1. Ship exactly three endpoint pages: orders, refunds and webhooks.
2. Every endpoint page carries a runnable curl example.
3. Every endpoint page has a matching .json schema file beside it.
4. No page names the internal service billing-core.
5. The build records the commit it came from in build.json, under sourceCommit.
