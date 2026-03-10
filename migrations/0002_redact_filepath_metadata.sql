-- Remove legacy local filepath metadata emitted by older sync-local versions.

UPDATE usage_events
SET metadata = NULL
WHERE source IN ('claude', 'codex')
  AND json_valid(metadata)
  AND (
    json_extract(metadata, '$.filePath') IS NOT NULL
    OR json_extract(metadata, '$.filepath') IS NOT NULL
    OR json_extract(metadata, '$.file_path') IS NOT NULL
  );

UPDATE usage_events
SET metadata = CASE
  WHEN json_remove(
    json_remove(
      json_remove(metadata, '$.filePath'),
      '$.filepath'
    ),
    '$.file_path'
  ) IN ('{}', '[]') THEN NULL
  ELSE json_remove(
    json_remove(
      json_remove(metadata, '$.filePath'),
      '$.filepath'
    ),
    '$.file_path'
  )
END
WHERE source NOT IN ('claude', 'codex')
  AND json_valid(metadata)
  AND (
    json_extract(metadata, '$.filePath') IS NOT NULL
    OR json_extract(metadata, '$.filepath') IS NOT NULL
    OR json_extract(metadata, '$.file_path') IS NOT NULL
  );
