"""Reads raw RGB frames from stdin and publishes them as a virtual webcam.
usage: vcam_helper.exe WIDTH HEIGHT FPS     (or --selftest)"""
import sys


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
        import numpy, pyvirtualcam  # noqa: F401
        print('SELFTEST OK', flush=True)
        return 0
    if len(sys.argv) < 4:
        sys.stderr.write('usage: vcam_helper WIDTH HEIGHT FPS\n')
        return 1
    w, h, fps = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
    try:
        import numpy as np
        import pyvirtualcam
        from pyvirtualcam import PixelFormat
        cam = pyvirtualcam.Camera(width=w, height=h, fps=fps, fmt=PixelFormat.RGB)
    except Exception as e:  # driver missing, etc.
        sys.stderr.write('%s: %s\n' % (type(e).__name__, e))
        sys.stderr.flush()
        return 2
    print('READY ' + str(cam.device), flush=True)
    size = w * h * 3
    stdin = sys.stdin.buffer
    try:
        while True:
            buf = stdin.read(size)
            if not buf or len(buf) < size:
                break
            cam.send(np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3))
    except (BrokenPipeError, OSError, KeyboardInterrupt):
        pass
    finally:
        try:
            cam.close()
        except Exception:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
