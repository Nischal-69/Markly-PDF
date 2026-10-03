"""Generates Batch 1 test fixtures: a 5-page text PDF + a corrupt file."""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = "tests/fixtures/markly-5page.pdf"

c = canvas.Canvas(OUT, pagesize=A4)
W, H = A4
paras = [
    "Welcome to Markly PDF",
    "Batch 1 verification document",
    "Selection, zoom and scroll test",
    "Thumbnails and navigation test",
    "Final page of the fixture",
]
for i, head in enumerate(paras, start=1):
    c.setFont("Helvetica-Bold", 20)
    c.drawString(72, H - 96, f"Page {i} — {head}")
    c.setFont("Helvetica", 12)
    y = H - 140
    for line in range(30):
        c.drawString(
            72, y,
            f"Line {line + 1:02d}: sample body text for selection, "
            f"zoom and scroll testing (page {i}).",
        )
        y -= 20
    c.setFont("Helvetica-Oblique", 10)
    c.drawCentredString(W / 2, 48, f"Markly PDF test fixture — page {i} of 5")
    c.showPage()
c.save()
print("wrote", OUT)

with open("tests/fixtures/corrupt.pdf", "wb") as f:
    f.write(b"%PDF-1.4 GARBAGE TRUNCATED \x00\xff\xfe not a real pdf xref")
print("wrote tests/fixtures/corrupt.pdf")
