"use client";

import type { Paper } from "@weaveforge/core";
import { formatMetricCell } from "@weaveforge/core";
import Link from "next/link";
import { CommentsToggle } from "@/features/sharing/ui/comments-toggle";
import { SharedPaperImages } from "@/features/sharing/ui/shared-paper-images";
import { sharedPaperAnnotationSummary } from "@/features/sharing/application/shared-paper-annotations";
import { AddToLibraryButton } from "@/features/sharing/ui/add-to-library-button";
import { DuplicateCopyButton } from "@/features/sharing/ui/duplicate-copy-button";
import { sharedItemHref, sharedItemTypeLabel } from "@/features/sharing/ui/shared-item-routes";
import { OpenIcon } from "@/components/view-icons";
import type { SharedItemDetail } from "@/features/sharing/application/load-shared-details";

/** Resource kinds that only live as cards (no dedicated detail page for comments). */
const CARD_COMMENTS = new Set(["milestone", "reading_list"]);

export function SharedItemRenderer({
  item,
  ownerName,
  canComment = false,
}: {
  item: SharedItemDetail;
  ownerName: string;
  canComment?: boolean;
}) {
  const href = sharedItemHref(item);
  const commentsOnCard = CARD_COMMENTS.has(item.kind);

  if (item.kind === "paper" && item.paper) {
    return (
      <SharedPaperCard
        paper={item.paper}
        href={href}
        ownerName={ownerName}
        ownerId={item.ownerId}
        canComment={canComment}
      />
    );
  }

  if (item.kind === "vault_page" && item.vaultPage) {
    const page = item.vaultPage;
    const snippet = page.body.replace(/\s+/g, " ").slice(0, 120);
    return (
      <li className="card exp-item shared-item">
        <Link href={href} className="shared-item-link">
          <ShareTags kind={item.kind} canComment={canComment} />
          <div className="card-head">
            <h3 className="card-title">{page.title}</h3>
            <span className="tag-chip shared-by-chip">Shared by {ownerName}</span>
          </div>
          {snippet && <p className="muted">{snippet}{page.body.length > 120 ? "…" : ""}</p>}
        </Link>
        <div className="card-foot shared-item-foot">
          <AddToLibraryButton
            resourceType={item.kind}
            resourceId={item.id}
            ownerId={item.ownerId}
          />
          <DuplicateCopyButton
            resourceType={item.kind}
            resourceId={item.id}
            ownerId={item.ownerId}
          />
          <Link href={href} className="entity-icon-btn" aria-label="Open" title="Open">
            <OpenIcon />
          </Link>
        </div>
      </li>
    );
  }

  if (item.kind === "experiment" && item.experiment) {
    const exp = item.experiment;
    const metrics = Object.entries(exp.metrics ?? {});
    return (
      <li className="card exp-item shared-item">
        <Link href={href} className="shared-item-link">
          <ShareTags kind={item.kind} canComment={canComment} />
          <div className="card-head">
            <h3 className="card-title">{exp.name}</h3>
            <span className="tag-chip shared-by-chip">Shared by {ownerName}</span>
          </div>
          {exp.hypothesis && <p className="muted">{exp.hypothesis}</p>}
          {metrics.length > 0 && (
            <div className="metric-chips">
              {metrics.slice(0, 4).map(([k, v]) => (
                <span key={k} className="metric-chip">
                  {/* Through the shared formatter, not `String(v)`. That call had
                      both halves of the bug the experiment page was reported
                      for: an object rendered as the literal `[object Object]`,
                      and a number lost the precision every other surface shows
                      it with — `0.22` here against `0.2200` there, for the same
                      run. */}
                  <em>{k}</em> {formatMetricCell(k, v)}
                </span>
              ))}
            </div>
          )}
        </Link>
        <div className="card-foot shared-item-foot">
          <AddToLibraryButton
            resourceType={item.kind}
            resourceId={item.id}
            ownerId={item.ownerId}
          />
          <Link href={href} className="entity-icon-btn" aria-label="Open" title="Open">
            <OpenIcon />
          </Link>
        </div>
      </li>
    );
  }

  return (
    <li className="card exp-item shared-item">
      <Link href={href} className="shared-item-link">
        <ShareTags kind={item.kind} canComment={canComment} />
        <div className="card-head">
          <h3 className="card-title">{item.title}</h3>
          <span className="tag-chip shared-by-chip">Shared by {ownerName}</span>
        </div>
        <div className="metric-chips">
          <span className="metric-chip">
            <em>type</em> {sharedItemTypeLabel(item.kind)}
          </span>
          {item.status && (
            <span className="metric-chip">
              <em>status</em> {item.status}
            </span>
          )}
        </div>
        {item.kind === "paper" && <SharedPaperImages metadata={item.metadata} />}
      </Link>
      <div className="card-foot shared-item-foot">
        {commentsOnCard && (
          <CommentsToggle resourceType={item.kind} resourceId={item.id} canComment={canComment} />
        )}
        <AddToLibraryButton
          resourceType={item.kind}
          resourceId={item.id}
          ownerId={item.ownerId}
        />
        <Link href={href} className="entity-icon-btn" aria-label="Open" title="Open">
          <OpenIcon />
        </Link>
      </div>
    </li>
  );
}

function SharedPaperCard({
  paper,
  href,
  ownerName,
  ownerId,
  canComment,
}: {
  paper: Paper;
  href: string;
  ownerName: string;
  ownerId: string;
  canComment: boolean;
}) {
  const hasSummary = !!paper.summary && paper.summary !== "No summary yet.";
  const snippet = hasSummary
    ? paper.summary!.replace(/\s+/g, " ").slice(0, 150) +
      (paper.summary!.length > 150 ? "…" : "")
    : "";

  return (
    <li className="card paper-card shared-item">
      <Link href={href} className="shared-item-link paper-card">
        <ShareTags kind="paper" canComment={canComment} />
        <div className="paper-card-head">
          <h3 className="paper-card-title">{paper.title}</h3>
          <span className="tag-chip shared-by-chip">Shared by {ownerName}</span>
        </div>
        {paper.authors.length > 0 && (
          <p className="muted paper-card-authors">
            {paper.authors.slice(0, 4).join(", ")}
            {paper.authors.length > 4 ? " et al." : ""}
            {paper.year ? ` · ${paper.year}` : ""}
          </p>
        )}
        {snippet && <p className="paper-card-snippet">{snippet}</p>}
        {paper.tags.length > 0 && (
          <div className="tag-chips">
            {paper.tags.map((t) => (
              <span key={t} className="tag-chip">
                #{t}
              </span>
            ))}
          </div>
        )}
        <div className="metric-chips">
          <span className="metric-chip">
            <em>status</em> {paper.status.replace("_", " ")}
          </span>
        </div>
        <SharedPaperImages metadata={paper.metadata} />
        <SharedPaperAnnotations metadata={paper.metadata} />
      </Link>
      <div className="card-foot paper-card-foot shared-item-foot">
        <AddToLibraryButton resourceType="paper" resourceId={paper.id} ownerId={ownerId} />
        <DuplicateCopyButton resourceType="paper" resourceId={paper.id} ownerId={ownerId} />
        <Link href={href} className="entity-icon-btn" aria-label="Open note" title="Open note">
          <OpenIcon />
        </Link>
      </div>
    </li>
  );
}

/** What the item is and what the share lets me do with it, as two pills. */
function ShareTags({ kind, canComment }: { kind: SharedItemDetail["kind"]; canComment: boolean }) {
  const label = sharedItemTypeLabel(kind);
  return (
    <div className="shared-tags">
      <span className={`shared-kind shared-kind--${kind}`}>
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </span>
      <span className="shared-access">{canComment ? "Can comment" : "Can view"}</span>
    </div>
  );
}

/** Read-only paper card for the native Papers list when item is pinned from a share. */
export function PinnedPaperBadge({ ownerName }: { ownerName?: string }) {
  if (!ownerName) return null;
  return <span className="tag-chip shared-by-chip">Shared by {ownerName}</span>;
}

function SharedPaperAnnotations({ metadata }: { metadata?: Record<string, unknown> }) {
  const summary = sharedPaperAnnotationSummary(metadata);
  if (summary.count === 0) return null;
  return (
    <div className="shared-paper-annotations" aria-label="Shared annotations">
      <span className="metric-chip">
        <em>annotations</em> {summary.count}
      </span>
      {summary.samples.map((s) => (
        <p key={s.slice(0, 24)} className="muted paper-card-snippet">
          “{s.slice(0, 120)}
          {s.length > 120 ? "…" : ""}”
        </p>
      ))}
    </div>
  );
}
