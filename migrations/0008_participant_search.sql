CREATE VIRTUAL TABLE `participants_search` USING fts5(
  name, content='participants', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `participants_search_insert` AFTER INSERT ON `participants` BEGIN
  INSERT INTO participants_search(rowid, name) VALUES (new.rowid, new.name);
END;
--> statement-breakpoint
CREATE TRIGGER `participants_search_delete` AFTER DELETE ON `participants` BEGIN
  INSERT INTO participants_search(participants_search, rowid, name) VALUES ('delete', old.rowid, old.name);
END;
--> statement-breakpoint
CREATE TRIGGER `participants_search_update` AFTER UPDATE ON `participants` BEGIN
  INSERT INTO participants_search(participants_search, rowid, name) VALUES ('delete', old.rowid, old.name);
  INSERT INTO participants_search(rowid, name) VALUES (new.rowid, new.name);
END;
--> statement-breakpoint
INSERT INTO participants_search(participants_search) VALUES ('rebuild');
