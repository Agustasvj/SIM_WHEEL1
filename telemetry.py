import mmap
import struct
import sys
import os

PLATFORM = sys.platform


class ACTelemetry:
    def __init__(self):
        self.shm = None
        # Linux: file handle kept open so mmap stays valid
        self._file = None

    def connect(self):
        try:
            if PLATFORM == "win32":
                # Windows — Win32 named shared memory created by Assetto Corsa
                self.shm = mmap.mmap(0, 500, "Local\\acpmf_physics")
            else:
                # Linux — AC (via Proton/Wine) writes to a file in /dev/shm
                shm_path = "/dev/shm/acpmf_physics"
                if not os.path.exists(shm_path):
                    return False
                self._file = open(shm_path, "rb")
                self.shm = mmap.mmap(self._file.fileno(), 500, access=mmap.ACCESS_READ)
            return True
        except Exception:
            self._cleanup()
            return False

    def _cleanup(self):
        try:
            if self.shm:
                self.shm.close()
        except Exception:
            pass
        try:
            if self._file:
                self._file.close()
        except Exception:
            pass
        self.shm = None
        self._file = None

    def get_data(self):
        if not self.shm:
            if not self.connect():
                return None

        try:
            self.shm.seek(0)
            data = self.shm.read(320)

            # Read speedKmh at offset 28
            speed_kmh = struct.unpack('<f', data[28:32])[0]

            # Read finalFF (Force Feedback) at offset 316
            # In AC, finalFF is the calculated self-aligning torque sent to the wheel
            final_ff = struct.unpack('<f', data[316:320])[0]

            return {
                "speed": speed_kmh,
                "ffb": final_ff
            }
        except Exception:
            self._cleanup()
            return None
