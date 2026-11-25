# Automations

The activity source is read on a timer with a cursor in the automation's state. The manifest suggests five minutes;
Linear's own rate limits are the floor.

<!-- generated:automations -->
| Source | Method | Provider floor | Suggested | Signals |
|---|---|---|---|---|
| `linear.activity` | `tools.linear.events_list` | — | 5 min | `bus` |
<!-- /generated:automations -->

## The recipe

1. Read `tools.linear.events_list` with the account and the cursor saved by the previous run.
2. Apply the page's events, then save the `cursor` it answers in the automation's state.
3. If `failed` is not empty, keep the old cursor: a failed event holds the read back. A `refused` event may be skipped;
   the cursor already covers it. A feed that could not be read at all is named `feed:issues` or `feed:notifications`;
   the page lists the other feed and the cursor keeps the failed feed where it was, so retrying asks for it again.
4. If the page carries `gap`, history before `gap.since` was lost: apply the page, then tell the person the window was
   cut.
5. Read again on the suggested cadence. `more: true` means another page is ready now, not that the source is done.

```ts
// The automation's state holds one cursor per account.
const page = await tools.linear.events_list({
  source: "linear",
  account: "work",
  cursor: state.cursor,
})
state.cursor = page.cursor
```

A cursor is bound to its plugin, source and account, and keeps the window it was issued with: pages after a `since`
read never list an event before that `since`. Do not share one between accounts: the plugin refuses it with
`CURSOR_INVALID`.

## Nudges

`events_list` emits `rpc.linear.changed` after a page that lists at least one change, with `capability:
"linear.activity"` and the account. An app that listens can re-read the source instead of waiting for its timer; the
nudge carries no content, and the cursor still decides what is new.
