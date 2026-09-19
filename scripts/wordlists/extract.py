#!/usr/bin/env python3
"""Bounded, data-only SWF Word List extraction. Python 3.11+ standard library."""
import argparse
import hashlib
import json
import lzma
import re
import struct
import zlib
import zipfile
import subprocess
import sys
from collections import Counter
from pathlib import Path

MAX_SWF = 128 * 1024 * 1024
MAX_JSON = 8 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def decompress_swf(data):
    if len(data) < 9 or len(data) > MAX_SWF:
        raise ValueError("SWF input size invalid")
    size = struct.unpack_from("<I", data, 4)[0]
    if not 14 <= size <= MAX_SWF:
        raise ValueError("SWF declared size invalid")
    signature = data[:3]
    if signature == b"FWS":
        body = data[8:]
    elif signature == b"CWS":
        decoder = zlib.decompressobj()
        body = decoder.decompress(data[8:], size - 8 + 1)
        if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            raise ValueError("CWS stream bounds invalid")
    elif signature == b"ZWS":
        if len(data) < 17 or struct.unpack_from("<I", data, 8)[0] != len(data) - 17:
            raise ValueError("ZWS compressed size invalid")
        prop = data[12]
        dictionary = struct.unpack_from("<I", data, 13)[0]
        if prop >= 225 or dictionary > 64 * 1024 * 1024:
            raise ValueError("ZWS properties invalid")
        decoder = lzma.LZMADecompressor(format=lzma.FORMAT_RAW, filters=[{
            "id": lzma.FILTER_LZMA1, "dict_size": max(dictionary, 4096),
            "lc": prop % 9, "lp": prop // 9 % 5, "pb": prop // 45}])
        body = decoder.decompress(data[17:], max_length=size - 8 + 1)
        if not decoder.eof or decoder.unused_data:
            raise ValueError("ZWS stream bounds invalid")
    else:
        raise ValueError("Unsupported SWF signature")
    if len(body) != size - 8:
        raise ValueError("SWF decompressed size mismatch")
    return b"FWS" + data[3:8] + body


def extract_wordlist(data):
    swf = decompress_swf(data)
    rect_bits = swf[8] >> 3
    offset = 8 + (5 + rect_bits * 4 + 7) // 8 + 4
    symbols, binaries = {}, {}
    ended = False
    for _ in range(100000):
        if offset + 2 > len(swf):
            raise ValueError("Truncated SWF tag")
        header = struct.unpack_from("<H", swf, offset)[0]
        offset += 2
        code, size = header >> 6, header & 63
        if size == 63:
            if offset + 4 > len(swf):
                raise ValueError("Truncated SWF tag length")
            size = struct.unpack_from("<I", swf, offset)[0]
            offset += 4
        if offset + size > len(swf):
            raise ValueError("SWF tag exceeds bounds")
        payload = swf[offset:offset + size]
        offset += size
        if code == 0:
            if size or offset != len(swf):
                raise ValueError("Invalid SWF end tag")
            ended = True
            break
        if code == 76:
            if size < 2:
                raise ValueError("Invalid SymbolClass")
            count = struct.unpack_from("<H", payload)[0]
            cursor = 2
            for _ in range(count):
                if cursor + 3 > size:
                    raise ValueError("Truncated SymbolClass")
                character = struct.unpack_from("<H", payload, cursor)[0]
                end = payload.find(b"\0", cursor + 2)
                if end < 0 or character in symbols:
                    raise ValueError("Invalid/duplicate SymbolClass")
                symbols[character] = payload[cursor + 2:end].decode("utf-8")
                cursor = end + 1
            if cursor != size:
                raise ValueError("SymbolClass bounds invalid")
        if code == 87:
            if size < 6 or payload[2:6] != b"\0" * 4:
                raise ValueError("Invalid DefineBinaryData")
            character = struct.unpack_from("<H", payload)[0]
            if character in binaries:
                raise ValueError("Duplicate binary character")
            binaries[character] = payload[6:]
    if not ended:
        raise ValueError("SWF tag limit exceeded")
    candidates = []
    for character, payload in binaries.items():
        symbol = symbols.get(character, "")
        if not re.search(r"wordlist.*json", symbol, re.I):
            continue
        if len(payload) > MAX_JSON:
            raise ValueError("Word List JSON exceeds bounds")
        value = json.loads(payload.decode("utf-8-sig"))
        if not isinstance(value, dict) or not isinstance(value.get("wordlist", {}).get("item"), list):
            raise ValueError("Word List shape invalid")
        candidates.append((value, payload, symbol))
    if len(candidates) != 1:
        raise ValueError(f"Expected one Word List candidate, found {len(candidates)}")
    return candidates[0]


def read_bounded(path, maximum):
    with path.open("rb") as source:
        data = source.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("Input exceeds size limit")
    return data


def export_wordlist(swf_path, audio_root, output, book, edition):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,99}", book) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,99}", edition):
        raise ValueError("Explicit book and provenance edition slugs required")
    source = read_bounded(swf_path, MAX_SWF)
    value, raw, symbol = extract_wordlist(source)
    items = value["wordlist"]["item"]
    if not 1 <= len(items) <= 10000:
        raise ValueError("Entry count exceeds bounds")
    root = audio_root.resolve(strict=True)
    audio, paths, entries = {}, {}, []
    expected = {"id", "unit_prefix", "num", "word", "pos", "Pronunciation", "definition", "translation", "example", "unit", "part", "belong", "sound", "image"}
    for index, item in enumerate(items):
        if set(item) != expected:
            raise ValueError("Unsupported lexical shape; no fields discarded")
        sound = item["sound"]
        if not isinstance(sound, str) or not re.fullmatch(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*", sound):
            raise ValueError("Unsafe source audio path")
        if sound not in paths:
            path = root / (sound + ".mp3")
            if path.is_symlink() or not path.resolve(strict=True).is_relative_to(root):
                raise ValueError("Audio escapes selected root")
            data = read_bounded(path, 4 * 1024 * 1024)
            sha = digest(data)
            name = "audio/" + sha + ".mp3"
            audio[name] = data
            paths[sound] = name
            if len(audio) > 4096 or sum(map(len, audio.values())) > 128 * 1024 * 1024:
                raise ValueError("Audio aggregate limit")
        groups = item["belong"].split(",")
        memberships = [{"group": group, "component": "students-book" if re.fullmatch(r"unit\d+_\d+", group)
                        else "workbook" if re.fullmatch(r"work\d+_\d+", group) else "unsupported"} for group in groups]
        entries.append({"id": f"entry-{index + 1:06d}", "order": index, "originalId": item["id"], "displayNumber": item["num"],
                        "english": dict(zip(["word", "partOfSpeech", "pronunciation", "definition", "example"],
                                            [item[key] for key in ["word", "pos", "Pronunciation", "definition", "example"]])),
                        "translations": {"el": item["translation"]},
                        "source": {"unit": item["unit"], "part": item["part"], "unitPrefix": item["unit_prefix"],
                                   "belong": item["belong"], "sound": sound, "image": item["image"]},
                        "memberships": memberships, "audioPath": paths[sound]})
    semantic = {"schemaVersion": "portable-wordlist.v1", "datasetKey": "publisher-wordlist", "bookSlug": book,
                "languages": ["en", "el"], "entries": entries,
                "audio": [{"path": name, "sha256": digest(data), "byteSize": len(data), "mediaType": "audio/mpeg"}
                          for name, data in sorted(audio.items())]}
    portable = {**semantic, "datasetSha256": digest(canonical(semantic)), "provenance": {
        "format": "swf-wordlist-json", "edition": edition, "sourceSha256": digest(source), "rawJsonSha256": digest(raw)}}
    encoded = canonical(portable)
    if len(encoded) > MAX_JSON:
        raise ValueError("Portable JSON limit")
    # Output is always a fresh directory. Never overwrite any earlier export.
    output.mkdir(parents=True, exist_ok=False)
    (output / "audio").mkdir()
    (output / "wordlist.json").write_bytes(encoded)
    (output / "raw-wordlist.json").write_bytes(raw)
    for name, data in audio.items():
        (output / name).write_bytes(data)
    with zipfile.ZipFile(output / "wordlist.zip", "x", compression=zipfile.ZIP_STORED) as archive:
        for name, data in [("wordlist.json", encoded), *sorted(audio.items())]:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.flag_bits = 0x800
            archive.writestr(info, data)
    counts = Counter(item["id"] for item in items)
    audit = {"sourceSha256": digest(source), "rawJsonSha256": digest(raw), "symbol": symbol,
             "datasetSha256": portable["datasetSha256"], "portableSha256": digest(encoded),
             "zipSha256": digest((output / "wordlist.zip").read_bytes()), "entries": len(items),
             "originalGroups": dict(Counter(re.sub(r"\d+$", "", item["unit"]) for item in items)),
             "distinctReferencedPaths": len(paths), "distinctAudioBytes": len(audio), "audioBytes": sum(map(len, audio.values())),
             "duplicateOriginalIds": {str(key): count for key, count in counts.items() if count > 1},
             "nonStringHeadwords": [entry["id"] for entry in entries if not isinstance(entry["english"]["word"], str)],
             "unsupportedGroups": sorted({m["group"] for e in entries for m in e["memberships"] if m["component"] == "unsupported"}),
             "pageMappings": "Unresolved: no Builder pages were read, invented or modified."}
    (output / "audit.json").write_bytes(canonical(audit))
    validator = Path(__file__).resolve().with_name("validate.mjs")
    validated = subprocess.run(["node", str(validator), str(output / "wordlist.zip")], capture_output=True, text=True,
                               creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
    if validated.returncode:
        raise ValueError("Portable validation failed; incomplete export retained for inspection: " + validated.stderr[-1500:])
    audit["portableRoundTrip"] = json.loads(validated.stdout)
    (output / "audit.json").write_bytes(canonical(audit))
    return audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inspect", type=Path)
    parser.add_argument("--swf", type=Path)
    parser.add_argument("--audio-root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--book")
    parser.add_argument("--edition")
    parser.add_argument("--gui", action="store_true")
    args = parser.parse_args()
    if args.gui or not any([args.inspect, args.swf]):
        from launcher import launch
        launch()
    elif args.inspect:
        value, raw, symbol = extract_wordlist(read_bounded(args.inspect, MAX_SWF))
        print(json.dumps({"symbol": symbol, "sha256": digest(raw), "count": len(value["wordlist"]["item"])}))
    elif all([args.swf, args.audio_root, args.output, args.book, args.edition]):
        print(json.dumps(export_wordlist(args.swf, args.audio_root, args.output, args.book, args.edition)))
    else:
        parser.error("--swf, --audio-root, --output, --book and --edition are required together")


if __name__ == "__main__":
    main()
