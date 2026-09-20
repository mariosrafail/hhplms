"""Bounded independent APK ZIP readback. Not the portable Word List ZIP policy."""
import hashlib
import json
import pathlib
import re
import stat
import sys
import zipfile

apk, destination = map(pathlib.Path, sys.argv[1:])
destination.mkdir(exist_ok=False)
seen = set()
inventory = {}
total = 0
with zipfile.ZipFile(apk) as archive:
    if len(archive.infolist()) > 60000:
        raise ValueError('offline_apk_entry_limit')
    for entry in archive.infolist():
        name = entry.orig_filename
        parts = name.rstrip('/').split('/')
        if (name in seen or len(name) > 1024 or name.startswith('/') or '\\' in name or ':' in name
                or any(ord(c) < 32 or ord(c) == 127 for c in entry.orig_filename)
                or any(p in ('', '.', '..') or p.endswith(('.', ' '))
                       or re.match(r'^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)', p, re.I) for p in parts)):
            raise ValueError('offline_apk_path_unsafe')
        seen.add(name)
        if stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
            raise ValueError('offline_apk_entry_unsafe')
        if entry.file_size > 512 * 1024**2:
            raise ValueError('offline_apk_file_limit')
        total += entry.file_size
        if total > 10 * 1024**3:
            raise ValueError('offline_apk_total_limit')
        if entry.is_dir():
            continue
        selected = name.startswith('assets/public/') or name == 'assets/capacitor.config.json'
        target = destination.joinpath(*parts) if selected else None
        if target:
            target.parent.mkdir(parents=True, exist_ok=True)
        checksum = hashlib.sha256()
        count = 0
        with archive.open(entry) as source:
            output = target.open('xb') if target else None
            try:
                while chunk := source.read(1024 * 1024):
                    count += len(chunk)
                    if count > entry.file_size:
                        raise ValueError('offline_apk_size_mismatch')
                    checksum.update(chunk)
                    if output:
                        output.write(chunk)
            finally:
                if output:
                    output.close()
        if count != entry.file_size:
            raise ValueError('offline_apk_size_mismatch')
        inventory[name] = {'sha256': checksum.hexdigest(), 'byteSize': count}
print(json.dumps({'entries': len(inventory), 'files': inventory}))
