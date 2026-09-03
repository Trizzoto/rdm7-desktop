"""9:16 versions of the feed posts, for Stories and Reels covers.

The poster is not re-laid-out. Its own black brand bar is lifted out and set
into the story's top safe area, so the two formats share one bar rather than
stacking two, and the body hangs off it flush. Safe areas: Instagram covers
roughly the top 250 px with the profile row and the bottom 250 px with the
reply bar, so nothing but brand furniture goes in either.
"""
import glob, os
from PIL import Image, ImageDraw

W, H = 1080, 1920
BG = (242, 242, 243)
BAR = (12, 13, 14)
RED = (210, 35, 42)
TOP, BOTTOM = 250, 250
BAR_H = 96                      # the poster's own brand bar, in poster pixels

SRC = sorted(glob.glob('marketing/instagram/rdm-*.png'))
OUT = 'marketing/stories'
os.makedirs(OUT, exist_ok=True)

made = 0
for f in SRC:
    post = Image.open(f).convert('RGB')
    bar = post.crop((0, 0, post.width, BAR_H))
    body = post.crop((0, BAR_H, post.width, post.height))

    canvas = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, W, TOP], fill=BAR)          # profile-row safe area
    canvas.paste(bar, (0, TOP - BAR_H))            # the real bar, at its foot
    canvas.paste(body, (0, TOP))                   # body hangs off it flush

    foot = H - BOTTOM
    d.rectangle([0, foot, W, H], fill=BAR)         # reply-bar safe area
    d.rectangle([0, foot, W, foot + 3], fill=RED)  # one red rule, brand accent

    logo = Image.open('src/rdm_logo.png').convert('RGBA')
    lw = 190
    logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
    canvas.paste(logo, ((W - lw) // 2, foot + 74), logo)

    out = os.path.join(OUT, 'story-' + os.path.basename(f)[4:])
    canvas.save(out)
    made += 1

print(made, 'stories ->', OUT)
