import asyncio
import enum
import struct
import logging
from typing import Dict, List, Optional, Tuple

from PIL import Image
from bleak import BleakClient, BleakError

from ..base import BasePrinterClient
from ...protocol.encoding import pack_line
from ...protocol.types import PixelFormat
from ...rendering.renderer import image_to_raster
from ...devices import get_ble_transport_profile

# --- Configure robust logging for Niimbot ---
logger = logging.getLogger("NiimbotClient")
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setLevel(logging.DEBUG)
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - [Niimbot] %(message)s')
    ch.setFormatter(formatter)
    logger.addHandler(ch)
    try:
        fh = logging.FileHandler("niimbot_debug.log", mode="a")
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(formatter)
        logger.addHandler(fh)
    except Exception:
        pass


class RequestCodeEnum(enum.IntEnum):
    GET_INFO = 64
    GET_RFID = 26
    HEARTBEAT = 220
    SET_LABEL_TYPE = 35
    SET_LABEL_DENSITY = 33
    SET_PRINT_SPEED = 2
    START_PRINT = 1
    END_PRINT = 243
    START_PAGE_PRINT = 3
    END_PAGE_PRINT = 227
    ALLOW_PRINT_CLEAR = 32
    SET_DIMENSION = 19
    SET_QUANTITY = 21
    GET_PRINT_STATUS = 163
    PRINT_BITMAP_ROW = 133          # 0x85
    PRINT_EMPTY_ROW = 132           # 0x84
    PRINT_BITMAP_ROW_INDEXED = 131  # 0x83


def count_pixels_for_bitmap(
    line_data: bytes, printhead_pixels: int = 96
) -> Tuple[int, Tuple[int, int, int], bytes]:
    """
    Counts black pixels (1-bits) in line_data across 3 chunks of the printhead.
    Returns:
      (total_black_pixels, (count_chunk0, count_chunk1, count_chunk2), index_bytes)
    where index_bytes are uint16_be encoded indices for black pixels (used for 0x83 packets).
    """
    chunk_size = max(1, printhead_pixels // 8 // 3)
    total = 0
    parts = [0, 0, 0]
    indices = []

    for byte_idx, b in enumerate(line_data):
        if b == 0:
            continue
        chunk_idx = min(2, byte_idx // chunk_size)
        for bit in range(8):
            if b & (1 << (7 - bit)):
                total += 1
                parts[chunk_idx] += 1
                pixel_idx = byte_idx * 8 + bit
                indices.extend([(pixel_idx >> 8) & 0xFF, pixel_idx & 0xFF])

    return total, (min(255, parts[0]), min(255, parts[1]), min(255, parts[2])), bytes(indices)


class InfoEnum(enum.IntEnum):
    DENSITY = 1
    PRINTSPEED = 2
    LABELTYPE = 3
    SOFTVERSION = 9
    BATTERY = 10
    DEVICESERIAL = 11
    HARDVERSION = 12


class NiimbotPacket:
    def __init__(self, type_, data):
        self.type = int(type_)
        self.data = bytes(data)

    @classmethod
    def from_bytes(cls, pkt: bytes) -> Optional["NiimbotPacket"]:
        if len(pkt) < 7 or pkt[:2] != b"\x55\x55" or pkt[-2:] != b"\xaa\xaa":
            return None
        type_ = pkt[2]
        length = pkt[3]
        if len(pkt) != length + 7:
            return None
        data = pkt[4 : 4 + length]

        checksum = type_ ^ length
        for value in data:
            checksum ^= value

        if checksum != pkt[-3]:
            logger.warning(f"Packet checksum mismatch! Expected {pkt[-3]}, got {checksum}")
            return None
        return cls(type_, data)

    def to_bytes(self) -> bytes:
        checksum = self.type ^ len(self.data)
        for value in self.data:
            checksum ^= value
        return bytes((0x55, 0x55, self.type, len(self.data), *self.data, checksum, 0xAA, 0xAA))


RESPONSE_MAP: Dict[int, List[int]] = {
    RequestCodeEnum.START_PRINT: [2],
    RequestCodeEnum.START_PAGE_PRINT: [4],
    RequestCodeEnum.SET_DIMENSION: [20],
    RequestCodeEnum.SET_QUANTITY: [22],
    RequestCodeEnum.GET_RFID: [27],
    RequestCodeEnum.ALLOW_PRINT_CLEAR: [33],
    RequestCodeEnum.SET_LABEL_DENSITY: [34],
    RequestCodeEnum.SET_LABEL_TYPE: [36],
    RequestCodeEnum.GET_INFO: [65],
    RequestCodeEnum.GET_PRINT_STATUS: [179],
    RequestCodeEnum.HEARTBEAT: [217, 219, 221, 222],
    RequestCodeEnum.END_PAGE_PRINT: [228],
    RequestCodeEnum.END_PRINT: [244],
}


class NiimbotClient(BasePrinterClient):
    def __init__(self, device, hardware_info, printer_profile, settings):
        super().__init__(device, hardware_info, printer_profile, settings)
        self.client: Optional[BleakClient] = None
        self.notify_uuid: Optional[str] = None
        self.write_uuid: Optional[str] = None
        self._buffer = bytearray()
        self._events: Dict[int, Tuple[asyncio.Event, asyncio.AbstractEventLoop]] = {}
        self._responses: Dict[int, NiimbotPacket] = {}
        self._ble_profile = get_ble_transport_profile("niimbot")

    def _publish_response(self, req_code: int, packet: NiimbotPacket) -> None:
        self._responses[req_code] = packet
        event_data = self._events.get(req_code)
        if event_data is None:
            return
        event, _loop = event_data
        event.set()

    def _on_notify(self, sender, payload: bytearray) -> None:
        """Route raw Bleak notification packets back onto the waiting asyncio loop safely."""
        self._buffer.extend(payload)

        while True:
            start = self._buffer.find(b"\x55\x55")
            if start == -1:
                self._buffer.clear()
                return
            if start > 0:
                del self._buffer[:start]

            if len(self._buffer) < 7:
                return

            length = self._buffer[3]
            total_length = length + 7
            if len(self._buffer) < total_length:
                return

            if self._buffer[total_length - 2 : total_length] != b"\xaa\xaa":
                del self._buffer[:2]
                continue

            packet_bytes = bytes(self._buffer[:total_length])
            del self._buffer[:total_length]

            packet = NiimbotPacket.from_bytes(packet_bytes)
            if packet is None:
                continue

            matched_req_code = None
            for req_code in list(self._events.keys()):
                expected = RESPONSE_MAP.get(req_code, [req_code, req_code + 1])
                if packet.type in expected or packet.type == req_code or packet.type == (req_code + 1):
                    matched_req_code = req_code
                    break

            if matched_req_code is None:
                logger.debug(f"Unsolicited packet received: type={packet.type}, data={packet.data.hex()}")
                self._responses[packet.type] = packet
                continue

            event_data = self._events.get(matched_req_code)
            if event_data is None:
                self._responses[matched_req_code] = packet
                continue

            _event, loop = event_data
            if loop.is_closed():
                self._responses[matched_req_code] = packet
                continue

            loop.call_soon_threadsafe(self._publish_response, matched_req_code, packet)

    async def connect(self) -> bool:
        self._buffer.clear()
        self._events.clear()
        self._responses.clear()

        address = self.device.address
        if hasattr(self.device, "ble_endpoint") and self.device.ble_endpoint:
            address = self.device.ble_endpoint.address

        logger.info(f"Attempting native BLE connection to {address}...")
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                self.client = BleakClient(address)
                await self.client.connect(timeout=10.0)
                
                self.notify_uuid = None
                self.write_uuid = None

                PREFERRED_COMBINED = ["bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"]
                PREFERRED_WRITE = ["49535343-8841-43f4-a8d4-ecbe34729bb3"]
                PREFERRED_NOTIFY = ["49535343-1e4d-4bd9-ba61-23c647249616"]

                preferred_service_uuid = self._ble_profile.preferred_service_uuid.lower()
                for service in self.client.services:
                    if str(service.uuid).lower() != preferred_service_uuid:
                        continue
                    for char in service.characteristics:
                        props = {str(value).lower() for value in char.properties}
                        if self.write_uuid is None and (
                            "write" in props or "write-without-response" in props
                        ):
                            self.write_uuid = char.uuid
                        if self.notify_uuid is None and (
                            "notify" in props or "indicate" in props
                        ):
                            self.notify_uuid = char.uuid
                
                for service in self.client.services:
                    for char in service.characteristics:
                        uuid_str = str(char.uuid).lower()
                        if uuid_str in PREFERRED_COMBINED and not (
                            self.write_uuid and self.notify_uuid
                        ):
                            self.write_uuid = char.uuid
                            self.notify_uuid = char.uuid
                        elif uuid_str in PREFERRED_WRITE and self.write_uuid is None:
                            self.write_uuid = char.uuid
                        elif uuid_str in PREFERRED_NOTIFY and self.notify_uuid is None:
                            self.notify_uuid = char.uuid

                if not self.write_uuid or not self.notify_uuid:
                    for service in self.client.services:
                        for char in service.characteristics:
                            uuid_str = str(char.uuid).lower()
                            props = char.properties
                            
                            # Skip the Air Patch which breaks normal communication
                            if "aca3-481c-91ec-d85e28a60318" in uuid_str:
                                continue
                                
                            if not self.write_uuid and ('write' in props or 'write-without-response' in props):
                                self.write_uuid = char.uuid
                            if not self.notify_uuid and ('notify' in props or 'indicate' in props):
                                self.notify_uuid = char.uuid

                if not self.write_uuid or not self.notify_uuid:
                    raise RuntimeError("Could not find valid TX/RX characteristics for Niimbot.")

                logger.debug(f"Bound to RX (notify): {self.notify_uuid} | TX (write): {self.write_uuid}")
                await self.client.start_notify(self.notify_uuid, self._on_notify)
                
                logger.info("Executing initial hardware handshake...")
                await self.send_command(RequestCodeEnum.HEARTBEAT, b"\x01", timeout=1.0)
                await self.send_command(RequestCodeEnum.GET_INFO, bytes([InfoEnum.DEVICESERIAL.value]), timeout=1.0)
                
                logger.info("Connected successfully.")
                return True
            except Exception as exc:
                logger.warning(f"Connection attempt {attempt + 1} failed: {exc}")
                self.last_error = exc
                if self.client and self.client.is_connected:
                    try:
                        await self.client.disconnect()
                    except:
                        pass
                self.client = None
                self.notify_uuid = None
                self.write_uuid = None
                await asyncio.sleep(1.5)
        
        logger.error("All connection attempts failed.")
        return False

    async def disconnect(self) -> None:
        try:
            logger.info("Disconnecting...")
            if self.client and self.client.is_connected:
                try:
                    await self.client.stop_notify(self.notify_uuid)
                except:
                    pass
                await self.client.disconnect()
        finally:
            self.client = None
            self.notify_uuid = None
            self.write_uuid = None
            self._buffer.clear()
            self._events.clear()
            self._responses.clear()

    async def send_command(self, req_code, data=b"", timeout=5.0):
        request_code = int(req_code)
        packet = NiimbotPacket(request_code, data)
        loop = asyncio.get_running_loop()
        event = asyncio.Event()
        self._responses.pop(request_code, None)
        self._events[request_code] = (event, loop)

        logger.debug(f"Sending cmd {request_code} (payload: {data.hex()})")
        try:
            await self.write_raw(packet.to_bytes())
            await asyncio.wait_for(event.wait(), timeout)
            res = self._responses.pop(request_code, None)
            logger.debug(f"Cmd {request_code} ACK'd. Response: {res.data.hex() if res else 'None'}")
            return res
        except asyncio.TimeoutError:
            logger.warning(f"Cmd {request_code} TIMED OUT after {timeout}s.")
            return None
        except Exception as e:
            logger.error(f"Cmd {request_code} Error: {e}")
            return None
        finally:
            current = self._events.get(request_code)
            if current is not None and current[0] is event:
                self._events.pop(request_code, None)

    async def write_raw(self, data: bytes) -> None:
        if not self.client or not self.client.is_connected:
            raise RuntimeError("BLE client disconnected during write.")
        
        chunk_size = self._ble_profile.standard_chunk_cap
        delay_seconds = self._ble_profile.standard_write_delay_ms / 1000.0
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i + chunk_size]
            try:
                await self.client.write_gatt_char(self.write_uuid, chunk, response=False)
            except BleakError:
                # Flow control fallback for overloaded buffer
                await self.client.write_gatt_char(self.write_uuid, chunk, response=True)
            if delay_seconds:
                await asyncio.sleep(delay_seconds)

    def _prepare_print_image(self, image: Image.Image, print_width_px: int) -> Image.Image:
        working = image.copy()

        # If a wide horizontal label was supplied without pre-rotation, orient it along the print direction
        if working.width > working.height and working.width > print_width_px and working.height <= print_width_px:
            working = working.rotate(90, expand=True)

        # Only scale down if the user generated a label wider than the physical printhead
        if working.width > print_width_px:
            ratio = print_width_px / float(working.width)
            new_height = max(1, int(working.height * ratio))
            working = working.resize((print_width_px, new_height), Image.Resampling.LANCZOS)

        # Pad slightly to ensure the width is a multiple of 8 for byte packing
        remainder = working.width % 8
        if remainder != 0:
            new_width = working.width + (8 - remainder)
            padded = Image.new("RGB", (new_width, working.height), "white")
            padded.paste(working, (0, 0))
            working = padded

        return working.convert("RGB")

    async def _wait_for_page_finished(self, page_num: int, timeout: float = 15.0) -> None:
        """
        Waits for the printer to finish physical printing and paper feed for page_num.
        Polls GET_PRINT_STATUS (0xa3) which returns In_PrintStatus (0xb3 = 179).
        Payload contains: [page_hi, page_lo, page_print_progress, page_feed_progress, ...]
        """
        deadline = asyncio.get_running_loop().time() + timeout
        logger.debug(f"Waiting for physical printer to finish printing page {page_num}...")

        while asyncio.get_running_loop().time() < deadline:
            pkt = await self.send_command(RequestCodeEnum.GET_PRINT_STATUS, b"\x01", timeout=0.8)
            if pkt and pkt.data and len(pkt.data) >= 4:
                reported_page = (pkt.data[0] << 8) | pkt.data[1]
                print_progress = pkt.data[2]
                feed_progress = pkt.data[3]
                logger.debug(
                    f"Printer status: page={reported_page}/{page_num}, "
                    f"print={print_progress}%, feed={feed_progress}%"
                )
                if reported_page >= page_num and (feed_progress >= 100 or feed_progress == 0):
                    logger.debug(f"Page {page_num} finished (feed: {feed_progress}%).")
                    return
            elif pkt and pkt.data:
                logger.debug(f"Printer status raw: {pkt.data.hex()}")
                if pkt.data == b"\x01":
                    await asyncio.sleep(1.0)
                    return
            await asyncio.sleep(0.3)

        logger.warning(f"Status polling timed out after {timeout}s for page {page_num}. Proceeding...")

    async def _finish_print_session(self, timeout: float = 10.0) -> None:
        """
        Ends print session by sending END_PRINT (0xf3) and waiting for confirmation (0x01).
        When the printer is still mechanically busy, END_PRINT returns a multi-byte status.
        Once completely finished, it returns 0x01.
        """
        deadline = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < deadline:
            pkt = await self.send_command(RequestCodeEnum.END_PRINT, b"\x01", timeout=1.0)
            if pkt and pkt.data:
                if len(pkt.data) == 1 and pkt.data[0] == 1:
                    logger.debug("Printer confirmed END_PRINT.")
                    return
                logger.debug(f"Printer busy during END_PRINT (status {pkt.data.hex()}), waiting...")
            await asyncio.sleep(0.5)
        logger.warning(f"END_PRINT polling timed out after {timeout}s.")

    async def print_images(self, images: List[Image.Image], split_mode: bool = False, dither: bool = True) -> None:
        if not images:
            return

        total_pages = len(images)
        logger.info(f"Starting batch print job for {total_pages} image(s)...")

        default_density = int(self.hardware_info.get("default_energy", 3) or 3)
        max_allowed = max(1, int(self.hardware_info.get("max_density", 5) or 5))
        raw_density = (
            self.printer_profile.energy
            if self.printer_profile and self.printer_profile.energy not in (None, 0)
            else default_density
        )
        density = max(1, min(int(raw_density), max_allowed))

        print_width_px = max(1, int(self.hardware_info.get("width_px", 96) or 96))
        media_type_str = self.hardware_info.get("media_type", "pre-cut")
        label_type = 2 if media_type_str == "continuous" else 1

        model_id = str(self.hardware_info.get("model_id") or "").strip().upper()
        protocol_variant = str(self.hardware_info.get("protocol_variant") or "").strip().lower()
        is_b1_family = protocol_variant == "b1" or model_id in ("D110_M", "B1", "B21", "B18", "B3S", "D101")

        logger.info(
            f"Niimbot print: model={model_id}, protocol_variant={protocol_variant}, "
            f"is_b1_family={is_b1_family}, print_width_px={print_width_px}, density={density}, total_pages={total_pages}"
        )

        session_started = False
        try:
            # Session Setup
            await self.send_command(RequestCodeEnum.SET_LABEL_DENSITY, bytes([density]), timeout=1.0)
            await self.send_command(RequestCodeEnum.SET_LABEL_TYPE, bytes([label_type]), timeout=1.0)

            # Start Print Session
            if is_b1_family:
                start_payload = struct.pack(">H4BB", total_pages, 0, 0, 0, 0, 1)
                start_pkt = await self.send_command(RequestCodeEnum.START_PRINT, start_payload, timeout=2.0)
            else:
                start_pkt = await self.send_command(RequestCodeEnum.START_PRINT, b"\x01", timeout=2.0)

            if not start_pkt or not start_pkt.data or start_pkt.data[0] == 0:
                logger.warning("Printer returned 0x00 or None for START_PRINT. Proceeding anyway...")
            session_started = True

            for i, image in enumerate(images):
                page_num = i + 1
                logger.info(f"--- Printing label {page_num} of {total_pages} ---")

                prepared = self._prepare_print_image(image, print_width_px)
                raster = image_to_raster(prepared, PixelFormat.BW1, dither=dither)
                packed_bytes = pack_line(raster.pixels, lsb_first=False)
                width_bytes = (raster.width + 7) // 8

                if not is_b1_family:
                    await self.send_command(RequestCodeEnum.ALLOW_PRINT_CLEAR, b"\x01", timeout=1.0)

                page_pkt = await self.send_command(RequestCodeEnum.START_PAGE_PRINT, b"\x01", timeout=2.0)
                if not page_pkt or not page_pkt.data or page_pkt.data[0] == 0:
                    logger.warning("Printer rejected START_PAGE_PRINT. Forcing transmission...")

                if is_b1_family:
                    await self.send_command(
                        RequestCodeEnum.SET_DIMENSION,
                        struct.pack(">HHH", raster.height, raster.width, 1),
                        timeout=2.0,
                    )
                else:
                    await self.send_command(
                        RequestCodeEnum.SET_DIMENSION,
                        struct.pack(">HH", raster.height, raster.width),
                        timeout=2.0,
                    )
                    await self.send_command(RequestCodeEnum.SET_QUANTITY, struct.pack(">H", 1), timeout=2.0)

                logger.debug(
                    f"Streaming {raster.height} rows of raster data (width={raster.width}px, {width_bytes}B/row)..."
                )
                for y in range(raster.height):
                    line_data = packed_bytes[y * width_bytes : (y + 1) * width_bytes]
                    total_black, parts, indices = count_pixels_for_bitmap(line_data, raster.width)

                    if total_black == 0:
                        packet = NiimbotPacket(RequestCodeEnum.PRINT_EMPTY_ROW, struct.pack(">HB", y, 1))
                    elif total_black <= 6 and indices:
                        header = struct.pack(">HBBBB", y, parts[0], parts[1], parts[2], 1)
                        packet = NiimbotPacket(RequestCodeEnum.PRINT_BITMAP_ROW_INDEXED, header + indices)
                    else:
                        header = struct.pack(">HBBBB", y, parts[0], parts[1], parts[2], 1)
                        packet = NiimbotPacket(RequestCodeEnum.PRINT_BITMAP_ROW, header + line_data)

                    await self.write_raw(packet.to_bytes())

                    if y % 32 == 0:
                        await asyncio.sleep(0.01)

                logger.debug("Row streaming complete. Ending page...")
                await self.send_command(RequestCodeEnum.END_PAGE_PRINT, b"\x01", timeout=3.0)

                # Wait for the printer to physically print and advance this page
                await self._wait_for_page_finished(page_num, timeout=15.0)

            # All pages sent and finished, cleanly end the print session
            logger.info("Finishing print session...")
            await self._finish_print_session(timeout=10.0)
            session_started = False

        except Exception as e:
            logger.error(f"Print job FAILED: {e}")
            raise RuntimeError(f"Print failed: {e}")
        finally:
            if session_started:
                logger.info("Aborting/cleaning up print session...")
                try:
                    await self.send_command(RequestCodeEnum.END_PRINT, b"\x01", timeout=1.0)
                except Exception:
                    pass
            await asyncio.sleep(0.5)
