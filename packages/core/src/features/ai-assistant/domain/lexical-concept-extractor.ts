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
 */

import { extractWikilinks } from "../../vault/domain/vault-page.js";
import { extractHashtags } from "../../papers/domain/paper.js";
import {
  conceptKey,
  type ConceptKind,
  type ExtractedConcept,
  type ExtractedMention,
  type ExtractionRequest,
  type ExtractionResult,
  type IConceptExtractor,
} from "./ai-extraction.js";

/** Below this a phrase is incidental capitalisation, not a name. */
const MIN_MENTIONS = 2;

/** Words that start sentences and would otherwise look like names. */
const STOPWORDS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "we", "it", "our", "their",
  "i", "he", "she", "they", "there", "here", "in", "on", "at", "for", "with",
  "and", "but", "or", "if", "when", "while", "as", "by", "to", "from", "of",
  "however", "therefore", "thus", "first", "second", "finally", "note", "see",
  "figure", "table", "section", "chapter", "appendix",
]);

const CAPITALISED_PHRASE = /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\b/g;
/** Acronyms carry a lot of meaning in research writing: VAE, GAN, BERT. */
const ACRONYM = /\b([A-Z]{2,6})\b/g;

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

function classify(name: string, fromTag: boolean): ConceptKind {
  if (/^[A-Z]{2,6}$/.test(name)) return "method";
  if (fromTag) return "concept";
  if (/\b(dataset|corpus|benchmark)\b/i.test(name)) return "dataset";
  if (/\b(accuracy|f1|bleu|loss|score|rate)\b/i.test(name)) return "metric";
  if (/\b(conference|workshop|journal|proceedings)\b/i.test(name)) return "venue";
  return "concept";
}

/** Snippet of surrounding text, for the review queue's evidence pane. */
function evidenceFor(text: string, needle: string): string {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return "";
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + needle.length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export class LexicalConceptExtractor implements IConceptExtractor {
  readonly id = "lexical";

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const counts = new Map<string, { name: string; kind: ConceptKind; documents: Set<string> }>();
    const mentions: ExtractedMention[] = [];

    const record = (name: string, documentId: string, kind: ConceptKind, evidence: string) => {
      const key = conceptKey(name);
      const entry = counts.get(key) ?? { name, kind, documents: new Set<string>() };
      entry.documents.add(documentId);
      counts.set(key, entry);
      mentions.push({ documentId, conceptName: name, evidence });
    };

    for (const document of request.documents) {
      const raw = document.text ?? "";
      const plain = stripMarkdown(raw);

      // Signals the user authored deliberately come first and are always kept:
      // a hashtag or a wikilink is a stated concept, not a guess.
      for (const tag of extractHashtags(raw)) {
        record(tag, document.id, classify(tag, true), evidenceFor(plain, tag));
      }
      for (const link of extractWikilinks(raw)) {
        const target = link.target.trim();
        if (target) record(target, document.id, classify(target, true), evidenceFor(plain, target));
      }

      const seenInDoc = new Set<string>();
      for (const re of [CAPITALISED_PHRASE, ACRONYM]) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(plain)) !== null) {
          const phrase = match[1]!.trim();
          if (!isPlausibleName(phrase)) continue;
          const key = conceptKey(phrase);
          if (seenInDoc.has(key)) continue;
          seenInDoc.add(key);
          record(phrase, document.id, classify(phrase, false), evidenceFor(plain, phrase));
        }
      }
    }

    const stated = new Set<string>();
    for (const document of request.documents) {
      for (const tag of extractHashtags(document.text ?? "")) stated.add(conceptKey(tag));
      for (const link of extractWikilinks(document.text ?? "")) {
        stated.add(conceptKey(link.target));
      }
    }

    const concepts: ExtractedConcept[] = [...counts.values()]
      // A phrase in one document is usually incidental; a stated tag or link is
      // kept regardless, because the user already committed to it.
      .filter((entry) => entry.documents.size >= MIN_MENTIONS || stated.has(conceptKey(entry.name)))
      .map((entry) => ({
        name: entry.name,
        aliases: [],
        kind: entry.kind,
        mentions: entry.documents.size,
      }))
      .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));

    const limited = request.maxConcepts ? concepts.slice(0, request.maxConcepts) : concepts;
    const kept = new Set(limited.map((concept) => conceptKey(concept.name)));

    return {
      concepts: limited,
      mentions: mentions.filter((mention) => kept.has(conceptKey(mention.conceptName))),
    };
  }
}
