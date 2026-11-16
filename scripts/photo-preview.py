import sys
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 25_000_000
with Image.open(sys.argv[1]) as image:
    image = ImageOps.exif_transpose(image).convert('RGB')
    image.thumbnail((768, 960))
    image.save(sys.argv[2], 'WEBP', quality=76, method=4)
