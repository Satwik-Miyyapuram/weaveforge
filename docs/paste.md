# Paste

Text arrives in a note from somewhere else — a PDF column, a terminal window, a
newsletter, a chat assistant — and each of those sources leaves its own damage
behind. WeaveForge repairs it on the way in, so the note holds the words and not
the wrapping.

Every rule has a switch, under **Settings → Paste**. The switches live in your
browser, next to your theme, so a shared machine and your own laptop can answer
differently.

## What runs on every paste

Three rules are on by default. Each is a repair with no stylistic opinion in it —
nothing that changes how *you* set your text.

**Tracking is stripped from links.** Campaign tags and click identifiers go;
everything that addresses content stays.

```
https://www.theverge.com/2026/1/9/story?utm_source=newsletter&fbclid=IwAR2x9
→ https://www.theverge.com/2026/1/9/story

https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxAbC123&si=8f2a1c&t=42
→ https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxAbC123&t=42
```

A DOI, an arXiv link and a Semantic Scholar query come through untouched, and so
does a signed download URL — removing a parameter from one of those invalidates
its signature, and the failure only shows up as a 403 when somebody clicks the
link months later.

Browsers also append a scroll-to-text fragment when you copy a link to
highlighted text. `#results:~:text=the%20finding` becomes `#results`.

**Invisible characters are removed.** Zero-width spaces and bidirectional
overrides go; non-breaking spaces become ordinary ones. The joiners that hold
emoji together, and that hold letters together in Arabic, Persian and the Indic
scripts, are left exactly where they are.

**Escape sequences are stripped**, so copied terminal output does not arrive
carrying its colour codes.

**A pasted DOI or arXiv id becomes a link.** Both have exactly one canonical
resolver, so this needs no network and makes no guess — and a bare identifier in
a note is dead text a year later.

```
See 10.1145/3292500.3330701 and arXiv:1706.03762.
→ See [10.1145/3292500.3330701](https://doi.org/10.1145/3292500.3330701) and
  [arXiv:1706.03762](https://arxiv.org/abs/1706.03762).
```

The label keeps the identifier rather than a title, because that is what
somebody quoting your note will need to copy back out. An arXiv id is only
linked with its `arXiv:` prefix — a bare `1706.03762` is a decimal number as
readily as an identifier. An identifier already inside a link is left alone.

**A spreadsheet paste becomes a table.** Copy a block of cells from Excel,
Numbers, Google Sheets or an HTML table and it arrives as tab-separated rows,
which Markdown renders as one run-together line:

```
model     val_loss   accuracy
beta-VAE  0.1826     0.912
```

becomes

```
| model | val_loss | accuracy |
| --- | ---: | ---: |
| beta-VAE | 0.1826 | 0.912 |
```

Columns whose values are all numbers are right-aligned. This is tabs only, never
commas — a tab-separated block of several lines is unambiguous because prose
does not contain tabs, while half the sentences in a note would pass for CSV,
and a rule that turns a paragraph into a table is worse than no rule.

Blank lines and stray spaces around the paste are trimmed. Blank lines *inside*
it are paragraph breaks you meant, and they stay.

## What you can turn on

**Straighten quotes** turns `“don’t”` into `"don't"`, and **straighten dashes**
turns en and em dashes into hyphens. Both are off by default: a thesis that uses
en dashes on purpose should not have them quietly taken away. Turn them on if
you would rather your notes were plain ASCII all the way to the LaTeX export.

**Repair PDF text automatically** runs the repair below on any paste that looks
like it came from a PDF. Off by default — it is the most opinionated rule, and
the command is the deliberate way to reach it.

## What never gets touched

- **Code.** Fenced blocks, indented blocks and inline backtick spans pass
  through exactly as pasted, and a paste that *lands inside* one is left alone
  entirely — there, the text is being shown rather than written.
- **Maths.** `$\alpha - \beta$` is subtraction and `$x'$` is a prime. Both
  survive the dash and quote rules.
- **Links and citations.** A `[[wikilink]]` target, a Markdown destination, a
  `\cite{}` key and a `[@pandoc-key]` are names, not prose.
- **Frontmatter.** The values are data the app reads back.

One `Ctrl+Z` takes a whole paste back out. To get the clipboard in untouched in
the first place, use `Ctrl/Cmd + Shift + V`.

## Images

Copy an image and paste it into a note. It uploads and the link appears **where
the caret was**. Dragging an image in does the same thing, and drops it where
you dropped it. The **attach-image button** in the note toolbar takes the same
path — it used to append to the end of the note, and now inserts at the caret
like everything else.

Every way a picture can arrive works:

- **A screenshot on the clipboard.** Print Screen, the Snipping Tool, `Cmd
  +Shift+4`, a browser's "copy image" — anything that puts a bitmap there.
- **A file dragged in** from Explorer or Finder, one or several at a time. A
  file whose type Windows does not recognise is judged by its extension rather
  than dropped on the floor.
- **A picture dragged from another tab**, a mail client or a document. What
  crosses is the address rather than the file, so it is downloaded and stored
  the same way — see "Looking things up" below.

One case deliberately does *not* insert a picture. Several Windows applications
— Word, Excel, Outlook — put a **rendered image of the selection** on the
clipboard next to the text. Taking the picture there would mean pasting a
screenshot of the spreadsheet instead of the spreadsheet, with no way to ask for
the rows, so **text wins whenever the clipboard carries any**. Nothing is lost by
it: a screenshot and a "copy image" carry no text at all, and a site that puts
the picture's address there has the address pasted, which downloads the same
picture by the other route.

Nothing blocks while the upload runs. A dimmed `![Uploading diagram…]()`
placeholder holds the spot and is swapped for the real link when the upload
lands, so you can keep typing — including in front of it and behind it. Paste
several at once and each keeps its own place, whatever order the uploads finish
in.

If an upload fails, the placeholder disappears and the note says why. If you
press `Ctrl+Z` before it lands, the image does not reappear a second later.

- Images go wherever that surface already keeps them: a vault note stores them
  against the note, a report section against the section, a paper note against
  the paper.
- Screenshots are downscaled to 1600px and re-encoded as WebP, which turns a
  multi-megabyte capture into tens of kilobytes. **Animated GIFs are stored as
  they came** — a canvas re-encode would keep the first frame and silently throw
  the animation away.
- The alt text comes from the file name, with the extension dropped and
  separators turned into spaces, so `loss-curve.png` becomes `![loss curve]`.
- SVG is not accepted. It is a script carrier, not a picture format.
- Anything over 25 MB is refused before the upload starts.

## Looking things up

Two rules reach the internet, and only ever for an address you pasted yourself.
Both are on by default, and both are listed apart from the rest in settings
because that difference is worth seeing.

**Read the title behind a pasted link.** Paste
`https://www.nature.com/articles/s41586-021-03819-2` and a moment later it reads
`[Highly accurate protein structure prediction with AlphaFold](https://…)`. The
link goes in the instant you press the key — the lookup runs beside it and
rewrites what is already there, so a slow site costs you nothing and a site that
never answers leaves you with the plain link you pasted. The URL is not dimmed
while it waits: it is already a working link.

**Download a pasted image address.** Safari's "copy image" puts a URL on the
clipboard rather than the picture, and a note that keeps that URL is a note
whose figure vanishes when the site reorganises. With this on, the picture is
downloaded and stored in your workspace exactly as a pasted bitmap would be. A
dimmed `![Downloading loss curve…]()` holds the spot; if the download fails, the
link you pasted goes back and the note says why. This one needs a screen that
can store images — in a place that cannot, the address stays an address.

The same rule covers **dragging a picture in from another tab**, a mail client
or a document, because that hands over an address rather than a file. Only
`http(s)` addresses that end in an image extension are fetched, and only from a
drag that carried a real link — dragging a selection *within* the note is still
CodeMirror moving your text, not a download.

Both use the same guard, described under Privacy. Titles are read from at most
512 KB of a page and capped at 300 characters; images are capped at 12 MB, must
declare a bitmap content type, and SVG is refused as it is everywhere else.

## Commands

In any note editor, on the selection — or on the whole note when nothing is
selected.

| Command | Keys |
|---|---|
| Clean up selection | `Ctrl/Cmd + Alt + C` |
| Clean up terminal output | `Ctrl/Cmd + Alt + T` |
| Clean up PDF text | `Ctrl/Cmd + Alt + P` |
| …and drop page numbers, joining it into one paragraph | `Ctrl/Cmd + Alt + Shift + P` |
| Turn a tab-separated selection into a table | `Ctrl/Cmd + Alt + Shift + T` |
| Move commas inside the quotes | `Ctrl/Cmd + Alt + ,` |
| Move commas outside the quotes | `Ctrl/Cmd + Alt + .` |
| Paste without cleaning | `Ctrl/Cmd + Shift + V` |

### Terminal output

A terminal breaks every long line at its window edge, and nothing in the result
says which of those breaks you meant. Select the pasted output and the lines go
back together:

```
npm warn deprecated inflight@1.0.6: This module is not supported and leaks memory. Do
  not use it. Check out lru-cache instead.
```

becomes one line. Bullets such as `•` become Markdown list items, and the shared
indentation goes with them.

This is a command rather than an automatic rule because only you know the short
lines in front of you came from a terminal rather than from a person who meant
them. The wrap column itself is worked out from the text — it depends on how
wide a window happened to be when you pressed copy, which is not a number anyone
can be asked for.

### Commas and quotes

Journals disagree about whether a comma goes inside or outside a closing
quotation mark, and a thesis has to pick one. Neither is a default worth
imposing, so this only runs on a selection when you ask for it — and it moves a
comma only where the text is really quoted prose. A CSV row, a JSON object and a
list of quoted words are all left exactly as they are.

### PDF text

The one that matters most here. A quotation lifted from a two-column paper
arrives wrapped at the typesetter's column, with words split by hyphens the
typesetter added and `fi` and `ffl` as single glyphs:

```
The findings suggest that long-term expo-
sure has a measurable effect on the out-
come in both groups.
```

becomes

```
The findings suggest that long-term exposure has a measurable effect on the outcome in both groups.
```

Ligatures become real letters, so a search for "financial" finds the word again.
A hyphen is only removed when the word resumes in lower case: `Navier-`/`Stokes`
stays `Navier-Stokes`, and `10-`/`20` stays `10-20`. Keeping a hyphen that should
have gone is a smaller error than fusing two words that were never one, and far
easier to spot.

The plain `Ctrl/Cmd + Alt + P` makes no guesses. The shift version adds the two
that only a person can confirm: that a line holding nothing but a number was a
page number rather than data, and that the passage was one paragraph the layout
broke apart.

**Highlights get this for free.** *Copy quote + cite* in the reader, and
*Insert excerpt* in a report section, both run the repair — a highlight's text is
the PDF's text layer, so it has exactly these problems, every time.

## Link rules

Under **Settings → Paste**, on top of the built-in list. One rule per line, with
a live tester so you can see a real link before and after.

```
fbclid                      remove that parameter on every site
site.example | source, ref  remove those two on that site and its subdomains
google.*                    match the site on every top-level domain
!youtube.com                switch the built-in rules off for one site
```

A line starting `#` is a comment.

## Privacy

None of the **text rewriting** rules make a network request. Every one of them
is a function of the text on your clipboard and your settings, computed in your
browser as the paste happens. That includes the link cleanup and the DOI and
arXiv linking: both are pure string work against a fixed list of resolvers, and
neither asks anybody anything.

Pasting an image makes one request: the upload, to wherever your workspace
stores its files — your own Postgres or blob store when you self-host.

The two rules under **Looking things up** contact a third-party site, because
that is what they are for. What is worth knowing about them:

- **Only an address you pasted.** Nothing is looked up speculatively, nothing is
  read from the note around it, and a paste that is not a single bare `http(s)`
  URL never triggers either rule.
- **The request comes from WeaveForge, not from you.** In the browser build it
  is made by the server — the site sees the server's address, not yours, and no
  cookie of yours is involved. In the desktop app it is made by the app itself,
  because there is no server to ask and no CORS barrier to work around; the app
  runs the same guard, in the same module.
- **Where it may go is checked, not guessed.** The address is resolved and the
  resulting IP is tested before the connection is made, so a hostname that
  points at `127.0.0.1`, a private range, link-local, or cloud metadata is
  refused. Every redirect hop is re-checked the same way rather than followed
  blindly. Only `http` and `https` on ordinary ports are allowed.
- **Both can be switched off**, together with the rest of the rules, in
  Settings → Paste.

Turning both off restores the older behaviour exactly: no paste rule contacts
anything outside your own workspace.
