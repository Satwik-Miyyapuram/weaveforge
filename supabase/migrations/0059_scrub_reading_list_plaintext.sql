-- Scrub legacy plaintext reading list fields once content_enc exists.

update reading_lists
set name = '', description = null
where content_enc is not null and (name <> '' or description is not null);

update reading_list_items
set note = null
where content_enc is not null and note is not null;
