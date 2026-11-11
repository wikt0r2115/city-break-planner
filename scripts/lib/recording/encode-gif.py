"""Encode trusted browser screenshots, then decode every GIF frame before release."""
import json
from pathlib import Path
import sys

from PIL import Image, __version__

manifest = json.loads(Path(sys.argv[1]).read_text())
output = Path(sys.argv[2])
frames = []
for frame in manifest:
    with Image.open(frame["filename"]) as screenshot:
        frames.append(screenshot.convert("RGB").quantize(colors=256))

assert len(frames) >= 6, "The demo must contain every release step"
frames[0].save(output, format="GIF", save_all=True, append_images=frames[1:],
               duration=[frame["duration"] for frame in manifest], loop=0,
               disposal=2, optimize=True)

with Image.open(output) as recording:
    assert recording.format == "GIF"
    assert recording.n_frames == len(frames)
    duration = 0
    for index in range(recording.n_frames):
        recording.seek(index)
        recording.load()
        duration += recording.info.get("duration", 0)
    assert recording.info.get("loop") == 0
    assert duration >= 10000
    assert output.stat().st_size < 10 * 1024 * 1024, "Keep the repository demo below 10 MiB"
    print(json.dumps({"format": "GIF", "frames": recording.n_frames,
                      "durationMs": duration, "width": recording.width,
                      "height": recording.height, "bytes": output.stat().st_size,
                      "encoder": "Pillow " + __version__}))
