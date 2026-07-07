# IPL Fantasy — Re-enable Checklist (next season)

Everything was disabled 2026-07-02 for the off-season. Nothing was deleted.
Re-enabling is 4 small steps + restart:

1. **Group**: `src/group-config.ts` → IPL Fantasy entry → delete the `disabled: true` line.
2. **Commands in Banter Squad**: same file, main group `disabledCommands` — remove
   `"fantasy", "f11", "fl", "win"` (comment marks them).
3. **Crons**: `/home/pi/pi-scheduler/index.js` — uncomment the 9 lines marked
   `[v2 2026-07-02: IPL season over — re-enable next season]` (8 fantasy crons +
   `fire("fantasy-morning-winners")` in the 8:30 block). Then `pm2 restart pi-scheduler`.
4. **Help text**: `src/router.ts` !help — re-add the IPL Fantasy section (see git
   history: removed in commit "v2 phase 3").
5. Verify `npx tsc --noEmit`, then activate via `!pi update bot` → `!pi confirm restart`.
6. Sanity: `!fantasy help` in group, and check `fantasy-schedule-sync` pulls the new
   season schedule (`!pi logs 30` after 10:30 IST).

Also review: `docs/GROUPS.md` disabled-groups section, and whether last season's
contest data in Supabase needs archiving before new contests are created.
