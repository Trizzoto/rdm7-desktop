import glob, os
from PIL import Image, ImageDraw
files = sorted(glob.glob('marketing/instagram/rdm-*.png'))
cols, tw = 4, 300
th = int(tw*1350/1080)
rows = (len(files)+cols-1)//cols
pad, lab = 10, 22
W = cols*(tw+pad)+pad
H = rows*(th+pad+lab)+pad
sheet = Image.new('RGB',(W,H),(220,220,224))
d = ImageDraw.Draw(sheet)
for i,f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((tw,th), Image.LANCZOS)
    x = pad+(i%cols)*(tw+pad); y = pad+(i//cols)*(th+pad+lab)
    sheet.paste(im,(x,y))
    d.rectangle([x,y,x+tw-1,y+th-1],outline=(150,150,155))
    d.text((x+2,y+th+4), os.path.basename(f)[4:-4], fill=(40,40,42))
sheet.save('tools/hype/out/sheet.png')
print('sheet', sheet.size, len(files),'posters')
