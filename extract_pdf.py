import subprocess, sys, os

try:
    import fitz
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'PyMuPDF', '-q'])
    import fitz

pdf_path = r'C:\Users\kenji412\Downloads\full-preflop-charts.pdf'
out_dir = r'C:\Users\kenji412\Documents\kenji_ai_test\poker-gto-trainer\pdf_pages'
os.makedirs(out_dir, exist_ok=True)

doc = fitz.open(pdf_path)
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=200)
    pix.save(os.path.join(out_dir, f'page_{i+1}.png'))
print(f'Saved {len(doc)} pages as PNG via PyMuPDF')
