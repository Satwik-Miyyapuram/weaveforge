# How we write the docs

The docs are Markdown files in `docs/`, kept in the same repository as the code
and changed in the same pull request as the code they describe. The site
publishes `using/`, `building/` and `running/` as they are; nothing is written
anywhere else.

These rules come from three places that do this well:

- **[Diátaxis](https://diataxis.fr/)** (used by Canonical, Django, NumPy):
  there are four kinds of documentation — tutorials, how-to guides, reference
  and explanation — and a page that mixes them serves none of its readers well.
- **[Google's developer documentation style guide](https://developers.google.com/style)**:
  the sentence-level rules below.
- **[Stripe's docs](https://stripe.com/blog/markdoc)**: docs as code, reviewed
  like code; examples are real and runnable; every page answers the next
  question before the reader has to ask it.

## Who reads which folder

| Folder | Reader | Holds |
| --- | --- | --- |
| `using/` | someone using the app | one page per feature, plus [Getting started](../using/getting-started.md) |
| `building/` | someone changing the code | how it is built, one page per Rust core module under `building/core/` |
| `running/` | someone hosting it | servers, storage, costs |

## The four kinds, and where each lives

| Kind | Answers | Where |
| --- | --- | --- |
| Tutorial | "Teach me" — a first success, start to finish | `using/getting-started.md` only |
| How-to | "How do I…?" — steps to a goal the reader already has | the **How to** section of a feature page |
| Reference | "What exactly is…?" — settings, limits, formats, shortcuts | the **Reference** section of a feature page |
| Explanation | "Why does it work this way?" | the **How it works** section, and `building/` |

A feature page keeps the kinds in separate, fixed sections, so a reader who
wants one can skip the others. Do not put an explanation inside a step, or a
step inside a reference table.

## A feature page

Every page in `using/` follows this outline. Leave out a section that would be
empty; do not reorder them.

```markdown
# <Feature name>

One or two sentences: what it is and what it is for. No "This page describes".

## How to

### <Task, as a verb phrase: "Import a .bib file">

1. Numbered steps, one action each.
2. Name UI elements in **bold**, exactly as the app labels them.
3. End with what the reader now sees.

## Reference

Tables for settings (name, default, what it does), limits (with the number),
keyboard shortcuts, file formats, and error messages (the exact text, what
caused it, what to do).

## How it works

What happens under the surface, enough to predict behaviour: where the data
lives, what works offline, what is sent over the network, edge cases.
End with: Source: `crates/wf-core/src/<module>/`.

## Related

- Links to the neighbouring features.
```

## Write from the Rust, not from memory

The Rust core is the source of truth. Before you document a rule, a limit or an
error, read it in `crates/wf-core` and copy the real number or message. When the
TypeScript and the Rust disagree, the Rust is right and the TypeScript is stale.
If a behaviour exists only in TypeScript, it is not ported yet: port it, then
document it.

## Sentence rules

- Second person, present tense, active voice: "Search finds…", "You can…".
- Sentence-case headings: "Import a .bib file", not "Import A .Bib File".
- Short sentences. One idea each. Lead with the point.
- Plain words: "use", not "utilize"; "lets you", not "allows the user to".
- No "simply", "just", "easy", "obviously": they blame the reader when it is not.
- Numbers as digits, with units: "25 MB", "2 s", "4 characters".
- Code, paths, settings keys and file names in `code`.
- Every example is real: a command that runs, a URL shape the code accepts,
  an error message copied from the source.
- Link the first mention of another feature to its page.
- No screenshots of text. A screenshot only where layout is the point, with
  alt text that says what it shows.

## Checklist before merging a page

- [ ] Follows the feature-page outline.
- [ ] Every number, limit and message checked against the Rust source.
- [ ] Every UI label in a How-to step matches the screen's source, and the
      steps were tried in WeaveForge Dev.
- [ ] Listed in [docs/README.md](../README.md) under its folder.
