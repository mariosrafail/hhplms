import json
import lzma
import struct
import unittest
import zlib
from extract import extract_wordlist, MAX_SWF


def tag(code, payload):
    return struct.pack("<HI", code << 6 | 63, len(payload)) + payload


def fixture(compression="ZWS", ambiguous=False):
    raw = json.dumps({"wordlist": {"item": [{"id": 1, "word": "λέξη"}]}}, ensure_ascii=False).encode()
    symbols = [(311, b"wordlist_json$arbitrary-suffix")]
    if ambiguous:
        symbols.append((912, b"another_wordlist_json$variable"))
    payload = b"\x08\0\0\x18\x01\0"
    payload += tag(76, struct.pack("<H", len(symbols)) + b"".join(struct.pack("<H", id) + name + b"\0" for id, name in symbols))
    payload += b"".join(tag(87, struct.pack("<HI", id, 0) + raw) for id, _ in symbols)
    payload += b"\0\0"
    header = compression.encode() + b"\x22" + struct.pack("<I", len(payload) + 8)
    if compression == "ZWS":
        compressed = lzma.compress(payload, format=lzma.FORMAT_RAW, filters=[{"id": lzma.FILTER_LZMA1, "dict_size": 1 << 20, "lc": 3, "lp": 0, "pb": 2}])
        return header + struct.pack("<I", len(compressed)) + b"\x5d" + struct.pack("<I", 1 << 20) + compressed
    return header + (zlib.compress(payload) if compression == "CWS" else payload)


class ExtractorTests(unittest.TestCase):
    def test_all_compressions(self):
        for compression in ["ZWS", "FWS", "CWS"]:
            value, raw, symbol = extract_wordlist(fixture(compression))
            self.assertEqual(value["wordlist"]["item"][0]["word"], "λέξη")
            self.assertIn("arbitrary", symbol)

    def test_ambiguous(self):
        with self.assertRaisesRegex(ValueError, "found 2"):
            extract_wordlist(fixture(ambiguous=True))

    def test_malformed_and_bounds(self):
        for data in [b"", b"garbage", fixture()[:-1], fixture("FWS")[:-1], fixture("CWS") + b"trailing"]:
            with self.assertRaises(ValueError):
                extract_wordlist(data)
        data = bytearray(fixture())
        struct.pack_into("<I", data, 4, MAX_SWF + 1)
        with self.assertRaisesRegex(ValueError, "size"):
            extract_wordlist(data)
        data = bytearray(fixture("FWS")); data[16:20] = b"\xff" * 4
        with self.assertRaises(ValueError):
            extract_wordlist(data)


if __name__ == "__main__":
    unittest.main()
