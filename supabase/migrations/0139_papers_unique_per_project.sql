-- One paper may sit in several projects, each copy with its own tags and notes.
drop index if exists papers_user_arxiv_uniq;
drop index if exists papers_user_doi_uniq;
drop index if exists papers_user_arxiv_bidx_uniq;
drop index if exists papers_user_doi_bidx_uniq;

create unique index if not exists papers_project_arxiv_uniq
  on papers (project_id, arxiv_id) where arxiv_id is not null;
create unique index if not exists papers_project_doi_uniq
  on papers (project_id, doi) where doi is not null;
create unique index if not exists papers_project_arxiv_bidx_uniq
  on papers (project_id, arxiv_bidx) where arxiv_bidx is not null;
create unique index if not exists papers_project_doi_bidx_uniq
  on papers (project_id, doi_bidx) where doi_bidx is not null;
