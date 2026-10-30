//! Relays: fetches the page cannot make itself (papers, pages, APIs), served on the `app` scheme.
//!
//! Ported from `apps/desktop/src/*-proxy.ts` and `proxy-shared.ts`.

pub mod address;

pub mod shared;

pub mod arxiv;

pub mod blob;

pub mod html;

pub mod pdf;

pub mod semantic_scholar;
