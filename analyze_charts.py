"""
Analyze poker range chart images from PDF pages.
Detect 13x13 grid cells and classify actions by color.
"""
import os, sys
try:
    from PIL import Image
    import numpy as np
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'Pillow', 'numpy', '-q'])
    from PIL import Image
    import numpy as np

RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']
IMG_DIR = r'C:\Users\kenji412\Documents\kenji_ai_test\poker-gto-trainer\pdf_pages'

def grid_to_hand(row, col):
    if row == col: return RANKS[row] + RANKS[col]
    if row < col: return RANKS[row] + RANKS[col] + 's'
    return RANKS[col] + RANKS[row] + 'o'

def classify_color(r, g, b):
    """Classify a pixel color to an action based on PokerCoaching chart colors."""
    # Typical colors:
    # Raise/Open = Red/Orange
    # Call = Green
    # 3-bet = Red/Dark red
    # 4-bet = Dark red/Purple
    # Fold = Gray/White/Light
    
    # Convert to HSV-like logic
    mx = max(r, g, b)
    mn = min(r, g, b)
    diff = mx - mn
    
    # Very light / white / gray = fold
    if mx < 100 and mn < 100:  # very dark
        return 'fold'
    if diff < 30 and mx > 180:  # grayish/white
        return 'fold'
    
    # Red dominant
    if r > g + 40 and r > b + 40:
        if r > 180:
            return 'raise'  # bright red = raise/open
        return 'raise'      # darker red still raise
    
    # Green dominant
    if g > r + 20 and g > b + 20:
        return 'call'
    
    # Blue dominant (sometimes used for call or specific action)
    if b > r + 30 and b > g + 10:
        return 'call'
    
    # Yellow/Orange (r and g both high, b low)
    if r > 150 and g > 100 and b < 100:
        return 'raise'
    
    # Purple (r and b high, g low) = sometimes 4-bet
    if r > 100 and b > 100 and g < 100:
        return 'raise'
    
    return 'fold'

def find_grids_in_image(img_path):
    """
    Try to find 13x13 grids in the image by looking for regular patterns of colored cells.
    Returns list of (x_start, y_start, cell_w, cell_h) tuples.
    """
    img = Image.open(img_path)
    arr = np.array(img)
    return img, arr

def sample_grid(arr, x0, y0, cell_w, cell_h, grid_size=13):
    """Sample the center color of each cell in a 13x13 grid."""
    results = []
    for row in range(grid_size):
        row_data = []
        for col in range(grid_size):
            cx = int(x0 + col * cell_w + cell_w / 2)
            cy = int(y0 + row * cell_h + cell_h / 2)
            if cy < arr.shape[0] and cx < arr.shape[1]:
                pixel = arr[cy, cx]
                r, g, b = pixel[0], pixel[1], pixel[2]
                action = classify_color(r, g, b)
                row_data.append((grid_to_hand(row, col), action, (r, g, b)))
            else:
                row_data.append((grid_to_hand(row, col), 'fold', (0, 0, 0)))
        results.append(row_data)
    return results

def analyze_page3_rfi():
    """Analyze RFI page (page 3) - 8 charts: UTG, UTG+1, UTG+2, LJ, HJ, CO, BTN, SB"""
    img = Image.open(os.path.join(IMG_DIR, 'page_3.png'))
    arr = np.array(img)
    h, w = arr.shape[:2]
    print(f"Page 3 dimensions: {w}x{h}")
    
    # First, let's find colored regions to understand the layout
    # Sample some key pixels to understand chart positions
    # The page likely has a 2x4 or 4x2 grid of charts
    
    # Let's scan for regions of strong color (non-white, non-gray)
    # to find chart boundaries
    colored_mask = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(w):
            r, g, b = arr[y, x, 0], arr[y, x, 1], arr[y, x, 2]
            diff = int(max(r, g, b)) - int(min(r, g, b))
            if diff > 40 and max(r, g, b) > 80:
                colored_mask[y, x] = True
    
    # Find bounding boxes of colored regions
    # Project colored pixels onto x and y axes
    y_proj = colored_mask.any(axis=1)
    x_proj = colored_mask.any(axis=0)
    
    # Find runs of True in y_proj and x_proj
    def find_runs(arr):
        runs = []
        in_run = False
        start = 0
        for i, v in enumerate(arr):
            if v and not in_run:
                start = i
                in_run = True
            elif not v and in_run:
                if i - start > 20:  # minimum size
                    runs.append((start, i))
                in_run = False
        if in_run and len(arr) - start > 20:
            runs.append((start, len(arr)))
        return runs
    
    y_runs = find_runs(y_proj)
    x_runs = find_runs(x_proj)
    
    print(f"Y-axis chart bands: {len(y_runs)} found")
    for i, (s, e) in enumerate(y_runs):
        print(f"  Band {i}: y={s}-{e} (height={e-s})")
    print(f"X-axis chart bands: {len(x_runs)} found")
    for i, (s, e) in enumerate(x_runs):
        print(f"  Band {i}: x={s}-{e} (width={e-s})")

# First just analyze the layout
print("=== Analyzing Page 3 (RFI) layout ===")
analyze_page3_rfi()
