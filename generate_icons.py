#!/usr/bin/env python3
"""
Generiert einfache App-Icons für die PWA.
Ausführen mit: python3 generate_icons.py
Benötigt: pip install Pillow
"""
try:
    from PIL import Image, ImageDraw, ImageFont
    import os

    def make_icon(size, filename):
        img = Image.new('RGB', (size, size), '#080a0f')
        draw = ImageDraw.Draw(img)
        
        # Amber background circle
        margin = size // 8
        draw.ellipse([margin, margin, size-margin, size-margin], fill='#f59e0b')
        
        # "D" letter in center
        try:
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size // 2)
        except:
            font = ImageFont.load_default()
        
        text = "D"
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        x = (size - tw) // 2 - bbox[0]
        y = (size - th) // 2 - bbox[1]
        draw.text((x, y), text, fill='#080a0f', font=font)
        
        img.save(filename)
        print(f"✅ {filename} erstellt ({size}x{size})")

    make_icon(192, 'icon-192.png')
    make_icon(512, 'icon-512.png')
    print("\nIcons erfolgreich generiert!")

except ImportError:
    print("Pillow nicht installiert. Führe aus: pip install Pillow")
    print("Oder verwende eigene Icons: icon-192.png und icon-512.png")
