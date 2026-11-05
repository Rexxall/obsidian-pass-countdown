"""Pass Countdown README demo: record an activation, watch the count, ring and pace change.

    python3 demo_pc.py <frames dir> <light|dark> <out.gif>
"""
import os
import json, sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, os.environ.get('README_KIT', str(Path(__file__).parent)))  # folder with the shared make_demo.py
from make_demo import Film, smooth, ACCENT, SCALE

def load(d):
    d = Path(d)
    boxes = {k: [v * SCALE for v in b] for k, b in json.loads((d / 'boxes.json').read_text()).items()}
    shots = {}
    for f in sorted(d.glob('*.png')):
        shots.setdefault(f.stem.split('-', 1)[1], []).append(Image.open(f).convert('RGB'))
    return boxes, shots

def centre(b):
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)

def main(frames, mode, out):
    boxes, shots = load(frames)
    start, modal, types, result = shots['start'][0], shots['modal'][0], shots['type'], shots['result'][0]
    film = Film(mode, start.size)
    side = film.cam(1248, 110, start.width - 1248)
    dialog = film.around([700, 300, 1840, 1240], 1500)
    rec, label, save = centre(boxes['button']), centre(boxes['label']), centre(boxes['save'])
    enter = (start.width - 200, 1250)

    film.add(start, side, 900)
    for k in range(1, 11):
        film.add(start, side, 35, cursor=film.mix(enter, rec, smooth(k / 10)))
    for k in range(4):
        film.add(start, side, 45, cursor=rec, ripple=(*rec, k / 3))
    for k in range(1, 11):  # the dialog opens; the camera moves to it
        film.add(modal, film.mix(side, dialog, smooth(k / 10)), 45, cursor=rec)
    film.add(modal, dialog, 700, cursor=rec)
    film.add(modal, dialog, 1300, cursor=rec, ring=boxes['preview'], ring_color=ACCENT[mode])
    for k in range(1, 9):
        film.add(modal, dialog, 35, cursor=film.mix(rec, label, smooth(k / 8)))
    for k in range(3):
        film.add(modal, dialog, 45, cursor=label, ripple=(*label, k / 2))
    for img in types:
        film.add(img, dialog, 110, cursor=label)
    for k in range(1, 9):
        film.add(types[-1], dialog, 35, cursor=film.mix(label, save, smooth(k / 8)))
    for k in range(4):
        film.add(types[-1], dialog, 45, cursor=save, ripple=(*save, k / 3))
    for k in range(1, 11):  # back to the panel
        film.add(result, film.mix(dialog, side, smooth(k / 10)), 45)
    film.add(result, side, 800)
    film.add(result, side, 1100, ring=boxes['count'], ring_color=ACCENT[mode])
    film.add(result, side, 1100, ring=boxes['current'], ring_color=ACCENT[mode])
    film.add(result, side, 1300, ring=boxes['pace'], ring_color=ACCENT[mode])
    for k in range(1, 9):
        film.add(result, film.mix(side, film.full, smooth(k / 8)), 55)
    film.add(result, film.full, 2400)
    film.save(out)

if __name__ == '__main__':
    main(*sys.argv[1:4])
