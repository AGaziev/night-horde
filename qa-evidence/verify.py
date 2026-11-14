#!/usr/bin/env python3
"""Read and verify evidence bytes; never extract or execute archive members."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile

root = Path(__file__).resolve().parent
results = []
for checksum_file in sorted(root.glob('*/SHA256SUMS')):
    expected, name = checksum_file.read_text().strip().split()
    if PurePosixPath(name).name != name:
        raise SystemExit('Unsafe archive filename')
    archive = checksum_file.parent / name
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'Archive digest mismatch: {name}')
    manifest_raw = (checksum_file.parent / 'members.json').read_bytes()
    manifest = json.loads(manifest_raw)
    expected_files = {'outputs/' + item['path']: item for item in manifest['files']}
    seen = set()
    with tarfile.open(archive, 'r:gz') as tar:
        for entry in tar:
            path = PurePosixPath(entry.name)
            if not entry.isfile() or path.is_absolute() or '..' in path.parts or entry.name in seen:
                raise SystemExit(f'Invalid or duplicate member in {name}')
            seen.add(entry.name)
            raw = tar.extractfile(entry).read()
            if entry.name == 'members.json':
                if raw != manifest_raw:
                    raise SystemExit(f'Embedded manifest mismatch: {name}')
                continue
            item = expected_files.get(entry.name)
            if item is None or len(raw) != item['bytes'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
                raise SystemExit(f'Member digest mismatch: {name}/{entry.name}')
    if seen != set(expected_files) | {'members.json'}:
        raise SystemExit(f'Member set mismatch: {name}')
    results.append({'archive': name, 'sha256': actual, 'files': len(expected_files), 'status': 'PASS'})
if not results:
    raise SystemExit('No archives found')
print(json.dumps(results, indent=2))
