from __future__ import annotations

import struct
import unittest

from catlabel.vendors.niimbot.manifest import NiimbotManifest
from catlabel.vendors.niimbot.client import (
    NiimbotPacket,
    RequestCodeEnum,
    count_pixels_for_bitmap,
)


class NiimbotProtocolTests(unittest.TestCase):
    def setUp(self):
        self.manifest = NiimbotManifest()

    def test_identify_d110_m(self):
        model = self.manifest.identify_device("D110_M_ABC123")
        self.assertIsNotNone(model)
        self.assertEqual(model["model_id"], "D110_M")
        self.assertEqual(model["protocol_variant"], "b1")
        self.assertEqual(model["width_px"], 96)

        model_dash = self.manifest.identify_device("D110-M-456")
        self.assertIsNotNone(model_dash)
        self.assertEqual(model_dash["model_id"], "D110_M")

    def test_identify_standard_d110(self):
        model = self.manifest.identify_device("D110-1234")
        self.assertIsNotNone(model)
        self.assertEqual(model["model_id"], "D110")
        self.assertEqual(model["protocol_variant"], "d110")
        self.assertEqual(model["width_px"], 96)

    def test_count_pixels_empty_row(self):
        line = b"\x00" * 12  # 96 pixels, all white
        total, parts, indices = count_pixels_for_bitmap(line, printhead_pixels=96)
        self.assertEqual(total, 0)
        self.assertEqual(parts, (0, 0, 0))
        self.assertEqual(len(indices), 0)

    def test_count_pixels_indexed_mode(self):
        # 1 black pixel at bit 0 of byte 0 (pixel index 0)
        # 1 black pixel at bit 7 of byte 0 (pixel index 7)
        # 1 black pixel at bit 0 of byte 4 (pixel index 32 -> chunk 1)
        line = bytearray(12)
        line[0] = 0b10000001
        line[4] = 0b10000000
        total, parts, indices = count_pixels_for_bitmap(bytes(line), printhead_pixels=96)
        self.assertEqual(total, 3)
        self.assertEqual(parts, (2, 1, 0))
        self.assertEqual(len(indices), 6)  # 3 pixels * 2 bytes = 6 bytes
        # Indices should be 0, 7, 32
        unpacked_indices = struct.unpack(">HHH", indices)
        self.assertEqual(unpacked_indices, (0, 7, 32))

    def test_count_pixels_full_mode(self):
        # All black pixels
        line = b"\xFF" * 12  # 96 black pixels
        total, parts, indices = count_pixels_for_bitmap(line, printhead_pixels=96)
        self.assertEqual(total, 96)
        self.assertEqual(parts, (32, 32, 32))

    def test_packet_checksum_and_framing(self):
        pkt = NiimbotPacket(RequestCodeEnum.PRINT_EMPTY_ROW, struct.pack(">HB", 0, 1))
        wire = pkt.to_bytes()
        self.assertTrue(wire.startswith(b"\x55\x55"))
        self.assertTrue(wire.endswith(b"\xAA\xAA"))
        self.assertEqual(wire[2], RequestCodeEnum.PRINT_EMPTY_ROW)
        # Length of payload (3 bytes)
        self.assertEqual(wire[3], 3)
        # Roundtrip parse
        parsed = NiimbotPacket.from_bytes(wire)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.type, RequestCodeEnum.PRINT_EMPTY_ROW)
        self.assertEqual(parsed.data, struct.pack(">HB", 0, 1))


if __name__ == "__main__":
    unittest.main()
