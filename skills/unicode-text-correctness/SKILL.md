---
name: unicode-text-correctness
description: Implements and fixes correct text/Unicode handling — pinning UTF-8 end-to-end, detecting BOM/legacy charsets, NFC/NFD normalization, grapheme-aware length/slicing/truncation/reversal, locale-aware collation and full case-folding, and homoglyph/confusable/bidi spoofing defenses.
when_to_use: Code measures, slices, truncates, reverses, sorts, lowercases, or compares strings containing emoji, combining marks, or CJK; or bugs show mojibake, emoji counting as length 4, truncation splitting a character, equal-looking usernames comparing unequal, broken accented sorting, or double-encoding. Distinct from regex-build (pattern matching) and validate-data-quality (column-level rules, not character semantics).
---

## When to Use

Reach for this when the bug is about **what a character *is*** — its bytes, boundaries, identity, or order — not about pattern matching or business rules:

- "Emoji `👨‍👩‍👧` counts as length 7 / truncates to a broken `�` / reverses into garbage"
- "Twitter-style `120 chars` limit cuts a flag emoji or `é` in half"
- "Two usernames look identical but `==` says they differ" (or the reverse: a spoof passes)
- "Accented words sort after `z` / `ä` doesn't sort near `a`"
- "Text came in as `Ã©` / `â€™` / `é` — mojibake / double-encoding"
- "`.toLowerCase()` breaks Turkish `İ`, German `ß`, or fails to match `İstanbul`"
- "MySQL stores emoji as `????` / IDN domain `аpple.com` (Cyrillic а) phishes users"

NOT this skill:
- Writing/debugging a regex pattern (email/slug/`\d` over-matching) → **regex-build**
- Column-level assertions (no nulls/dupes, value ranges, freshness) → **validate-data-quality**
- Schema/charset migration mechanics (lock contention, rollback of an `ALTER`) → **db-migration-safety**
- Whether a confusable username is an actual attack you must *report* in a diff → **security-review** (this skill *builds* the defense; security-review *audits* for its absence)

## Steps

1. **Know the four length units — pick one deliberately, never let the language pick for you.** Most "Unicode bugs" are using the wrong unit.

   | Unit | What it counts | `"é"` (NFD) | `"👨‍👩‍👧"` | Use for |
   |---|---|---|---|---|
   | Bytes | UTF-8 octets | 3 | 18 | storage size, network frames, DB byte limits |
   | Code units | UTF-16 slots (JS `.length`, Java `char`) | 2 | 7 | **almost never — this is the trap** |
   | Code points | Unicode scalars | 2 | 5 | normalization input, codepoint ranges |
   | **Grapheme clusters** | user-perceived characters | **1** | **1** | length shown to users, truncation, cursor, slicing |

   Default for any **user-facing** length, limit, slice, or reverse: **grapheme clusters**. JS `"👨‍👩‍👧".length === 7` and `[..."👨‍👩‍👧"].length === 5` are *both wrong* for "how many characters"; only a segmenter gives 1.

2. **Count and slice on grapheme boundaries — use a real segmenter, do not split on code points.** Built-ins:

   ```js
   const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
   const graphemes = [...seg.segment(s)].map(x => x.segment);
   const len = graphemes.length;                 // user-visible length
   const head = graphemes.slice(0, 120).join(""); // truncate to 120 chars, never split
   const reversed = graphemes.reverse().join(""); // reverse without scrambling 👨‍👩‍👧
   ```
   - Python: `regex` module `\X` (`regex.findall(r"\X", s)`) — stdlib `re`/`len()` give code points, not graphemes.
   - Rust: `unicode-segmentation` `.graphemes(true)`. Go: `rivo/uniseg`. Swift: `String` is already grapheme-correct (`.count`).
   - **Truncate, then re-append an ellipsis as its own grapheme**; if a byte cap (e.g. DB `VARCHAR(n)` is bytes) also applies, trim graphemes until `utf8Bytes(result) <= cap` — never cut at byte `n` directly.

3. **Normalize to NFC at every boundary you store, compare, hash, or index.** `"é"` has two encodings (NFC U+00E9 = 1 codepoint; NFD U+0065 U+0301 = 2). They render identically but are `!=` and hash differently. Rule:
   - **NFC on input** (ingest/form submit/API request) — canonical, shortest, what the web expects.
   - Compare/hash/dedup/`UNIQUE` index **only on NFC** strings — never store one form and look up another (macOS filesystem returns **NFD**; HTTP/most input is NFC → a path from disk won't match a stored key without normalizing both sides).
   - Apply NFC **before** truncation (combining mark must ride with its base) and **before** case-folding.
   ```js
   const key = s.normalize("NFC");            // JS
   ```
   ```python
   import unicodedata; key = unicodedata.normalize("NFC", s)  # Python
   ```
   Use **NFKC** (compatibility) only for *identifiers/search keys* where you want `①`→`1`, `ﬁ`→`fi`, full-width `Ａ`→`A` folded together — it is lossy, so never NFKC user display text.

4. **Compare case-insensitively with full case-folding, not `lower()`; sort with a locale collator, not byte order.**
   - Case-insensitive equality: `str.casefold()` (Python) / `String::to_lowercase` (Rust) is the floor — `.toLowerCase()`/`.toUpperCase()` is *not* enough. `"ß".casefold() == "ss"`; Turkish `"İ"` vs `"i"` differ by locale. Never use `.toLowerCase()` for a *security or identity* comparison — NFC then fold both sides: compare `a.normalize("NFC")` folded vs `b.normalize("NFC")` folded.
   - Sorting: byte/codepoint order puts `Z`(0x5A) before `a`(0x61) and accented letters after `z`. Use an **ICU/CLDR collator**: `new Intl.Collator("de", { sensitivity: "base" }).compare(a, b)` (JS), `PyICU.Collator` or `locale.strxfrm` (Python), `COLLATE "de-x-icu"` (Postgres). Pin the locale explicitly — the "right" order for `ä`/`ö` differs by language (German vs Swedish).

5. **Defend identifiers (usernames, domains, package names) against confusables and mixed-script spoofing.** Equal-*looking* must mean equal-*compared*, and visually-deceptive must be rejected:
   - **Skeleton/confusable check** (UTS #39): map each char to its prototype (`раypal`→`paypal`) via the Unicode confusables table (`confusable_homoglyphs`, ICU `usprep`, `unicode-security` crate) and compare skeletons against existing identifiers.
   - **Mixed-script reject:** allow a single script run per identifier (Latin *or* Cyrillic, not `аpple` mixing Cyrillic `а` + Latin); permit only known-safe combos (Latin+Han+Hiragana for JP). Reject whole-script confusables (all-Cyrillic `аррӏе`).
   - **Strip/reject bidi overrides** `U+202A–202E`, `U+2066–2069`, and zero-width `U+200B/200C/200D/FEFF` in identifiers and filenames — `safe.txt‮gpj.exe` displays as `safe.txtexe.jpg` (Trojan Source). NFKC-fold identifiers before storing.

6. **Pin UTF-8 across storage and transport — no implicit charset anywhere.**
   - DB: MySQL **`utf8mb4`** (the 3-byte `utf8` alias silently drops emoji → `????`); set table *and* connection charset + a `_unicode_ci`/`utf8mb4_0900_ai_ci` collation. Postgres: `ENCODING 'UTF8'` + ICU collation per UTF-8 column.
   - HTTP: send `Content-Type: …; charset=utf-8`; read `charset` from the response header, fall back to BOM, then to the declared meta — never assume Latin-1.
   - **BOM:** strip a leading `U+FEFF` on read (it corrupts JSON parse and the first field of CSV); do **not** emit a BOM in UTF-8 output unless a consumer (Excel CSV) demands it.
   - **Legacy ingest:** detect with `chardet`/`charset-normalizer`/ICU `CharsetDetector`, decode once to Unicode, then work in UTF-8 — and **never re-decode an already-decoded string** (the cause of `â€™` double-encoding mojibake).
   - URLs/IDN: percent-encode the UTF-8 bytes of the path/query; convert IDN hostnames to **Punycode** (`xn--…`) for transport, but display the Unicode form *only after* the confusable check in step 5.

7. **Lock the behavior with adversarial test strings** (see Verify) before declaring text handling correct.

## Common Errors

- **Using `.length` (JS/Java UTF-16) as character count.** Counts code units → emoji = 2–7, BMP CJK = 1. Fix: `Intl.Segmenter` graphemes for user counts.
- **Splitting on code points and calling it grapheme-safe.** `[...str]` keeps `é`(NFC) whole but shatters `👨‍👩‍👧` (5 codepoints) and a base+combining `e+◌́`. Fix: segment graphemes, not codepoints.
- **Byte-cap truncation (`s[:200]`, `substr`).** Cuts mid-codepoint → `�`, or splits a base from its combining mark / a ZWJ sequence. Fix: trim whole graphemes until under the byte cap.
- **Comparing/indexing without normalizing.** NFC `café` ≠ NFD `café`; one inserts, the other duplicates past a `UNIQUE` constraint. Fix: NFC both sides before `==`, hash, and the DB write.
- **`toLowerCase()` for identity/security checks.** Misses `ß`/`ss`, breaks Turkish `İ/ı`, locale-dependent. Fix: full case-fold (`casefold()`), NFC first.
- **Sorting by codepoint/byte.** `Z` before `a`, accents dumped after `z`, wrong per language. Fix: ICU/CLDR collator with an explicit locale.
- **MySQL `utf8` (3-byte alias).** Silently stores emoji/4-byte chars as `????` or errors. Fix: `utf8mb4` everywhere — column, table, connection.
- **Double-decoding / re-encoding.** Decoding an already-`str` value (or treating UTF-8 bytes as Latin-1 then re-encoding) → `Ã©`, `â€™`. Fix: decode exactly once at the boundary; keep Unicode internally.
- **Not stripping the BOM.** Leading `U+FEFF` breaks `JSON.parse`, makes the first CSV column key invisible. Fix: strip a leading `﻿` on read.
- **Reversing a string by codepoint/char.** Scrambles emoji ZWJ sequences and detaches combining marks (`á` → `́a`). Fix: reverse grapheme clusters.
- **NFKC on display text.** Lossy: `²`→`2`, `ﬁ`→`fi`, full-width collapses. Fix: NFKC only for fold-keys/identifiers; store NFC for display.
- **Trusting Unicode display of IDN/filenames.** Bidi override + homoglyph spoofs the eye. Fix: render Punycode / run the confusable+bidi check before showing.

## Verify

Test every text op against a fixed adversarial corpus — at minimum: `"á"` (e + combining acute, NFD `á`), `"á"` (NFC `á`), `"👨‍👩‍👧‍👦"` (ZWJ family), `"🇯🇵"` (regional-indicator flag), `"ẹ́"` (stacked combining marks), `"한국어"` (Hangul), `"Ｈｅｌｌｏ"` (full-width), `"раypal"` (mixed-script Cyrillic), `"safe‮txt.exe"` (bidi override), `"﻿hi"` (BOM), `"café"` in NFC and NFD.

1. **Grapheme length:** the ZWJ family and a flag emoji each report length **1**; `"á"` reports **1**. Not 2, 4, or 7.
2. **Truncation:** truncating the corpus to N graphemes never yields a `�`, never splits a ZWJ sequence, and never strands a combining mark; `utf8Bytes(result) <= byteCap` when a byte cap applies.
3. **Reverse:** reversing `"👨‍👩‍👧"` returns it unchanged (single grapheme); reversing `"áb"` keeps `á` intact.
4. **Normalization equality:** NFC `"café"` and NFD `"café"` compare **equal** and hash equal after `.normalize("NFC")`; inserting both into a table with a `UNIQUE(NFC)` key yields one row.
5. **Case-fold:** `"ß"` matches `"SS"`/`"ss"` under full case-fold; `"İstanbul"` matches per Turkish locale and is *not* silently mangled in the default locale.
6. **Collation:** sorting `["z","ä","a","Z"]` under `de` collator puts `ä` adjacent to `a` and is *not* codepoint order (`Z` before `a`).
7. **Confusable/bidi:** `"раypal"` is flagged confusable with an existing `"paypal"` and mixed-script-rejected; the bidi-override string is rejected or its overrides stripped before storage/display.
8. **Round-trip:** a string written to the DB (`utf8mb4`) and read back is byte-identical including emoji; a BOM-prefixed file parses with no phantom first key; an IDN host round-trips through Punycode and back.

Done = grapheme-unit length/slice/truncate/reverse are all correct on the ZWJ + flag + combining-mark corpus, NFC-normalized values compare/hash/dedup equal across forms, case-insensitive matching uses full case-folding and sorting uses a locale collator, confusable + mixed-script + bidi spoofs are rejected, and emoji round-trip cleanly through the `utf8mb4` store with no `????`/`�`/mojibake.
