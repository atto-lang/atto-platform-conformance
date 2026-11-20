#!/usr/bin/env python3
"""Independent host-only RFC6455 client-frame oracle. No native guest runs."""
import json
import pathlib
import re
import struct
import sys

MAX_BYTES = 65536
HEX = re.compile(r'(?:[0-9a-f]{2})+')
IDS = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')


class FrameError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def fail(code, message):
    raise FrameError(code, message)


def valid_close(code):
    return (1000 <= code < 5000 and code not in (1004, 1005, 1006, 1015)
            and (code < 1016 or code >= 3000))


def interpret(raw):
    if len(raw) > MAX_BYTES * 64:
        fail(1009, 'stream exceeds test budget')
    offset, fragments, opcode_open, result, closed = 0, [], None, [], False
    while offset < len(raw):
        if closed or offset + 2 > len(raw):
            fail(1002, 'bytes after close or truncated header')
        a, b = raw[offset:offset+2]
        offset += 2
        fin, opcode = bool(a & 0x80), a & 0x0f
        masked, length = bool(b & 0x80), b & 0x7f
        if a & 0x70 or not masked or opcode not in (0, 1, 2, 8, 9, 10):
            fail(1002, 'invalid header/mask/opcode')
        if opcode == 2:
            fail(1003, 'binary unsupported')
        if opcode >= 8 and (not fin or length > 125):
            fail(1002, 'invalid control frame')
        if length == 126:
            if offset + 2 > len(raw):
                fail(1002, 'truncated 16-bit length')
            length = struct.unpack('!H', raw[offset:offset+2])[0]
            offset += 2
            if length < 126:
                fail(1002, 'nonminimal 16-bit length')
        elif length == 127:
            if offset + 8 > len(raw):
                fail(1002, 'truncated 64-bit length')
            length = struct.unpack('!Q', raw[offset:offset+8])[0]
            offset += 8
            if length < 65536 or length >> 63:
                fail(1002, 'invalid 64-bit length')
        if length > MAX_BYTES or (opcode >= 8 and length > 125):
            fail(1009 if opcode < 8 else 1002, 'frame exceeds bound')
        if offset + 4 + length > len(raw):
            fail(1002, 'truncated frame')
        mask = raw[offset:offset+4]
        offset += 4
        data = bytes(raw[offset + i] ^ mask[i & 3] for i in range(length))
        offset += length
        if opcode == 8:
            if length == 1:
                fail(1002, 'invalid close length')
            if length >= 2:
                if not valid_close(int.from_bytes(data[:2], 'big')):
                    fail(1002, 'invalid close status')
                try:
                    data[2:].decode('utf-8', 'strict')
                except UnicodeDecodeError:
                    fail(1007, 'invalid close reason')
            result.append({'type': 'close', 'data_hex': data.hex()})
            closed = True
            continue
        if opcode in (9, 10):
            result.append({'type': 'ping' if opcode == 9 else 'pong',
                           'data_hex': data.hex()})
            continue
        if opcode == 0:
            if opcode_open is None:
                fail(1002, 'orphan continuation')
        elif opcode_open is not None:
            fail(1002, 'new data frame during fragmentation')
        else:
            opcode_open = opcode
        fragments.append(data)
        if len(fragments) > 64 or sum(map(len, fragments)) > MAX_BYTES:
            fail(1009, 'message budget exceeded')
        if fin:
            try:
                decoded = b''.join(fragments).decode('utf-8', 'strict')
            except UnicodeDecodeError:
                fail(1007, 'invalid UTF-8 text')
            result.append({'type': 'text', 'data': decoded})
            opcode_open = None
            fragments.clear()
    if opcode_open is not None:
        fail(1002, 'incomplete fragmented message')
    return result


def verify(path):
    manifest = json.loads(path.read_text(encoding='utf8'))
    if manifest.get('schema') != 'ores-liveview-wire-v1':
        raise AssertionError('schema mismatch')
    # Never permit the declared budgets to diverge from the actual decoder.
    if manifest.get('limits') != {'max_message_bytes': MAX_BYTES, 'max_fragments': 64}:
        raise AssertionError('wire budget mismatch')
    origin = manifest.get('source', {})
    if (origin.get('repo') != 'ores-truffle-oreslang/oreslang-phoenix-server.ores'
            or origin.get('pr') != 11
            or not re.fullmatch(r'[0-9a-f]{40}', origin.get('head', ''))
            or not re.fullmatch(r'[0-9a-f]{40}', origin.get('blob', ''))):
        raise AssertionError('unrecognized pinned fixture provenance')
    cases = manifest.get('cases')
    if not isinstance(cases, list) or len(cases) < 14:
        raise AssertionError('missing wire cases')
    seen = set()
    for case in cases:
        case_id, raw_hex = case['id'], case['frames_hex']
        if not IDS.fullmatch(case_id) or case_id in seen or not HEX.fullmatch(raw_hex):
            raise AssertionError('duplicate/invalid ID or hex')
        seen.add(case_id)
        success = case.get('expected') is not None
        if success == ('error_code' in case):
            raise AssertionError(f'{case_id}: ambiguous expectation')
        try:
            output = interpret(bytes.fromhex(raw_hex))
        except FrameError as error:
            if success or error.code != case['error_code']:
                raise AssertionError(f'{case_id}: unexpected close {error.code}') from error
        else:
            if not success or output != case['expected']:
                raise AssertionError(f'{case_id}: unexpected acceptance {output!r}')
    print(f'HOST_WIRE_ORACLE_PASS cases={len(seen)}; NATIVE_GUEST_NOT_EXECUTED')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: verify_liveview_wire.py manifest.json')
    verify(pathlib.Path(sys.argv[1]))
