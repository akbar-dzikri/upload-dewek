-- Seed for local D1: portfolio project + usage + api_key
-- Key for local dev: ud_local_test_key_12345 (hash: 813ce155c9c71e7ce4349edb531d4a42da4454df8cee4db7ef1c6b020d2706d9)
INSERT OR IGNORE INTO projects (id, name, quota_bytes, created_at, updated_at)
VALUES ('portfolio', 'Portfolio', 1073741824, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO project_usages (project_id, used_bytes, last_updated)
VALUES ('portfolio', 0, strftime('%s','now')*1000);

INSERT OR IGNORE INTO api_keys (id, project_id, key_hash, created_at)
VALUES ('seed-key-1', 'portfolio', '813ce155c9c71e7ce4349edb531d4a42da4454df8cee4db7ef1c6b020d2706d9', strftime('%s','now')*1000);
