"""Read-only Win32 serial diagnostic, independent of .NET SerialPort."""

import ctypes as c
from ctypes import wintypes as w
from datetime import datetime
import json
from pathlib import Path
import time


class DCB(c.Structure):
    _fields_ = [
        ('length', w.DWORD), ('baud', w.DWORD), ('flags', w.DWORD),
        ('reserved', w.WORD), ('xon_limit', w.WORD), ('xoff_limit', w.WORD),
        ('byte_size', w.BYTE), ('parity', w.BYTE), ('stop_bits', w.BYTE),
        ('xon', c.c_char), ('xoff', c.c_char), ('error_char', c.c_char),
        ('eof', c.c_char), ('event_char', c.c_char), ('reserved1', w.WORD),
    ]


class Timeouts(c.Structure):
    _fields_ = [(name, w.DWORD) for name in (
        'read_interval', 'read_multiplier', 'read_constant',
        'write_multiplier', 'write_constant',
    )]


class CommStat(c.Structure):
    _fields_ = [('flags', w.DWORD), ('in_queue', w.DWORD), ('out_queue', w.DWORD)]


kernel = c.WinDLL('kernel32', use_last_error=True)


def bind(name, arguments, result=w.BOOL):
    function = getattr(kernel, name)
    function.argtypes = arguments
    function.restype = result
    return function


create_file = bind('CreateFileW', [w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p,
                                 w.DWORD, w.DWORD, w.HANDLE], w.HANDLE)
get_state = bind('GetCommState', [w.HANDLE, c.POINTER(DCB)])
set_state = bind('SetCommState', [w.HANDLE, c.POINTER(DCB)])
set_timeouts = bind('SetCommTimeouts', [w.HANDLE, c.POINTER(Timeouts)])
get_timeouts = bind('GetCommTimeouts', [w.HANDLE, c.POINTER(Timeouts)])
purge = bind('PurgeComm', [w.HANDLE, w.DWORD])
read_file = bind('ReadFile', [w.HANDLE, c.c_void_p, w.DWORD,
                            c.POINTER(w.DWORD), c.c_void_p])
comm_error = bind('ClearCommError', [w.HANDLE, c.POINTER(w.DWORD),
                                   c.POINTER(CommStat)])
close = bind('CloseHandle', [w.HANDLE])


def check(result):
    if not result:
        raise c.WinError(c.get_last_error())


def now():
    return datetime.now().astimezone().isoformat()


def state_dict(state):
    return dict(baud=state.baud, byte_size=state.byte_size, parity=state.parity,
                stop_bits=state.stop_bits, flags=hex(state.flags),
                dtr_control=(state.flags >> 4) & 3,
                rts_control=(state.flags >> 12) & 3)


def queue_state(handle):
    errors = w.DWORD()
    status = CommStat()
    check(comm_error(handle, c.byref(errors), c.byref(status)))
    return dict(error_mask=errors.value, in_queue=status.in_queue,
                out_queue=status.out_queue)


def capture(root, name, duration):
    handle = create_file(r'\\.\COM3', 0xC0000000, 0, None, 3, 0, None)
    if handle == c.c_void_p(-1).value:
        raise c.WinError(c.get_last_error())
    summary = dict(phase=name, started_at=now(), bytes=0, chunks=0,
                   empty_reads=0, native_errors=[])
    print(json.dumps(dict(event='capture_started', phase=name, time=now())), flush=True)
    try:
        state = DCB()
        state.length = c.sizeof(DCB)
        check(get_state(handle, c.byref(state)))
        summary['settings_before'] = state_dict(state)
        state.baud = 9600
        state.flags = 0x11  # Binary mode and DTR enabled; no flow control or RTS.
        state.byte_size = 8
        state.parity = 0
        state.stop_bits = 0
        check(set_state(handle, c.byref(state)))
        # Return buffered data immediately, otherwise wait at most 300 ms.
        timeouts = Timeouts(0xFFFFFFFF, 0xFFFFFFFF, 300, 0, 300)
        check(set_timeouts(handle, c.byref(timeouts)))
        check(get_state(handle, c.byref(state)))
        check(get_timeouts(handle, c.byref(timeouts)))
        summary['effective_settings'] = state_dict(state)
        summary['effective_timeouts'] = {
            field: getattr(timeouts, field) for field, _ in Timeouts._fields_
        }
        summary['queue_before_purge'] = queue_state(handle)
        check(purge(handle, 0x000A))  # Abort pending RX and clear the RX queue.
        summary['queue_after_purge'] = queue_state(handle)
        started = time.monotonic()
        with (root / (name + '.bin')).open('wb') as raw, \
                (root / (name + '.jsonl')).open('w', encoding='utf-8') as log:
            while time.monotonic() - started < duration:
                before = queue_state(handle)
                buffer = c.create_string_buffer(256)
                count = w.DWORD()
                check(read_file(handle, buffer, len(buffer), c.byref(count), None))
                elapsed = time.monotonic() - started
                after = queue_state(handle)
                for status in (before, after):
                    if status['error_mask']:
                        summary['native_errors'].append(dict(seconds=elapsed, **status))
                if not count.value:
                    summary['empty_reads'] += 1
                    continue
                data = buffer.raw[:count.value]
                raw.write(data)
                log.write(json.dumps(dict(timestamp=now(), seconds=round(elapsed, 6),
                                          bytes=len(data), hex=data.hex(),
                                          before=before, after=after)) + '\n')
                summary['bytes'] += len(data)
                summary['chunks'] += 1
        summary['duration_seconds'] = round(time.monotonic() - started, 3)
    finally:
        check(close(handle))
        summary['ended_at'] = now()
        (root / (name + '-summary.json')).write_text(
            json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary), flush=True)
    return summary


if __name__ == '__main__':
    assert c.sizeof(DCB) == 28
    assert c.sizeof(Timeouts) == 20
    assert c.sizeof(CommStat) == 12
    root = Path('.generated/scale-captures') / datetime.now().strftime('native-test-%Y%m%d-%H%M%S')
    root.mkdir(parents=True)
    print(json.dumps(dict(event='artifacts', path=str(root))), flush=True)
    summaries = [capture(root, 'initial', 10)]
    print(json.dumps(dict(event='idle_started', seconds=60, time=now())), flush=True)
    time.sleep(60)
    summaries.append(capture(root, 'after-idle', 20))
    (root / 'summary.json').write_text(
        json.dumps(summaries, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(event='finished', path=str(root))), flush=True)
