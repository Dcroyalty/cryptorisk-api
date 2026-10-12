@AGENTS.md

# Reports end with a PASTE block

End every report (any completed task or end of a work turn) with a block in exactly this shape, and put
NOTHING after it:

```
=== PASTE ===
(short, one fact per line)
=== END ===
```

The owner copies only this block and pastes it to another Claude, so it has to stand on its own.

- Keep the full write-up (tables, per-file notes, verification) ABOVE the block. Only the block is constrained.
- One fact per line. Plain text only: no tables, no box-drawing, no ANSI, no wide markdown. Short lines, 15 at most.
- Cover what changed, what deployed (commit or URL) and what is blocked.
- Each decision the owner has to make goes on its own line, starting `DECISION:`.
- Each thing that was not verified goes on its own line, starting `UNVERIFIED:`.
- `=== END ===` is the last line of the message.
- Not for mid-task status pings or pure questions.

# The mcp.so listing lives in docs/MCP_LISTING.md

`docs/MCP_LISTING.md` is the canonical public listing for the MCP server (name, URL, repository, description, tool
list). Whenever a tool in `app/api/mcp/route.ts` is added, removed, renamed, or changes between free and paid,
update that file in the same commit, and tell the owner the live mcp.so listing needs the new text.
