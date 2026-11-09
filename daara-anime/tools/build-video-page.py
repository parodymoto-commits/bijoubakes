"""Builds video.html from tools/video-template.html, reusing the characters and the
Italian script from index.html so both stay in sync."""
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
index = (root / 'index.html').read_text()
tpl = (root / 'tools' / 'video-template.html').read_text()

def char_svg(char_id):
    block = index.split(f'id="{char_id}" aria-hidden="true">', 1)[1]
    svg = block[block.index('<svg'):block.index('</svg>') + 6]
    # no outline on shadows, highlights and blush
    svg = re.sub(r'<ellipse cx="100" cy="332"', '<ellipse class="no" cx="100" cy="332"', svg)
    svg = re.sub(r'<circle (cx="\d+" cy="\d+" r="2")', r'<circle class="no" \1', svg)
    svg = re.sub(r'<circle (cx="\d+" cy="\d+" r="[\d.]+" fill="#c0614a")', r'<circle class="no" \1', svg)
    svg = svg.replace('<g class="eyes">', '<g class="eyes">').replace('fill="#2a1a10"/>', 'fill="#2a1a10" class="no"/>')
    return svg

scenes = re.search(r'const scenes_it = \[[\s\S]*?\n\];', index).group(0)
out = tpl.replace('{{BOY}}', char_svg('boy')).replace('{{GIRL}}', char_svg('girl')).replace('{{SCENES}}', scenes)
(root / 'video.html').write_text(out)
print('video.html written')
