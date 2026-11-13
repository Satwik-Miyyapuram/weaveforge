# The wiki

The wiki is a set of notes under a root page called Wiki. The app builds an
index of its pages inside that root, and it can merge two pages that say the
same thing. Nothing in the wiki changes without your review.

## How to

1. Keep your wiki pages under the Wiki root. Each page is listed in the index.
2. Write your own text above or below the index. Regenerating the index never
   touches it.
3. To merge two pages, pick the one to keep. Its title stays, and the other
   title becomes an alias, so links to either still work.
4. Read the contradictions the merge lists. Where the two pages disagree, both
   statements are kept side by side for you to resolve.

## Reference

The generated index sits between two markers, and only that region is rebuilt.
Each entry is a link to the page, followed by "— also" and its aliases when it
has any. Pages are grouped alphabetically. Titles that start with a digit, a
symbol, or a letter other than A to Z go in a last group. Each group is sorted by title. The index heading is
"Index", and a line under it gives the page count and the generation date.

A merge keeps the primary page's title and body, adds the absorbed page's
statements that are new, and lists contradictions. Two statements contradict
when they are at least 60 percent alike and exactly one of them contains a
negation word such as "not" or "never". If both or neither contain one, they
do not count as a contradiction. A statement that is 85 percent alike
to one already kept is treated as the same claim and not added twice. Aliases
and sources from both pages are combined, with duplicates removed.

Source: `crates/wf-core/src/ai/wiki_index.rs` and `crates/wf-core/src/ai/wiki_merge.rs`

## Related

- [The AI assistant](ai-assistant.md) — what the assistant may read and suggest
- [Search](search.md) — finding pages across the workspace
