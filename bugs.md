# BanterAgent — Bug Reports

Bugs reported by group members via `!bug` command.
Developers: fix open bugs, update STATUS to `FIXED` with fix notes.

**Workflow:**
1. User reports via `!bug <description>` in WhatsApp
2. Bug lands here with reporter, timestamp, and chat context
3. Dev reads this file at start of session, fixes open bugs
4. Update status: `OPEN` → `FIXED` with a brief note
5. Include in next `pending-release.txt` announcement

---

## Bug #1 — 2026-03-18 17:19:25 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** quiz emoji doesn’t match the movie at all

**Recent chat context:**
```
  [Harikrishnan D]: !answer anniyan
  [Harikrishnan D]: WooooWooooo
  [Madhu]: Idhuku yanaikum ena samantham
  [Madhu]: !bug
  [Madhu]: !bug quiz emoji doesn’t match the movie at all
```

**Fix notes:** Root cause — Claude was generating emojis based on movie *scenes/theme* (e.g. 🐘 for Anniyan from a movie scene) instead of the *title word* ("anniyan" = stranger → 👤❓). Fixed by rewriting the emoji quiz prompt with: (1) an explicit WRONG example using Anniyan/elephant, (2) a RIGHT example showing anniyan = stranger, (3) a self-check rule: "Does each emoji match a WORD in the title, not a scene?" (4) more title-word examples (Thuppakki=🔫, Mersal=⚡ etc.). Deploy: restart bot.

---

## Bug #2 — 2026-03-18 19:54:19 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** quiz emoji doesn’t match the movie at all

**Recent chat context:**
```
  [Madhu]: !a vellinila
  [Madhu]: !a vennila
  [Madhu]: !a nilavuku en mel ena kobam
  [Madhu]: !a chandramukhi
  [Madhu]: !bug quiz emoji doesn’t match the movie at all
```

**Fix notes:** Root cause — Claude can’t reliably generate title-word emoji clues (keeps defaulting to scene/theme emojis). Fixed by replacing AI-generated quiz entirely with a hand-curated list of 40+ Tamil movies, each with verified emoji clues that map to title WORDS (e.g., Muthu → 🦪💎, Darbar → 👑⚖️). Quiz picks randomly from the curated pool, deduplicating recently used answers. Claude is no longer involved in quiz generation. Also added `!brandquiz` with 24 curated Indian brand emoji questions. Deploy: restart bot.

---

## Bug #3 — 2026-03-19 12:12:21 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** not recognising the answers while using !a on subsequent messages

**Recent chat context:**
```
  [Madhu]: !a clue venum
  [Madhu]: !a minnale
  [Madhu]: !a minnale
  [Madhu]: Oru vatti sonna pathaadha machi
  [Madhu]: !bug not recognising the answers while using !a on subsequent messages
```

**Fix notes:** Root cause — the 8-second per-user command rate limiter was silently dropping the second `!a minnale` (Madhu typed it twice in quick succession). "Oru vatti sonna pathaadha machi" was Madhu's own message expressing frustration, not a bot reply. Fixed by exempting `!a` / `!answer` commands from rate limiting entirely — game answers are time-sensitive and must never be dropped. All other commands (quiz, news, stats etc.) retain the 8s cooldown. Deploy: restart bot.

---

## Bug #4 — 2026-03-19 12:42:49 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** movie command returns irrelevant data. Make it more interesting by adding ratings and other information to spice things up

**Recent chat context:**
```
  [Krishna Madhan]: !h
  [Krishna Madhan]: !movie coolie
  [Krishna Madhan]: Otha
  [Krishna Madhan]: !movie rajini coolie
  [Krishna Madhan]: !bug movie command returns irrelevant data. Make it more interesting by adding ratings and other information to spice things up
```

**Fix notes:** Root cause — `handleMovie` treated ALL args as a "mood" string, so `!movie coolie` asked Claude to recommend a movie for the "coolie" mood, which gave nonsense. Fixed with intent detection: if the first word is a known mood/genre word (action, comedy, sad, etc.) → mood-based recommendation; otherwise → specific movie info card. The info card includes: title, year, director, cast, IMDb rating, plot, highlight, and a Tanglish verdict. Also handles upcoming films (like Coolie) cleanly — says "Upcoming" for unreleased movies and gives what's known so far. Deploy: restart bot.

---

## Bug #5 — 2026-03-19 13:09:02 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** coolie is not upcoming ( 2025) is in the past

**Recent chat context:**
```
  [Krishna Madhan]: !movie coolie
  [Krishna Madhan]: !bug coolie is not upcoming ( 2025) is in the past
```

**Fix notes:** Root cause — the `!movie` info prompt told Claude to say "Upcoming" for unreleased films but didn't pass today's date, so Claude used its training knowledge bias (which may have flagged Coolie as upcoming). Fixed by injecting `getISTToday()` explicitly into the movie info prompt with instruction: "If the movie released BEFORE today's date (${today}), it is NOT upcoming — state the actual release year." Films from 2024/2025 are now correctly shown as "released". Deploy: restart bot.

---

## Bug #6 — 2026-03-19 17:09:10 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** zodiac sign usage still exists

**Recent chat context:**
```
  [Madhu]: !brandquiz
  [Madhu]: !a ola
  [Madhu]: Avlo dan repeatuu la poriya
  [Madhu]: Bye machi
  [Madhu]: !bug zodiac sign usage still exists
```

**Fix notes:** Root cause — two places were actively encouraging zodiac use: (1) `sharedRules()` in claude.ts had "mention at most once every few exchanges" which is too loose — Claude always picks zodiac as the easiest personality angle, (2) profile context mode instructions explicitly said "celebrate their zodiac traits" (nanban) and "zodiac personality type" (peter) and "vary between job, zodiac, or partner" (roast). Fixed by: replacing the loose ZODIAC RULE with a hard ZODIAC SILENCE RULE — zodiac is ONLY allowed when the user mentions it first in conversation OR it's a dedicated !astro/horoscope command. Updated all three mode instructions in getGroupProfileContext() to say "Zodiac stored for !astro only — do NOT bring up in general chat." Deploy: restart bot.

---

## Bug #7 — 2026-03-19 22:21:38 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** context of games or activities is tracked by the bot. Questions on the games and activities are not responded properly, bot has no idea of those.

**Recent chat context:**
```
  [Indhu Sravan ✨]: !a apo Preethika wood sell panitu irundha
  [Krishna Madhan]: !a siva ku odaney love start aachu
  [Indhu Sravan ✨]: !a rendu perukum fire agudhu love agudhu
  [Krishna Madhan]: Thoo nalla illa full story proper ah sollu
  [Krishna Madhan]: !bug context of games or activities is tracked by the bot. Questions on the games and activities are not responded properly, bot has no idea of those.
```

**Fix notes:** Root cause — every bot response (game questions, !debate, !storytime, !mostlikely, !roast etc.) was sent to WhatsApp but NEVER added to the group's Claude conversation history. So when users followed up ("full story proper ah sollu"), the bot had zero context of what it just said. Fixed by adding `addBotMessageToHistory(groupId, response)` + `addRecentMessage("[Bot]: ...")` in listener.ts immediately after every `sendReply()` call — both for command responses and auto-responses. Deploy: restart bot.

---

## Bug #8 — 2026-03-19 22:22:28 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** see it happened again. Typo not corrected as context is not tracked

**Fix notes:** Same root cause and fix as Bug #7 — bot's own responses now tracked in history. Deploy: restart bot.

---

## Bug #9 — 2026-03-20 12:03:23 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** hari responded with the option provided

**Fix notes:** Root cause — same as Bug #7/8. The bot sent a WYR/trivia/news message but it wasn't in history. Hari typed `!a B` responding to something the bot said, but the bot had no record of its own message so the context was broken. Fixed by the same history tracking fix in listener.ts. Deploy: restart bot.

---

## Bug #10 — 2026-03-20 13:48:13 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** we want the bot to support tvk

**Fix notes:** Added TVK political stance to `sharedRules()` in claude.ts: "When Tamil politics comes up, this group backs TVK (Vijay Makkal Iyakkam). Roast DMK and AIADMK with comedy, root for TVK. Keep it playful fan banter — never crosses into genuine hate." Deploy: restart bot.

---

## Bug #11 — 2026-03-20 15:31:32 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** bot has no clue about the debate message. Set this in context for better output. Include games as well

**Fix notes:** Same root cause as Bug #7/8 — !debate response was never added to history, so "Repeat?" had no context. Fixed by the listener.ts history tracking fix. Deploy: restart bot.

---

## Bug #12 — 2026-03-20 15:32:00 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** repeated games and activities. Redo with new set of questions and guessing games

**Fix notes:** Expanded all curated content pools: CURATED_QUIZZES 43→67 movies (+24 new Tamil films: Sethu, Naayakan, Alaipayuthey, 7G Rainbow Colony, Kaadhal Kondein, Mozhi, Pithamagan, Sillunu Oru Kadhal, Doctor, Thunivu, 2.0, Thalapathy, Kaappaan, Mudhalvan, Naan Kadavul, Pariyerum Perumal, PS2, and more). CURATED_BRAND_QUIZZES 24→36 (+Myntra, Meesho, BigBasket, Nykaa, MakeMyTrip, BYJU's, Zepto, Tata Neu, Slice, NoBroker, PharmEasy, and more). FASTFINGER_WORDS 25→57 (+Tamil cities, foods, movie titles). MOSTLIKELY_SCENARIOS 15→30 (+15 new group-relatable scenarios). STORY_STARTERS 5→10 (+5 new group-specific starters). Deploy: restart bot.

---

## Bug #13 — 2026-03-21 09:22:18 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** horoscope date is showing as 15th January 2025 but today is 21st March 2026

**Recent chat context:**
```
  [Krishna Madhan]: !news tvk
  [Bot]: Dei, news konjam neram pakkattum! 5 min-la again try pannunga 🗞️
  [Bot]: ☀️ *MORNING ROAST*

Ayyo Saturday morning 10 baje... weekend plans ready panningala illa sofa mela paduthu Netflix recommendation kekka poringala? 😴

Rajini sir solluvaaru "Styles... styles..." but nammaloda style ellam pillow face print oda wake up aagradhu dhaan 💀

Ennada Saturday free-aa irundhaalum alarm off panna maateenga... adultu yaaro ippavum snore adichutu irupaanga bet! 😂
  [Bot]: 📚 *WORD OF THE DAY*

🔤 *Kavalai*
📖 Worry, anxiety, concern
💬 "Exam results vandhadhum amma ku romba kavalai aachu, but naan full confident ah irundhen!"
💡 Kavalai originally comes from the word "kaval" meaning protection - so worrying is like being a protective guard over something!
  [Madhu]: !bug horoscope date is showing as 15th January 2025 but today is 21st March 2026
```

**Fix notes:** Root cause — horoscope prompts in scheduler.ts never passed today's date to Claude, so Claude used its training-data bias and printed a stale date. Fixed by computing `todayStr` using IST offset and injecting it explicitly into both horoscope prompts (generic 12-sign fallback and personalized member horoscope): "Today is ${todayStr}" at the top of the prompt, plus a "Start with 🗓️ ${todayStr}" rule so the date appears visibly in the output. Deploy: restart bot.

---

## Bug #14 — 2026-03-21 10:58:18 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** movie names are still repeating

**Recent chat context:**
```
  [Madhu]: !a terlaye
  [Bot]: ❌ Wrong da! Hint: Kamal's comeback — a secret agent and a dangerous drug cartel
  [Madhu]: !a Vikram
  [Bot]: ✅ Correct da Madhu! 🎉

Movie: *vikram*
+10 points!

Type !quiz for next question.
  [Madhu]: !bug movie names are still repeating
```

**Fix notes:** Root cause — `MAX_RECENT_ANSWERS` was 8, so only the last 8 answers were excluded from the pool. With 67+ quiz entries, movies recycled quickly. Fixed by increasing `MAX_RECENT_ANSWERS` from 8 → 30 in games.ts. Now the bot remembers the last 30 answered movies and avoids repeating them. Deploy: restart bot.

---

## Bug #15 — 2026-03-22 22:41:18 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** refresh all the quiz, everything is getting repetitive and unrelated

**Recent chat context:**
```
  [Bot]: ✅ Correct da Krishna Madhan! 🎉

Movie: *naan kadavul*
+10 points!

Type !quiz for next question.
  [Madhu]: Naan kaduvul ah🤣🤣
  [Krishna Madhan]: Paambu enga irundhu vandhu
  [Madhu]: Onum velangala
  [Krishna Madhan]: !bug refresh all the quiz, everything is getting repetitive and unrelated
```

**Fix notes:** Root cause — (1) `naan kadavul` had emojis 📸🐍 (camera + snake) which don't match the title "Naan Kadavul" (I am God) at all. Fixed to 🙋🙏 (I + God). (2) `vikram vedha` had a duplicate entry with 🐆 emoji — removed the duplicate. (3) `mersal` used ⚡ which clashed with `minnale`'s ⚡💑 — changed to 🪄⚡ (magic + lightning, reflects Vijay's magician role). (4) Added 12 new movies to the pool (anbe sivam, kakka muttai, vaaranam aayiram, thani oruvan, kabali, puli, ok kanmani, tik tik tik, valimai, neethane en ponvasantham, vettaiyaadu vilaiyaadu). Pool now has 79+ movies. Deploy: restart bot.

---

## Bug #16 — 2026-03-23 23:05:46 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** trivia is wrong

**Recent chat context:**
```
  [Bot]: ⏰ Time up! Answer: *virender sehwag*
💡 He scored 319 against South Africa in 2008 and was originally from Tamil Nadu before moving to Delhi

Type !trivia for next question.
  [Harikrishnan D]: !ff
  [Bot]: ⚡ *FAST FINGER FIRST!*

🎯 First to type this EXACTLY wins *15 points*:

*VADIVELU*

Type *!a VADIVELU* — GO! 🏃
  [Harikrishnan D]: !a vadivelu
  [Krishna Madhan]: !bug trivia is wrong
```

**Fix notes:** Root cause — `startTrivia()` asked Claude to generate trivia questions, and Claude hallucinated facts (Sehwag "originally from Tamil Nadu" — he's from Haryana/Delhi). Fixed by replacing AI-generated trivia entirely with a hand-curated pool of 31 verified questions (same approach as quiz fix in Bug #2). Pool covers: TN geography, Kollywood records, BGM composers, debut films, Tamil movie remakes, food & culture, TN history, cricket. Added separate `recentTriviaAnswers` deduplication so same question doesn't repeat for 20 rounds. Deploy: restart bot.

---

## Bug #17 — 2026-03-24 14:46:39 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** we want two person to type !ff ( fast fingers game only )for the game to begin . otherwise people are getting points by playing when no one is around

**Fix notes:** Replaced `startFastFinger` with a two-phase `handleFastFinger`. Phase 1: first `!ff` creates a `fastfinger_lobby` DB record with 30-second expiry — bot announces "lobby open, type !ff to join". Phase 2: when a DIFFERENT person types `!ff`, lobby is closed and game launches immediately. If same person types again they're told to wait. If nobody joins in 30s the lobby record expires automatically (DB `expires_at` + existing `gt` filter). Solo play is no longer possible. Deploy: restart bot.

---

## Bug #18 — 2026-03-24 14:48:44 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** when ff game is dropped we want random order like reverse / original in the question for the typing order in acceptance criteria.

**Fix notes:** When the game launches (second player joins), there's a 40% chance players are asked to type the REVERSE of the shown word instead of the word itself (e.g. shown "SARPATTA", must type "ATTAPRAS"). Bot announces "🔄 Type the REVERSE of: *WORD*". State stores `isReversed` + `requiredAnswer`. `handleAnswer` checks against `requiredAnswer` (not `targetWord`). Wrong-answer hint also adapts — shows "Type the REVERSE of *WORD*" or "Type EXACTLY: *WORD*" depending on mode. Deploy: restart bot.

---

## Bug #19 — 2026-03-24 21:03:05 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** would you rather is not taking both !a or !answer for providing answers

**Recent chat context:**
```
  [Madhu]: !answer A
  [Bot]: Machaan, answer type pannu! !answer <your answer>
  [Madhu]: !answer A
  [Bot]: Machaan, answer type pannu! !answer <your answer>
  [Madhu]: !bug would you rather is not taking both !a or !answer for providing answers
```

**Fix notes:** Root cause — `handleAnswer()` had a `answer.length < 2` guard that silently rejected any single-character answer. WYR accepts "A" or "B" (1 char) so every `!a A` / `!answer A` was blocked before reaching the WYR case. Fixed by changing the guard to `answer.length < 1` (reject only truly empty input). Deploy: restart bot.

---

## Bug #20 — 2026-03-25 10:45:20 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** if a question has been used then move it archive so that it doesn’t get repeated. During each update cycle add more new questions

**Fix notes:** Replaced in-memory `recentAnswers`/`recentTriviaAnswers` Maps with a persistent file-based archive at `data/used-answers.json`. Structure: `{ groupId: { quiz, brandquiz, trivia, fastfinger: string[] } }`. All 4 game types (`startQuiz`, `startBrandQuiz`, `startTrivia`, `launchFastFingerGame`) now call `archiveAnswer()` which appends to the JSON file on disk. On bot restart, archive is loaded from disk — no repeats across restarts. When entire pool for a group+type is exhausted, `resetArchive()` clears it and the cycle starts over. `fs`/`path` imports added to games.ts. `startDialogue` (AI-based) uses quiz archive for its avoid-list too. Deploy: restart bot.

**Recent chat context:**
```
  [Bot]: 📚 *WORD OF THE DAY*

🔤 *Kalakkiteenga*
📖 You rocked it / You nailed it
💬 "Boss meeting la presentation kodutheenga, kalakkiteenga da!"
💡 This word became super popular after Rajini sir used it in movies and now everyone uses it for appreciating anything awesome!
  [Madhu]: !a michael madana kamarajan
  [Bot]: ✅ Correct da Madhu! 🎉

Movie: *michael madana kama rajan*
+10 points!

Type !quiz for next question.
  [Bot]: 📰 *HOT NEWS*

Kerala la oru candidate ku 4 per same name opponent ah contest pannraanga — what is this, musical chairs ah? 😂

Love Mocktail 3 nu oru Kannada padam hit aagirukku while big budget films flop pannitu irukku — small budget, big heart always wins da!

Cricket Hall of Fame ku pudhusa rendu per add pannirkaanga but naama still World Cup final la cry pannikitu thaan irukom 🏆

*Scene ye mokka thaan but entertainment value super!* ✨
  [Krishna Madhan]: !bug if a question has been used then move it archive so that it doesn’t get repeated. During each update cycle add more new questions
```

**Fix notes:** _(developer fills this in)_

---

## Bug #21 — 2026-03-25 20:12:39 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** nicknames are getting considered as different people. Inspite of valiant effort from Madhu, ai is unable to learn

**Recent chat context:**
```
  [Krishna Madhan]: !mode peter
  [Bot]: 🎓 PETER MODE — Broken English, over-explains everything, very much sophisticated itself.
  [Krishna Madhan]: Machi who and all there in group da
  [Bot]: Actually speaking, this group is having very interesting demographic composition itself na? We are having Hari married to Madhu, Siva married to Preethinga, Madhan married to Indhu, and Thukuduraiiii 
  [Krishna Madhan]: !bug nicknames are getting considered as different people. Inspite of valiant effort from Madhu, ai is unable to learn
```

**Fix notes:** Three-part fix in `profiles.ts`: (1) `seedKnownCouples` now uses `ilike("member_name", "Hari%")` so short names match full WhatsApp names; auto-sets short name as nickname if not already set. (2) `extractProfileInfo` detects "call me X", "my nickname is X" patterns and auto-saves nickname. (3) `getGroupProfileContext` now leads with nickname: "Hari (full name: Harikrishnan D)" + CRITICAL instruction that short names in chat must be matched to the member list, never treated as unknown extra people. Deploy: restart bot.

---

## Bug #22 — 2026-03-25 22:33:14 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** wrong answer matched

**Recent chat context:**
```
  [Harikrishnan D]: !a torurist family
  [Bot]: ❌ Thambi wrong answer. Try again! (Attempt 2/6)
  [Krishna Madhan]: !a u
  [Bot]: ✅ Correct da Krishna Madhan! 🎉

Movie: *dharma durai*
+10 points!

Type !quiz for next question.
  [Krishna Madhan]: !bug wrong answer matched
```

**Fix notes:** Root cause — `fuzzyMatch` had `b.includes(a)` with no length guard. "dharmadurai" contains the letter "u" as a substring → matched. Fixed by requiring the shorter string to be at least 3 chars before the includes check fires. Deploy: restart bot.

---

## Bug #23 — 2026-03-25 23:00:44 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** wrong answer accepted

**Recent chat context:**
```
  [Harikrishnan D]: !a dna
  [Bot]: ❌ Thambi wrong answer. Try again! (Attempt 1/6)
  [Madhu]: !a 7 arivu
  [Bot]: ✅ Correct da Madhu! 🎉

Movie: *i*
+10 points!

Type !quiz for next question.
  [Krishna Madhan]: !bug wrong answer accepted
```

**Fix notes:** Same root cause as Bug #22 — `fuzzyMatch` had `a.includes(b)` with no length guard. "7arivu" contains the letter "i" as a substring → matched against answer "i" (the Shankar movie). Fixed by same guard: shorter string must be ≥ 3 chars. Also added `Math.abs(a.length - b.length) > maxDist → false` early-exit to levenshtein path. Deploy: restart bot.

---

## Bug #24 — 2026-03-26 10:33:08 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** the answer for 2 truths and one line always come in the 3rd option

**Recent chat context:**
```
  [Madhu]: !2t1l
  [Bot]: 🤥 *2 TRUTHS, 1 LIE*

*IPL and MS Dhoni*

1️⃣ CSK has won 5 IPL titles (2010, 2011, 2018, 2021, 2023)
2️⃣ IPL started in 2008 with Rajasthan Royals winning the first season
3️⃣ MS Dhoni has played onl
  [Madhu]: !a 3
  [Bot]: ✅ Correct da Madhu! Statement 3 was the LIE! 🤥

CSK has 5 titles ✓ and Rajasthan won the first IPL ✓ — but Dhoni played for Rising Pune Supergiant in 2016-17 when CSK was suspended for spot-fixing! H
  [Madhu]: !bug the answer for 2 truths and one line always come in the 3rd option
```

**Fix notes:** Root cause — all 8 curated `TWO_TRUTHS_ONE_LIE` entries were authored with the lie as the 3rd statement (lieIndex: 3). Fixed in `startTwoTruthsOneLie` with a Fisher-Yates shuffle of the `statements` array before storing game state. `lieIndex` is recalculated as `shuffled.indexOf(lieText) + 1` after shuffle, so the lie lands in position 1, 2, or 3 randomly each game. Deploy: restart bot.

---

## Bug #25 — 2026-03-26 12:14:05 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** riddle has wrong information and data

**Recent chat context:**
```
  [Madhu]: Eruma ku oru kombu dan ag iruku
  [Madhu]: Machi how many horns eruma nas
  [Bot]: Madhu akka, good catch! 😅

Eruma ku actually *two* horns dhaan irukku — I made a mistake in the riddle da!

Should have said "oru pair of horns" or just mentioned something else as the clue. My bad a
  [Krishna Madhan]: !riddle
  [Madhu]: !bug riddle has wrong information and data
```

**Fix notes:** Root cause — riddle prompt gave Claude no factual accuracy instructions, so it invented details (e.g. buffalo has 1 horn). Fixed by adding a STRICT ACCURACY RULES block to the riddle generation prompt: explicit animal anatomy facts (buffalo=2 horns, cow=4 legs, spider=8 legs), a "verify counts before writing" rule, and "if unsure, use a different clue" fallback. Deploy: restart bot.

---

## Bug #26 — 2026-03-26 12:38:06 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** 3 rd player in blackjack removes first

**Recent chat context:**
```
  [Bot]: 🃏 *BLACKJACK TABLE* — thala Krishna Madhan and Thukuduraiiii both joining!

**Krishna Madhan:** 🂴 🃒 = **16**
**Harikrishnan D:** 🃞 🂳 = **19**
**Dealer:** 🂥 🃟 = **?**

Nice contrast here! Thukud
  [Harikrishnan D]: !stand
  [Harikrishnan D]: Confirm win
  [Bot]: 🃏 *BLACKJACK UPDATE*

**Krishna Madhan:** 🂴 🃒 = **16** (waiting for move)
**Harikrishnan D:** 🃞 🂳 = **19** (STANDING)
**Dealer:** 🂥 🃟 = **?**

Smart move Thukuduraiiii! 19 is excellent — let th
  [Krishna Madhan]: !bug 3 rd player in blackjack removes first
```

**Fix notes:** Root cause — Blackjack game state was managed entirely by Claude through conversation history. Claude doesn't reliably maintain player hand state across turns — it invents eliminations, misidentifies players, and corrupts the game. Fixed by adding a STATEFUL GAME BAN to `sharedRules()` in claude.ts: Claude now refuses to run Blackjack/Poker/Chess/Carrom/Rummy and instead redirects to `!quiz`, `!ff`, or `!2t1l`. Deploy: restart bot.

---

## Bug #27 — 2026-03-26 13:10:55 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** response is too slow

**Recent chat context:**
```
  [Krishna Madhan]: Porumai porumai
  [Madhu]: !a kathi
  [Bot]: ❌ Thambi wrong answer. Try again! (Attempt 1/6)
  [Bot]: Dei Preethinga! 😄

Enna da "vanthuutaan" nu solra... naan enga ponen?

Inga dhan iruken da! Game sethu pochu nu complaint pannitu, ippo "vanthuutaan" nu welcome panra! 🤷‍♂️

Confusion-aa iruke... n
  [Krishna Madhan]: !bug response is too slow
```

**Fix notes:** Root cause — every incoming message triggered 2 serial Supabase calls (muted check + auto_response check). Fixed by introducing a 30-second settings cache in `src/group-settings-cache.ts`. Both checks now use a single combined `getGroupSettings()` call that caches `{ muted, auto_response }` per group for 30s. Cache is invalidated immediately on `!mute`/`!unmute` so muting takes effect on the very next message. Saves 1–2 DB round trips per message. Deploy: restart bot.

---

## Bug #28 — 2026-03-26 13:14:11 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** no response from bot. Heavy lag

**Recent chat context:**
```
  [Madhu]: Poitan da🫨
  [preethigamurugan15]: Naa typa panla bha enkita tha pesamatikran
  [preethigamurugan15]: Naa strike pandren😂
  [Madhu]: Protest against machii
  [Krishna Madhan]: !bug no response from bot. Heavy lag
```

**Fix notes:** Same root cause and fix as Bug #27 — serial Supabase calls adding latency on every message. Resolved by the 30-second settings cache in `group-settings-cache.ts`. Deploy: restart bot.

---

## Bug #29 — 2026-03-26 20:10:38 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** 2t1l shouldn’t give 6 attempts 1 is enough

**Recent chat context:**
```
  [Madhu]: Ah
  [Madhu]: Seri ah pochu
  [Madhu]: 🤣🤣
  [Krishna Madhan]: Nethu dhaana kalidas paathom
  [Krishna Madhan]: !bug 2t1l shouldn’t give 6 attempts 1 is enough
```

**Fix notes:** Root cause — 2T1L had 6 attempts with a hint at 3, same as quiz/trivia. But with only 3 options (1/2/3), anyone can brute-force it. Fixed by reducing to a single attempt: wrong answer immediately ends the game and reveals the lie with explanation. Right answer = +10 pts. Deploy: restart bot.

---

## Bug #30 — 2026-03-26 20:13:25 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** repeated questions

**Recent chat context:**
```
  [Madhu]: !a michale madhana kamarajan
  [Bot]: ✅ Correct da Madhu! 🎉

Movie: *michael madana kama rajan*
+10 points!

Type !quiz for next question.
  [Madhu]: Duplicate
  [Madhu]: Duplicate
  [Krishna Madhan]: !bug repeated questions
```

**Fix notes:** Root cause — race condition in all `startXxx` game functions. `archiveAnswer()` was called AFTER `await createGame()`. If two `!quiz` requests arrived before the first `archiveAnswer` completed (during the Supabase await), both would read the same archive state and could pick the same movie. Fixed by moving all `archiveAnswer` calls to BEFORE `await createGame` in `startQuiz`, `startBrandQuiz`, `startTrivia`, and `launchFastFingerGame`. Archive is now updated synchronously before any async yield, preventing the race. Deploy: restart bot.

---

## Bug #31 — 2026-03-29 20:26:08 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** no ipl knowledge, match updates not auto dropping

**Recent chat context:**
```
  [Krishna Madhan]: Aama machi innaiku yaarukum yaarukum match
  [Bot]: Ah thala, innaiku match irukka-nu kekra? 😅
  [Krishna Madhan]: !cricket
  [Bot]: 🏏 *LIVE CRICKET SCORES*
🏏 *Konark Suryas Odisha vs Royal Riders Punjab, Final, Legends League Cricket 2026*
  [Krishna Madhan]: !bug no ipl knowledge, match updates not auto dropping
```

**Fix notes:** Two fixes:
1. **`!cricket` showing wrong tournament** — `getLiveScores()` and `checkCricketUpdates()` now prioritize IPL matches (by name + team abbreviation detection). Falls back to all matches only when no IPL game is live.
2. **Match auto-drop missed window** — `checkAndAnnounceMatches` window expanded from "3h before match start" to "6h before", and the hard `msUntil < 0` block relaxed to 4h after start. `/api/bot/upcoming` now also returns matches that started within the last 4h (covers bot restarts mid-match). Deploy: push ipl-fantasy, restart bot.

---

## Bug #32 — 2026-04-01 13:04:50 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** brandquiz is repeating

**Recent chat context:**
```
  [Madhu]: !a mrf
  [Bot]: ✅ Correct da Madhu! 🎉

Brand: *mrf*
+10 points!

Type !brandquiz for next one.
  [Madhu]: !brandquiz
  [Bot]: 🏷️ *BRAND QUIZ*

Ennaa brand? 🛶📄

Type *!a <brand name>* to answer
3 wrong attempts-ku appuram hint varum!
  [Madhu]: !bug brandquiz is repeating
```

**Fix notes:** Archive system fully rewritten with Supabase persistence (`ba_question_archive` table). Added `syncArchiveFromSupabase()` called on bot startup. Added 18 new brand quiz entries (now ~58 total). Deploy: run `migration_008.sql` in Supabase, then restart bot.

---

## Bug #33 — 2026-04-01 13:06:08 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** brandquiz directly revealing answers in the clue itself

**Recent chat context:**
```
  [Madhu]: !a bike
  [Bot]: ❌ Wrong da! Hint: Chennai's own two-wheeler brand — TVS Apache, Jupiter — T.V. Sundaram group
  [Madhu]: !a tvs
  [Bot]: ✅ Correct da Madhu! 🎉

Brand: *tvs*
+10 points!

Type !brandquiz for next one.
  [Madhu]: !bug brandquiz directly revealing answers in the clue itself
```

**Fix notes:** TVS hint removed "TVS Apache, Jupiter" — now says "bikes and scooters for the common man". Audited all other brand hints — no other answers were self-revealing.

---

## Bug #34 — 2026-04-01 18:11:58 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** while revealing the answer explain why the emoji had been used in the quiz in context to the answer

**Recent chat context:**
```
  [Bot]: ⏰ Time up! Answer: *kaakha kaakha*

Yaarum correct solla mudiyala 😅
Type !quiz for next question.
  [Krishna Madhan]: Otha
  [Harikrishnan D]: Shit
  [Madhu]: 🤣🤣🤣🤣🤣
  [Krishna Madhan]: !bug while revealing the answer explain why the emoji had been used in the quiz in context to the answer
```

**Fix notes:** On correct answer: `✅ Correct da X!\n\nMovie: *y*\n💡 _🐦🐦 → hint text_\n+10 points!` On timeout: `⏰ Time up! Answer: *y*\n💡 _Emoji explained: 🐦🐦 → hint text_`. Applied to both quiz and brandquiz.

---

## Bug #35 — 2026-04-01 18:28:11 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** same repeated questions in brandquiz

**Recent chat context:**
```
  [Madhu]: !brandquiz
  [Bot]: 🏷️ *BRAND QUIZ*

Ennaa brand? 💧🔵

Type *!a <brand name>* to answer
3 wrong attempts-ku appuram hint varum!
  [Madhu]: !a bisleri
  [Bot]: ✅ Correct da Madhu! 🎉

Brand: *bisleri*
+10 points!

Type !brandquiz for next one.
  [Madhu]: !bug same repeated questions in brandquiz
```

**Fix notes:** Same root cause as Bug #32 — fixed by same Supabase archive system + more brand entries. Restart bot to deploy.

---

## Bug #36 — 2026-04-08 17:36:01 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** toss never happened toss at 7 pm for today

**Recent chat context:**
```
  [Bot]: 🪙 *TOSS RESULT!*

⚡ *Playing XI confirmed!* Update your team NOW!
_(Last chance before match starts)_

🟡 *Delhi Capitals*
Axar Patel (AR)
Sameer Rizvi (BAT)
David Miller (BAT)
Pathum Nissanka (BAT)
Nitish Rana (BAT)
Kuldeep Yadav (BOWL)
Mukesh Kumar (BOWL)
T Natarajan (BOWL)
Lungi Ngidi (BOWL)
Vipraj Nigam (BOWL)
KL Rahul (WK)

🔵 *Gujarat Titans*
Mohammed Siraj (BOWL)
Sai Sudharsan (BAT)
Jos Buttler (WK)

🔗 Update team: https://ipl11.vercel.app/matches/d2092787-94b7-4388-8af5-5f7ca50a0be4
  [Bot]: 🪙 *TOSS RESULT!*

⚡ *Playing XI confirmed!* Update your team NOW!
_(Last chance before match starts)_

🟡 *Delhi Capitals*
Axar Patel (AR)
Sameer Rizvi (BAT)
David Miller (BAT)
Pathum Nissanka (BAT)
Nitish Rana (BAT)
Kuldeep Yadav (BOWL)
Mukesh Kumar (BOWL)
T Natarajan (BOWL)
Lungi Ngidi (BOWL)
Vipraj Nigam (BOWL)
KL Rahul (WK)

🔵 *Gujarat Titans*
Mohammed Siraj (BOWL)
Sai Sudharsan (BAT)
Jos Buttler (WK)

🔗 Update team: https://ipl11.vercel.app/matches/d2092787-94b7-4388-8af5-5f7ca50a0be4
  [Krishna Madhan]: Spam panna start pannitaan
  [Krishna Madhan]: 🥲
  [Krishna Madhan]: !bug toss never happened toss at 7 pm for today
```

**Fix notes:** Two root causes in `checkAndSendToss` (`fantasy.ts`):
1. **False early trigger** — `hasToss` was `toss_winner || playing_xi.home.length > 0`. IPL API returns probable XI *before* the actual toss, so `home.length > 0` fired 2+ hours early with no real toss. Fixed: `hasToss = !!toss_winner` only — message only sends when toss winner is confirmed.
2. **Spam on DB write failure** — `saveState` silently swallowed upsert errors (no error check on return value), so `toss_notified_at` was never persisted. Every 5-min cron re-found the same row with null and re-sent the message. Fixed: `saveState` now throws if Supabase returns an error, which aborts the send and lets the next cron retry properly. Deploy: restart bot.

---



## Bug #37 — 2026-04-11
**Reporter:** Harikrishnan D (session audit)
**Status:** `FIXED`
**Description:** Bot-created contest charging ₹1000 entry fee but awarding ₹0 to winners — money disappears

**Root cause:** `POST /api/bot/contest` was inserting `entry_fee: 1000` but `prize_pool: 0`. The join route deducted ₹1000 per user (`if (contest.entry_fee > 0)`). The payout route computed `calcPrizeTiers(0, ...)` → `perPlayerAmount: 0` for all ranks → nobody paid out. The announcement also incorrectly said "Entry: FREE" while the app charged 1000.

**Fix:**
1. `api/bot/contest/route.ts`: Changed `entry_fee: 1000` → `entry_fee: 0` — bot group contest is free (bragging rights only)
2. `api/admin/matches/[id]/complete/route.ts`: Added safety guard — if `prize_pool = 0` but `entry_fee_paid > 0`, auto-refund all users instead of distributing nothing
3. `api/admin/bot-contest-refund/route.ts`: NEW one-time endpoint — retroactively refunds past affected users. Call `POST /api/admin/bot-contest-refund` once after deploy.

Deploy: push ipl-fantasy → call POST /api/admin/bot-contest-refund once to fix past contests.## Bug #38 — 2026-04-11 15:56:34 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** 2 games are happening today fl returns leaderbaord for game that hasn’t started

**Recent chat context:**
```
  [Harikrishnan D]: !fl
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Chennai Super Kings vs Delhi Capitals_

🥇 *harikrishnan977* — 0 pts
   _Team 1_
🥈 *Krishna Madhan* — 0 pts
   _Team 1_

_Join panna ippo time irukku!_
  [Harikrishnan D]: Srh vs pk ku varatha
  [Krishna Madhan]: Latest match yedukudhu
  [Krishna Madhan]: !bug 2 games are happening today fl returns leaderbaord for game that hasn’t started
```

**Root cause:** All handler functions (`handleJoin`, `handleLeaderboard`, `handleStats`, `handlePlayingXI`, `handleDiff`, `handleLock`, `handleSyncXI`) used `ORDER BY scheduled_at DESC LIMIT 1` which always picks the **latest-scheduled** match — on a double-header day this is the future match, not the live one.

**Fix:** Added `getActiveState(groupId)` helper in `fantasy.ts` — fetches all non-completed announced states, partitions into started vs future, returns most-recently-started (live) first, soonest-upcoming as fallback. All handlers now use this instead of the DESC sort query. `handleGoLive` uses same partition logic inline (needs `locked_at NOT NULL` filter not in `getActiveState`).

---

## Bug #39 — 2026-04-11 16:44:48 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** score doesn’t refresh

**Recent chat context:**
```
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Punjab Kings vs Sunrisers Hyderabad_

🥇 *harikrishnan977* — 172 pts
   _Team 1_
🥈 *Krishna Madhan* — 170 pts
   _Team 1_
🥉 *madhumithakanna* — 120 pts
   _Team 1_

_Match 
  [Krishna Madhan]: !lb
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Punjab Kings vs Sunrisers Hyderabad_

🥇 *harikrishnan977* — 172 pts
   _Team 1_
🥈 *Krishna Madhan* — 170 pts
   _Team 1_  
🥉 *madhumithakanna* — 120 pts
   _Team 1_

Thala
  [Krishna Madhan]: !fb
  [Krishna Madhan]: !bug score doesn’t refresh
```

**Root cause:** Two issues:
1. `checkAndSendToss` detected the toss and saved `toss_notified_at` but never transitioned the match to `live` status in the DB. The `sync-live` cron only processes matches with `status = ‘live’`, so scoring never started — scores stayed at last-synced values.
2. `handleLeaderboard` sync had a 6s `Promise.race` timeout, but the full Cricbuzz fetch + parse + upsert + leaderboard update pipeline takes 6-8s, so the timeout fired first and stale cached data was returned.

**Fix:**
1. `checkAndSendToss` now auto-locks + auto-goes-live the match immediately after toss detected (before sending toss announcement). Also saves `locked_at` alongside `toss_notified_at`.
2. `handleLeaderboard` sync timeout increased from 6s → 12s.

---

## Bug #40 — 2026-04-11 17:19:47 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** html returned for diff

**Recent chat context:**
```
  [Krishna Madhan]: !fantasy help
  [Bot]: 🏏 *Fantasy Cricket Commands*

!fantasy join — Join group contest
!fantasy lb — Leaderboard (syncs live scores first)
!fantasy diff — Compare top 2 teams side-by-side
!fantasy diff Krish Madhan — Comp
  [Krishna Madhan]: !fantasy diff krish hari
  [Bot]: Team diff error: <!DOCTYPE html><html lang="en" class="rajdhani_92eb9b2b-module__AHegJq__variable"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, maxi
  [Krishna Madhan]: !bug html returned for diff
```

**Root cause:** `diff/page.tsx` used `divideColor` as an inline style property (e.g., `style={{ divideColor: "#252D3D" }}`). `divideColor` is a Tailwind utility, not a CSS property — this caused 5 TypeScript compilation errors. The Vercel build failed, so the old deployment (without `team-diff/route.ts`) was still live. The bot hit a 404 which Next.js renders as an HTML page.

**Fix:**
1. `diff/page.tsx`: Removed all 5 invalid `divideColor` inline style properties
2. `dashboard/page.tsx`: Cast complex Supabase query to `any` to fix "type instantiation excessively deep" error
3. `handleDiff` in `fantasy.ts`: HTML responses (from 404/500) now show a friendly error instead of dumping raw HTML to WhatsApp

---

## Bug #41 — 2026-04-13 19:37:03 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** emoji clues in quiz for movie name are irrelevant

**Recent chat context:**
```
  [Madhu]: !a mullum malarum
  [Bot]: ❌ Wrong da! Hint: Karthi meets a man who claims to be his long-lost childhood friend — emotional thriller
  [Madhu]: !a meiyazhagan
  [Bot]: ✅ Correct da Madhu! 🎉

Movie: *meiyazhagan*
💡 _🌸🤝 → Karthi meets a man who claims to be his long-lost childhood friend — emotional thriller_
+10 points!

Type !quiz for next question.
  [Madhu]: !bug emoji clues in quiz for movie name are irrelevant
```

**Fix notes:** Root cause — `meiyazhagan` had emojis 🌸🤝 (flower + handshake) which don't map to the title words at all. "Meiyazhagan" = "Mei" (real/true) + "Azhagan" (beautiful person). Fixed to 💯👤 (true/100% + person) — both emojis represent the actual title words. Deploy: restart bot.

---

## Bug #42 — 2026-04-13 19:37:42 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** after reporting a bug next command is not executed

**Recent chat context:**
```
  [Bot]: ✅ Correct da Madhu! 🎉

Movie: *meiyazhagan*
💡 _🌸🤝 → Karthi meets a man who claims to be his long-lost childhood friend — emotional thriller_
+10 points!

Type !quiz for next question.
  [Madhu]: !bug emoji clues in quiz for movie name are irrelevant
  [Bot]: 🐛 Bug #41 noted! Thanks Madhu 🙏
_"emoji clues in quiz for movie name are irrelevant"_

Will be fixed in the next update.
  [Madhu]: !quiz
  [Madhu]: !bug after reporting a bug next command is not executed
```

**Fix notes:** Root cause — the 8-second per-user command rate limiter applied to `!bug`. When Madhu typed `!quiz` immediately after `!bug`, the cooldown timer (set by `!bug`) blocked `!quiz` silently. Fixed by exempting `!bug` from rate limiting in listener.ts alongside `!answer` — bug reports are instant file writes with no abuse risk, and users naturally want to continue playing right after reporting. Deploy: restart bot.

---

## Bug #43 — 2026-04-16 15:17:14 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** mis information

**Recent chat context:**
```
  [Madhu]: Thappu thappu
  [Madhu]: Punjab vs mumbai inaiku
  [Bot]: Dei maddy! 😂

Enna thappu nu sollara... thala phone number tag panni sorry solli confusion create pannuna thappu dhaana?

Illa naan over ah roast pannena thappu? Both ways um thala dhaan loose da!

W
  [Bot]: Dei Madhu! Sharp ah catch pannita da! 😂

Punjab vs Mumbai dhaan today - naan SRH nu type pannitu confusion create panniten. Copy-paste mokka!

Mumbai ku Wankhede home ground advantage iruku, but Punj
  [Krishna Madhan]: !bug mis information
```

**Fix notes:** Root cause — Claude was hallucinating IPL fixture/score data from stale training memory in free-chat responses (said "SRH" when the match was Punjab vs Mumbai). Added a CRICKET SCORES rule to `sharedRules()` in claude.ts: Claude must NEVER mention specific live scores, today's fixtures, or recent results from memory — they are stale and wrong. Instead it must redirect: "Dei, !cricket type panna live score solluven da 🏏". Deploy: restart bot.

---

## Bug #44 — 2026-04-16 15:25:39 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** stale match data

**Recent chat context:**
```
  [Bot]: Dei maddy! 😂

Enna thappu nu sollara... thala phone number tag panni sorry solli confusion create pannuna thappu dhaana?

Illa naan over ah roast pannena thappu? Both ways um thala dhaan loose da!

W
  [Bot]: Dei Madhu! Sharp ah catch pannita da! 😂

Punjab vs Mumbai dhaan today - naan SRH nu type pannitu confusion create panniten. Copy-paste mokka!

Mumbai ku Wankhede home ground advantage iruku, but Punj
  [Krishna Madhan]: !bug mis information
  [Bot]: 🐛 Bug #43 noted! Thanks Krishna Madhan 🙏
_"mis information"_

Will be fixed in the next update.
  [Krishna Madhan]: !bug stale match data
```

**Fix notes:** Same root cause and fix as Bug #43 — Claude hallucinating stale cricket data. Fixed by same CRICKET SCORES rule in sharedRules(). Deploy: restart bot.

---

## Bug #45 — 2026-04-16 19:15:19 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** wrong match contest

**Recent chat context:**
```
  [Bot]: 🎬 *RANDOM MOVIE FACT*

Thalapathy Vijay's "Thuppakki" la oru scene irukku where he jumps from helicopter right? Athu actually Vijay than jump pannaru da - no dupe! 🚁

Director Murugadoss was like "Vijay sir please dupe use pannunga" but our Thalapathy said "Dei naan than jump pannuven" and literally jumped from 200 feet height with safety gear. 

Insurance company almost heart attack vanthuruchi but film hit aachu! Mass level dedication da 🔥💥
  [Bot]: ⏰ *MATCH ALERT!*

*Rajasthan Royals vs Mumbai Indians*
🕐 Tue, 7 Apr, 7:30 pm

Join now before toss: https://ipl11.vercel.app/contests/join?code=3ODZZH

_Waiting for toss result... 🪙 Will post playing XI as soon as it's done!_
  [Madhu]: Meendum thappu
  [Krishna Madhan]: !bug wrong match contest
```

**Fix notes:** Root cause — `preMatchCheck` queried `ba_fantasy_state` with no date filter on `scheduled_at`. The time-of-day filter (`Math.abs(h * 60 + min - targetMins) <= 35`) only compared HH:MM, so any stale match from a previous day at the same kick-off time (e.g. April 7 7:30 PM) would re-trigger on every subsequent day at 7:10 PM as long as `toss_notified_at` and `completed_at` were both NULL. Fixed by adding `gte("scheduled_at", now - 3h)` and `lte("scheduled_at", now + 3h)` to the DB query, so only matches actually scheduled near now are candidates. Also ran a one-off DB cleanup that marked 9 stale announced-but-never-completed matches (April 7–15) as `completed_at = now`. Deploy: restart bot.

---

## Bug #46 — 2026-04-18 14:59:25 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** spot filled is always 1

**Recent chat context:**
```
  [Bot]: 🏏 *IPL Fantasy Alert!*

*Royal Challengers Bengaluru vs Delhi Capitals*
📅 Sat, 18 Apr, 3:30 pm (4h 29m from now)
📍 M.Chinnaswamy Stadium

Dei macha! Namma group-ku oru private contest ready aayiruchu! 🔥

💰 Entry: FREE
🎯 Invite Code: *E9F5R4*

📱 Join here:
https://ipl11.vercel.app/contests/join?code=E9F5R4

━━━━━━━━━━━━━━━━━━
🏟️ *GROUND PREDICTION*
🔥 Batting paradise — 200+ expected. Pick ARs & power hitters. Avoid pure spinners.

⭐ *PLAYERS TO WATCH*
🔵 Bengaluru: Venkatesh Iyer (AR), Vihaan Malhotra (AR), Jitesh Sharma (WK 🧤), Jordan Cox (WK 🧤), Virat Kohli (BAT)
🟡 Capitals: Ajay Jadav Mandal (AR), Madhav Tiwari (AR), KL Rahul (WK 🧤), Abishek Porel (WK 🧤), Ben Duckett (BAT)

*Ippave team set pannu — toss nadanthathum playing 11 release aagum!*
_(Deadline: match start time)_

─────────────

🏏 *IPL Fantasy Alert!*

*Sunrisers Hyderabad vs Chennai Super Kings*
📅 Sat, 18 Apr, 7:30 pm (8h 29m from now)
📍 Rajiv Gandhi International Stadium

Dei macha! Namma group-ku oru private contest ready aayiruchu! 🔥

💰 Entry: FREE
🎯 Invite Code: *8VTQLM*

📱 Join here:
https://ipl11.vercel.app/contests/join?code=8VTQLM

━━━━━━━━━━━━━━━━━━
🏟️ *GROUND PREDICTION*
🏏 Flat track, dew in 2nd innings. ARs + top-order batters shine.

⭐ *PLAYERS TO WATCH*
🔵 Hyderabad: Abhishek Sharma (AR), Kamindu Mendis (AR), Salil Arora (WK 🧤), Ishan Kishan (WK 🧤), Travis Head (BAT)
🟡 Kings: Shivam Dube (AR), Ramakrishna Ghosh (AR), Urvil Patel (WK 🧤), Sanju Samson (WK 🧤), Ayush Mhatre (BAT)

*Ippave team set pannu — toss nadanthathum playing 11 release aagum!*
_(Deadline: match start time)_
  [Bot]: 📜 *THIS DAY IN TAMIL HISTORY*

Dei, April 18, 1998 la our Thala Ajith's "Kadhal Mannan" release aachu da! 🎬 First time Ajith-Maanu Bhandari combination - enna love story, enna kuthu songs!

Ippo paatha 90s romance cringe ah irukum, but appo theatre la whistle adicha naanga than da 😅 Ajith anna bike scenes paathtu evlo peru Royal Enfield vaanga aarambichangalo! Classic Kollywood magic machaan ✨
  [Krishna Madhan]: !quiz
  [Bot]: 🎬 *TAMIL MOVIE QUIZ*

Guess the movie: 🌿🤱

Type *!a <movie name>* to answer
3 wrong attempts-ku appuram hint varum!
  [Krishna Madhan]: !bug spot filled is always 1
```

**Fix notes:** Root cause — `contests/browse/[matchId]/page.tsx` fetched entry count via `entry_count:f11_entries(count)` using the user-session Supabase client. RLS on `f11_entries` only allows users to see their own entries when a match is `open`/`locked` (policy: `entries_read_own`). So the count always returned 1 (their single joined entry) instead of the real total across all users. Fixed by removing the inline count from the user client query, then separately counting all entries using `createServiceClient()` (service role bypasses RLS) and merging counts into the contests array. Deploy: push ipl-fantasy.

---

## Bug #47 — 2026-04-18 16:40:51 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** misinformation

**Recent chat context:**
```
  [Krishna Madhan]: !fl
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Royal Challengers Bengaluru vs Delhi Capitals_

🥇 *harikrishnan977* — 0 pts
   _Team 1_
🥈 *Krishna Madhan* — 0 pts
   _Team 1_
🥉 *madhumithakanna* — 0 pts
   _Team 1_
4. *
  [Krishna Madhan]: !fl
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Royal Challengers Bengaluru vs Delhi Capitals_

🥇 *harikrishnan977* — 249 pts
   _Team 1_
🥈 *preethigamuruga* — 174 pts
   _Team 1_
🥉 *Krishna Madhan* — 110 pts
   _Team 1
  [Krishna Madhan]: !bug misinformation
```

**Fix notes:** Root cause — when `!fl` is called the moment a match goes live, the Cricbuzz score sync hasn't populated fantasy points yet. The bot fell through with cached 0-pt leaderboard data and displayed it as truth. Fixed by detecting the all-zero case during a live contest and returning a "scores still syncing, try again in 2 minutes" message instead of a misleading all-zero board. Deploy: restart bot.

---

## Bug #48 — 2026-04-18 18:47:34 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** ipl11.vercel.app not loading, some ui inconsistency and login issues do a clean intergration test and fix bugss

**Recent chat context:**
```
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Royal Challengers Bengaluru vs Delhi Capitals_

🥇 *harikrishnan977* — 437 pts
   _Team 1_
🥈 *preethigamuruga* — 325 pts
   _Team 1_
🥉 *madhumithakanna* — 221 pts
   _Team 
  [Bot]: 🎬 *RANDOM MOVIE FACT*

Ey, did you know Rajini's iconic "Magizhchi" dialogue in Muthu was completely unscripted da? 🎬 

Director Balu Mahendra told him to just react naturally when the heroine accepts his proposal - so our Thalaiva went "Magizhchi, magizhchi!" and did that trademark hand gesture spontaneously! 

The whole crew burst out laughing, but Balu kept the take. Now half of TN uses that word for happiness, thanks to one improvised moment! 😄

Mass ah illa mokka ah? 🔥
  [Harikrishnan D]: !fl
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Royal Challengers Bengaluru vs Delhi Capitals_

🥇 *harikrishnan977* — 582 pts
   _Team 1_
🥈 *madhumithakanna* — 422 pts
   _Team 1_
🥉 *preethigamuruga* — 386 pts
   _Team 
  [Krishna Madhan]: !bug ipl11.vercel.app not loading, some ui inconsistency and login issues do a clean intergration test and fix bugss
```

**Fix notes:** Full integration audit of ipl11.vercel.app. Four root causes found:

1. **Login/register pages broken** — Both had `export const dynamic = "force-dynamic"` inside `"use client"` components. This directive is silently ignored in client components, but caused Next.js to serve an inconsistent cached/dynamic hybrid that broke the post-login redirect in some cases. Removed the invalid export.

2. **User data pages serving stale/wrong-user data** — Dashboard, contests, wallet, profile, and leaderboard pages all had `export const revalidate = 30` (or 60). Next.js caches server component output for that duration, sharing one user's data with all users who request the same page within the window. Changed all to `export const dynamic = "force-dynamic"` to ensure every request respects the authenticated session.

3. **All game pages crashing with 500** — `AppHeader.tsx` (rendered by the shared `(game)/layout.tsx`) used `.single()` to fetch the user's profile. `.single()` throws a PostgREST error when no row is found (e.g. auth user exists but profile wasn't created by the DB trigger). Since AppHeader wraps every game page, a missing profile crashed the entire app. Fixed by switching to `.maybeSingle()` in AppHeader, dashboard, wallet, and profile pages.

4. **Login/register pages rendered as `○ (Static)`** — After fixing #1, these pages now correctly pre-render as static HTML since they contain no server-side dynamic data.

Deploy: push ipl-fantasy → Vercel auto-deploy.

## Bug #49 — 2026-04-18 20:08:41 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** ipl11.vercek.app Ui is not loading with error message as “The page is not loading” and retry . The error is inconsistent and is fixed randomly.

**Recent chat context:**
```
  [Preethiga]: !fl
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Sunrisers Hyderabad vs Chennai Super Kings_

🥇 *indhusravanoffi* — 105.5 pts
   _Team 1_
🥈 *Krishna Madhan* — 91 pts
   _Team 1_
🥉 *preethigamuruga* — 79 pts
   _Team 1_
4
  [Indhu Sravan ✨]: !fl
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Sunrisers Hyderabad vs Chennai Super Kings_

🥇 *indhusravanoffi* — 105.5 pts
   _Team 1_
🥈 *Krishna Madhan* — 91 pts
   _Team 1_
🥉 *preethigamuruga* — 79 pts
   _Team 1_
4
  [Madhu]: !bug ipl11.vercek.app Ui is not loading with error message as “The page is not loading” and retry .  The error is inconsistent and is fixed randomly.
```

**Fix notes:** Root cause — when the Vercel serverless function times out or a Supabase call fails during SSR, Next.js has no client-side error boundary to catch it, so the browser shows its native "page not loading" error with no retry option. Fixed by adding `src/app/(game)/error.tsx` — a Next.js error boundary that catches any SSR crash in the game route group and shows a styled "Something went wrong / Try Again" screen. The retry button calls Next.js's built-in `reset()` to re-render the segment, which usually succeeds on the next attempt. Deploy: push ipl-fantasy → Vercel auto-deploy.

---

## Bug #50 — 2026-04-19 12:14:38 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** finalize previous days match and announce winner at 8:30 am

**Recent chat context:**
```
  [Krishna Madhan]: !fl
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Sunrisers Hyderabad vs Chennai Super Kings_

🥇 *indhusravanoffi* — 505 pts
   _Team 1_
🥈 *preethigamuruga* — 483.5 pts
   _Team 1_
🥉 *harikrishnan977* — 462.5 pts
   _Team
  [Bot]: 📜 *THIS DAY IN TAMIL HISTORY*

April 19, 1947 - C. Rajagopalachari became the last Governor-General of India, first Indian to hold the post! Oru Chennai mama achieved what even Britishers couldn't imagine da 😎

But real talk machaan, Rajaji was peak multitasking - politician, writer, freedom fighter, AND he translated Ramayana into Tamil. Meanwhile namma aalunga struggle to handle one WhatsApp group properly! 

Fun fact: He also started the first Anti-Hindi agitation. Appo-ve Tamil pride strong ah irundhuchu pa! 🔥
  [Harikrishnan D]: @84714102779916  daily morning 8 or 8.30 ku previous contest oda winner announce pandra mari oru update
  [Krishna Madhan]: !bug finalize previous days match and announce winner at 8:30 am
```

**Fix notes:** Added `morningWinnerAnnouncement(groupId)` in `fantasy.ts` and a new `"30 8 * * *"` cron in `scheduler.ts`. At 8:30 AM IST each day the cron finds yesterday's matches (by IST date) in two ways: (1) `completed_at` set within yesterday's window — these finished cleanly; (2) `toss_notified_at` set + `scheduled_at` from yesterday + `completed_at` still null — matches the bot missed finalizing (restart, cron timing). For each, it calls `/match-summary` to confirm the match is `completed` or `in_review`, backfills `completed_at` in `ba_fantasy_state` if missing, then fetches the leaderboard and posts a "MORNING RECAP — Team A vs Team B / Nanna thoongireenga? Nethu match results solren!" announcement with final standings. If no matches qualify the cron is silent. Deploy: restart bot.

---

## Bug #51 — 2026-04-19 12:48:26 IST
**Reporter:** Madhu (`919159750218@c.us`)
**Status:** `FIXED`
**Description:** fantasy join command is not retrieving the latest match link for the current day

**Recent chat context:**
```
  [Harikrishnan D]: !fantasy help
  [Bot]: 🏏 *Fantasy Cricket Commands*

!fantasy join — Join group contest
!fantasy lb — Leaderboard (syncs live scores first)
!fantasy diff — Compare top 2 teams side-by-side
!fantasy diff Krish Madhan — Comp
  [Harikrishnan D]: !fantasy join
  [Bot]: 🏏 *Join the Group Contest!*

*Sunrisers Hyderabad vs Chennai Super Kings*

🎯 Invite Code: *8VTQLM*
📱 Link: https://ipl11.vercel.app/contests/join?code=8VTQLM

App-la register pannitu inga join pann
  [Madhu]: !bug fantasy join command is not retrieving the latest match link for the current day
```

**Fix notes:** Root cause — `getActiveState` returned the SRH vs CSK match (April 18, 7:30 PM) because its `completed_at` was NULL. The 8:30 AM morning-winner cron was deployed after that cron window passed, so the match was never auto-completed. `getActiveState` had no staleness guard — a started match 17+ hours old was returned as "active", blocking today's contests. Fixed by adding an 8-hour staleness cutoff to the `started` filter: matches older than 8h are treated as stale and excluded from active lookup. Stale matches are also auto-closed (fire-and-forget DB update) so they don't pile up. Deploy: restart bot.

---

## Bug #52 — 2026-04-19 12:54:03 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** message not deleted

**Recent chat context:**
```
  [Harikrishnan D]: !memory
  [Bot]: 🧠 *MEMORY GAME*

Memorize these 5 *WORDS*:

1. *VANAKKAM*
2. *AMMA*
3. *NANDRI*
4. *MACHAAN*
5. *ENNA*

Type *!a <word1> <word2> <word3> <word4> <word5>* in the SAME ORDER!
First correct answer wins 
  [Harikrishnan D]: !a Vanakkam Amma Nandri Machaan Enna
  [Bot]: 🧠 *Harikrishnan D remembered all 5!* 🏆

Words were: VANAKKAM, AMMA, NANDRI, MACHAAN, ENNA
+20 points! Type !memory for next round.
  [Krishna Madhan]: !bug message not deleted
```

**Fix notes:** Root cause — `sentMsg.delete(true)` was silently failing (wwjs puppeteer-based revoke can fail without throwing). Fixed in two ways: (1) added a puppeteer fallback that calls `window.Store.Cmd.sendRevokeMsgs` directly if `delete(true)` throws, giving the message deletion two independent code paths. (2) the recall message is always sent regardless of deletion success — if deletion failed, the recall text notes "(Scroll up fast!)" so players know the words are technically visible. Deploy: restart bot.

---

## Bug #53 — 2026-04-19 12:54:19 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** for the memory game message still visible

**Recent chat context:**
```
  [Harikrishnan D]: !a Vanakkam Amma Nandri Machaan Enna
  [Bot]: 🧠 *Harikrishnan D remembered all 5!* 🏆

Words were: VANAKKAM, AMMA, NANDRI, MACHAAN, ENNA
+20 points! Type !memory for next round.
  [Krishna Madhan]: !bug message not deleted
  [Bot]: 🐛 Bug #52 noted! Thanks Krishna Madhan 🙏
_"message not deleted"_

Will be fixed in the next update.
  [Krishna Madhan]: !bug for the memory game message still visible
```

**Fix notes:** Same root cause and fix as Bug #52. Deploy: restart bot.

---

## Bug #54 — 2026-04-19 15:46:49 IST
**Reporter:** Indhu Sravan ✨ (`918248392008@c.us`)
**Status:** `FIXED`
**Description:** diff command giving wrong comparison

**Recent chat context:**
```
  [Indhu Sravan ✨]: !fl
  [Bot]: 🏆 *FANTASY LEADERBOARD*
_Kolkata Knight Riders vs Rajasthan Royals_

🥇 *harikrishnan977* — 80.5 pts
   _Team 1_
🥈 *preethigamuruga* — 76.5 pts
   _Team 1_
🥉 *indhusravanoffi* — 69 pts
   _Team 1_

  [Indhu Sravan ✨]: !fantasy diff Indhu Krish
  [Bot]: 🔄 *TEAM DIFF*
indhusravanoffi (#3) vs harikrishnan977 (#1)

━━━━━━━━━━━━━━━━━━
🔀 *DIFFERENT PLAYERS*
━━━━━━━━━━━━━━━━━━

👤 *Only indhusravanoffi has:*
⚡ Cameron Green (Kolkata Knight Riders) — 4pts
  [Indhu Sravan ✨]: !bug diff command giving wrong comparison
```

**Fix notes:** Root cause — `findEntry` in `team-diff/route.ts` used a pure `.includes()` substring match. "krish" is a substring of "harikrishnan", so the rank-1 entry (harikrishnan977) was matched before Krishna Madhan (rank-2). Fixed by adding a word-boundary-first pass: check if the query matches the START of the full name or the start of any whitespace/underscore-separated word. Only if no word-boundary match is found does it fall back to substring search. "Krish" now correctly matches "krishna madhan" (starts with "krish") and skips "harikrishnan". Deploy: push ipl-fantasy.

---

## Bug #55 — 2026-04-19 16:44:23 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** toss done match started

**Recent chat context:**
```
  [Indhu Sravan ✨]: !fantasy diff Indhu Krish
  [Bot]: 🔄 *TEAM DIFF*
indhusravanoffi (#3) vs harikrishnan977 (#1)

━━━━━━━━━━━━━━━━━━
🔀 *DIFFERENT PLAYERS*
━━━━━━━━━━━━━━━━━━

👤 *Only indhusravanoffi has:*
⚡ Cameron Green (Kolkata Knight Riders) — 4pts
  [Indhu Sravan ✨]: !bug diff command giving wrong comparison
  [Bot]: 🐛 Bug #54 noted! Thanks Indhu Sravan ✨ 🙏
_"diff command giving wrong comparison"_

Will be fixed in the next update.
  [Krishna Madhan]: !bug toss done match started
```

**Fix notes:** Root cause — `checkAndSendToss` queried with `.is("locked_at", null)`. If a match was manually locked (e.g. via `!fantasy lock`) before the toss result arrived, `locked_at` was already set and the cron skipped it, so the toss announcement was never sent. Fixed by removing `locked_at IS NULL` from the query — now only `toss_notified_at IS NULL` and `completed_at IS NULL` are required. Also, `continue` on lock/go_live API errors replaced with `console.warn` — the match might already be in the right state, but the toss announcement should still go out. Deploy: restart bot.

---

## Bug #56 — 2026-04-19 18:21:34 IST
**Reporter:** Krishna Madhan (`919487506127@c.us`)
**Status:** `FIXED`
**Description:** join should return contest for the next match not the live one

**Recent chat context:**
```
  [preethigamurugan15]: Contest
  [Bot]: 🏏 *IPL Fantasy Alert!*

*Punjab Kings vs Lucknow Super Giants*
📅 Sun, 19 Apr, 7:30 pm (1h 9m from now)
📍 Maharaja Yadavindra Singh International Cricket Stadium, Mullanpur

Dei macha! Namma group-k
  [Krishna Madhan]: !fantasy join
  [Bot]: 🏏 *Join the Group Contest!*

*Kolkata Knight Riders vs Rajasthan Royals*

🎯 Invite Code: *9T4HDN*
📱 Link: https://ipl11.vercel.app/contests/join?code=9T4HDN

App-la register pannitu inga join pannu
  [Krishna Madhan]: !bug join should return contest for the next match not the live one
```

**Fix notes:** Root cause — `handleJoin` called `getActiveState` which returns the most recently STARTED match first. On a double-header day the live match (KKR vs RR, 3:30 PM) was returned instead of the upcoming one (Punjab vs LSG, 7:30 PM). Since you can't change teams after a match starts, pointing to a live match for "join" is wrong. Fixed by querying all non-completed announced states and preferring future (not-yet-started) matches. Falls back to the live match only if there's no upcoming one (so `!fantasy join` is never a dead end). Also adds a "⚠️ Match already started" warning when returning a live match. Deploy: restart bot.

---

## Bug #57 — 2026-04-19 18:37:15 IST
**Reporter:** Preethiga (`916374404892@c.us`)
**Status:** `OPEN`
**Description:** app is showing a “Something went wrong” message while loading

**Recent chat context:**
```
  [Krishna Madhan]: !fantasy join
  [Bot]: 🏏 *Join the Group Contest!*

*Kolkata Knight Riders vs Rajasthan Royals*

🎯 Invite Code: *9T4HDN*
📱 Link: https://ipl11.vercel.app/contests/join?code=9T4HDN

App-la register pannitu inga join pannu
  [Krishna Madhan]: .
  [Bot]: Thala, dot adichitu enna panra? 😄

Bore adikutha? !quiz or !song try pannu da!
  [Preethiga]: !bug app is showing a “Something went wrong” message while loading
```

**Fix notes:** Two root causes: (1) `contests/browse/[matchId]/page.tsx` used `.single()` for the match query — Supabase v2 `.single()` returns an error object on 0 rows but doesn't throw; however, changed to `.maybeSingle()` for consistency and to avoid any PostgREST error propagation. (2) `matches/[id]/live/page.tsx` had `export const revalidate = 0` instead of `export const dynamic = “force-dynamic”` — on Vercel, `revalidate = 0` still goes through the CDN layer which can serve stale or cached auth session data to the wrong user, causing SSR failures. Changed to `force-dynamic` so every request gets a fresh server-side render with the correct auth session. The error.tsx boundary added in Bug #49 continues to provide a “Try Again” fallback for any remaining intermittent Supabase timeouts. Deploy: push ipl-fantasy.

---

