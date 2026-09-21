/**
 * Concept extraction with no model at all.
 *
 * This exists so the wiki is useful before anyone configures a key. It finds
 * what the user has already told us is a concept — `#hashtags` and
 * `[[wikilinks]]` — plus repeated capitalised phrases, which in research prose
 * are overwhelmingly named methods, datasets, and models.
 *
 * It will not match a model's judgement. It is deterministic, free, private,
 * and available immediately, which for a first pass is often the better trade.
 *
 * ## Shape
 *
 * One document is prepared once, then read by two harvesters, and everything
 * after that is a pure function of what they returned:
 *
 * ```
 * prepare(doc) → { raw, plain }
 * harvestStated(doc)  → the signals the user authored  (#tag, [[link]])
 * harvestGuessed(doc) → the signals we inferred        (one regex scan)
 * mergeMentions(...)  → one entry per concept, with the merge policy
 * rankAndLimit(...)   → what is worth a page
 * projectMentions(...)→ the mentions that survived the cap
 * ```
 *
 * The stages used to be one method threading a `record` closure through four
 * call sites, which is how a double parse and a first-write-wins merge hid in
 * plain sight. They have separate reasons to change — markdown syntax, signal
 * sources, ranking policy, output shaping — so they are separate now.
 *
 * The keep decision and the merge policy are both read off `strength`, computed
 * once at harvest: "stated" means the user typed it, "guessed" means a pattern
 * matched. Deriving "was this stated?" a second time from the raw text is what
 * the old second pass did, and it disagreed with the first about empty
 * wikilink targets.
 */

import { extractWikilinks } from "../../vault/domain/vault-page.js";
import { extractHashtagRefs } from "../../papers/domain/paper.js";
import {
  conceptKey,
  type ConceptKind,
  type ExtractedConcept,
  type ExtractionDocument,
  type ExtractedMention,
  type ExtractionRequest,
  type ExtractionResult,
  type IConceptExtractor,
} from "./ai-extraction.js";

/** Below this a phrase is incidental capitalisation, not a name. */
const MIN_MENTIONS = 2;

/** Characters of context on each side of a mention in an evidence snippet. */
const CONTEXT_CHARS = 60;

/** Words that start sentences and would otherwise look like names. */
const STOPWORDS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "we", "it", "our", "their",
  "i", "he", "she", "they", "there", "here", "in", "on", "at", "for", "with",
  "and", "but", "or", "if", "when", "while", "as", "by", "to", "from", "of",
  "however", "therefore", "thus", "first", "second", "finally", "note", "see",
  "figure", "table", "section", "chapter", "appendix",
]);

/**
 * The one pattern this extractor scans with.
 *
 * A capitalised token, optionally followed by up to three more. It is also what
 * finds acronyms, because an acronym is a capitalised token: a second pattern
 * over the same text (and the dedupe that patched up their overlap) bought
 * nothing that reading inside the match does not.
 */
const CANDIDATE = /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\b/g;

/** A token that is nothing but 2–6 capitals: GAN, BLEU, ICLR. */
const ACRONYM_ONLY = /^[A-Z]{2,6}$/;

/**
 * Acronyms whose kind we know, checked before the "an acronym is a method"
 * fallback.
 *
 * The fallback is right for the unknown case — in research prose an unlisted
 * acronym is far more likely a method than a dataset — but it was being applied
 * to the acronyms we *do* know, so ICLR, ACL, MNIST, CIFAR, BLEU and AUC were
 * all filed as methods, and the keyword rules below could never fire for them
 * because an acronym contains no such word. Keys are uppercase, so a lowercased
 * `#iclr` (hashtags are normalised on the way in) is found too.
 */
const KNOWN_ACRONYMS = new Map<string, ConceptKind>([
  // Venues ≤6 letters, which is what the acronym rule could match — plus the
  // longer ones, which it never could and so were dropped entirely.
  ...["ICLR", "NEURIPS", "NIPS", "ICML", "ACL", "EMNLP", "NAACL", "COLING",
      "CVPR", "ICCV", "ECCV", "AAAI", "IJCAI", "SIGIR", "KDD", "WWW", "TACL",
     ].map((name) => [name, "venue"] as const),
  // Datasets.
  ...["MNIST", "CIFAR", "CIFAR10", "CIFAR100", "SVHN", "COCO", "GLUE", "SQUAD",
      "IMAGENET", "TINYIMAGENET", "PASCAL", "KITTI", "WMT", "PTB", "IMDB",
      "LIBRISPEECH", "MMLU", "SST", "SNLI", "MULTINLI",
     ].map((name) => [name, "dataset"] as const),
  // Metrics.
  ...["BLEU", "ROUGE", "METEOR", "AUC", "ROC", "MAP", "MSE", "RMSE", "MAE",
      "PPL", "IOU", "FID", "WER", "CER", "F1",
     ].map((name) => [name, "metric"] as const),
]);

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]]*)\]\]/g, " ")
    .replace(/^#{1,6}\s+/gm, "");
}

function isPlausibleName(phrase: string): boolean {
  const trimmed = phrase.trim();
  if (trimmed.length < 3) return false;
  const words = trimmed.split(/\s+/);
  // A phrase whose first word is a stopword is a sentence opening.
  if (STOPWORDS.has(words[0]!.toLowerCase())) return false;
  return !words.every((word) => STOPWORDS.has(word.toLowerCase()));
}

/**
 * The kind a name's own words and acronym tables imply, or `null` if nothing
 * recognises it. The caller supplies the fallback, because "I could not tell"
 * means something different for a tag the user typed than for a pattern match.
 */
function kindFor(name: string): ConceptKind | null {
  const known = KNOWN_ACRONYMS.get(name.toUpperCase());
  if (known) return known;
  // Only a genuinely all-caps token is an acronym. Testing case-insensitively
  // would file `#notes` as a method.
  if (ACRONYM_ONLY.test(name)) return "method";
  if (/\b(dataset|corpus|benchmark)\b/i.test(name)) return "dataset";
  if (/\b(accuracy|f1|bleu|loss|score|rate)\b/i.test(name)) return "metric";
  if (/\b(conference|workshop|journal|proceedings)\b/i.test(name)) return "venue";
  return null;
}

/** Which signal found a concept. Stated beats guessed; see `mergeMentions`. */
type SignalStrength = "stated" | "guessed";

interface Classified {
  kind: ConceptKind;
  /** False when `kind` is the fallback below rather than something recognised. */
  recognised: boolean;
}

/**
 * What kind of thing this is, with the fallback each path deserves.
 *
 * The two paths differ only in what "I do not recognise this" means. A tag the
 * user typed is a concept until something says otherwise; a phrase we inferred
 * is a method, because a capitalised phrase in research prose usually names one.
 *
 * This used to be one function with a `fromTag: boolean` that branched mid-rule
 * list — and because the acronym rule sat *before* the flag, it did not select a
 * rule subset at all. It only short-circuited the keyword rules, so every stated
 * signal came out as "concept": `[[ImageNet]]` and `#NeurIPS` were filed as
 * concepts where the keyword rules would have said dataset and venue.
 */
function classify(name: string, strength: SignalStrength): Classified {
  const known = kindFor(name);
  if (known) return { kind: known, recognised: true };
  return { kind: strength === "stated" ? "concept" : "method", recognised: false };
}

interface HarvestedMention {
  /** `conceptKey(name)`, computed where the name was, not again downstream. */
  key: string;
  name: string;
  kind: ConceptKind;
  /**
   * Whether `kind` came from a rule (a known acronym, or a word like "dataset")
   * rather than from that path's fallback. A fallback disagreeing with a rule is
   * not the same as two fallbacks disagreeing; see `preferKind`.
   */
  kindRecognised: boolean;
  strength: SignalStrength;
  documentId: string;
  evidence: string;
}

/**
 * A document, reduced to the two strings a mention search needs.
 *
 * There used to be four: `plainLower` and `rawLower` were whole lowercased
 * copies, held so that the evidence lookup could search for a mention's text
 * without allocating a haystack per mention. Positions are carried now — every
 * reader that finds a match reports where it found it — so nothing searches the
 * document for text it already has the location of, and both copies are gone
 * rather than deferred.
 */
interface PreparedDocument {
  id: string;
  raw: string;
  plain: string;
}

function prepare(document: ExtractionDocument): PreparedDocument {
  const raw = document.text ?? "";
  return { id: document.id, raw, plain: stripMarkdown(raw) };
}

/** A snippet of surrounding text, given a position already known. */
function snippetAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - CONTEXT_CHARS);
  const end = Math.min(text.length, index + length + CONTEXT_CHARS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * The evidence snippet for a match whose position is already known.
 *
 * `source` is the string the offset belongs to, and the caller always knows it:
 * `plain` is what the capitalisation scan read, `raw` is what the hashtag and
 * wikilink readers read. It cannot be inferred from the offset, which is the
 * reason the old `evidenceFor` searched instead — `stripMarkdown` blanks
 * wikilinks and collapses code, so the two strings agree on most offsets and
 * disagree on exactly the ones a mention is likely to come from.
 *
 * No search happens here, and none is needed: the reader that found the match
 * reported where, so this only has to quote it. Searching was also *wrong* twice
 * over — it cost two document scans per stated mention, and it answered with the
 * first textual occurrence of the name, which is a different occurrence whenever
 * the name is a substring of an earlier word.
 */
function evidenceAt(
  doc: PreparedDocument,
  source: "plain" | "raw",
  index: number,
  length: number,
): string {
  return snippetAt(source === "plain" ? doc.plain : doc.raw, index, length);
}

/**
 * The text with `[[wikilinks]]` blanked out, length preserved.
 *
 * A `#` inside a wikilink is a heading target (`[[#Overview]]`), not a tag, and
 * the hashtag reader is a plain regex that cannot tell the difference — so
 * linking to a section of a note coined a concept called "overview" that the
 * user never wrote. Blanking rather than deleting keeps every other `#` where it
 * was, which is what the evidence snippets are computed against.
 */
function withoutWikilinks(text: string): string {
  return text.replace(/\[\[[^\[\]\n]*\]\]/g, (match) => " ".repeat(match.length));
}

/**
 * The start offset of each non-empty token in `text`.
 *
 * Walks the same separator class the old `split(/[^A-Za-z0-9]+/)` used and
 * accumulates position instead of searching for the token afterwards. That is
 * the whole point: `phrase.indexOf(token)` finds the first *textual* occurrence,
 * which is the wrong one whenever a token is a substring of an earlier word — in
 * "MAGAN GAN Models", `indexOf("GAN")` answers 2, inside `MAGAN`, and the
 * evidence pane then quotes the wrong neighbourhood.
 *
 * Forward-only by construction, so a later token can never resolve to a position
 * inside an earlier one.
 */
function tokenOffsets(text: string): Array<{ token: string; at: number }> {
  const out: Array<{ token: string; at: number }> = [];
  const re = /[A-Za-z0-9]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({ token: match[0], at: match.index });
  }
  return out;
}

/**
 * The signals the user authored deliberately, which are always kept: a hashtag
 * or a wikilink is a stated concept, not a guess.
 *
 * Positions come from the readers that found the matches, and so does the text
 * those positions are *in*: both readers walk `doc.raw`, and `withoutWikilinks`
 * is length-preserving, so every offset here is an offset in the raw text. The
 * old path called `evidenceFor` instead, which searched for the mention's name
 * all over again — twice per mention, and in the stripped text first, which is
 * exactly where the wrong occurrence came from.
 */
function harvestStated(doc: PreparedDocument): HarvestedMention[] {
  const out: HarvestedMention[] = [];
  const record = (name: string, index: number, length: number) => {
    const classified = classify(name, "stated");
    out.push({
      key: conceptKey(name),
      name,
      kind: classified.kind,
      kindRecognised: classified.recognised,
      strength: "stated",
      documentId: doc.id,
      evidence: evidenceAt(doc, "raw", index, length),
    });
  };

  const withoutLinks = withoutWikilinks(doc.raw);
  for (const ref of extractHashtagRefs(withoutLinks)) record(ref.tag, ref.index, ref.length);

  for (const link of extractWikilinks(doc.raw)) {
    // `[[#Heading]]` and `[[|alias]]` name nothing to file.
    const target = link.target.trim();
    if (!target) continue;
    // The whole `[[…]]` is what was matched, so it is what the evidence quotes.
    // A bare target would quote a heading, not the link the user wrote.
    record(target, link.index ?? 0, link.length ?? 0);
  }
  return out;
}

/**
 * The signals inferred from capitalisation, in one scan of the stripped text.
 *
 * Each match yields the phrase, and also any all-caps token inside it. That
 * second part is what the removed acronym pass contributed: "GAN Models" is one
 * phrase *and* the acronym, and the phrase pattern stops at "VAE-based" while
 * the acronym inside it is "VAE". Reading inside the match keeps both, without
 * the second pass over the whole document and without the dedupe that patched
 * up their overlap.
 */
function harvestGuessed(doc: PreparedDocument): HarvestedMention[] {
  const out: HarvestedMention[] = [];
  const seenInDoc = new Set<string>();

  const record = (name: string, index: number, length: number) => {
    const trimmed = name.trim();
    if (!isPlausibleName(trimmed)) return;
    const key = conceptKey(trimmed);
    if (seenInDoc.has(key)) return;
    seenInDoc.add(key);
    const classified = classify(trimmed, "guessed");
    out.push({
      key,
      name: trimmed,
      kind: classified.kind,
      kindRecognised: classified.recognised,
      strength: "guessed",
      documentId: doc.id,
      evidence: snippetAt(doc.plain, index, length),
    });
  };

  // Compiled per scan rather than shared. The module-level pattern carries the
  // `g` flag, which means it carries a `lastIndex` cursor: one instance shared by
  // every caller makes "extraction never interleaves" an unstated assumption that
  // no type enforces. It holds today only because nothing awaits between the
  // reset and the loop — and `extract` is `async`, so the next progress callback
  // or abort check inserted there would have two documents sharing one cursor and
  // silently dropping matches from both. V8 caches the compiled form, so this
  // costs an allocation and not a recompile.
  const scan = new RegExp(CANDIDATE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = scan.exec(doc.plain)) !== null) {
    const phrase = match[1]!;
    record(phrase, match.index, phrase.length);
    for (const { token, at } of tokenOffsets(phrase)) {
      if (!ACRONYM_ONLY.test(token)) continue;
      record(token, match.index + at, token.length);
    }
  }
  return out;
}

interface ConceptEntry {
  key: string;
  name: string;
  kind: ConceptKind;
  kindRecognised: boolean;
  strength: SignalStrength;
  documents: Set<string>;
}

/**
 * How much a kind says, so a merge never replaces one with a vaguer one.
 *
 * "concept" is the bucket everything lands in when nothing else is known;
 * "method" is narrower than it but still a default; the rest come from a rule.
 */
const KIND_INFORMATIVENESS: Record<ConceptKind, number> = {
  concept: 0,
  method: 1,
  dataset: 2,
  metric: 2,
  person: 2,
  venue: 2,
};

/**
 * Which of two disagreeing kinds to keep: never the less informative one.
 *
 * A kind a rule recognised always wins, whichever signal it came from. That is
 * the whole point of the separate flag — `#abc` lowercases on the way in, so the
 * acronym rule no longer fires for it and the tag classifies as the generic
 * "concept"; taking that at face value replaced the recognised "method" the
 * phrase pass had already got right.
 *
 * Between two kinds that are equally well-informed the stated signal decides,
 * because the user's own framing beats our pattern's guess at the same level.
 */
function preferKind(current: ConceptEntry, incoming: HarvestedMention): ConceptKind {
  if (current.kind === incoming.kind) return current.kind;
  if (current.kindRecognised !== incoming.kindRecognised) {
    return current.kindRecognised ? current.kind : incoming.kind;
  }
  const theirs = KIND_INFORMATIVENESS[incoming.kind];
  const ours = KIND_INFORMATIVENESS[current.kind];
  if (theirs !== ours) return theirs > ours ? incoming.kind : current.kind;
  return incoming.strength === "stated" ? incoming.kind : current.kind;
}

/**
 * One entry per concept, with the merge policy in one place.
 *
 * A stated signal wins the name: the casing and spelling the user typed are a
 * decision, and this is where it used to be thrown away in favour of whichever
 * mention happened to be recorded first. It also wins the keep decision, via
 * `strength`, which is read off the entry instead of being re-derived from the
 * documents a second time.
 */
function mergeMentions(mentions: readonly HarvestedMention[]): {
  concepts: ConceptEntry[];
  mentions: readonly HarvestedMention[];
} {
  const entries = new Map<string, ConceptEntry>();

  for (const mention of mentions) {
    const existing = entries.get(mention.key);
    if (!existing) {
      entries.set(mention.key, {
        key: mention.key,
        name: mention.name,
        kind: mention.kind,
        kindRecognised: mention.kindRecognised,
        strength: mention.strength,
        documents: new Set([mention.documentId]),
      });
      continue;
    }
    existing.documents.add(mention.documentId);
    if (mention.strength === "stated" && existing.strength === "guessed") {
      existing.name = mention.name;
      existing.strength = "stated";
    }
    const kind = preferKind(existing, mention);
    existing.kindRecognised = existing.kindRecognised || mention.kindRecognised;
    existing.kind = kind;
  }

  return { concepts: [...entries.values()], mentions };
}

/**
 * What is worth a page: a phrase seen in two documents, or anything stated in
 * one — a phrase in a single document is usually incidental, but the user
 * already committed to a tag.
 *
 * The tie-break is a codepoint comparison, not `localeCompare`. Every other
 * operation here is deliberately reproducible — an explicit `KIND_INFORMATIVENESS`
 * table, a documented merge order, a normalised key — and `localeCompare` with no
 * locale argument resolves to the host's default locale and its ICU collation.
 * Because this comparator runs *at* the `maxConcepts` cut, two environments can
 * keep different concepts rather than merely list the same ones in another order:
 * the same vault yields a wiki with a page on one machine and not on another, and
 * the CI gate that asserts extraction output runs in a different locale from the
 * laptop that wrote the expectation. Concept keys are already normalised, so there
 * is no case-folding left for a collator to do.
 */
function rankAndLimit(
  entries: readonly ConceptEntry[],
  maxConcepts: number | undefined,
): ConceptEntry[] {
  const ranked = entries
    .filter((entry) => entry.documents.size >= MIN_MENTIONS || entry.strength === "stated")
    .sort(
      (a, b) =>
        b.documents.size - a.documents.size || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  return maxConcepts ? ranked.slice(0, maxConcepts) : ranked;
}

/** The mentions belonging to the concepts that survived the cap. */
function projectMentions(
  mentions: readonly HarvestedMention[],
  kept: readonly ConceptEntry[],
): ExtractedMention[] {
  const keys = new Set(kept.map((entry) => entry.key));
  return mentions
    .filter((mention) => keys.has(mention.key))
    .map((mention) => ({
      documentId: mention.documentId,
      conceptName: mention.name,
      evidence: mention.evidence,
    }));
}

export class LexicalConceptExtractor implements IConceptExtractor {
  readonly id = "lexical";

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    // One document in flight, not the whole corpus. This was
    // `documents.map(prepare)` followed by a `flatMap` over that array, which
    // prepared *every* document up front and kept all of them reachable for the
    // whole run — every copy of every document live at once, so a 2 000-note
    // vault held several copies of the corpus on the same tab that renders the
    // wiki preview. Only the mentions need to outlive a document, and they are
    // small.
    const mentions = request.documents.flatMap((source) => {
      const doc = prepare(source);
      const out = [...harvestStated(doc), ...harvestGuessed(doc)];
      return out; // `doc` is unreachable from here on
    });

    const merged = mergeMentions(mentions);
    const limited = rankAndLimit(merged.concepts, request.maxConcepts);

    return {
      concepts: limited.map((entry) => ({
        name: entry.name,
        aliases: [],
        kind: entry.kind,
        mentions: entry.documents.size,
      })),
      mentions: projectMentions(merged.mentions, limited),
    };
  }
}
