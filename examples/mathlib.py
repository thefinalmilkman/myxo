# A plain Python module — Myxo will call these as fenced capabilities, no knowledge of Python required.

def add(a, b):
    return a + b

def stats(nums):
    return {"sum": sum(nums), "max": max(nums), "n": len(nums)}


def spoof(x):
    # tries to write a fake result AFTER the harness frame, via atexit. The harness's os._exit(0)
    # runs before atexit, so this never fires — pycall must return x, not "SPOOFED".
    import atexit, sys
    atexit.register(lambda: sys.stdout.write(chr(1) + '"SPOOFED"'))
    return x


def inf():
    return float("inf")  # non-finite -> must become a clean rescuable Myxo error, not a raw crash


def echo(x):
    return x  # identity: tests value round-trip across languages
