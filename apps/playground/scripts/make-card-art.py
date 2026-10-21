# Draws the engraving mask for the Metal card scene, white on transparent at 1024 x 645 to match the
# card's aspect ratio. Opaque pixels are engraved.
# Run: python3 scripts/make-card-art.py assets/images/card-art.png
# Needs Pillow and the DejaVu fonts.
import sys
from PIL import Image, ImageDraw, ImageFont
W, H = 1024, 645
S = 4  # supersample for smooth edges
img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
F = "/usr/share/fonts/truetype/dejavu/"
font = lambda name, size: ImageFont.truetype(F + name, size * S)
white = (255, 255, 255, 255)
# Wordmark with a round mark.
d.ellipse((70 * S, 62 * S, 118 * S, 110 * S), outline=white, width=7 * S)
d.ellipse((88 * S, 50 * S, 100 * S, 70 * S), fill=white)
d.text((134 * S, 50 * S), "apricot", font=font("DejaVuSans-Bold.ttf", 58), fill=white)
# Spaced-out label, top right.
label = "M E T A L"
lf = font("DejaVuSans.ttf", 26)
lw = d.textlength(label, font=lf)
d.text((W * S - 70 * S - lw, 70 * S), label, font=lf, fill=white)
# Contactless symbol right of the chip (chip spans x 121–255, y 247–349).
cx, cy = 300, 298
for i, r in enumerate([16, 30, 44, 58]):
    d.arc(((cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S), -50, 50, fill=white, width=6 * S)
# Number, name, expiry.
d.text((70 * S, 410 * S), "5354  ••••  ••••  4242", font=font("DejaVuSansMono-Bold.ttf", 50), fill=white)
d.text((70 * S, 535 * S), "ALEX MORGAN", font=font("DejaVuSans-Bold.ttf", 32), fill=white)
d.text((560 * S, 535 * S), "09/29", font=font("DejaVuSansMono-Bold.ttf", 32), fill=white)
# Generic network mark: two overlapping rings.
for x in (850, 912):
    d.ellipse(((x - 44) * S, (548 - 44) * S, (x + 44) * S, (548 + 44) * S), outline=white, width=7 * S)
img = img.resize((W, H), Image.LANCZOS)
img.save(sys.argv[1], optimize=True)
